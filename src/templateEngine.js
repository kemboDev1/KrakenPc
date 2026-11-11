const fsSync = require('node:fs');
const path = require('node:path');
const configMod = require('./config');

const getConfig = () => (
  configMod?.default && typeof configMod.default === 'object' && !configMod.esc
    ? configMod.default
    : configMod
);

const fallbackEsc = (value = '') => String(value).replace(/[&<>"'`]/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
})[ch]);

function resolveViewsDir() {
  const cfg = getConfig();
  const candidates = [
    typeof cfg?.ROOT === 'string' ? cfg.ROOT : '',
    process.cwd(),
    typeof __dirname === 'string' ? path.resolve(__dirname, '..') : '',
    typeof __dirname === 'string' ? __dirname : '',
    '/var/task'
  ].filter(Boolean);

  for (const base of candidates) {
    const dir = path.join(base, 'views');
    if (fsSync.existsSync(path.join(dir, 'layout.html'))) {
      return dir;
    }
  }
  return path.join(process.cwd(), 'views');
}

const VIEWS_DIR = resolveViewsDir();
const templateCache = new Map();
const TOKEN_RE = /\{\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\}|\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function loadTemplateSource(name) {
  if (!/^[a-z0-9/_-]+$/i.test(name) || name.includes('..')) {
    throw new Error(`Invalid view template name: ${name}`);
  }
  const prod = Boolean(getConfig()?.PROD);
  if (prod && templateCache.has(name)) {
    return templateCache.get(name);
  }
  const fullPath = path.join(VIEWS_DIR, `${name}.html`);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(VIEWS_DIR + path.sep)) {
    throw new Error(`Template path outside views directory: ${name}`);
  }
  const source = fsSync.readFileSync(resolved, 'utf8');
  if (prod) {
    templateCache.set(name, source);
  }
  return source;
}

/**
 * Single-pass template renderer supporting escaped `{{key}}` and raw HTML `{{{key}}}`.
 * Single-pass replacement prevents Server-Side Template Injection (SSTI) on user data.
 */
function renderTemplate(name, data = {}) {
  const source = loadTemplateSource(name);
  const escFn = getConfig()?.esc || fallbackEsc;
  return source.replace(TOKEN_RE, (_match, rawKey, escapedKey) => {
    const key = rawKey || escapedKey;
    if (!Object.hasOwn(data, key)) return '';
    const value = data[key];
    if (value === null || value === undefined) return '';
    return rawKey ? String(value) : escFn(value);
  });
}

module.exports = {
  VIEWS_DIR,
  renderTemplate
};
