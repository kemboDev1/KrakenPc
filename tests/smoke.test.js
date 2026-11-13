const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'krakenpc-smoke-'));
const TEST_ADMIN_PASSWORD = 'KrakenTestAdminPassword2026!!';
const TEST_SESSION_SECRET = 'KrakenTestSessionSecretMinimum32CharsLong2026';

// Isolate any in-process module imports from repo .data and Telegram credentials
process.env.KRAKEN_DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_ADMIN_ID = '';

const { renderTemplate } = require('../src/templateEngine');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
  });
}

class SessionClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.csrf = '';
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
    for (const raw of list) {
      const pair = String(raw).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  updateCsrfFromHtml(html) {
    const inputMatch = html.match(/name="csrf"\s+value="([^"]+)"/i) || html.match(/value="([^"]+)"\s+name="csrf"/i);
    if (inputMatch) {
      this.csrf = inputMatch[1];
      return;
    }
    const bootMatch = html.match(/<script[^>]*id="kraken-boot"[^>]*>([\s\S]*?)<\/script>/i);
    if (bootMatch) {
      try {
        const boot = JSON.parse(bootMatch[1]);
        if (boot && boot.csrf) this.csrf = boot.csrf;
      } catch {
        // Ignore non-JSON boot payload
      }
    }
  }

  async get(route) {
    const headers = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${this.baseUrl}${route}`, { headers, redirect: 'manual' });
    this.storeCookies(res);
    const body = await res.text();
    if (res.headers.get('content-type')?.includes('text/html')) {
      this.updateCsrfFromHtml(body);
    }
    return { status: res.status, headers: res.headers, body };
  }

  async postForm(route, fields = {}, { omitCsrf = false } = {}) {
    const params = new URLSearchParams();
    if (!omitCsrf && this.csrf && !Object.hasOwn(fields, 'csrf')) {
      params.set('csrf', this.csrf);
    }
    for (const [k, v] of Object.entries(fields)) {
      params.set(k, String(v));
    }
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': this.baseUrl
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers,
      body: params.toString(),
      redirect: 'manual'
    });
    this.storeCookies(res);
    const body = await res.text();
    if (res.headers.get('content-type')?.includes('text/html')) {
      this.updateCsrfFromHtml(body);
    }
    return { status: res.status, headers: res.headers, body };
  }

  async postJson(route, payload = {}, { omitCsrf = false } = {}) {
    const bodyObj = (!omitCsrf && this.csrf && !Object.hasOwn(payload, 'csrf'))
      ? { csrf: this.csrf, ...payload }
      : { ...payload };
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': this.baseUrl
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
      redirect: 'manual'
    });
    this.storeCookies(res);
    const json = await res.json();
    return { status: res.status, headers: res.headers, json };
  }
}

let serverProc;
let baseUrl = '';

test.before(async () => {
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      PUBLIC_URL: baseUrl,
      KRAKEN_DATA_DIR: DATA_DIR,
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_ADMIN_ID: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  serverProc.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
  });

  const deadline = Date.now() + 8000;
  let ready = false;
  while (Date.now() < deadline) {
    if (serverProc.exitCode !== null) {
      throw new Error(`Server exited early with code ${serverProc.exitCode}: ${stderr}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise(r => setTimeout(r, 80));
    }
  }
  assert.ok(ready, `Server failed to respond on ${baseUrl}/health: ${stderr}`);
});

