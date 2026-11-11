const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const {
  CATEGORIES, BUILD_FIELDS, requestOrigin,
  esc, localized, formatPrice, localizedRoute
} = u(require('../config'));
const { tr } = u(require('../i18n'));
const { getStore, productById } = u(require('../storage'));
const { renderTemplate } = u(require('../templateEngine'));
const {
  evaluateBuild, extractSocket, extractDdr, extractPsuWatts, estimateCpuWatts, estimateGpuWatts
} = u(require('../builder'));
const {
  csrfField, iconSvg, productImageUrl, productImage, priceMarkup, tagMarkup, stockTag,
  cardGrid, cartTotals, orderSummary, renderPage
} = u(require('./layout'));

function productSchema(product, session, req) {
  const origin = requestOrigin(req);
  const item = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: localized(product, 'name', session),
    description: localized(product, 'description', session),
    sku: product.id,
    brand: { '@type': 'Brand', name: product.brand },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'UZS',
      price: String(product.price),
      availability: product.stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
    }
  };
  if (origin) {
    item.image = origin + productImageUrl(product);
    item.url = origin + localizedRoute(`/product/${product.slug}`, session.lang);
  }
  return item;
}

function breadcrumbSchema(items, session, req) {
  const origin = requestOrigin(req);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, route], idx) => {
      const entry = { '@type': 'ListItem', position: idx + 1, name };
      if (origin && route) entry.item = origin + localizedRoute(route, session.lang);
      return entry;
    })
  };
}

function redirectResponse(res, to = '/') {
  res.statusCode = 303;
  res.setHeader('Location', to);
  res.end();
}

function forbiddenPage(req, res, session, message = '') {
  const msg = message || tr(session, 'csrfError');
  const content = renderTemplate('error', {
    iconAlert: iconSvg('alert'),
    message: msg,
    returnHome: tr(session, 'returnHome')
  });
  renderPage(req, res, session, {
    title: tr(session, 'confirmTitle'),
    description: msg,
    noindex: true,
    statusCode: 403,
    content
  });
}

