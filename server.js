const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const {
  ROOT, ON_VERCEL, PORT, HOST, PUBLIC_ORIGIN, PROD,
  SESSION_KEY, STATUSES, BUILD_FIELDS, LEGACY_SLUG_REDIRECTS, LEGACY_PRODUCT_IDS,
  esc, localized, formatPrice, requestOrigin, localizedRoute, localPath
} = u(require('./src/config'));
const { tr } = u(require('./src/i18n'));
const {
  initStore, saveStore, getStore, productById, productBySlug,
  getSession, rotateSession, flushSession, validCsrf
} = u(require('./src/storage'));
const { productArtworkSvg, faviconPngBuffer, faviconIcoBuffer } = u(require('./src/artwork'));
const { sendOrderReport, sendStatusReport, startBotPolling, stopBotPolling } = u(require('./src/telegram'));
const { evaluateBuild } = u(require('./src/builder'));
const { cartTotals, productImageUrl } = u(require('./src/views/layout'));
const {
  homePage, catalogPage, productPage, simpleListPage,
  cartPage, checkoutPage, renderBuilder, successPage, pageNotFound, forbiddenPage
} = u(require('./src/views/storePages'));
const { adminLoginPage, adminPage } = u(require('./src/views/adminPages'));

const MAX_CART_LINES = 24;
const limiters = new Map();

function rateAllowed(req, key, maximum, windowMs, scope = '') {
  const now = Date.now();
  let ip = req.socket.remoteAddress || 'unknown';
  if (ON_VERCEL || process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    const candidate = forwarded.at(-1);
    if (candidate && /^[0-9a-f:.]+$/i.test(candidate)) ip = candidate;
  }
  const id = `${key}:${scope || ip}`;
  let row = limiters.get(id);
  if (!row || row.resetAt < now) row = { count: 0, resetAt: now + windowMs };
  row.count += 1;
  limiters.set(id, row);
  if (limiters.size > 6000) {
    for (const [stored, value] of limiters) {
      if (value.resetAt < now) limiters.delete(stored);
    }
  }
  return row.count <= maximum;
}

function outputBody(res, bytes) {
  let body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const request = res.req;
  res.setHeader('Vary', 'Accept-Encoding');
  if (body.length > 700 && /\bgzip\b/.test(String(request?.headers['accept-encoding'] || ''))) {
    const compressed = zlib.gzipSync(body, { level: 6 });
    if (compressed.length < body.length) {
      body = compressed;
      res.setHeader('Content-Encoding', 'gzip');
    }
  }
  res.setHeader('Content-Length', body.length);
  res.end(request?.method === 'HEAD' ? undefined : body);
}

function sendJson(res, payload, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  outputBody(res, Buffer.from(JSON.stringify(payload)));
}

function redirect(res, to = '/') {
  res.statusCode = 303;
  res.setHeader('Location', localPath(to));
  res.end();
}