test.after(async () => {
  if (serverProc && serverProc.exitCode === null) {
    serverProc.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (serverProc.exitCode === null) serverProc.kill('SIGKILL');
        resolve();
      }, 2000);
      serverProc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('renderTemplate escapes HTML/backticks and prevents SSTI and path traversal', () => {
  const rendered = renderTemplate('error', {
    message: '{{csrf}}<script>alert(1)</script>`tick`',
    returnHome: 'Home'
  });
  assert.ok(rendered.includes('{{csrf}}&lt;script&gt;alert(1)&lt;/script&gt;&#96;tick&#96;'));
  assert.ok(!rendered.includes('<script>alert(1)</script>'));
  assert.throws(() => renderTemplate('../package', {}), /Invalid view template name/);
});

test('static assets, SEO files, zero-cookie static requests, and legacy .html 301 redirects', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.getSetCookie().length, 0);
  assert.deepEqual(await health.json(), { ok: true, store: 'KrakenPC' });

  for (const [route, type] of [
    ['/style.css', 'text/css'],
    ['/app.js', 'application/javascript'],
    ['/robots.txt', 'text/plain'],
    ['/sitemap.xml', 'application/xml'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/favicon-32x32.png', 'image/png'],
    ['/apple-touch-icon.png', 'image/png'],
    ['/favicon.png', 'image/png'],
    ['/favicon.ico', 'image/x-icon'],
    ['/art/pc-r7-7800x3d-4070s.svg', 'image/svg+xml'],
    ['/images/pc-r7-7800x3d-4070s.jpg', 'image/jpeg']
  ]) {
    const res = await fetch(`${baseUrl}${route}`);
    assert.equal(res.status, 200, `Expected 200 for ${route}`);
    assert.ok(res.headers.get('content-type')?.includes(type), `Expected ${type} for ${route}`);
    assert.equal(res.headers.getSetCookie().length, 0, `Static route ${route} should not set session cookie`);
    if (route === '/favicon.png' || route === '/favicon-32x32.png' || route === '/apple-touch-icon.png') {
      const buf = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(buf.subarray(0, 4), Buffer.from([137, 80, 78, 71]));
    }
    if (route === '/favicon.ico') {
      const buf = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(buf.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
    }
    if (route === '/favicon.svg') {
      const svgText = await res.text();
      assert.ok(svgText.includes('<svg') && svgText.length > 1000, 'Expected brand mascot SVG favicon');
    }
  }

  const redirIndex = await fetch(`${baseUrl}/index.html`, { redirect: 'manual' });
  assert.equal(redirIndex.status, 301);
  assert.equal(redirIndex.headers.get('location'), '/');
  assert.equal(redirIndex.headers.getSetCookie().length, 0);

  const redirCatalog = await fetch(`${baseUrl}/catalog.html?cat=graphics`, { redirect: 'manual' });
  assert.equal(redirCatalog.status, 301);
  assert.equal(redirCatalog.headers.get('location'), '/catalog?cat=graphics');

  const redirLegacyProduct = await fetch(`${baseUrl}/product/kraken-aurora-7800x3d-rtx4070s`, { redirect: 'manual' });
  assert.equal(redirLegacyProduct.status, 301);
  assert.equal(redirLegacyProduct.headers.get('location'), '/product/ryzen-7-7800x3d-rtx-4070-super');

  const malformed = await fetch(`${baseUrl}/%ZZ`);
  assert.equal(malformed.status, 400);

  const missing = await fetch(`${baseUrl}/no-such-page-here`);
  assert.equal(missing.status, 404);
});

test('SSR pages render clean HTML from views/, structured JSON-LD, and compare actions', async () => {
  const client = new SessionClient(baseUrl);
  const home = await client.get('/');
  assert.equal(home.status, 200);
  assert.ok(client.cookies.size >= 1, 'Expected session cookie on HTML page GET');
  assert.ok(client.csrf.length > 10, 'Expected CSRF token rendered in page');
  assert.ok(home.body.includes('"@type":"WebSite"'), 'Expected WebSite schema JSON-LD');
  assert.ok(home.body.includes('"@type":"Organization"'), 'Expected Organization schema JSON-LD');
  assert.ok(home.body.includes('class="brand-mark" src="/favicon.png"'), 'Expected Kraken emblem brand mark in header and footer');
  assert.ok(!home.body.includes('m25 9-12 17'), 'Legacy hexagon placeholder SVG should not remain');
  assert.ok(!home.body.includes('Kraken Aurora'), 'Home should use real hardware product names');
  assert.ok(!/\{\{\{?[a-zA-Z0-9_.]+\}?\}\}/.test(home.body), 'No unreplaced template tokens should remain on home page');

  const product = await client.get('/product/ryzen-7-7800x3d-rtx-4070-super');
  assert.equal(product.status, 200);
  assert.ok(product.body.includes('"@type":"Product"'), 'Expected Product schema JSON-LD');
  assert.ok(product.body.includes('"@type":"BreadcrumbList"'), 'Expected BreadcrumbList schema JSON-LD');
  assert.ok(!product.body.includes('KRAKENPC · '), 'Product detail badge should show manufacturer brand instead of store prefix');
  assert.ok(product.body.includes('/compare/toggle'), 'Expected Compare button form on product page');
});

test('API search, CSRF enforcement, PC builder compatibility & socket mismatch', async () => {
  const searchRes = await fetch(`${baseUrl}/api/search?q=rtx&lang=uz`);
  assert.equal(searchRes.status, 200);
  const searchData = await searchRes.json();
  assert.equal(searchData.ok, true);
  const rtxItem = searchData.items.find(item => item.id === 'gpu-4070s');
  assert.ok(rtxItem, 'Expected RTX 4070 Super in search results');
  assert.equal(rtxItem.imageUrl, '/images/gpu-4070s.jpg');

  const client = new SessionClient(baseUrl);
  await client.get('/builder');

  const badJsonCsrf = await client.postJson('/api/cart/add', { id: 'mouse-g502', csrf: 'bad-token' });
  assert.equal(badJsonCsrf.status, 403);
  assert.equal(badJsonCsrf.json.ok, false);

  const badFormCsrf = await client.postForm('/cart/add', { id: 'mouse-g502', csrf: 'bad-token' });
  assert.equal(badFormCsrf.status, 303, 'Stale form CSRF should bounce back instead of an error page');

  // Mismatched socket: Intel LGA1700 CPU (cpu-i5144) + AM5 board (mb-b650)
  const mismatch = await client.postForm('/builder/add', {
    cpu: 'cpu-i5144',
    gpu: 'gpu-4060',
    board: 'mb-b650',
    ram: 'ram-fury32',
    ssd: 'ssd-990pro',
    psu: 'psu-rm850',
    cooler: 'cooler-ak620',
    case: 'case-h7flow'
  });
  assert.equal(mismatch.status, 403);

  // Valid AM5 build
  const validBuild = await client.postForm('/builder/add', {
    cpu: 'cpu-7600',
    gpu: 'gpu-4060',
    board: 'mb-b650',
    ram: 'ram-fury32',
    ssd: 'ssd-990pro',
    psu: 'psu-rm850',
    cooler: 'cooler-ak620',
    case: 'case-h7flow'
  });
  assert.equal(validBuild.status, 303);
  assert.equal(validBuild.headers.get('location'), '/cart');

  const cartPage = await client.get('/cart');
  assert.equal(cartPage.status, 200);
  assert.ok(cartPage.body.includes('AMD Ryzen 5 7600'));
});

test('Cart supports >8 items, live summary API fields, and Compare enforces max 4 + clear', async () => {
  const client = new SessionClient(baseUrl);
  await client.get('/catalog');

  const skus = [
    'pc-r7-7800x3d-4070s', 'pc-i7-14700kf-4080s', 'pc-i5-14400f-4060', 'pc-r5-5600-7600',
    'gpu-4070s', 'gpu-4060', 'cpu-7800x3d', 'cpu-7600', 'mb-b650', 'ram-fury32'
  ];
  for (const id of skus) {
    const res = await client.postJson('/api/cart/add', { id });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  }

  const update = await client.postJson('/api/cart/update', { id: 'ram-fury32', qty: 2 });
  assert.equal(update.status, 200);
  assert.equal(update.json.counts.cart, 11);
  const ramLine = update.json.summary.lines.find(l => l.id === 'ram-fury32');
  assert.ok(ramLine && ramLine.name.includes('Kingston Fury Beast'), 'Expected line.name in formatted cart summary');
  assert.equal(ramLine.qty, 2);

  const removed = await client.postJson('/api/cart/remove', { id: 'ram-fury32' });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.counts.cart, 9);
  assert.ok(!removed.json.summary.lines.some(l => l.id === 'ram-fury32'));

  const clearCart = await client.postForm('/cart/clear');
  assert.equal(clearCart.status, 303);

  for (const id of ['gpu-4070s', 'gpu-4060', 'cpu-7800x3d', 'cpu-7600']) {
    const cmp = await client.postJson('/api/compare/toggle', { id });
    assert.equal(cmp.status, 200);
    assert.equal(cmp.json.active, true);
    assert.equal(cmp.json.full, false);
  }
  const fifth = await client.postJson('/api/compare/toggle', { id: 'ram-fury32' });
  assert.equal(fifth.status, 200);
  assert.equal(fifth.json.full, true);
  assert.equal(fifth.json.counts.compare, 4);

  const clearedCmp = await client.postForm('/compare/clear');
  assert.equal(clearedCmp.status, 303);
  const cmpPage = await client.get('/compare');
  assert.equal(cmpPage.status, 200);
  assert.ok(!cmpPage.body.includes('compare-table'));
});

