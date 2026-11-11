const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const {
  ON_VERCEL, DATA_DIR, STORE_FILE, CATALOG_FILE, PROD, SESSION_KEY,
  readLegacyLocalKey
} = u(require('./config'));

let store = null;
let writeQueue = Promise.resolve();

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

function pruneStaleGuestSessions() {
  const maxAge = 14 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAge;
  let removed = 0;
  for (const [id, sess] of Object.entries(store.sessions)) {
    const emptyCart = !sess.cart || Object.keys(sess.cart).length === 0;
    const emptyFavs = !sess.favorites || sess.favorites.length === 0;
    const emptyCmp = !sess.compare || sess.compare.length === 0;
    const touchedAt = Number(sess.lastSeenAt || sess.createdAt || 0);
    if (!sess.isAdmin && emptyCart && emptyFavs && emptyCmp && touchedAt < cutoff) {
      delete store.sessions[id];
      removed++;
    }
  }
  return removed > 0;
}

async function saveStore() {
  const payload = encryptStorePayload(store, SESSION_KEY);
  writeQueue = writeQueue.then(async () => {
    const temp = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, payload, { mode: 0o600 });
    await fs.rename(temp, STORE_FILE);
  });
  return writeQueue;
}

async function initStore() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const catalogSeed = loadCatalogSeed();
  let migratedKey = false;

  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.algorithm === 'aes-256-gcm' && parsed.version === 1) {
      try {
        store = decryptStorePayload(parsed, SESSION_KEY);
      } catch (primaryErr) {
        const legacyKey = readLegacyLocalKey();
        if (legacyKey && legacyKey !== SESSION_KEY) {
          store = decryptStorePayload(parsed, legacyKey);
          const backupPath = path.join(DATA_DIR, 'store.backup.json');
          await fs.writeFile(backupPath, raw, { mode: 0o600 });
          migratedKey = true;
          console.log('Migrated encrypted store.json from .data/session.key to SESSION_SECRET (backup saved).');
        } else {
          throw primaryErr;
        }
      }
    } else {
      store = parsed;
    }
    if (!Array.isArray(store.products) || !Array.isArray(store.orders) || !store.sessions || typeof store.sessions !== 'object') {
      throw new Error('Invalid store data');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (ON_VERCEL) {
        console.warn('Resetting temporary Vercel store cache after key/format mismatch.');
      } else {
        throw new Error('Store data could not be read. Back up .data/store.json and restore valid JSON before restarting.');
      }
    }
    store = { products: catalogSeed, orders: [], sessions: {} };
    await saveStore();
  }

  const catalogUpdated = syncCatalogProducts(catalogSeed);
  const pruned = pruneStaleGuestSessions();
  if (migratedKey || catalogUpdated || pruned) {
    await saveStore();
  }
}

function getStore() {
  return store;
}

const productById = id => store.products.find(p => p.id === id);
const productBySlug = slug => store.products.find(p => p.slug === slug);

function cookieMap(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const i = part.indexOf('=');
        const key = i < 0 ? part : part.slice(0, i);
        const raw = i < 0 ? '' : part.slice(i + 1);
        try { return [key, decodeURIComponent(raw)]; } catch { return [key, '']; }
      })
  );
}

function sign(id) {
  return crypto.createHmac('sha256', SESSION_KEY).update(id).digest('base64url');
}

function verifySigned(value) {
  const at = String(value || '').lastIndexOf('.');
  if (at < 1) return '';
  const id = value.slice(0, at);
  const supplied = value.slice(at + 1);
  const actual = sign(id);
  if (supplied.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(actual))) return '';
  return /^[a-f0-9]{48}$/.test(id) ? id : '';
}

function isRequestSecure(req) {
  if (req?.socket?.encrypted) return true;
  if (ON_VERCEL || process.env.TRUST_PROXY === '1') {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
  }
  return false;
}

function setSessionCookie(req, res, id) {
  const secureAttr = PROD || isRequestSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `kraken_sid=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secureAttr}`);
}

function parseCookiesSessionId(req) {
  return verifySigned(cookieMap(req).kraken_sid || '');
}

async function getSession(req, res, { createIfMissing = true } = {}) {
  const id = parseCookiesSessionId(req);
  let session = id ? store.sessions[id] : null;
  if (!session) {
    if (!createIfMissing) {
      return { lang: 'uz', theme: 'dark', csrf: '', cart: {}, favorites: [], compare: [], ephemeral: true };
    }
    const newId = crypto.randomBytes(24).toString('hex');
    session = {
      lang: 'uz', theme: 'dark',
      csrf: crypto.randomBytes(24).toString('base64url'),
      cart: {}, favorites: [], compare: [],
      createdAt: Date.now(), lastSeenAt: Date.now()
    };
    store.sessions[newId] = session;
    req.sessionId = newId;
    setSessionCookie(req, res, newId);
    await saveStore();
  } else {
    req.sessionId = id;
    session.lastSeenAt = Date.now();
  }
  session.cart ||= {};
  session.favorites ||= [];
  session.compare ||= [];
  if (!['uz', 'ru', 'en'].includes(session.lang)) session.lang = 'uz';
  if (!['light', 'dark'].includes(session.theme)) session.theme = 'dark';
  return session;
}

async function rotateSession(req, res, session) {
  const oldId = req.sessionId || parseCookiesSessionId(req);
  if (oldId) delete store.sessions[oldId];
  const newId = crypto.randomBytes(24).toString('hex');
  session.csrf = crypto.randomBytes(24).toString('base64url');
  session.lastSeenAt = Date.now();
  store.sessions[newId] = session;
  req.sessionId = newId;
  setSessionCookie(req, res, newId);
  await saveStore();
}

function validCsrf(req, session) {
  if (!session?.csrf) return false;
  const supplied = String(req.body?.csrf || req.headers['x-csrf-token'] || '');
  return supplied.length === session.csrf.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrf));
}

module.exports = {
  initStore, saveStore, getStore, productById, productBySlug,
  getSession, rotateSession, validCsrf, parseCookiesSessionId
};