function commonHeaders(req, res) {
  const nonce = res.localsNonce = crypto.randomBytes(18).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self' data:; script-src 'self' 'nonce-${nonce}'; connect-src 'self'`
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (req.method === 'POST' && req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      const expectedHost = (ON_VERCEL || process.env.TRUST_PROXY === '1')
        ? String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
        : String(req.headers.host || '');
      if (!expectedHost || origin.host !== expectedHost || !['http:', 'https:'].includes(origin.protocol)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function readBody(req) {
  const max = 24 * 1024;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const rawText = Buffer.concat(chunks).toString('utf8');
  if (type === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(rawText);
    return Object.fromEntries(params.entries());
  }
  if (type === 'application/json') {
    try {
      const parsed = JSON.parse(rawText || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 });
    }
  }
  throw Object.assign(new Error('Unsupported media type'), { statusCode: 415 });
}

function sendBytesAsset(res, bytes, contentType, maxAge = 300) {
  const etag = `"${crypto.createHash('sha1').update(bytes).digest('hex')}"`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=86400`);
  res.setHeader('ETag', etag);
  if (res.req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    return res.end();
  }
  res.statusCode = 200;
  outputBody(res, bytes);
}

async function sendAsset(res, file, contentType, maxAge = 300) {
  try {
    const bytes = await fs.readFile(file);
    sendBytesAsset(res, bytes, contentType, maxAge);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

function sessionCounts(session) {
  return {
    cart: Object.values(session.cart || {}).reduce((sum, n) => sum + Number(n || 0), 0),
    favorites: (session.favorites || []).filter(id => productById(id)).length,
    compare: (session.compare || []).filter(id => productById(id)).length
  };
}

function formattedCartSummary(session) {
  const totals = cartTotals(session);
  return {
    empty: totals.items.length === 0,
    subtotal: totals.subtotal,
    subtotalFormatted: formatPrice(totals.subtotal, session.lang),
    delivery: totals.delivery,
    deliveryFormatted: totals.delivery === 0 ? tr(session, 'deliveryFree') : formatPrice(totals.delivery, session.lang),
    total: totals.total,
    totalFormatted: formatPrice(totals.total, session.lang),
    lines: totals.items.map(({ product, qty }) => ({
      id: product.id,
      name: localized(product, 'name', session),
      qty,
      lineTotalFormatted: formatPrice(product.price * qty, session.lang)
    }))
  };
}

function csvSafeCell(value) {
  let str = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function orderId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `KPC-${date}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function validateCheckoutInput(session, form) {
  const name = String(form.name || '').replace(/\s+/g, ' ').trim();
  const phone = String(form.phone || '').trim();
  const address = String(form.address || '').replace(/\s+/g, ' ').trim();
  const note = String(form.note || '').replace(/[<>]/g, '').trim().slice(0, 240);
  const digits = phone.replace(/\D/g, '');
  const fieldErrors = {};

  if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M}\s.'‘’`ʻʼ-]+$/u.test(name)) {
    fieldErrors.name = tr(session, 'errName');
  }
  if (digits.length < 9 || digits.length > 15 || !/^[+0-9()\-\s]{8,24}$/.test(phone)) {
    fieldErrors.phone = tr(session, 'errPhone');
  }
  if (address.length < 6 || address.length > 240) {
    fieldErrors.address = tr(session, 'errAddress');
  }

  return {
    ok: Object.keys(fieldErrors).length === 0,
    values: { name, phone, address, note },
    fieldErrors
  };
}

const LEGACY_HTML_REDIRECTS = {
  '/index.html': '/',
  '/catalog.html': '/catalog',
  '/builder.html': '/builder',
  '/cart.html': '/cart',
  '/checkout.html': '/checkout',
  '/favorites.html': '/favorites',
  '/compare.html': '/compare',
  '/admin.html': '/admin'
};

function handleStaticGet(req, res, pathname, url) {
  if (LEGACY_HTML_REDIRECTS[pathname]) {
    res.statusCode = 301;
    res.setHeader('Location', localPath(LEGACY_HTML_REDIRECTS[pathname] + url.search));
    return res.end();
  }
  const store = getStore();
  if (pathname === '/health') {
    return sendJson(res, { ok: true, store: 'KrakenPC' });
  }
  if (pathname === '/style.css') {
    return sendAsset(res, path.join(ROOT, 'public', 'style.css'), 'text/css; charset=utf-8', 600);
  }
  if (pathname === '/app.js') {
    return sendAsset(res, path.join(ROOT, 'public', 'app.js'), 'application/javascript; charset=utf-8', 600);
  }
  if (pathname === '/favicon.svg') {
    return sendAsset(res, path.join(ROOT, 'public', 'favicon.svg'), 'image/svg+xml; charset=utf-8', 604800);
  }
  if (pathname === '/favicon-32x32.png') {
    return sendAsset(res, path.join(ROOT, 'public', 'favicon-32x32.png'), 'image/png', 604800);
  }
  if (pathname === '/apple-touch-icon.png' || pathname === '/apple-touch-icon-precomposed.png') {
    return sendAsset(res, path.join(ROOT, 'public', 'apple-touch-icon.png'), 'image/png', 604800);
  }
  if (pathname === '/favicon.png') {
    return sendBytesAsset(res, faviconPngBuffer(), 'image/png', 604800);
  }
  if (pathname === '/favicon.ico') {
    return sendBytesAsset(res, faviconIcoBuffer(), 'image/x-icon', 604800);
  }

  const imgMatch = pathname.match(/^\/images\/([a-z0-9-]+)\.(jpg|jpeg|webp|png)$/);
  if (imgMatch) {
    const mime = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      png: 'image/png'
    }[imgMatch[2]];
    const imagesDir = path.join(ROOT, 'public', 'images');
    const resolved = path.resolve(imagesDir, `${imgMatch[1]}.${imgMatch[2]}`);
    if (!resolved.startsWith(imagesDir + path.sep)) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }
    return sendAsset(res, resolved, mime, 604800);
  }

  const artMatch = pathname.match(/^\/art\/([a-z0-9-]+)\.svg$/);
  if (artMatch) {
    const product = productById(artMatch[1]);
    if (!product) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=604800');
      res.statusCode = 200;
      return res.end();
    }
    const svg = productArtworkSvg(product);
    const etag = `"${crypto.createHash('sha1').update(svg).digest('hex')}"`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=604800');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      return res.end();
    }
    res.statusCode = 200;
    return outputBody(res, Buffer.from(svg));
  }

  if (pathname === '/robots.txt') {
    const origin = requestOrigin(req);
    const txt = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /cart\nDisallow: /checkout\nDisallow: /favorites\nDisallow: /compare\nDisallow: /success\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return outputBody(res, Buffer.from(txt));
  }

  if (pathname === '/sitemap.xml') {
    const origin = requestOrigin(req) || `http://localhost:${PORT}`;
    const baseRoutes = ['/', '/catalog', '/builder', ...store.products.map(p => `/product/${encodeURIComponent(p.slug)}`)];
    const routes = baseRoutes.flatMap(route => [route, localizedRoute(route, 'ru'), localizedRoute(route, 'en')]);
    const today = new Date().toISOString().slice(0, 10);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(route => `<url><loc>${esc(origin + route)}</loc><lastmod>${today}</lastmod></url>`).join('')}</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return outputBody(res, Buffer.from(xml));
  }

  if (pathname === '/api/search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 80).toLocaleLowerCase();
    const langParam = url.searchParams.get('lang');
    const lang = ['uz', 'ru', 'en'].includes(langParam) ? langParam : 'uz';
    if (!q) return sendJson(res, { ok: true, items: [] });

    const matches = store.products
      .filter(p => {
        const hay = [p.brand, ...Object.values(p.name), ...Object.values(p.description), ...p.specs]
          .join(' ')
          .toLocaleLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8)
      .map(p => ({
        id: p.id,
        slug: p.slug,
        brand: p.brand,
        category: p.category,
        categoryLabel: tr({ lang }, p.category),
        name: localized(p, 'name', { lang }),
        imageUrl: productImageUrl(p),
        price: p.price,
        priceFormatted: formatPrice(p.price, lang),
        stock: p.stock
      }));
    return sendJson(res, { ok: true, items: matches });
  }

  return false;
}