function homePage(req, res, session) {
  const store = getStore();
  const origin = requestOrigin(req);
  const hero = productById('pc-r7-7800x3d-4070s') || store.products[0];
  const servicePc = productById('pc-i7-14700kf-4080s') || hero;
  const builds = store.products.filter(p => p.type === 'pc');
  const popular = ['gpu-4070s', 'cpu-7800x3d', 'ram-fury32', 'monitor-lg27'].map(productById).filter(Boolean);

  const siteUrl = origin ? origin + localizedRoute('/', session.lang) : undefined;
  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'KrakenPC',
    url: siteUrl,
    inLanguage: session.lang
  };
  if (origin) {
    websiteSchema.potentialAction = {
      '@type': 'SearchAction',
      target: origin + '/catalog?q={search_term_string}',
      'query-input': 'required name=search_term_string'
    };
  }
  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'KrakenPC',
    url: siteUrl
  };

  const warrantySummary = `12 ${session.lang === 'en' ? 'month' : session.lang === 'ru' ? 'мес.' : 'oy'} · ${session.lang === 'en' ? 'service cover' : session.lang === 'ru' ? 'сервиса' : 'servis kafolati'}`;
  const categoryLinksHtml = CATEGORIES
    .filter(cat => cat !== 'pcs')
    .map(cat => `<a href="/catalog?cat=${encodeURIComponent(cat)}"><span class="category-icon">${iconSvg(cat)}</span><span>${esc(tr(session, cat))}</span>${iconSvg('arrowUpRight')}</a>`)
    .join('');

  const content = renderTemplate('index', {
    heroEyebrow: tr(session, 'heroEyebrow'),
    heroTitleHtml: tr(session, 'heroTitle'),
    heroBody: tr(session, 'heroBody'),
    heroPrimary: tr(session, 'heroPrimary'),
    heroSecondary: tr(session, 'heroSecondary'),
    heroFeature: tr(session, 'heroFeature'),
    warrantySummary,
    heroHref: hero ? `/product/${encodeURIComponent(hero.slug)}` : '/catalog?type=pc',
    heroImageHtml: hero ? productImage(hero, session, { hero: true, lazy: false }) : '',
    heroBadge: tr(session, 'heroBadge'),
    heroBadgelabel: tr(session, 'heroBadgelabel'),
    heroPriceFormatted: hero ? formatPrice(hero.price, session.lang) : '',
    storeLabel: tr(session, 'store'),
    benefitBuild: tr(session, 'benefitBuild'),
    benefitBuildText: tr(session, 'benefitBuildText'),
    benefitWarranty: tr(session, 'benefitWarranty'),
    benefitWarrantyText: tr(session, 'benefitWarrantyText'),
    benefitDelivery: tr(session, 'benefitDelivery'),
    benefitDeliveryText: tr(session, 'benefitDeliveryText'),
    sectionPicks: tr(session, 'sectionPicks'),
    pcsLabel: tr(session, 'pcs'),
    picksText: tr(session, 'picksText'),
    allPcs: tr(session, 'allPcs'),
    buildsGridHtml: cardGrid(builds, session, { compact: true, lazy: false }),
    sectionPopular: tr(session, 'sectionPopular'),
    partsLabel: tr(session, 'parts'),
    popularText: tr(session, 'popularText'),
    allParts: tr(session, 'allParts'),
    popularGridHtml: cardGrid(popular, session, { compact: true, lazy: false }),
    sectionService: tr(session, 'sectionService'),
    serviceImageHtml: servicePc ? productImage(servicePc, session, { hero: false, lazy: false }) : '',
    serviceTitle: tr(session, 'serviceTitle'),
    serviceText: tr(session, 'serviceBody'),
    serviceButton: tr(session, 'serviceButton'),
    navCatalog: tr(session, 'navCatalog'),
    categoryLinksHtml,
    iconArrow: iconSvg('arrowUpRight'),
    iconCheck: iconSvg('check'),
    iconCpu: iconSvg('processors'),
    iconShield: iconSvg('shield'),
    iconTruck: iconSvg('truck')
  });

  renderPage(req, res, session, {
    title: `${tr(session, 'heroBadge')} — ${tr(session, 'heroBadgelabel')}`,
    description: tr(session, 'heroBody'),
    content,
    active: 'home',
    canonicalRoute: '/',
    structured: [websiteSchema, orgSchema],
    ogImage: hero ? productImageUrl(hero) : ''
  });
}

