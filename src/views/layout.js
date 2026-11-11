const crypto = require('node:crypto');
const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const {
  TAG_KEYS, esc, safeJson, localized, formatPrice, requestOrigin, canonical, localizedRoute, localPath
} = u(require('../config'));
const { tr } = u(require('../i18n'));
const { productById } = u(require('../storage'));
const { renderTemplate } = u(require('../templateEngine'));

function csrfField(session) {
  return `<input type="hidden" name="csrf" value="${esc(session.csrf || '')}">`;
}

function iconSvg(name, extraClass = '') {
  const paths = {
    heart: '<path d="M20.8 8.8c0 5.3-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.8A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z"/>',
    compare: '<path d="M4 7h15m0 0-3-3m3 3-3 3M20 17H5m0 0 3 3m-3-3 3-3"/>',
    cart: '<path d="M3 4h2l2.1 11.2a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"/><circle cx="10" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-9.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M20.4 14.5A8.5 8.5 0 0 1 9.5 3.6a8.5 8.5 0 1 0 10.9 10.9Z"/>',
    arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
    arrowLeft: '<path d="M19 12H5m0 0 6 6m-6-6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v6M14 11v6"/>',
    shield: '<path d="M12 3 4 6.5v5.3c0 5 3.4 8.5 8 10.2 4.6-1.7 8-5.2 8-10.2V6.5L12 3Z"/><path d="m9 12 2 2 4-4"/>',
    truck: '<path d="M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6Z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/>',
    inbox: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 14h5l2 2h4l2-2h5"/>',
    graphics: '<rect x="2.5" y="6" width="19" height="11" rx="2"/><circle cx="8.5" cy="11.5" r="2.6"/><circle cx="15.5" cy="11.5" r="2.6"/><path d="M6 17v2M14 17v2"/>',
    processors: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    motherboards: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><rect x="7.5" y="6.5" width="5" height="5"/><path d="M16 6v6M8 15h8M8 18h5"/>',
    memory: '<rect x="3" y="7" width="18" height="8" rx="1"/><path d="M7 10v2M11 10v2M15 10v2M6 15v2.5M10 15v2.5M14 15v2.5M18 15v2.5"/>',
    storage: '<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M8 11h8M8 14h4M18 9.5v5"/>',
    power: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9.5" cy="12" r="3.5"/><path d="m16.5 9-1.5 3h2.2l-1.4 3"/>',
    cooling: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6M12 14v6M5.1 8l5.2 3M13.7 13l5.2 3M18.9 8l-5.2 3M10.3 13l-5.2 3"/>',
    cases: '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9 6h6v9H9V6Zm1 12h4"/>',
    monitors: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/>',
    peripherals: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 10h2M11 10h2M15 10h2M8 14h8"/>'
  };
  const cls = ['icon', `icon-${esc(name)}`, extraClass].filter(Boolean).join(' ');
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
}

function productImageUrl(product) {
  return `/images/${encodeURIComponent(product.id)}.jpg`;
}

function productImage(product, session, { hero = false, lazy = true } = {}) {
  const suffix = session.lang === 'ru'
    ? '— фото товара'
    : session.lang === 'en'
      ? '— product photo'
      : '— mahsulot rasmi';
  return `<img class="product-art ${hero ? 'product-art-hero' : ''}" src="${productImageUrl(product)}" alt="${esc(localized(product, 'name', session))} ${suffix}" width="800" height="600" ${lazy ? 'loading="lazy" decoding="async"' : 'fetchpriority="high" decoding="async"'}>`;
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

function card(product, session, { compact = false, lazy = true } = {}) {
  const on = session.favorites.includes(product.id);
  const comparing = session.compare.includes(product.id);
  const favoriteLabel = on ? tr(session, 'removeFavorite') : tr(session, 'addFavorite');
  const compareLabel = comparing ? tr(session, 'removeCompare') : tr(session, 'addCompare');

  return renderTemplate('partials/product-card', {
    id: product.id,
    compactClass: compact ? 'compact-card' : '',
    productHref: `/product/${encodeURIComponent(product.slug)}`,
    imageHtml: productImage(product, session, { lazy }),
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
    return `<div class="empty-inline">${iconSvg('search')}<p>${esc(tr(session, 'productNotFound'))}</p><a href="/catalog">${esc(tr(session, 'resetFilters'))}</a></div>`;
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

  const themeToggleLabel = session.theme === 'dark' ? tr(session, 'themeLight') : tr(session, 'themeDark');
  return renderTemplate('partials/header', {
    skipText,
    region: tr(session, 'region'),
    csrfField: csrfField(session),
    langLabel: tr(session, 'langLabel'),
    selUz: session.lang === 'uz' ? 'selected' : '',
    selRu: session.lang === 'ru' ? 'selected' : '',
    selEn: session.lang === 'en' ? 'selected' : '',
    themeLabel: tr(session, 'themeLabel'),
    themeToggleLabel,
    iconSun: iconSvg('sun'),
    iconMoon: iconSvg('moon'),
    selDark: session.theme === 'dark' ? 'selected' : '',
    selLight: session.theme === 'light' ? 'selected' : '',
    themeDark: tr(session, 'themeDark'),
    themeLight: tr(session, 'themeLight'),
    backPath: session.currentPath || '/',
    apply: tr(session, 'apply'),
    homeUrl: localizedRoute('/', session.lang),
    navHome: tr(session, 'navHome'),
    iconHome: iconSvg('home'),
    iconSearch: iconSvg('search'),
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
    iconClose: iconSvg('close'),
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

  const origin = requestOrigin(req);
  const canonicalUrl = canonicalRoute ? canonical(localizedRoute(canonicalRoute, session.lang), req) : '';
  const canonicalTags = canonicalUrl
    ? `<link rel="canonical" href="${esc(canonicalUrl)}">\n  ` +
      ['uz', 'ru', 'en']
        .map(lang => `<link rel="alternate" hreflang="${lang === 'uz' ? 'uz-UZ' : lang === 'ru' ? 'ru-UZ' : 'en'}" href="${esc(canonical(localizedRoute(canonicalRoute, lang), req))}">`)
        .join('\n  ') +
      `\n  <link rel="alternate" hreflang="x-default" href="${esc(canonical(canonicalRoute, req))}">`
    : '';
  const robotsTag = noindex ? '<meta name="robots" content="noindex,nofollow">' : '';
  const ogUrlTag = canonicalUrl ? `<meta property="og:url" content="${esc(canonicalUrl)}">` : '';
  const ogImageTag = ogImage && origin ? `<meta property="og:image" content="${esc(origin + ogImage)}">` : '';
  const ogLocale = session.lang === 'uz' ? 'uz_UZ' : session.lang === 'ru' ? 'ru_UZ' : 'en_US';
  const bootTag = `<script nonce="${nonce}" id="kraken-boot" type="application/json">${safeJson(bootPayload(session))}</script>`;

  const html = renderTemplate('layout', {
    lang: session.lang,
    theme: session.theme,
    title,
    description,
    themeColor: session.theme === 'dark' ? '#0b1118' : '#f1f5f6',
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
  productImageUrl,
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