const COMMON_REDIRECTS = {
  '/products': '/catalog',
  '/pcs': '/catalog?type=pc',
  '/parts': '/catalog?type=part',
  '/home': '/',
  '/shop': '/catalog',
  '/favourite': '/favorites',
  '/favorite': '/favorites',
  '/wishlist': '/favorites',
  '/comparison': '/compare',
  '/pc-builder': '/builder',
  '/build': '/builder',
  '/order': '/cart',
  '/orders': '/cart',
  '/login': '/admin',
  '/signin': '/admin'
};

async function handleGet(req, res, session, pathname, url) {
  if (COMMON_REDIRECTS[pathname]) {
    res.statusCode = 301;
    res.setHeader('Location', localPath(COMMON_REDIRECTS[pathname] + url.search));
    return res.end();
  }

  if (pathname === '/api/csrf') {
    return sendJson(res, { ok: true, csrf: session.csrf });
  }

  if (['/favorites', '/compare', '/cart', '/checkout', '/success', '/admin', '/admin/export.csv', '/admin/export.json'].includes(pathname)) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  if (pathname === '/admin/export.csv') {
    if (!session.isAdmin) return redirect(res, '/admin');
    const store = getStore();
    const header = ['ID', 'CreatedAt', 'Status', 'Customer', 'Phone', 'Address', 'Note', 'Items', 'Subtotal', 'Delivery', 'Total', 'Telegram'].map(csvSafeCell).join(',');
    const lines = store.orders.map(o => [
      o.id,
      o.createdAt,
      o.status,
      o.name,
      o.phone,
      o.address,
      o.note || '',
      o.items.map(i => `${i.name} x${i.qty}`).join(' | '),
      o.subtotal,
      o.delivery,
      o.total,
      o.telegramStatus || 'pending'
    ].map(csvSafeCell).join(','));
    const csv = `\uFEFF${[header, ...lines].join('\r\n')}`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="krakenpc-orders.csv"');
    res.setHeader('Cache-Control', 'no-store');
    return outputBody(res, Buffer.from(csv));
  }

  if (pathname === '/admin/export.json') {
    if (!session.isAdmin) return redirect(res, '/admin');
    const store = getStore();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="krakenpc-orders.json"');
    res.setHeader('Cache-Control', 'no-store');
    return outputBody(res, Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), orders: store.orders }, null, 2)));
  }

  if (pathname === '/') return homePage(req, res, session);
  if (pathname === '/catalog') return catalogPage(req, res, session, url);
  if (pathname === '/builder') {
    const selected = Object.fromEntries(BUILD_FIELDS.map(([field]) => [field, url.searchParams.get(field)]).filter(([, value]) => value));
    return renderBuilder(req, res, session, Object.keys(selected).length ? selected : null);
  }
  if (pathname === '/favorites') return simpleListPage(req, res, session, 'favorites');
  if (pathname === '/compare') return simpleListPage(req, res, session, 'compare');
  if (pathname === '/cart') return cartPage(req, res, session);
  if (pathname === '/checkout') return checkoutPage(req, res, session);
  if (pathname === '/success') return successPage(req, res, session, url);
  if (pathname === '/admin') return adminPage(req, res, session, url);
  if (pathname === '/settings') {
    const lang = url.searchParams.get('lang');
    if (['uz', 'ru', 'en'].includes(lang)) session.lang = lang;
    const theme = url.searchParams.get('theme');
    if (['light', 'dark'].includes(theme)) session.theme = theme;
    const rawBack = url.searchParams.get('back') || '/';
    const dest = new URL(localPath(rawBack), 'http://local');
    if (dest.searchParams.has('lang')) {
      if (session.lang === 'uz') dest.searchParams.delete('lang');
      else dest.searchParams.set('lang', session.lang);
      return redirect(res, dest.pathname + dest.search);
    }
    return redirect(res, localPath(rawBack));
  }
  if (pathname.startsWith('/product/')) {
    const rawKey = pathname.slice('/product/'.length);
    const slug = decodeURIComponent(rawKey);
    if (LEGACY_SLUG_REDIRECTS[slug]) {
      res.statusCode = 301;
      res.setHeader('Location', `/product/${encodeURIComponent(LEGACY_SLUG_REDIRECTS[slug])}${url.search}`);
      return res.end();
    }
    let product = productBySlug(slug);
    if (!product) {
      const resolvedId = LEGACY_PRODUCT_IDS[slug] || slug;
      product = productById(resolvedId);
      if (product) {
        res.statusCode = 301;
        res.setHeader('Location', `/product/${encodeURIComponent(product.slug)}${url.search}`);
        return res.end();
      }
    }
    return productPage(req, res, session, product);
  }
  return pageNotFound(req, res, session);
}