test('Checkout preserves input on 400, accepts Uzbek apostrophes, and Admin manages orders/stock securely', async () => {
  const client = new SessionClient(baseUrl);
  await client.get('/catalog');

  const added = await client.postJson('/api/cart/add', { id: 'mouse-g502' });
  assert.equal(added.status, 200);

  // Invalid phone triggers 400 and preserves name with Uzbek modifier apostrophe
  const invalidCheckout = await client.postForm('/checkout', {
    name: 'O‘tkirbek',
    phone: '123',
    address: 'Toshkent, Chilonzor 9'
  });
  assert.equal(invalidCheckout.status, 400);
  assert.ok(invalidCheckout.body.includes('O‘tkirbek'));
  assert.ok(invalidCheckout.body.includes('value="123"'));

  // Valid checkout with CSV-formula note payload
  const validCheckout = await client.postForm('/checkout', {
    name: 'O‘tkirbek',
    phone: '+998901234567',
    address: 'Toshkent, Chilonzor 9-kvartal',
    note: '=HYPERLINK("http://evil")'
  });
  assert.equal(validCheckout.status, 303);
  const successLocation = validCheckout.headers.get('location');
  assert.ok(successLocation && successLocation.startsWith('/success?id=KPC-'));
  const orderId = new URL(`${baseUrl}${successLocation}`).searchParams.get('id');

  const successRes = await client.get(successLocation);
  assert.equal(successRes.status, 200);
  assert.ok(successRes.body.includes(orderId));
  assert.ok(successRes.body.includes('Logitech G502 HERO'));
  assert.ok(!successRes.body.includes('Chilonzor'), 'Success page should not leak customer PII');

  // Admin unauthenticated redirect + wrong password + valid login with session rotation
  const anonExport = await client.get('/admin/export.json');
  assert.equal(anonExport.status, 303);
  assert.equal(anonExport.headers.get('location'), '/admin');

  await client.get('/admin');
  const cookieBeforeLogin = client.cookieHeader();

  const wrongAdmin = await client.postForm('/admin/login', { password: 'wrong-password-1234' });
  assert.equal(wrongAdmin.status, 200);
  assert.ok(wrongAdmin.body.includes('role="alert"'));

  const okAdmin = await client.postForm('/admin/login', { password: TEST_ADMIN_PASSWORD });
  assert.equal(okAdmin.status, 303);
  assert.equal(okAdmin.headers.get('location'), '/admin');
  const cookieAfterLogin = client.cookieHeader();
  assert.notEqual(cookieAfterLogin, cookieBeforeLogin, 'Admin login must rotate the session ID');

  const adminHtml = await client.get('/admin');
  assert.equal(adminHtml.status, 200);
  assert.ok(adminHtml.body.includes(orderId));
  assert.ok(adminHtml.body.includes('O‘tkirbek'));

  // Verify CSV formula neutralization and JSON export
  const csvRes = await client.get('/admin/export.csv');
  assert.equal(csvRes.status, 200);
  assert.ok(csvRes.headers.get('content-type')?.includes('text/csv'));
  assert.ok(csvRes.body.includes("'=HYPERLINK"), 'CSV formula cells must be prefixed with a single quote');

  const jsonRes = await client.get('/admin/export.json');
  assert.equal(jsonRes.status, 200);
  const exported = JSON.parse(jsonRes.body);
  assert.equal(exported.orders.length, 1);
  assert.equal(exported.orders[0].id, orderId);

  // Stock update + cancelling order restores item stock cleanly
  const stockUpdate = await client.postForm('/admin/stock', { id: 'mouse-g502', stock: '10' });
  assert.equal(stockUpdate.status, 303);

  await client.get('/admin');
  const cancelOrder = await client.postForm('/admin/status', { id: orderId, status: 'cancelled' });
  assert.equal(cancelOrder.status, 303);

  const jsonAfterCancel = await client.get('/admin/export.json');
  const exportedAfterCancel = JSON.parse(jsonAfterCancel.body);
  assert.equal(exportedAfterCancel.orders[0].status, 'cancelled');
  assert.equal(exportedAfterCancel.orders[0].stockRestored, true);

  const adminAfterCancel = await client.get('/admin');
  assert.ok(adminAfterCancel.body.includes('id="stock-mouse-g502" name="stock" type="number" min="0" max="999" value="11"'));
});

