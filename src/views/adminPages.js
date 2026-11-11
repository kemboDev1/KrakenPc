const {
  STATUSES, esc, localized, formatPrice, tashkentDayStart
} = require('../config');
const { tr } = require('../i18n');
const { getStore } = require('../storage');
const { renderTemplate } = require('../templateEngine');
const { csrfField, statusText, renderPage } = require('./layout');

function adminLoginPage(req, res, session, alert = '') {
  let formHtml;
  if (!process.env.ADMIN_PASSWORD) {
    formHtml = `<div class="setup-note"><span class="state-icon">◇</span><h2>${esc(tr(session, 'adminMissingPassword'))}</h2><p>${esc(tr(session, 'footerPolicy'))}</p></div>`;
  } else {
    formHtml = `<form class="admin-login" method="post" action="/admin/login">
      ${csrfField(session)}
      ${alert ? `<p class="form-alert" role="alert">${esc(alert)}</p>` : ''}
      <label class="field-label" for="admin-password">${esc(tr(session, 'adminPassword'))}</label>
      <input class="control" id="admin-password" type="password" name="password" required minlength="8" maxlength="128" autocomplete="current-password">
      <button class="button button-primary" type="submit">${esc(tr(session, 'adminSubmit'))}</button>
    </form>`;
  }

  const content = renderTemplate('admin-login', {
    adminTitle: tr(session, 'adminTitle'),
    adminSubtitle: tr(session, 'adminSubtitle'),
    formHtml
  });

  renderPage(req, res, session, {
    title: tr(session, 'adminTitle'),
    description: tr(session, 'adminSubtitle'),
    content,
    noindex: true
  });
}

function adminPage(req, res, session, url) {
  if (!session.isAdmin) return adminLoginPage(req, res, session);
  const store = getStore();
  const allOrders = [...store.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const dayStart = tashkentDayStart();
  const todayCount = allOrders.filter(o => new Date(o.createdAt).getTime() >= dayStart).length;
  const activeRevenue = allOrders
    .filter(o => o.status !== 'cancelled')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const pendingCount = allOrders.filter(o => ['received', 'confirmed', 'assembling', 'delivering'].includes(o.status)).length;
  const lowStockCount = store.products.filter(p => p.stock <= 4).length;

  const q = String(url?.searchParams?.get('q') || '').trim().slice(0, 80).toLowerCase();
  const statusFilter = STATUSES.includes(url?.searchParams?.get('status')) ? url.searchParams.get('status') : '';

  const orders = allOrders.filter(o => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (q) {
      const hay = `${o.id} ${o.name} ${o.phone} ${o.address}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const ordersHtml = orders.length
    ? orders.map(order => renderTemplate('partials/admin-order', {
        id: order.id,
        createdAtIso: order.createdAt,
        createdAtFormatted: new Intl.DateTimeFormat(session.lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tashkent' }).format(new Date(order.createdAt)),
        status: order.status,
        statusLabel: statusText(order.status, session),
        customerName: order.name,
        phoneDial: order.phone.replace(/[^+0-9]/g, ''),
        phone: order.phone,
        address: order.address,
        noteHtml: order.note ? `<p class="admin-note">${esc(order.note)}</p>` : '',
        itemsHtml: order.items.map(i => `<div><span>${esc(i.name)} × ${i.qty}</span><strong>${esc(formatPrice(i.price * i.qty, session.lang))}</strong></div>`).join(''),
        totalLabel: tr(session, 'total'),
        totalFormatted: formatPrice(order.total, session.lang),
        telegramStatus: order.telegramStatus || 'pending',
        telegramErrorSuffix: order.telegramError ? ` — ${order.telegramError}` : '',
        retryFormHtml: order.telegramStatus !== 'sent'
          ? `<form method="post" action="/admin/telegram-retry">${csrfField(session)}<input type="hidden" name="id" value="${esc(order.id)}"><button class="button button-quiet" type="submit">${esc(tr(session, 'adminRetryTelegram'))}</button></form>`
          : '',
        csrfField: csrfField(session),
        statusTitle: tr(session, 'status'),
        statusOptionsHtml: STATUSES.map(status => `<option value="${esc(status)}" ${order.status === status ? 'selected' : ''}>${esc(statusText(status, session))}</option>`).join(''),
        updateStatusLabel: tr(session, 'updateStatus')
      })).join('')
    : `<div class="empty-state"><span class="state-icon">⌁</span><h2>${esc(tr(session, 'ordersEmpty'))}</h2></div>`;

  const stockRowsHtml = store.products.map(p => renderTemplate('partials/stock-row', {
    lowClass: p.stock <= 4 ? 'is-low' : '',
    csrfField: csrfField(session),
    id: p.id,
    productHref: `/product/${encodeURIComponent(p.slug)}`,
    name: localized(p, 'name', session),
    brand: p.brand,
    priceFormatted: formatPrice(p.price, session.lang),
    stockLabel: tr(session, 'stockRow'),
    stock: String(Number(p.stock)),
    saveLabel: tr(session, 'adminStockSave')
  })).join('');

  const content = renderTemplate('admin', {
    adminTitle: tr(session, 'adminTitle'),
    totalOrdersCount: String(allOrders.length),
    orderItemsLabel: tr(session, 'orderItems'),
    csrfField: csrfField(session),
    adminLogoutLabel: tr(session, 'adminLogout'),
    kpiOrdersLabel: tr(session, 'adminKpiOrders'),
    kpiTodayLabel: tr(session, 'adminKpiToday'),
    todayCount: String(todayCount),
    kpiRevenueLabel: tr(session, 'adminKpiRevenue'),
    revenueFormatted: formatPrice(activeRevenue, session.lang),
    kpiPendingLabel: tr(session, 'adminKpiPending'),
    pendingCount: String(pendingCount),
    lowStockWarnClass: lowStockCount ? 'is-warn' : '',
    kpiLowStockLabel: tr(session, 'adminKpiLowStock'),
    lowStockCount: String(lowStockCount),
    searchQuery: q,
    adminSearchPlaceholder: tr(session, 'adminSearch'),
    statusLabel: tr(session, 'status'),
    allLabel: tr(session, 'all'),
    statusOptionsHtml: STATUSES.map(st => `<option value="${esc(st)}" ${statusFilter === st ? 'selected' : ''}>${esc(statusText(st, session))}</option>`).join(''),
    showResultsLabel: tr(session, 'showResults'),
    exportCsvLabel: tr(session, 'adminExportCsv'),
    exportJsonLabel: tr(session, 'adminExportJson'),
    ordersHtml,
    stockTitle: tr(session, 'adminStockTitle'),
    stockRowsHtml
  });

  renderPage(req, res, session, {
    title: tr(session, 'adminTitle'),
    description: tr(session, 'adminSubtitle'),
    content,
    noindex: true
  });
}

module.exports = {
  adminLoginPage,
  adminPage
};
