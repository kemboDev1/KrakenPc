const crypto = require('node:crypto');
const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const {
  PUBLIC_ORIGIN, TAG_KEYS, esc, safeJson, localized, formatPrice, canonical, localizedRoute, localPath
} = u(require('../config'));
const { tr } = u(require('../i18n'));
const { productById } = u(require('../storage'));
const { renderTemplate } = u(require('../templateEngine'));

function csrfField(session) {
  return `<input type="hidden" name="csrf" value="${esc(session.csrf || '')}">`;
}

function iconSvg(name) {
  const paths = {
    heart: '<path d="M20.8 8.8c0 5.3-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.8A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"/>',
    compare: '<path d="M4 6h15m0 0-3-3m3 3-3 3M20 18H5m0 0 3 3m-3-3 3-3"/>',
    cart: '<path d="M3 4h2l2.1 11.2a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"/><circle cx="10" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/>'
  };
  return `<svg class="icon icon-${esc(name)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
}

function productImage(product, session, { hero = false, lazy = true } = {}) {
  const suffix = session.lang === 'ru'
    ? '— иллюстрация товара'
    : session.lang === 'en'
      ? '— product illustration'
      : '— mahsulot rasmi';
  return `<img class="product-art ${hero ? 'product-art-hero' : ''}" src="/art/${encodeURIComponent(product.id)}.svg" alt="${esc(localized(product, 'name', session))} ${suffix}" width="800" height="600" ${lazy ? 'loading="lazy" decoding="async"' : 'fetchpriority="high" decoding="async"'}>`;
}

function priceMarkup(product, lang) {
  return `<div class="price-row"><span class="price">${formatPrice(product.price, lang)}</span>${product.oldPrice ? `<del>${formatPrice(product.oldPrice, lang)}</del><span class="sale-chip">−${Math.round((1 - product.price / product.oldPrice) * 100)}%</span>` : ''}</div>`;
}

function tagMarkup(product, session) {
  if (product.oldPrice) {
    return `<span class="product-tag tag-sale">${tr(session, 'save')} ${Math.round((1 - product.price / product.oldPrice) * 100)}%</span>`;
  }
  return product.tag && TAG_KEYS[product.tag] ? `<span class="product-tag">${tr(session, TAG_KEYS[product.tag])}</span>` : '';
}

function stockTag(product, session) {
  const key = product.stock < 1 ? 'soldOut' : product.stock <= 4 ? 'lowStock' : 'stock';
  const css = product.stock < 1 ? 'out' : product.stock <= 4 ? 'few' : '';
  return `<span class="stock-note ${css}"><span class="live-dot"></span>${tr(session, key)}</span>`;
}

function statusText(status, session) {
  return tr(session, ({
    received: 'statusReceived',
    confirmed: 'statusConfirmed',
    assembling: 'statusAssembling',
    delivering: 'statusDelivering',
    complete: 'statusComplete',
    cancelled: 'statusCancelled'
  })[status] || 'statusReceived');
}

function card(product, session, { compact = false } = {}) {
  const on = session.favorites.includes(product.id);
  const comparing = session.compare.includes(product.id);
  const favoriteLabel = on ? tr(session, 'removeFavorite') : tr(session, 'addFavorite');
  const compareLabel = comparing ? tr(session, 'removeCompare') : tr(session, 'addCompare');

  return renderTemplate('partials/product-card', {
    id: product.id,
    compactClass: compact ? 'compact-card' : '',
    productHref: `/product/${encodeURIComponent(product.slug)}`,
    imageHtml: productImage(product, session),
    tagHtml: tagMarkup(product, session),
    csrfField: csrfField(session),
    back: session.currentPath || '/catalog',
    favActiveClass: on ? 'is-active' : '',
    favPressed: on ? 'true' : 'false',
    favoriteLabel,
    iconHeart: iconSvg('heart'),
    name: localized(product, 'name', session),
    specsHtml: product.specs.slice(0, compact ? 2 : 3).map(spec => `<span>${esc(spec)}</span>`).join(''),
    stockHtml: stockTag(product, session),
    priceHtml: priceMarkup(product, session.lang),
    addCartDisabledAttr: product.stock < 1 ? 'disabled' : '',
    addCartLabel: tr(session, 'addCart'),
    compareActiveClass: comparing ? 'is-active' : '',
    comparePressed: comparing ? 'true' : 'false',
    compareLabel,
    iconCompare: iconSvg('compare')
  });
}

function cardGrid(products, session, opts = {}) {
  if (!products.length) {
    return `<div class="empty-inline"><span>⌕</span><p>${esc(tr(session, 'productNotFound'))}</p><a href="/catalog">${esc(tr(session, 'resetFilters'))}</a></div>`;
  }
  return `<div class="product-grid ${opts.compact ? 'grid-compact' : ''}">${products.map(p => card(p, session, opts)).join('')}</div>`;
}

function cartTotals(session) {
  const items = Object.entries(session.cart || {})
    .map(([id, qty]) => ({ product: productById(id), qty: Number(qty) }))
    .filter(row => row.product && row.qty > 0);
  const subtotal = items.reduce((sum, row) => sum + row.product.price * row.qty, 0);
  const delivery = subtotal >= 1000000 || subtotal === 0 ? 0 : 30000;
  return { items, subtotal, delivery, total: subtotal + delivery };
}

function orderSummary(session, totals) {
  const summaryLinesHtml = totals.items
    .map(({ product, qty }) => `<div class="summary-line"><span>${esc(localized(product, 'name', session))}<b>× ${qty}</b></span><strong>${formatPrice(product.price * qty, session.lang)}</strong></div>`)
    .join('');

  return renderTemplate('partials/order-summary', {
    orderSummaryTitle: tr(session, 'orderSummary'),
    summaryLinesHtml,
    subtotalLabel: tr(session, 'subtotal'),
    subtotalFormatted: formatPrice(totals.subtotal, session.lang),
    deliveryLabel: tr(session, 'delivery'),
    deliveryFormatted: totals.delivery === 0 ? tr(session, 'deliveryFree') : formatPrice(totals.delivery, session.lang),
    totalLabel: tr(session, 'total'),
    totalFormatted: formatPrice(totals.total, session.lang),
    freeFrom: tr(session, 'freeFrom')
  });
}

function pageHeader(active, session) {
  const links = [
    ['/catalog?type=pc', 'navPCs', active === 'pcs'],
    ['/catalog?type=part', 'navParts', active === 'parts'],
    ['/builder', 'navBuilder', active === 'builder'],
    ['/catalog', 'navCatalog', active === 'catalog']
  ];
  const count = Object.values(session.cart || {}).reduce((a, n) => a + Number(n || 0), 0);
  const favCount = (session.favorites || []).length;
  const compareCount = (session.compare || []).length;
  const skipText = session.lang === 'ru'
    ? 'Перейти к товарам'
    : session.lang === 'en'
      ? 'Skip to products'
      : 'Mahsulotlarga o‘tish';

  return renderTemplate('partials/header', {
    skipText,
    region: tr(session, 'region'),
    csrfField: csrfField(session),
    langLabel: tr(session, 'langLabel'),
    selUz: session.lang === 'uz' ? 'selected' : '',
    selRu: session.lang === 'ru' ? 'selected' : '',
    selEn: session.lang === 'en' ? 'selected' : '',
    themeLabel: tr(session, 'themeLabel'),
    selDark: session.theme === 'dark' ? 'selected' : '',
    selLight: session.theme === 'light' ? 'selected' : '',
    themeDark: tr(session, 'themeDark'),
    themeLight: tr(session, 'themeLight'),
    backPath: session.currentPath || '/',
    apply: tr(session, 'apply'),
    homeUrl: localizedRoute('/', session.lang),
    navHome: tr(session, 'navHome'),
    searchPlaceholder: tr(session, 'search'),
    lang: session.lang,
    paletteTitle: tr(session, 'paletteTitle'),
    shortcutTip: tr(session, 'shortcutTip'),
    searchAction: tr(session, 'searchAction'),
    compareUrl: localizedRoute('/compare', session.lang),
    navCompare: tr(session, 'navCompare'),
    iconCompare: iconSvg('compare'),
    compareCountDisplay: compareCount || '',
    favoritesUrl: localizedRoute('/favorites', session.lang),
    navFavorites: tr(session, 'navFavorites'),
    iconHeart: iconSvg('heart'),
    favCountDisplay: favCount || '',
    cartUrl: localizedRoute('/cart', session.lang),
    navCart: tr(session, 'navCart'),
    iconCart: iconSvg('cart'),
    cartCount: count,
    navLabel: tr(session, 'navCatalog'),
    homeActiveClass: active === 'home' ? 'active' : '',
    navLinksHtml: links
      .map(([href, key, on]) => `<a class="${on ? 'active' : ''}" href="${esc(localizedRoute(href, session.lang))}">${esc(tr(session, key))}</a>`)
      .join('')
  });
}

function pageFooter(session) {
  return renderTemplate('partials/footer', {
    homeUrl: localizedRoute('/', session.lang),
    footerSignature: tr(session, 'footerSignature'),
    footerPolicy: tr(session, 'footerPolicy'),
    adminTitle: tr(session, 'adminTitle'),
    year: String(new Date().getFullYear()),
    region: tr(session, 'region'),
    catalogUrl: localizedRoute('/catalog', session.lang),
    navCatalog: tr(session, 'navCatalog')
  });
}

function uiOverlays(session) {
  return renderTemplate('partials/modals', {
    paletteTitle: tr(session, 'paletteTitle'),
    cancel: tr(session, 'cancel'),
    iconSearch: iconSvg('search'),
    palettePlaceholder: tr(session, 'palettePlaceholder'),
    shortcutTip: tr(session, 'shortcutTip'),
    confirmTitle: tr(session, 'confirmTitle'),
    confirm: tr(session, 'confirm')
  });
}

function bootPayload(session) {
  return {
    csrf: session.csrf || '',
    lang: session.lang,
    theme: session.theme,
    strings: {
      toastCartAdded: tr(session, 'toastCartAdded'),
      toastCartUpdated: tr(session, 'toastCartUpdated'),
      toastCartRemoved: tr(session, 'toastCartRemoved'),
      toastFavAdded: tr(session, 'toastFavAdded'),
      toastFavRemoved: tr(session, 'toastFavRemoved'),
      toastCmpAdded: tr(session, 'toastCmpAdded'),
      toastCmpRemoved: tr(session, 'toastCmpRemoved'),
      toastCmpFull: tr(session, 'toastCmpFull'),
      addFavorite: tr(session, 'addFavorite'),
      removeFavorite: tr(session, 'removeFavorite'),
      addCompare: tr(session, 'addCompare'),
      removeCompare: tr(session, 'removeCompare'),
      openCart: tr(session, 'openCart'),
      paletteEmpty: tr(session, 'paletteEmpty'),
      shortcutTip: tr(session, 'shortcutTip'),
      errorGeneric: tr(session, 'errorGeneric'),
      errName: tr(session, 'errName'),
      errPhone: tr(session, 'errPhone'),
      errAddress: tr(session, 'errAddress'),
      builderMismatch: tr(session, 'builderMismatch'),
      builderPsuWarning: tr(session, 'builderPsuWarning'),
      builderCompatible: tr(session, 'builderCompatible'),
      builderPowerLabel: tr(session, 'builderPowerLabel'),
      builderPsuLabel: tr(session, 'builderPsuLabel'),
      deliveryFree: tr(session, 'deliveryFree'),
      stock: tr(session, 'stock')
    }
  };
}

function renderPage(req, res, session, {
  title,
  description,
  content,
  active = 'catalog',
  canonicalRoute = '',
  noindex = false,
  structured = null,
  ogImage = '',
  ogType = 'website',
  statusCode = 200
}) {
  session.currentPath = localPath(req.url);
  const nonce = res.localsNonce || crypto.randomBytes(18).toString('base64');
  const schemas = Array.isArray(structured) ? structured : (structured ? [structured] : []);
  const schemaTags = schemas
    .map(item => `<script nonce="${nonce}" type="application/ld+json">${safeJson(item)}</script>`)
    .join('\n  ');

  const canonicalUrl = canonicalRoute ? canonical(localizedRoute(canonicalRoute, session.lang)) : '';
  const canonicalTags = canonicalUrl
    ? `<link rel="canonical" href="${esc(canonicalUrl)}">\n  ` +
      ['uz', 'ru', 'en']
        .map(lang => `<link rel="alternate" hreflang="${lang === 'uz' ? 'uz-UZ' : lang === 'ru' ? 'ru-UZ' : 'en'}" href="${esc(canonical(localizedRoute(canonicalRoute, lang)))}">`)
        .join('\n  ') +
      `\n  <link rel="alternate" hreflang="x-default" href="${esc(canonical(canonicalRoute))}">`
    : '';
  const robotsTag = noindex ? '<meta name="robots" content="noindex,nofollow">' : '';
  const ogUrlTag = canonicalUrl ? `<meta property="og:url" content="${esc(canonicalUrl)}">` : '';
  const ogImageTag = ogImage && PUBLIC_ORIGIN ? `<meta property="og:image" content="${esc(PUBLIC_ORIGIN + ogImage)}">` : '';
  const ogLocale = session.lang === 'uz' ? 'uz_UZ' : session.lang === 'ru' ? 'ru_UZ' : 'en_US';
  const bootTag = `<script nonce="${nonce}" id="kraken-boot" type="application/json">${safeJson(bootPayload(session))}</script>`;

  const html = renderTemplate('layout', {
    lang: session.lang,
    theme: session.theme,
    title,
    description,
    themeColor: session.theme === 'dark' ? '#10191f' : '#edf2f3',
    robotsTag,
    canonicalTags,
    ogType,
    ogLocale,
    ogUrlTag,
    ogImageTag,
    schemaTags,
    headerHtml: pageHeader(active, session),
    content,
    footerHtml: pageFooter(session),
    modalsHtml: uiOverlays(session),
    bootTag
  });

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  if (typeof res.outputBody === 'function') {
    res.outputBody(html);
  } else {
    res.end(req.method === 'HEAD' ? undefined : html);
  }
}

module.exports = {
  csrfField,
  iconSvg,
  productImage,
  priceMarkup,
  tagMarkup,
  stockTag,
  statusText,
  card,
  cardGrid,
  cartTotals,
  orderSummary,
  renderPage
};
