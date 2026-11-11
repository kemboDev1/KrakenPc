const fsSync = require('node:fs');
const path = require('node:path');
const { ROOT, PROD, esc } = require('./config');

const VIEWS_DIR = path.join(ROOT, 'views');
const templateCache = new Map();
const TOKEN_RE = /\{\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\}|\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function loadTemplateSource(name) {
  if (!/^[a-z0-9/_-]+$/i.test(name) || name.includes('..')) {
    throw new Error(`Invalid view template name: ${name}`);
  }
  if (PROD && templateCache.has(name)) {
    return templateCache.get(name);
  }
  const fullPath = path.join(VIEWS_DIR, `${name}.html`);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(VIEWS_DIR + path.sep)) {
    throw new Error(`Template path outside views directory: ${name}`);
  }
  const source = fsSync.readFileSync(resolved, 'utf8');
  if (PROD) {
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
  return source.replace(TOKEN_RE, (_match, rawKey, escapedKey) => {
    const key = rawKey || escapedKey;
    if (!Object.hasOwn(data, key)) return '';
    const value = data[key];
    if (value === null || value === undefined) return '';
    return rawKey ? String(value) : esc(value);
  });
}

module.exports = {
  VIEWS_DIR,
  renderTemplate
};