async function handleApiPost(req, res, session, pathname) {
  const form = req.body;

  if (pathname === '/api/settings') {
    if (['uz', 'ru', 'en'].includes(form.lang)) session.lang = form.lang;
    if (['light', 'dark'].includes(form.theme)) session.theme = form.theme;
    return sendJson(res, { ok: true, lang: session.lang, theme: session.theme });
  }

  if (pathname === '/api/cart/add') {
    const product = productById(String(form.id || ''));
    if (!product || product.stock < 1) {
      return sendJson(res, { ok: false, error: tr(session, 'errStock') }, 400);
    }
    const current = Number(session.cart[product.id] || 0);
    if (!current && Object.keys(session.cart).length >= MAX_CART_LINES) {
      return sendJson(res, { ok: false, error: tr(session, 'errorGeneric') }, 400);
    }
    let capped = false;
    if (current < product.stock && current < 99) {
      session.cart[product.id] = current + 1;
    } else {
      capped = true;
    }
    return sendJson(res, { ok: true, capped, counts: sessionCounts(session) });
  }

  if (pathname === '/api/cart/update') {
    const product = productById(String(form.id || ''));
    const qty = Number(form.qty);
    if (!product || !Number.isInteger(qty) || qty < 0 || qty > Math.min(99, product.stock)) {
      return sendJson(res, { ok: false, error: tr(session, 'errStock') }, 400);
    }
    if (qty === 0) delete session.cart[product.id];
    else session.cart[product.id] = qty;
    const summary = formattedCartSummary(session);
    return sendJson(res, {
      ok: true,
      empty: summary.empty,
      lineTotalFormatted: qty > 0 ? formatPrice(product.price * qty, session.lang) : '',
      summary,
      counts: sessionCounts(session)
    });
  }

  if (pathname === '/api/cart/remove') {
    delete session.cart[String(form.id || '')];
    const summary = formattedCartSummary(session);
    return sendJson(res, {
      ok: true,
      empty: summary.empty,
      summary,
      counts: sessionCounts(session)
    });
  }

  if (pathname === '/api/favorites/toggle') {
    const product = productById(String(form.id || ''));
    if (!product) return sendJson(res, { ok: false, error: tr(session, 'productNotFound') }, 404);
    session.favorites = session.favorites.filter(id => productById(id));
    let active = false;
    if (session.favorites.includes(product.id)) {
      session.favorites = session.favorites.filter(id => id !== product.id);
    } else if (session.favorites.length < 40) {
      session.favorites.push(product.id);
      active = true;
    }
    return sendJson(res, { ok: true, active, counts: sessionCounts(session) });
  }

  if (pathname === '/api/compare/toggle') {
    const product = productById(String(form.id || ''));
    if (!product) return sendJson(res, { ok: false, error: tr(session, 'productNotFound') }, 404);
    session.compare = session.compare.filter(id => productById(id));
    let active = false;
    let full = false;
    if (session.compare.includes(product.id)) {
      session.compare = session.compare.filter(id => id !== product.id);
    } else if (session.compare.length >= 4) {
      full = true;
    } else {
      session.compare.push(product.id);
      active = true;
    }
    return sendJson(res, { ok: true, active, full, counts: sessionCounts(session) });
  }

  return sendJson(res, { ok: false, error: tr(session, 'pageNotFound') }, 404);
}