test('Vercel serverless exported handler boots cleanly without .env secrets or writable root', async () => {
  const childScript = `
    const http = require('node:http');
    const os = require('node:os');
    const cfg = require('./src/config');
    const handler = require('./server');
    if (!cfg.ON_VERCEL) throw new Error('Expected ON_VERCEL=true');
    if (!cfg.DATA_DIR.startsWith(os.tmpdir())) throw new Error('Expected tmp DATA_DIR on Vercel, got ' + cfg.DATA_DIR);
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', async () => {
      try {
        const port = s.address().port;
        const rHome = await fetch('http://127.0.0.1:' + port + '/');
        const rIco = await fetch('http://127.0.0.1:' + port + '/favicon.ico');
        const rAdmin = await fetch('http://127.0.0.1:' + port + '/admin');
        const homeHtml = await rHome.text();
        const adminHtml = await rAdmin.text();
        console.log(JSON.stringify({
          homeStatus: rHome.status,
          icoStatus: rIco.status,
          adminStatus: rAdmin.status,
          hasKraken: homeHtml.includes('KrakenPC'),
          adminLocked: adminHtml.includes('setup-note'),
          publicOrigin: cfg.PUBLIC_ORIGIN
        }));
      } finally {
        s.close(() => process.exit(0));
      }
    });
  `;
  const env = {
    ...process.env,
    VERCEL: '1',
    NODE_ENV: 'production',
    VERCEL_URL: 'krakenpc-preview.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: '',
    PUBLIC_URL: '',
    ADMIN_PASSWORD: '',
    SESSION_SECRET: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_ADMIN_ID: ''
  };
  delete env.KRAKEN_DATA_DIR;

  const result = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['-e', childScript], { cwd: ROOT, env });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d.toString('utf8'); });
    proc.stderr.on('data', d => { err += d.toString('utf8'); });
    proc.on('exit', code => {
      if (code !== 0) reject(new Error(`Exited ${code}: ${err}\n${out}`));
      else resolve(out.trim().split(/\r?\n/).at(-1));
    });
  });

  const parsed = JSON.parse(result);
  assert.equal(parsed.homeStatus, 200);
  assert.equal(parsed.icoStatus, 200);
  assert.equal(parsed.adminStatus, 200);
  assert.equal(parsed.hasKraken, true);
  assert.equal(parsed.adminLocked, true);
  assert.equal(parsed.publicOrigin, 'https://krakenpc-preview.vercel.app');
});

