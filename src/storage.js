const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const path = require('node:path');
const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const {
  ON_VERCEL, DATA_DIR, STORE_FILE, CATALOG_FILE, PROD, SESSION_KEY, LEGACY_PRODUCT_IDS
} = u(require('./config'));

/*
 * Storage layer.
 *
 * Products and orders live in an AES-256-GCM encrypted JSON snapshot on disk.
 * Visitor sessions are NOT stored in that file any more: they are sealed into a
 * signed, encrypted cookie. That keeps the store stateless on serverless hosts
 * (Vercel lambdas each get their own /tmp) and removes a full-store rewrite from
 * every cart/favourite/language change.
 */

let store = null;
let writeQueue = Promise.resolve();
let writeSeq = 0;

const SESSION_COOKIE = 'kraken_sess';
const LEGACY_COOKIE = 'kraken_sid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const MAX_CART_LINES = 24;
const MAX_FAVORITES = 40;
const MAX_COMPARE = 4;
const MAX_COOKIE_BYTES = 3600;

/* ------------------------------------------------------------------ store io */

function deriveStoreKey(secret) {
  return crypto.createHash('sha256').update('krakenpc-store-v1:' + secret).digest();
}

function decryptStorePayload(parsed, secret) {
  const key = deriveStoreKey(secret);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64url')), decipher.final()]).toString('utf8')
  );
}

function encryptStorePayload(data, secret) {
  const iv = crypto.randomBytes(12);
  const key = deriveStoreKey(secret);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url')
  });
}

function loadCatalogSeed() {
  const candidates = [
    CATALOG_FILE,
    path.join(process.cwd(), 'data', 'catalog.json'),
    path.resolve(__dirname, '..', 'data', 'catalog.json'),
    '/var/task/data/catalog.json'
  ].filter(Boolean);
  for (const file of candidates) {
    if (fsSync.existsSync(file)) {
      return JSON.parse(fsSync.readFileSync(file, 'utf8'));
    }
  }
  return JSON.parse(fsSync.readFileSync(CATALOG_FILE, 'utf8'));
}

function syncCatalogProducts(catalogList) {
  const existingById = new Map((store.products || []).map(p => [p.id, p]));
  let changed = false;
  const merged = catalogList.map(seed => {
    const existing = existingById.get(seed.id);
    if (!existing) {
      changed = true;
      return structuredClone(seed);
    }
    const preservedStock = Number.isInteger(existing.stock) ? existing.stock : seed.stock;
    const next = { ...structuredClone(seed), stock: preservedStock };
    if (JSON.stringify(existing) !== JSON.stringify(next)) changed = true;
    return next;
  });
  if (merged.length !== (store.products || []).length) changed = true;
  store.products = merged;
  return changed;
}

async function renameWithRetry(src, dest) {
  let delay = 12;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (error) {
      if ((error.code !== 'EPERM' && error.code !== 'EBUSY' && error.code !== 'EACCES') || attempt === 4) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

async function saveStore() {
  const payload = encryptStorePayload(store, SESSION_KEY);
  const nextWrite = writeQueue.catch(() => {}).then(async () => {
    const temp = `${STORE_FILE}.${process.pid}.${++writeSeq}.tmp`;
    try {
      await fs.writeFile(temp, payload, { mode: 0o600 });
      await renameWithRetry(temp, STORE_FILE);
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      throw error;
    }
  });
  writeQueue = nextWrite;
  return nextWrite;
}

async function initStore() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const catalogSeed = loadCatalogSeed();

  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.algorithm === 'aes-256-gcm' && parsed.version === 1) {
      store = decryptStorePayload(parsed, SESSION_KEY);
    } else {
      store = parsed;
    }
    if (!Array.isArray(store.products) || !Array.isArray(store.orders)) {
      throw new Error('Invalid store data');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (ON_VERCEL || process.env.KRAKEN_DATA_DIR) {
        console.warn('Resetting temporary store cache after key/format mismatch.');
      } else {
        throw new Error('Store data could not be read. Back up .data/store.json and restore valid JSON before restarting.');
      }
    }
    store = { products: catalogSeed, orders: [] };
    await saveStore();
  }

  // sessions used to be persisted here; they are cookie-sealed now.
  delete store.sessions;

  if (syncCatalogProducts(catalogSeed)) {
    await saveStore();
  }
}

function getStore() {
  return store;
}

const productById = id => store.products.find(p => p.id === id);
const productBySlug = slug => store.products.find(p => p.slug === slug);

/* --------------------------------------------------------------- cookies */

function cookieMap(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf('=');
    const key = i < 0 ? trimmed : trimmed.slice(0, i);
    const raw = i < 0 ? '' : trimmed.slice(i + 1);
    try { out[key] = decodeURIComponent(raw); } catch { out[key] = ''; }
  }
  return out;
}

function isRequestSecure(req) {
  if (req?.socket?.encrypted) return true;
  if (ON_VERCEL || process.env.TRUST_PROXY === '1') {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
  }
  return false;
}

function hmac(value, secret = SESSION_KEY) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function adminProof() {
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!password) return '';
  return crypto.createHmac('sha256', password).update('krakenpc-admin-v2').digest('base64url');
}

function isAdminProof(value) {
  const expected = adminProof();
  if (!expected || typeof value !== 'string') return false;
  const supplied = Buffer.from(value);
  const target = Buffer.from(expected);
  return supplied.length === target.length && crypto.timingSafeEqual(supplied, target);
}