async function handlePost(req, res, session, pathname) {
  const isApi = pathname.startsWith('/api/');
  if (!validCsrf(req, session)) {
    if (isApi) return sendJson(res, { ok: false, error: tr(session, 'csrfError'), reload: true, csrf: session.csrf }, 403);
    // A stale/absent session must never leave the visitor on an "expired" page:
    // bounce them back to the page they came from with a fresh session cookie.
    return redirect(res, localPath((req.body && req.body.back) || '/'));
  }
  if (isApi) return handleApiPost(req, res, session, pathname);

  const form = req.body;
  const store = getStore();

  if (pathname === '/settings') {
    if (['uz', 'ru', 'en'].includes(form.lang)) session.lang = form.lang;
    if (['light', 'dark'].includes(form.theme)) session.theme = form.theme;
    const destination = new URL(localPath(form.back), 'http://local');
    if (session.lang === 'uz') destination.searchParams.delete('lang');
    else destination.searchParams.set('lang', session.lang);
    return redirect(res, destination.pathname + destination.search);
  }

  if (pathname === '/cart/add') {
    const product = productById(form.id);
    if (!product || product.stock < 1) return redirect(res, localPath(form.back) || '/catalog');
    const current = Number(session.cart[product.id] || 0);
    if (current >= product.stock || current >= 99) return redirect(res, '/cart');
    if (!current && Object.keys(session.cart).length >= MAX_CART_LINES) return redirect(res, '/cart');
    session.cart[product.id] = current + 1;
    return redirect(res, localPath(form.back));
  }

  if (pathname === '/cart/update') {
    const product = productById(form.id);
    const qty = Number(form.qty);
    if (!product || !Number.isInteger(qty) || qty < 0 || qty > Math.min(99, product.stock)) return redirect(res, '/cart');
    if (qty === 0) delete session.cart[product.id];
    else session.cart[product.id] = qty;
    return redirect(res, '/cart');
  }

  if (pathname === '/cart/remove') {
    delete session.cart[String(form.id || '')];
    return redirect(res, localPath(form.back));
  }

  if (pathname === '/cart/clear') {
    session.cart = {};
    return redirect(res, '/cart');
  }

  if (pathname === '/favorites/toggle') {
    const product = productById(form.id);
    if (!product) return redirect(res, '/catalog');
    session.favorites = session.favorites.filter(id => productById(id));
    if (session.favorites.includes(product.id)) session.favorites = session.favorites.filter(id => id !== product.id);
    else if (session.favorites.length < 40) session.favorites.push(product.id);
    return redirect(res, localPath(form.back));
  }

  if (pathname === '/compare/toggle') {
    const product = productById(form.id);
    if (!product) return redirect(res, '/catalog');
    session.compare = session.compare.filter(id => productById(id));
    if (session.compare.includes(product.id)) session.compare = session.compare.filter(id => id !== product.id);
    else if (session.compare.length < 4) session.compare.push(product.id);
    return redirect(res, localPath(form.back));
  }

  if (pathname === '/compare/clear') {
    session.compare = [];
    return redirect(res, '/compare');
  }

  if (pathname === '/builder/add') {
    const evaluation = evaluateBuild(store.products, form);
    if (!evaluation.ok) {
      return forbiddenPage(req, res, session, tr(session, 'builderMismatch'));
    }
    for (const [field] of BUILD_FIELDS) {
      const id = evaluation.selected[field].id;
      session.cart[id] = Math.max(1, Number(session.cart[id] || 0));
    }
    return redirect(res, '/cart');
  }

  if (pathname === '/checkout') {
    const validation = validateCheckoutInput(session, form);
    if (!rateAllowed(req, 'checkout-session', 8, 60 * 60 * 1000, req.sessionId) ||
        !rateAllowed(req, 'checkout-network', 80, 60 * 60 * 1000)) {
      res.setHeader('Retry-After', '900');
      return checkoutPage(req, res, session, {
        values: validation.values,
        formError: tr(session, 'errRateLimit'),
        statusCode: 429
      });
    }

    const totals = cartTotals(session);
    if (!totals.items.length || totals.items.length > MAX_CART_LINES) {
      return redirect(res, '/cart');
    }

    if (!validation.ok) {
      return checkoutPage(req, res, session, {
        values: validation.values,
        fieldErrors: validation.fieldErrors,
        statusCode: 400
      });
    }

    if (totals.items.some(({ product, qty }) => qty > product.stock)) {
      return checkoutPage(req, res, session, {
        values: validation.values,
        formError: tr(session, 'errStock'),
        statusCode: 409
      });
    }

    const order = {
      id: orderId(),
      createdAt: new Date().toISOString(),
      status: 'received',
      name: validation.values.name,
      phone: validation.values.phone,
      address: validation.values.address,
      note: validation.values.note,
      items: totals.items.map(({ product, qty }) => ({
        id: product.id,
        slug: product.slug,
        image: product.image,
        name: localized(product, 'name', session),
        specs: product.specs.slice(0, 8),
        price: product.price,
        qty
      })),
      subtotal: totals.subtotal,
      delivery: totals.delivery,
      total: totals.total,
      telegramStatus: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_ID ? 'queued' : 'disabled',
      stockRestored: false
    };

    for (const { product, qty } of totals.items) {
      product.stock -= qty;
    }
    store.orders.push(order);
    session.cart = {};
    await saveStore();

    if (order.telegramStatus === 'queued') {
      if (ON_VERCEL) await sendOrderReport(order);
      else void sendOrderReport(order);
    }
    return redirect(res, `/success?id=${encodeURIComponent(order.id)}`);
  }

  if (pathname === '/admin/login') {
    if (!rateAllowed(req, 'admin-login', 6, 15 * 60 * 1000)) {
      return adminLoginPage(req, res, session, tr(session, 'adminDenied'));
    }
    const provided = crypto.createHmac('sha256', SESSION_KEY).update(String(form.password || '')).digest();
    const expected = crypto.createHmac('sha256', SESSION_KEY).update(String(process.env.ADMIN_PASSWORD || '')).digest();
    if (!process.env.ADMIN_PASSWORD || !crypto.timingSafeEqual(provided, expected)) {
      return adminLoginPage(req, res, session, tr(session, 'adminDenied'));
    }
    session.isAdmin = true;
    await rotateSession(req, res, session);
    return redirect(res, '/admin');
  }

  if (pathname === '/admin/logout') {
    if (session.isAdmin) delete session.isAdmin;
    await rotateSession(req, res, session);
    return redirect(res, '/');
  }

  if (pathname === '/admin/status') {
    if (!session.isAdmin) return redirect(res, '/admin');
    const order = store.orders.find(item => item.id === form.id);
    const status = STATUSES.includes(form.status) ? form.status : '';
    if (!order || !status) return redirect(res, '/admin');
    const old = order.status;

    if (status === 'cancelled' && old !== 'cancelled' && !order.stockRestored) {
      for (const item of order.items) {
        const p = productById(item.id);
        if (p) p.stock += item.qty;
      }
      order.stockRestored = true;
    }
    if (old === 'cancelled' && status !== 'cancelled' && order.stockRestored) {
      const canRestore = order.items.every(item => {
        const p = productById(item.id);
        return p && p.stock >= item.qty;
      });
      if (!canRestore) return forbiddenPage(req, res, session, tr(session, 'errStock'));
      for (const item of order.items) {
        const p = productById(item.id);
        p.stock -= item.qty;
      }
      order.stockRestored = false;
    }

    order.status = status;
    await saveStore();
    if (old !== status) {
      if (ON_VERCEL) await sendStatusReport(order);
      else void sendStatusReport(order);
    }
    return redirect(res, '/admin');
  }

  if (pathname === '/admin/telegram-retry') {
    if (!session.isAdmin) return redirect(res, '/admin');
    const order = store.orders.find(item => item.id === form.id);
    if (order) {
      order.telegramStatus = 'queued';
      await saveStore();
      if (ON_VERCEL) await sendOrderReport(order);
      else void sendOrderReport(order);
    }
    return redirect(res, '/admin');
  }

  if (pathname === '/admin/stock') {
    if (!session.isAdmin) return redirect(res, '/admin');
    const product = productById(String(form.id || ''));
    const nextStock = Number(form.stock);
    if (product && Number.isInteger(nextStock) && nextStock >= 0 && nextStock <= 999) {
      product.stock = nextStock;
      await saveStore();
    }
    return redirect(res, '/admin');
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end('<!doctype html><title>Not found</title><h1>Not found</h1>');
}

let initPromise = null;
function ensureStoreReady() {
  if (!initPromise) {
    initPromise = initStore().catch(error => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

async function handleRequest(req, res) {
  res.req = req;
  res.outputBody = bytes => outputBody(res, bytes);

  if (!commonHeaders(req, res)) {
    res.statusCode = 403;
    return res.end('Request rejected');
  }

  let url;
  let pathname;
  try {
    url = new URL(req.url || '/', 'http://local');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }

  if (pathname.length > 1 && pathname.endsWith('/')) {
    res.statusCode = 301;
    res.setHeader('Location', pathname.replace(/\/+$/, '') + url.search);
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  try {
    await ensureStoreReady();
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Store could not be initialized.');
  }

  if (req.method !== 'POST') {
    const handledStatic = await handleStaticGet(req, res, pathname, url);
    if (handledStatic !== false) return;
  }

  if (req.method === 'POST') {
    try {
      req.body = await readBody(req);
    } catch (error) {
      res.statusCode = error.statusCode || 400;
      return res.end(error.message || 'Bad request');
    }
  }

  let session;
  try {
    session = await getSession(req, res, { createIfMissing: true });
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Store session could not be loaded.');
  }

  // The whole visitor session lives in one sealed cookie, so it has to be
  // written onto the response before the handler ends. Patching res.end keeps
  // that in a single place instead of touching every route.
  req.session = session;
  const nativeEnd = res.end;
  res.end = function flushedEnd(...args) {
    try {
      flushSession(req, res);
    } catch (error) {
      console.error('Session cookie could not be written: ' + (error && error.message));
    }
    return nativeEnd.apply(res, args);
  };

  try {
    const requestedLang = url.searchParams.get('lang');
    if (req.method === 'GET' && ['uz', 'ru', 'en'].includes(requestedLang) && session.lang !== requestedLang) {
      session.lang = requestedLang;
      // session cookie is flushed at the end of the request
    }
    session.currentPath = localPath(req.url);

    if (req.method === 'POST') {
      return await handlePost(req, res, session, pathname);
    }
    return await handleGet(req, res, session, pathname, url);
  } catch (error) {
    console.error(`Request failed: ${req.method} ${pathname} (${error.name || 'Error'}).`);
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (pathname.startsWith('/api/')) {
      return sendJson(res, { ok: false, error: tr(session, 'errorGeneric') }, 500);
    }
    return forbiddenPage(req, res, session, tr(session, 'errorGeneric'));
  }
}

const requestHandler = (req, res) => {
  void handleRequest(req, res);
};

async function start() {
  await ensureStoreReady();
  const server = http.createServer(requestHandler);
  server.requestTimeout = 15000;
  server.headersTimeout = 16000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 80;

  server.listen(PORT, HOST, () => {
    console.log(`KrakenPC is ready at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (PROD && !PUBLIC_ORIGIN) {
      console.warn('Set PUBLIC_URL to the store’s canonical HTTPS address for SEO metadata.');
    }
  });

  startBotPolling();

  const shutdown = () => {
    stopBotPolling();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref?.();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (ON_VERCEL) {
  void ensureStoreReady().catch(error => {
    console.error(`KrakenPC Vercel warmup failed: ${error.message}`);
  });
} else {
  start().catch(error => {
    console.error(`KrakenPC could not start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = requestHandler;