function catalogPage(req, res, session, url) {
  const store = getStore();
  const params = url.searchParams;
  const query = (params.get('q') || '').trim().slice(0, 80);
  const category = CATEGORIES.includes(params.get('cat')) ? params.get('cat') : '';
  const type = ['pc', 'part'].includes(params.get('type')) ? params.get('type') : '';
  const min = Math.max(0, Math.min(100000000, Number(params.get('min')) || 0));
  const maxRaw = Number(params.get('max')) || 0;
  const max = maxRaw > 0 ? Math.max(min, Math.min(100000000, maxRaw)) : 0;
  const inStockOnly = params.get('stock') === '1';
  const order = ['price-asc', 'price-desc', 'name'].includes(params.get('sort')) ? params.get('sort') : 'featured';
  const q = query.toLocaleLowerCase();

  const products = store.products.filter(p => {
    if (type && p.type !== type) return false;
    if (category && p.category !== category) return false;
    if (inStockOnly && p.stock < 1) return false;
    if (p.price < min || (max && p.price > max)) return false;
    if (q) {
      const text = [p.brand, ...Object.values(p.name), ...Object.values(p.description), ...p.specs]
        .join(' ')
        .toLocaleLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  if (order === 'price-asc') products.sort((a, b) => a.price - b.price);
  else if (order === 'price-desc') products.sort((a, b) => b.price - a.price);
  else if (order === 'name') products.sort((a, b) => localized(a, 'name', session).localeCompare(localized(b, 'name', session), session.lang));
  else products.sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || b.stock - a.stock);

  const currencyLabel = session.lang === 'en' ? 'UZS' : session.lang === 'ru' ? 'сум' : 'so‘m';
  const categorySelectHtml = `<select name="cat" id="cat"><option value="">${esc(tr(session, 'all'))}</option>${CATEGORIES.map(cat => `<option value="${esc(cat)}" ${category === cat ? 'selected' : ''}>${esc(tr(session, cat))}</option>`).join('')}</select>`;
  const resetHref = `/catalog${type ? `?type=${type}${session.lang !== 'uz' ? `&lang=${session.lang}` : ''}` : session.lang !== 'uz' ? `?lang=${session.lang}` : ''}`;

  const filterChips = [];
  if (query) filterChips.push(`«${esc(query)}»`);
  if (category) filterChips.push(esc(tr(session, category)));
  if (inStockOnly) filterChips.push(esc(tr(session, 'inStockOnly')));
  if (min) filterChips.push(`${esc(tr(session, 'priceMin'))}: ${esc(formatPrice(min, session.lang))}`);
  if (max) filterChips.push(`${esc(tr(session, 'priceMax'))}: ${esc(formatPrice(max, session.lang))}`);

  const heading = query
    ? `${tr(session, 'searchResults')}: “${query}”`
    : category
      ? tr(session, category)
      : type === 'pc'
        ? tr(session, 'pcs')
        : type === 'part'
          ? tr(session, 'parts')
          : tr(session, 'allParts');

  const content = renderTemplate('catalog', {
    navCatalog: tr(session, 'navCatalog'),
    navHome: tr(session, 'navHome'),
    iconChevron: iconSvg('chevronRight'),
    heading,
    foundCount: String(products.length),
    productsFoundLabel: tr(session, 'productsFound'),
    categoryTitle: tr(session, 'category'),
    lang: session.lang,
    typeHiddenInput: type ? `<input type="hidden" name="type" value="${esc(type)}">` : '',
    searchLabel: tr(session, 'searchLabel'),
    query,
    searchPlaceholder: tr(session, 'search'),
    categoryLabel: tr(session, 'category'),
    categorySelectHtml,
    sortLabel: tr(session, 'sort'),
    selSortFeatured: order === 'featured' ? 'selected' : '',
    selSortLow: order === 'price-asc' ? 'selected' : '',
    selSortHigh: order === 'price-desc' ? 'selected' : '',
    selSortName: order === 'name' ? 'selected' : '',
    sortFeatured: tr(session, 'sortFeatured'),
    sortLow: tr(session, 'sortLow'),
    sortHigh: tr(session, 'sortHigh'),
    sortName: tr(session, 'sortName'),
    priceLabel: tr(session, 'price'),
    currencyLabel,
    minValue: min || '',
    maxValue: max || '',
    priceMin: tr(session, 'priceMin'),
    priceMax: tr(session, 'priceMax'),
    inStockChecked: inStockOnly ? 'checked' : '',
    inStockOnlyLabel: tr(session, 'inStockOnly'),
    showResults: tr(session, 'showResults'),
    resetHref,
    resetFilters: tr(session, 'resetFilters'),
    filterChipsHtml: filterChips.map(chip => `<span class="filter-pill">${chip}</span>`).join(''),
    clearAllLinkHtml: (category || type || query || inStockOnly || min || max)
      ? `<a href="/catalog${session.lang !== 'uz' ? `?lang=${session.lang}` : ''}">${esc(tr(session, 'all'))}</a>`
      : '',
    gridHtml: cardGrid(products, session)
  });

  const isFiltered = query || category || type || min || max || inStockOnly || order !== 'featured';
  const title = query
    ? `${tr(session, 'searchResults')} — ${query}`
    : category
      ? tr(session, category)
      : type
        ? tr(session, type === 'pc' ? 'pcs' : 'parts')
        : tr(session, 'navCatalog');

  renderPage(req, res, session, {
    title,
    description: `${tr(session, 'navCatalog')}: ${products.length} ${tr(session, 'productsFound')}.`,
    content,
    active: type === 'pc' ? 'pcs' : type === 'part' ? 'parts' : 'catalog',
    canonicalRoute: isFiltered ? '' : '/catalog',
    noindex: !!isFiltered
  });
}

function productPage(req, res, session, product) {
  if (!product) return pageNotFound(req, res, session);
  const store = getStore();
  const on = session.favorites.includes(product.id);
  const comparing = session.compare.includes(product.id);
  const related = store.products.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  const specsListHtml = product.specs
    .map((spec, i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><b>${esc(spec)}</b></li>`)
    .join('');
  const backUrl = `/product/${product.slug}`;
  const favoriteLabel = on ? tr(session, 'removeFavorite') : tr(session, 'addFavorite');
  const compareLabel = comparing ? tr(session, 'removeCompare') : tr(session, 'addCompare');

  const relatedSectionHtml = related.length
    ? `<section class="section container"><div class="section-heading"><div><p class="eyebrow"><span class="eyebrow-rule"></span>${esc(tr(session, 'sectionPopular'))}</p><h2>${esc(tr(session, product.category))}</h2></div><a class="text-link" href="/catalog?cat=${esc(product.category)}">${esc(tr(session, 'allParts'))} ${iconSvg('arrowUpRight')}</a></div>${cardGrid(related, session, { compact: true })}</section>`
    : '';

  const content = renderTemplate('product', {
    categoryEncoded: encodeURIComponent(product.category),
    navCatalog: tr(session, 'navCatalog'),
    iconChevron: iconSvg('chevronRight'),
    iconCheck: iconSvg('check'),
    categoryLabel: tr(session, product.category),
    imageHtml: productImage(product, session, { hero: false, lazy: false }),
    brand: product.brand,
    tagHtml: tagMarkup(product, session),
    stockHtml: stockTag(product, session),
    name: localized(product, 'name', session),
    description: localized(product, 'description', session),
    priceHtml: priceMarkup(product, session.lang),
    deliveryNoteText: tr(session, product.type === 'pc' ? 'serviceIncluded' : 'deliveryIncluded'),
    csrfField: csrfField(session),
    id: product.id,
    backUrl,
    addCartDisabledAttr: product.stock < 1 ? 'disabled' : '',
    addCartLabel: tr(session, 'addCart'),
    favActiveClass: on ? 'is-active' : '',
    favPressed: on ? 'true' : 'false',
    favoriteLabel,
    iconHeart: iconSvg('heart'),
    compareActiveClass: comparing ? 'is-active' : '',
    comparePressed: comparing ? 'true' : 'false',
    compareLabel,
    iconCompare: iconSvg('compare'),
    specsTitle: tr(session, 'specs'),
    specsListHtml,
    priceNote: tr(session, 'priceNote'),
    freeFrom: tr(session, 'freeFrom'),
    relatedSectionHtml
  });

  const crumbs = breadcrumbSchema([
    [tr(session, 'navHome'), '/'],
    [tr(session, product.category), `/catalog?cat=${encodeURIComponent(product.category)}`],
    [localized(product, 'name', session), backUrl]
  ], session, req);

  renderPage(req, res, session, {
    title: localized(product, 'name', session),
    description: localized(product, 'description', session),
    content,
    canonicalRoute: backUrl,
    structured: [productSchema(product, session, req), crumbs],
    ogImage: productImageUrl(product),
    ogType: 'product'
  });
}

function simpleListPage(req, res, session, kind) {
  const isFavorites = kind === 'favorites';
  const ids = isFavorites ? session.favorites : session.compare;
  const products = ids.map(productById).filter(Boolean);
  const heading = isFavorites ? tr(session, 'favoritesTitle') : tr(session, 'compareTitle');

  if (isFavorites) {
    const bodyHtml = products.length
      ? cardGrid(products, session)
      : `<div class="empty-state"><span class="state-icon">${iconSvg('heart')}</span><h2>${esc(tr(session, 'favoritesEmpty'))}</h2><p>${esc(tr(session, 'favoritesHint'))}</p><a class="button button-primary" href="/catalog">${esc(tr(session, 'navCatalog'))}</a></div>`;

    const content = renderTemplate('favorites', {
      navFavorites: tr(session, 'navFavorites'),
      heading,
      navCatalog: tr(session, 'navCatalog'),
      iconArrow: iconSvg('arrowUpRight'),
      bodyHtml
    });
    return renderPage(req, res, session, { title: heading, description: tr(session, 'favoritesHint'), content, noindex: true });
  }

  let bodyHtml;
  if (products.length) {
    const rows = products.map(p => `<tr>
      <th scope="row">
        <a class="compare-product" href="/product/${encodeURIComponent(p.slug)}">${productImage(p, session)}<span>${esc(localized(p, 'name', session))}</span></a>
        <form method="post" action="/compare/toggle">${csrfField(session)}<input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="back" value="/compare"><button class="filter-reset" type="submit">${esc(tr(session, 'remove'))}</button></form>
      </th>
      <td>${esc(formatPrice(p.price, session.lang))}</td>
      <td>${esc(p.brand)}</td>
      <td>${stockTag(p, session)}</td>
      <td><ul>${p.specs.map(s => `<li>${esc(s)}</li>`).join('')}</ul></td>
      <td>
        <form method="post" action="/cart/add" data-async-form="cart-add" data-product-id="${esc(p.id)}">${csrfField(session)}<input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="back" value="/compare"><button class="button button-primary" type="submit" ${p.stock < 1 ? 'disabled' : ''}>${esc(tr(session, 'addCart'))}</button></form>
      </td>
    </tr>`).join('');
    bodyHtml = `<div class="list-toolbar">
      <form method="post" action="/compare/clear" data-confirm="${esc(tr(session, 'confirmClearCompare'))}">${csrfField(session)}<button class="button button-secondary" type="submit">${esc(tr(session, 'clearCompare'))}</button></form>
    </div>
    <div class="compare-scroll"><table class="compare-table"><thead><tr><th>${esc(tr(session, 'product'))}</th><th>${esc(tr(session, 'priceRow'))}</th><th>${esc(tr(session, 'brandRow'))}</th><th>${esc(tr(session, 'stockRow'))}</th><th>${esc(tr(session, 'specs'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    bodyHtml = `<div class="empty-state"><span class="state-icon">${iconSvg('compare')}</span><h2>${esc(tr(session, 'compareEmpty'))}</h2><p>${esc(tr(session, 'compareHint'))}</p><a class="button button-primary" href="/catalog">${esc(tr(session, 'navCatalog'))}</a></div>`;
  }

  const content = renderTemplate('compare', {
    navCompare: tr(session, 'navCompare'),
    heading,
    navCatalog: tr(session, 'navCatalog'),
    iconArrow: iconSvg('arrowUpRight'),
    bodyHtml
  });

  renderPage(req, res, session, {
    title: heading,
    description: tr(session, 'compareHint'),
    content,
    noindex: true
  });
}

function cartPage(req, res, session) {
  const totals = cartTotals(session);
  let cartBodyHtml;
  if (!totals.items.length) {
    cartBodyHtml = `<div class="empty-state"><span class="state-icon">${iconSvg('cart')}</span><h2>${esc(tr(session, 'cartEmpty'))}</h2><p>${esc(tr(session, 'cartHint'))}</p><a class="button button-primary" href="/catalog">${esc(tr(session, 'continueShopping'))}</a></div>`;
  } else {
    const unitWord = session.lang === 'en' ? 'item' : session.lang === 'ru' ? 'шт.' : 'dona';
    const rows = totals.items.map(({ product, qty }) => renderTemplate('partials/cart-line', {
      id: product.id,
      productHref: `/product/${encodeURIComponent(product.slug)}`,
      imageHtml: productImage(product, session),
      name: localized(product, 'name', session),
      specsShort: product.specs.slice(0, 2).join(' · '),
      stockHtml: stockTag(product, session),
      lineTotalFormatted: formatPrice(product.price * qty, session.lang),
      unitPriceFormatted: formatPrice(product.price, session.lang),
      unitWord,
      csrfField: csrfField(session),
      quantityLabel: tr(session, 'quantity'),
      maxQty: String(Math.min(99, product.stock)),
      qty: String(qty),
      updateLabel: tr(session, 'updateStatus'),
      removeLabel: tr(session, 'remove'),
      iconMinus: iconSvg('minus'),
      iconPlus: iconSvg('plus'),
      iconRefresh: iconSvg('refresh'),
      iconTrash: iconSvg('trash')
    })).join('');

    cartBodyHtml = `<div class="cart-layout">
      <div class="cart-items">
        ${rows}
        <div class="cart-footer-actions">
          <a class="text-link" href="/catalog">${iconSvg('arrowLeft')} ${esc(tr(session, 'continueShopping'))}</a>
          <form method="post" action="/cart/clear" data-confirm="${esc(tr(session, 'confirmClearCart'))}">
            ${csrfField(session)}
            <button class="filter-reset danger-link" type="submit">${esc(tr(session, 'clearCart'))}</button>
          </form>
        </div>
      </div>
      <div id="cart-summary-wrap">
        ${orderSummary(session, totals)}
        <a class="button button-primary checkout-button" href="/checkout">${esc(tr(session, 'checkout'))} ${iconSvg('arrowUpRight')}</a>
      </div>
    </div>`;
  }

  const content = renderTemplate('cart', {
    navCart: tr(session, 'navCart'),
    cartTitle: tr(session, 'cartTitle'),
    cartBodyHtml
  });

  renderPage(req, res, session, {
    title: tr(session, 'cartTitle'),
    description: tr(session, 'cartHint'),
    content,
    noindex: true
  });
}

function checkoutPage(req, res, session, { values = {}, fieldErrors = {}, formError = '', statusCode = 200 } = {}) {
  const totals = cartTotals(session);
  if (!totals.items.length) return redirectResponse(res, '/cart');

  const content = renderTemplate('checkout', {
    navCart: tr(session, 'navCart'),
    checkoutTitle: tr(session, 'checkoutTitle'),
    checkoutInfo: tr(session, 'checkoutInfo'),
    csrfField: csrfField(session),
    formAlertHtml: formError ? `<p class="form-alert form-alert-box" role="alert">${esc(formError)}</p>` : '',
    fullNameLabel: tr(session, 'fullName'),
    nameInvalidClass: fieldErrors.name ? 'is-invalid' : '',
    nameValue: values.name || '',
    nameAriaInvalid: fieldErrors.name ? 'aria-invalid="true" aria-describedby="err-name"' : '',
    nameErrorHtml: fieldErrors.name ? `<p class="field-error" id="err-name" role="alert">${esc(fieldErrors.name)}</p>` : '',
    phoneLabel: tr(session, 'phone'),
    phoneInvalidClass: fieldErrors.phone ? 'is-invalid' : '',
    phoneValue: values.phone || '',
    phoneAriaInvalid: fieldErrors.phone ? 'aria-invalid="true" aria-describedby="err-phone"' : '',
    phoneErrorHtml: fieldErrors.phone ? `<p class="field-error" id="err-phone" role="alert">${esc(fieldErrors.phone)}</p>` : '',
    addressLabel: tr(session, 'address'),
    addressInvalidClass: fieldErrors.address ? 'is-invalid' : '',
    addressValue: values.address || '',
    addressAriaInvalid: fieldErrors.address ? 'aria-invalid="true" aria-describedby="err-address"' : '',
    addressErrorHtml: fieldErrors.address ? `<p class="field-error" id="err-address" role="alert">${esc(fieldErrors.address)}</p>` : '',
    noteLabel: tr(session, 'note'),
    noteValue: values.note || '',
    checkoutTerms: tr(session, 'checkoutTerms'),
    requiredFields: tr(session, 'requiredFields'),
    placeOrderLabel: tr(session, 'placeOrder'),
    iconArrow: iconSvg('arrowUpRight'),
    orderSummaryHtml: orderSummary(session, totals)
  });

  renderPage(req, res, session, {
    title: tr(session, 'checkoutTitle'),
    description: tr(session, 'checkoutInfo'),
    content,
    noindex: true,
    statusCode
  });
}

function renderBuilder(req, res, session, selectedIds = null) {
  const store = getStore();
  const evaluation = evaluateBuild(store.products, selectedIds || {}, { allowOutOfStockFallback: true });
  const picks = evaluation.selected;

  const partsCatalog = Object.fromEntries(
    store.products
      .filter(p => BUILD_FIELDS.some(([, cat]) => cat === p.category) && p.stock > 0)
      .map(p => [
        p.id,
        {
          id: p.id,
          category: p.category,
          name: localized(p, 'name', session),
          imageUrl: productImageUrl(p),
          price: p.price,
          priceFormatted: formatPrice(p.price, session.lang),
          socket: extractSocket(p),
          ddr: extractDdr(p),
          psuWatts: p.category === 'power' ? extractPsuWatts(p) : 0,
          cpuWatts: p.category === 'processors' ? estimateCpuWatts(p) : 0,
          gpuWatts: p.category === 'graphics' ? estimateGpuWatts(p) : 0,
          coolerSpec: p.category === 'cooling' ? p.specs.join(' ').toUpperCase() : ''
        }
      ])
  );

  const controlsHtml = BUILD_FIELDS.map(([field, category, key]) => {
    const items = store.products.filter(p => p.category === category && p.stock > 0);
    return `<label class="field-label" for="build-${esc(field)}">${esc(tr(session, key))}
      <select id="build-${esc(field)}" name="${esc(field)}" data-builder-select="${esc(field)}">
        ${items.map(p => `<option value="${esc(p.id)}" ${p.id === picks[field]?.id ? 'selected' : ''}>${esc(localized(p, 'name', session))} · ${esc(formatPrice(p.price, session.lang))}</option>`).join('')}
      </select>
    </label>`;
  }).join('');

  const hiddenChoicesHtml = BUILD_FIELDS
    .map(([field]) => `<input type="hidden" name="${esc(field)}" value="${esc(evaluation.choices[field] || '')}" data-builder-hidden="${esc(field)}">`)
    .join('');

  const markIcon = evaluation.compatible ? iconSvg('check') : iconSvg('alert');
  const rowsHtml = BUILD_FIELDS
    .map(([field]) => `<li data-builder-row="${esc(field)}"><span>${esc(picks[field] ? localized(picks[field], 'name', session) : '—')}</span><b class="${evaluation.compatible ? 'is-ok' : 'is-bad'}">${markIcon}</b></li>`)
    .join('');

  const statusBad = !evaluation.compatible;
  const statusWarn = evaluation.compatible && !evaluation.psuOk;
  const powerPct = evaluation.psuWatts > 0 ? Math.min(100, Math.round((evaluation.estimatedWatts / evaluation.psuWatts) * 100)) : 50;
  const previewItem = picks.case || picks.gpu || productById('pc-r7-7800x3d-4070s') || store.products[0];
  const previewStripHtml = ['cpu', 'gpu', 'board', 'case']
    .map(field => {
      const item = picks[field];
      if (!item) return '';
      return `<div class="builder-thumb" data-builder-thumb="${esc(field)}"><img src="${productImageUrl(item)}" alt="${esc(localized(item, 'name', session))}" width="160" height="120" loading="lazy"><span>${esc(field.toUpperCase())}</span></div>`;
    })
    .join('');

  const content = renderTemplate('builder', {
    navBuilder: tr(session, 'navBuilder'),
    builderTitle: tr(session, 'builderTitle'),
    builderText: tr(session, 'builderText'),
    partsCatalogJson: JSON.stringify(partsCatalog),
    lang: session.lang,
    iconCpu: iconSvg('processors'),
    iconArrow: iconSvg('arrowUpRight'),
    socket: evaluation.socket,
    ddr: evaluation.ddr,
    statusClass: statusBad ? 'is-error' : statusWarn ? 'is-warn' : '',
    statusText: statusBad
      ? tr(session, 'builderMismatch')
      : statusWarn
        ? tr(session, 'builderPsuWarning')
        : tr(session, 'builderCompatible'),
    controlsHtml,
    builderNote: tr(session, 'builderNote'),
    builderEstimate: tr(session, 'builderEstimate'),
    previewImageHtml: previewItem ? productImage(previewItem, session, { hero: false, lazy: false }) : '',
    previewCaseName: previewItem ? localized(previewItem, 'name', session) : '',
    previewStripHtml,
    totalLabel: tr(session, 'total'),
    totalFormatted: formatPrice(evaluation.total, session.lang),
    componentsSummary: `${BUILD_FIELDS.length} ${session.lang === 'ru' ? 'компонентов' : session.lang === 'en' ? 'components' : 'ta komponent'}`,
    serviceIncluded: tr(session, 'serviceIncluded'),
    builderPowerLabel: tr(session, 'builderPowerLabel'),
    estimatedWatts: String(evaluation.estimatedWatts),
    builderPsuLabel: tr(session, 'builderPsuLabel'),
    psuWattsDisplay: String(evaluation.psuWatts || '—'),
    powerWarnClass: statusWarn ? 'is-warn' : '',
    powerPct: String(powerPct),
    errorHiddenAttr: statusBad ? '' : 'hidden',
    builderMismatch: tr(session, 'builderMismatch'),
    psuWarnHiddenAttr: statusWarn ? '' : 'hidden',
    builderPsuWarning: tr(session, 'builderPsuWarning'),
    rowsHtml,
    csrfField: csrfField(session),
    hiddenChoicesHtml,
    addDisabledAttr: evaluation.compatible ? '' : 'disabled',
    builderAction: tr(session, 'builderAction'),
    sectionPicks: tr(session, 'sectionPicks'),
    pcsLabel: tr(session, 'pcs'),
    readyPcsGridHtml: cardGrid(store.products.filter(p => p.type === 'pc'), session, { compact: true })
  });

  renderPage(req, res, session, {
    title: tr(session, 'builderTitle'),
    description: tr(session, 'builderText'),
    content,
    active: 'builder',
    canonicalRoute: '/builder',
    noindex: !!selectedIds
  });
}

function successPage(req, res, session, url) {
  const store = getStore();
  const id = String(url.searchParams.get('id') || '').slice(0, 32);
  const order = store.orders.find(o => o.id === id);
  if (!order) return pageNotFound(req, res, session);

  const itemsHtml = order.items
    .map(item => `<div class="success-item"><span>${esc(item.name)} × ${item.qty}</span><strong>${esc(formatPrice(item.price * item.qty, session.lang))}</strong></div>`)
    .join('');

  const content = renderTemplate('success', {
    iconCheck: iconSvg('check'),
    iconArrow: iconSvg('arrowUpRight'),
    orderSuccessTitle: tr(session, 'orderSuccessTitle'),
    orderSuccessText: tr(session, 'orderSuccessText'),
    orderNumberLabel: tr(session, 'orderNumber'),
    orderId: order.id,
    itemsHtml,
    totalLabel: tr(session, 'total'),
    totalFormatted: formatPrice(order.total, session.lang),
    telegramState: order.telegramStatus === 'sent' ? tr(session, 'orderTelegramSent') : tr(session, 'orderTelegramPending'),
    returnHomeLabel: tr(session, 'returnHome')
  });

  renderPage(req, res, session, {
    title: tr(session, 'orderSuccessTitle'),
    description: tr(session, 'orderSuccessText'),
    content,
    noindex: true
  });
}

function pageNotFound(req, res, session) {
  const content = renderTemplate('404', {
    pageNotFound: tr(session, 'pageNotFound'),
    productNotFound: tr(session, 'productNotFound'),
    navCatalog: tr(session, 'navCatalog')
  });

  renderPage(req, res, session, {
    title: tr(session, 'pageNotFound'),
    description: tr(session, 'productNotFound'),
    content,
    noindex: true,
    statusCode: 404
  });
}

module.exports = {
  homePage,
  catalogPage,
  productPage,
  simpleListPage,
  cartPage,
  checkoutPage,
  renderBuilder,
  successPage,
  pageNotFound,
  forbiddenPage
};