/* --------------------------------------------------------------- session */

function sessionCryptoKey() {
  return crypto.createHash('sha256').update('krakenpc-session-v2:' + SESSION_KEY).digest();
}

function freshCsrf() {
  return crypto.randomBytes(24).toString('base64url');
}

function freshSession() {
  return {
    sid: crypto.randomBytes(12).toString('hex'),
    lang: 'uz',
    theme: 'dark',
    csrf: freshCsrf(),
    cart: {},
    favorites: [],
    compare: [],
    isAdmin: false,
    createdAt: Date.now()
  };
}

function cleanId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

function sanitizeSession(input) {
  const base = freshSession();
  const src = input && typeof input === 'object' ? input : {};
  const session = {
    sid: /^[a-f0-9]{16,48}$/.test(String(src.sid || '')) ? String(src.sid) : base.sid,
    lang: ['uz', 'ru', 'en'].includes(src.lang) ? src.lang : 'uz',
    theme: ['light', 'dark'].includes(src.theme) ? src.theme : 'dark',
    csrf: /^[A-Za-z0-9_-]{20,64}$/.test(String(src.csrf || '')) ? String(src.csrf) : freshCsrf(),
    cart: {},
    favorites: [],
    compare: [],
    isAdmin: isAdminProof(String(src.isAdminProof || '')),
    createdAt: Number.isFinite(Number(src.createdAt)) ? Number(src.createdAt) : base.createdAt
  };

  let lines = 0;
  for (const [rawId, rawQty] of Object.entries(src.cart && typeof src.cart === 'object' ? src.cart : {})) {
    if (lines >= MAX_CART_LINES) break;
    const id = cleanId(rawId);
    const qty = Number(rawQty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) continue;
    session.cart[id] = qty;
    lines++;
  }

  const list = (raw, max) => {
    const out = [];
    for (const value of Array.isArray(raw) ? raw : []) {
      const id = cleanId(value);
      if (id && !out.includes(id) && out.length < max) out.push(id);
    }
    return out;
  };
  session.favorites = list(src.favorites, MAX_FAVORITES);
  session.compare = list(src.compare, MAX_COMPARE);
  return session;
}

function sealSession(session) {
  const payload = {
    v: 2,
    sid: session.sid,
    lang: session.lang,
    theme: session.theme,
    csrf: session.csrf,
    cart: session.cart,
    favorites: session.favorites,
    compare: session.compare,
    isAdminProof: session.isAdmin ? adminProof() : '',
    createdAt: session.createdAt
  };
  const deflated = zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionCryptoKey(), iv);
  const body = Buffer.concat([cipher.update(deflated), cipher.final()]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  return `${packed}.${hmac(SESSION_COOKIE + '.' + packed)}`;
}

function openSession(raw) {
  if (typeof raw !== 'string' || raw.length < 24) return null;
  const at = raw.lastIndexOf('.');
  if (at < 1) return null;
  const packed = raw.slice(0, at);
  const supplied = raw.slice(at + 1);
  const expected = hmac(SESSION_COOKIE + '.' + packed);
  if (supplied.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;

  try {
    const bytes = Buffer.from(packed, 'base64url');
    if (bytes.length < 40) return null;
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const body = bytes.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionCryptoKey(), iv);
    decipher.setAuthTag(tag);
    const json = zlib.inflateRawSync(Buffer.concat([decipher.update(body), decipher.final()])).toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || parsed.v !== 2) return null;
    return sanitizeSession(parsed);
  } catch {
    return null;
  }
}

function shrinkSession(session) {
  const ids = Object.keys(session.cart);
  while (ids.length > 6) delete session.cart[ids.pop()];
  session.favorites = session.favorites.slice(0, 12);
  session.compare = session.compare.slice(0, MAX_COMPARE);
}

function writeSessionCookie(req, res, session) {
  if (!session || session.ephemeral || res.headersSent) return;
  let value = sealSession(session);
  if (value.length > MAX_COOKIE_BYTES) {
    shrinkSession(session);
    value = sealSession(session);
  }
  const secure = PROD || isRequestSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`,
    `${LEGACY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  ]);
}

async function getSession(req, res, { createIfMissing = true } = {}) {
  const jar = cookieMap(req);
  let session = openSession(jar[SESSION_COOKIE]);

  if (!session) {
    if (!createIfMissing) return Object.assign(freshSession(), { csrf: '', ephemeral: true });
    session = freshSession();
  }

  req.sessionId = session.sid;
  return session;
}

function rotateSession(req, res, session) {
  session.sid = crypto.randomBytes(12).toString('hex');
  session.csrf = freshCsrf();
}

function flushSession(req, res) {
  writeSessionCookie(req, res, req.session);
}

function validCsrf(req, session) {
  if (!session?.csrf) return false;
  const supplied = String(req.body?.csrf || req.headers['x-csrf-token'] || '');
  const expected = String(session.csrf);
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function sessionCounts(session) {
  return {
    cart: Object.values(session.cart || {}).reduce((sum, n) => sum + Number(n || 0), 0),
    favorites: (session.favorites || []).filter(id => productById(id)).length,
    compare: (session.compare || []).filter(id => productById(id)).length
  };
}

module.exports = {
  initStore, saveStore, getStore, productById, productBySlug,
  getSession, rotateSession, flushSession, validCsrf, sessionCounts,
  SESSION_COOKIE, LEGACY_COOKIE
};