test('language switching is a plain GET and never renders an "expired page"', async () => {
  const client = new SessionClient(baseUrl);
  await client.get('/');

  const switched = await client.get('/settings?lang=ru&back=/catalog');
  assert.equal(switched.status, 303);
  assert.equal(switched.headers.get('location'), '/catalog');

  const catalog = await client.get('/catalog');
  assert.ok(catalog.body.includes('<html lang="ru"'), 'Language switch must apply via GET');

  // A stale CSRF token must bounce the visitor back, not show the scary error page
  const stale = await client.postForm(
    '/cart/add',
    { csrf: 'not-a-real-token', id: 'gpu-4070s', back: '/catalog' },
    { omitCsrf: true }
  );
  assert.equal(stale.status, 303);
  assert.equal(stale.headers.get('location'), '/catalog');
  assert.ok(!stale.body.includes('eskirib'), 'No expired-page body for stale form posts');
});

test('trailing slashes and empty success pages redirect instead of 404', async () => {
  for (const [from, to] of [
    ['/catalog/', '/catalog'],
    ['/builder/', '/builder'],
    ['/cart/', '/cart'],
    ['/product/ryzen-7-7800x3d-rtx-4070-super/', '/product/ryzen-7-7800x3d-rtx-4070-super']
  ]) {
    const res = await fetch(`${baseUrl}${from}`, { redirect: 'manual' });
    assert.equal(res.status, 301, `${from} should redirect`);
    assert.equal(res.headers.get('location'), to);
  }

  const success = await fetch(`${baseUrl}/success`, { redirect: 'manual' });
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), '/');
});

