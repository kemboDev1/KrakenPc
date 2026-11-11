const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv() {
  try {
    const raw = fsSync.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, '');
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

loadDotEnv();

const DATA_DIR = process.env.KRAKEN_DATA_DIR
  ? path.resolve(process.env.KRAKEN_DATA_DIR)
  : path.join(ROOT, '.data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SESSION_KEY_FILE = path.join(DATA_DIR, 'session.key');
const CATALOG_FILE = path.join(ROOT, 'data', 'catalog.json');

const rawPort = Number(process.env.PORT || 3000);
const PORT = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_ORIGIN = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
const NODE_ENV = process.env.NODE_ENV || 'development';
const PROD = NODE_ENV === 'production';

function readLegacyLocalKey() {
  try {
    const existing = fsSync.readFileSync(SESSION_KEY_FILE, 'utf8').trim();
    return existing.length >= 32 ? existing : '';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
}

function localSessionKey() {
  if (PROD) return '';
  fsSync.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const existing = readLegacyLocalKey();
  if (existing) return existing;
  const generated = crypto.randomBytes(48).toString('base64url');
  fsSync.writeFileSync(SESSION_KEY_FILE, generated + '\n', { mode: 0o600, flag: 'wx' });
  return generated;
}

const SESSION_KEY = process.env.SESSION_SECRET || localSessionKey();
if (PROD && SESSION_KEY.length < 32) {
  throw new Error('Set a SESSION_SECRET of at least 32 characters before running in production.');
}
if (!SESSION_KEY) {
  throw new Error('Set SESSION_SECRET in .env first.');
}
if (PROD && String(process.env.ADMIN_PASSWORD || '').length < 16) {
  throw new Error('Set a unique ADMIN_PASSWORD of at least 16 characters before running in production.');
}
if (!process.env.ADMIN_PASSWORD) {
  console.warn('Admin orders are locked. Set ADMIN_PASSWORD in .env to use the admin panel.');
}
if (!process.env.SESSION_SECRET) {
  console.warn('Using local fallback key in .data/session.key. Set SESSION_SECRET in .env before production.');
}

const CATEGORIES = ['pcs', 'graphics', 'processors', 'motherboards', 'memory', 'storage', 'power', 'cooling', 'cases', 'monitors', 'peripherals'];
const STATUSES = ['received', 'confirmed', 'assembling', 'delivering', 'complete', 'cancelled'];
const TAG_KEYS = { mostLoved: 'taggedMostLoved', highEnd: 'taggedHighEnd', greatValue: 'taggedGreatValue', entry: 'taggedEntry', new: 'taggedNew' };
const CATEGORY_KEYS = {
  pcs: 'categoryPcs', graphics: 'categoryGraphics', processors: 'categoryProcessors',
  motherboards: 'categoryMotherboards', memory: 'categoryMemory', storage: 'categoryStorage',
  power: 'categoryPower', cooling: 'categoryCooling', cases: 'categoryCases',
  monitors: 'categoryMonitors', peripherals: 'categoryPeripherals'
};
const BUILD_FIELDS = [
  ['cpu', 'processors', 'processors', 'cpu-7600'],
  ['gpu', 'graphics', 'graphics', 'gpu-4060'],
  ['board', 'motherboards', 'motherboards', 'mb-b650'],
  ['ram', 'memory', 'memory', 'ram-fury32'],
  ['ssd', 'storage', 'storage', 'ssd-990pro'],
  ['psu', 'power', 'power', 'psu-rm850'],
  ['cooler', 'cooling', 'cooling', 'cooler-ak620'],
  ['case', 'cases', 'cases', 'case-h7flow']
];

const esc = (value = '') => String(value).replace(/[&<>"'`]/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
})[ch]);

const safeJson = value => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const localized = (product, key, session) => product[key]?.[session.lang] || product[key]?.uz || product[key]?.en || '';

const formatPrice = (price, lang) => new Intl.NumberFormat(
  lang === 'uz' ? 'uz-UZ' : lang === 'ru' ? 'ru-RU' : 'en-US',
  { maximumFractionDigits: 0 }
).format(Number(price || 0)) + (lang === 'ru' ? ' сум' : lang === 'en' ? ' UZS' : ' so‘m');

const canonical = route => (PUBLIC_ORIGIN ? PUBLIC_ORIGIN + route : '');

function localizedRoute(route, lang) {
  const url = new URL(route || '/', 'http://local');
  if (lang === 'uz') url.searchParams.delete('lang');
  else url.searchParams.set('lang', lang);
  return url.pathname + url.search;
}

function localPath(raw) {
  try {
    const u = new URL(raw || '/', 'http://local');
    return u.origin === 'http://local' && u.pathname.startsWith('/') ? u.pathname + u.search : '/';
  } catch {
    return '/';
  }
}

function tashkentDayStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(now);
  const part = name => Number(parts.find(item => item.type === name)?.value || 0);
  return Date.UTC(part('year'), part('month') - 1, part('day')) - (5 * 60 * 60 * 1000);
}

module.exports = {
  ROOT, DATA_DIR, STORE_FILE, SESSION_KEY_FILE, CATALOG_FILE,
  PORT, HOST, PUBLIC_ORIGIN, NODE_ENV, PROD, SESSION_KEY,
  CATEGORIES, STATUSES, TAG_KEYS, CATEGORY_KEYS, BUILD_FIELDS,
  readLegacyLocalKey, esc, safeJson, localized, formatPrice,
  canonical, localizedRoute, localPath, tashkentDayStart
};

