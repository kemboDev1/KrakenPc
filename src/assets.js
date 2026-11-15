const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const { ROOT } = u(require('./config'));

/*
 * Content-hashed asset URLs (/style.css?v=3f9a1c…).
 * The hash only changes when the file changes, so browsers and the CDN can keep
 * the file for a year and still pick up every new deployment instantly.
 */
const memo = new Map();

function assetVersion(rel) {
  const file = path.join(ROOT, 'public', rel);
  try {
    const stat = fs.statSync(file);
    const hit = memo.get(file);
    if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.version;
    const version = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    memo.set(file, { mtime: stat.mtimeMs, size: stat.size, version });
    return version;
  } catch {
    return '0';
  }
}

const assetUrl = rel => `/${rel}?v=${assetVersion(rel)}`;

module.exports = { assetUrl, assetVersion };