test('sealed session cookies survive a different server instance (serverless lambdas)', async () => {
  const clientA = new SessionClient(baseUrl);
  await clientA.get('/');

  const add = await clientA.postJson('/api/cart/add', { id: 'gpu-4070s' });
  assert.equal(add.status, 200);
  await clientA.get('/cart');
  const cartA = await clientA.get('/cart');
  assert.ok(cartA.body.includes('RTX 4070'), 'Cart item must be present on instance A');

  const login = await clientA.postForm('/admin/login', { password: TEST_ADMIN_PASSWORD });
  assert.equal(login.status, 303);

  const secondData = fs.mkdtempSync(path.join(os.tmpdir(), 'krakenpc-instance2-'));
  const port = await findFreePort();
  const secondUrl = `http://127.0.0.1:${port}`;
  const secondProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      PUBLIC_URL: secondUrl,
      KRAKEN_DATA_DIR: secondData,
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_ADMIN_ID: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let secondErr = '';
  secondProc.stderr.on('data', chunk => { secondErr += chunk.toString('utf8'); });

  try {
    const deadline = Date.now() + 8000;
    let ready = false;
    while (Date.now() < deadline) {
      if (secondProc.exitCode !== null) throw new Error(`Second server exited: ${secondErr}`);
      try {
        const res = await fetch(`${secondUrl}/health`);
        if (res.ok) { ready = true; break; }
      } catch {
        await new Promise(r => setTimeout(r, 80));
      }
    }
    assert.ok(ready, `Second server failed to start: ${secondErr}`);

    const clientB = new SessionClient(secondUrl);
    clientB.cookies = clientA.cookies;
    clientB.csrf = clientA.csrf;

    const cartB = await clientB.get('/cart');
    assert.equal(cartB.status, 200);
    assert.ok(cartB.body.includes('RTX 4070'), 'Cookie-sealed cart must work on a fresh instance');

    const settings = await clientB.postForm('/settings', { lang: 'en', theme: 'dark', back: '/' });
    assert.equal(settings.status, 303, 'CSRF must validate on a fresh instance');

    const adminB = await clientB.get('/admin');
    assert.equal(adminB.status, 200);
    assert.ok(adminB.body.includes('admin-kpis'), 'Admin session must work on a fresh instance');
  } finally {
    secondProc.kill('SIGKILL');
    fs.rmSync(secondData, { recursive: true, force: true });
  }
});
