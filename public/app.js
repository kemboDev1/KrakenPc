/* KrakenPC front-end. No framework: progressive enhancement over server-rendered pages. */
(() => {
  'use strict';

  const bootEl = document.getElementById('kraken-boot');
  let BOOT = { csrf: '', lang: 'uz', theme: 'dark', strings: {} };
  if (bootEl) {
    try { BOOT = JSON.parse(bootEl.textContent || '{}'); } catch { /* keep defaults */ }
  }
  const S = BOOT.strings || {};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const raf = window.requestAnimationFrame.bind(window);

  function formatMoney(amount, lang = BOOT.lang) {
    const locale = lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : 'uz-UZ';
    const suffix = lang === 'ru' ? ' сум' : lang === 'en' ? ' UZS' : ' so‘m';
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(amount || 0)) + suffix;
  }

  function createSvgIcon(pathD) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', pathD);
    svg.appendChild(p);
    return svg;
  }

  /* ---------------------------------------------------------- session / csrf */
  function applyCsrf(token) {
    if (!token) return;
    BOOT.csrf = token;
    $$('input[name="csrf"]').forEach(input => { input.value = token; });
  }

  function updateHeaderCounts(counts) {
    if (!counts) return;
    const set = (selector, value, bump) => {
      if (typeof value !== 'number') return;
      $$(selector).forEach(el => { el.textContent = value > 0 ? String(value) : ''; });
      if (bump) $$('[data-cart-target], .bn-icon').forEach(el => {
        el.classList.remove('is-bump');
        void el.offsetWidth;
        el.classList.add('is-bump');
      });
    };
    const before = Number(($('[data-cart-count]')?.textContent) || 0);
    set('[data-cart-count]', counts.cart, counts.cart > before);
    set('[data-fav-count]', counts.favorites);
    set('[data-compare-count]', counts.compare);
  }

  // A stale token must never end in an "expired page" message: ask the server
  // for the current one (also refreshes the counters) and let the caller retry.
  async function refreshSession() {
    try {
      const res = await fetch('/api/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await res.json();
      if (data && data.ok) {
        applyCsrf(data.csrf);
        updateHeaderCounts(data.counts);
      }
    } catch { /* offline: the next action will report it */ }
  }

  async function postJson(url, payload, canRetry = true) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': BOOT.csrf || '' },
        body: JSON.stringify(payload)
      });
    } catch {
      throw new Error(S.errorGeneric || 'Network error');
    }
    const data = await res.json().catch(() => null);
    if (res.status === 403 && canRetry) {
      if (data && data.csrf) applyCsrf(data.csrf); else await refreshSession();
      return postJson(url, payload, false);
    }
    if (!res.ok || !data || !data.ok) throw new Error(data?.error || S.errorGeneric || 'Request failed');
    if (data.csrf) applyCsrf(data.csrf);
    return data;
  }

  // Back/forward restores pages from memory with old counters and tokens.
  window.addEventListener('pageshow', event => { if (event.persisted) refreshSession(); });

  /* ------------------------------------------------------------------ toasts */
  function showToast(message, { actionHref = '', actionLabel = '', tone = 'info' } = {}) {
    const region = document.getElementById('toast-region');
    if (!region || !message) return;
    while (region.children.length >= 3) region.firstElementChild.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${tone}`;
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    if (actionHref && actionLabel) {
      const link = document.createElement('a');
      link.className = 'toast-action';
      link.href = actionHref;
      link.textContent = actionLabel;
      toast.appendChild(link);
    }
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', S.cancel || 'Close');
    closeBtn.appendChild(createSvgIcon('M18 6 6 18M6 6l12 12'));
    const dismiss = () => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 220);
    };
    closeBtn.addEventListener('click', dismiss);
    toast.appendChild(closeBtn);
    region.appendChild(toast);
    setTimeout(dismiss, 3600);
  }

  /* ----------------------------------------------------------------- layers */
  // Modals and the mobile sheet fade/slide in: unhide, then add .is-open on the next frame.
  function openLayer(el) {
    if (!el) return;
    clearTimeout(el._closeTimer);
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-open');
    document.documentElement.style.overflow = 'hidden';
  }
  function closeLayer(el) {
    if (!el || el.hidden) return;
    el.classList.remove('is-open');
    el._closeTimer = setTimeout(() => {
      el.hidden = true;
      if (!$$('.modal-backdrop.is-open').length) document.documentElement.style.overflow = '';
    }, reduceMotion ? 0 : 280);
  }

  /* ------------------------------------------------------------------ theme */
  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    $('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#060a12' : '#f3f6fb');
    $('meta[name="color-scheme"]')?.setAttribute('content', next);
    $$('[data-theme-toggle]').forEach(link => {
      const label = next === 'dark' ? S.themeLight : S.themeDark;
      if (label) {
        link.setAttribute('aria-label', label);
        link.title = label;
        const text = link.querySelector('span:last-child:not([class])');
        if (text) text.textContent = label;
      }
      try {
        const url = new URL(link.getAttribute('href'), location.origin);
        url.searchParams.set('theme', next === 'dark' ? 'light' : 'dark');
        link.setAttribute('href', url.pathname + url.search);
      } catch { /* leave href */ }
    });
  }

  document.addEventListener('click', async event => {
    const toggle = event.target.closest('[data-theme-toggle]');
    if (!toggle) return;
    event.preventDefault();
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { await postJson('/api/settings', { theme: next }); } catch { window.location.href = toggle.href; }
  });

  /* ------------------------------------------------- header & scroll effects */
  const header = $('[data-site-header]');
  const progress = $('[data-scroll-progress]');
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    raf(() => {
      const y = window.scrollY;
      header?.classList.toggle('is-scrolled', y > 24);
      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* -------------------------------------------------------- reveal on scroll */
  function initReveal() {
    const items = $$('[data-reveal]');
    $$('[data-reveal-group]').forEach(group => {
      $$('[data-reveal]', group).forEach((el, i) => el.style.setProperty('--i', String(Math.min(i, 8))));
    });
    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach(el => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(el => io.observe(el));
  }

  function initCountUp() {
    const nodes = $$('[data-count]');
    if (!nodes.length) return;
    const run = el => {
      const target = Number(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      if (!Number.isFinite(target) || reduceMotion) return;
      const start = performance.now();
      const duration = 1400;
      const tick = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (t < 1) raf(tick);
      };
      el.textContent = '0' + suffix;
      raf(tick);
    };
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        run(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    nodes.forEach(el => io.observe(el));
  }

  /* ------------------------------------------- pointer effects (fine pointers) */
  if (finePointer && !reduceMotion) {
    let pending = null;
    document.addEventListener('pointermove', event => {
      const card = event.target.closest?.('[data-spotlight]');
      if (card) {
        pending = { card, x: event.clientX, y: event.clientY };
        raf(() => {
          if (!pending) return;
          const rect = pending.card.getBoundingClientRect();
          pending.card.style.setProperty('--mx', `${pending.x - rect.left}px`);
          pending.card.style.setProperty('--my', `${pending.y - rect.top}px`);
          pending = null;
        });
      }
    }, { passive: true });

    const hero = $('.hero');
    const parallax = $('[data-parallax]');
    if (hero && parallax) {
      hero.addEventListener('pointermove', event => {
        const rect = hero.getBoundingClientRect();
        const px = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        const py = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        raf(() => {
          parallax.style.setProperty('--px', px.toFixed(3));
          parallax.style.setProperty('--py', py.toFixed(3));
        });
      }, { passive: true });
      hero.addEventListener('pointerleave', () => {
        parallax.style.setProperty('--px', '0');
        parallax.style.setProperty('--py', '0');
      });
    }

    const zoomFrame = $('[data-zoom]');
    if (zoomFrame) {
      zoomFrame.addEventListener('pointermove', event => {
        const rect = zoomFrame.getBoundingClientRect();
        zoomFrame.style.setProperty('--zx', `${((event.clientX - rect.left) / rect.width) * 100}%`);
        zoomFrame.style.setProperty('--zy', `${((event.clientY - rect.top) / rect.height) * 100}%`);
      }, { passive: true });
      zoomFrame.addEventListener('pointerenter', () => zoomFrame.classList.add('is-zoom'));
      zoomFrame.addEventListener('pointerleave', () => zoomFrame.classList.remove('is-zoom'));
    }
  }

  /* ---------------------------------------------------- image loading polish */
  function initImages() {
    $$('.card-art, .detail-art-frame').forEach(box => {
      const img = box.querySelector('img');
      if (!img) return;
      const done = () => box.classList.add('is-loaded');
      if (img.complete && img.naturalWidth) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });
  }

  /* ------------------------------------------- prefetch for non-Chromium browsers */
  if (!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules'))) {
    const seen = new Set();
    const warm = event => {
      const link = event.target.closest?.('a[href^="/"]');
      if (!link || link.target === '_blank') return;
      const href = link.getAttribute('href');
      if (seen.has(href) || /^\/(settings|admin|api|cart\/|checkout|success|favorites\/|compare\/|builder\/add)/.test(href)) return;
      seen.add(href);
      const hint = document.createElement('link');
      hint.rel = 'prefetch';
      hint.href = href;
      document.head.appendChild(hint);
    };
    document.addEventListener('pointerover', event => { if (event.pointerType === 'mouse') warm(event); }, { passive: true });
    document.addEventListener('touchstart', warm, { passive: true });
  }

  /* ------------------------------------------------------- menu sheet & modals */
  const menuSheet = document.getElementById('menu-sheet');
  const paletteModal = document.getElementById('palette-modal');
  const confirmModal = document.getElementById('confirm-modal');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmAccept = document.getElementById('confirm-accept');
  let pendingConfirmForm = null;

  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-menu]')) {
      event.preventDefault();
      openLayer(menuSheet);
      return;
    }
    if (event.target.closest('[data-open-palette]')) {
      event.preventDefault();
      closeLayer(menuSheet);
      openPalette();
      return;
    }
    const closer = event.target.closest('[data-close-modal]');
    if (closer) {
      const layer = closer.closest('.modal-backdrop');
      if (layer === confirmModal) pendingConfirmForm = null;
      closeLayer(layer);
      return;
    }
    if (event.target.classList.contains('modal-backdrop')) {
      if (event.target === confirmModal) pendingConfirmForm = null;
      closeLayer(event.target);
    }
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('form[data-confirm]');
    if (!form || form.dataset.confirmed === 'true' || !confirmModal || !confirmMessage) return;
    event.preventDefault();
    pendingConfirmForm = form;
    confirmMessage.textContent = form.dataset.confirm || '';
    openLayer(confirmModal);
    confirmAccept?.focus();
  });

  confirmAccept?.addEventListener('click', () => {
    if (!pendingConfirmForm) return;
    const targetForm = pendingConfirmForm;
    targetForm.dataset.confirmed = 'true';
    closeLayer(confirmModal);
    targetForm.submit();
  });

  /* ---------------------------------------------------- async shop actions */
  function syncProductToggleButtons(kind, productId, active) {
    const selector = `form[data-async-form="${kind}"][data-product-id="${CSS.escape(productId)}"] button`;
    $$(selector).forEach(btn => {
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      const label = kind === 'favorite'
        ? (active ? S.removeFavorite : S.addFavorite)
        : (active ? S.removeCompare : S.addCompare);
      if (label) { btn.title = label; btn.setAttribute('aria-label', label); }
    });
  }

  function refreshCartSummaryDom(summary) {
    const wrap = document.getElementById('cart-summary-wrap');
    if (!wrap || !summary) return;
    const subtotalEl = $('.summary-subtotal strong', wrap);
    if (subtotalEl && summary.subtotalFormatted) subtotalEl.textContent = summary.subtotalFormatted;
    const target = $('.summary-subtotal + .summary-line strong', wrap);
    if (target && summary.deliveryFormatted) target.textContent = summary.deliveryFormatted;
    const totalEl = $('.summary-total strong', wrap);
    if (totalEl && summary.totalFormatted) totalEl.textContent = summary.totalFormatted;

    if (Array.isArray(summary.lines)) {
      const box = $('.order-summary', wrap);
      const subtotalRow = box?.querySelector('.summary-subtotal');
      if (box && subtotalRow) {
        while (subtotalRow.previousElementSibling?.classList.contains('summary-line')) {
          subtotalRow.previousElementSibling.remove();
        }
        summary.lines.forEach(line => {
          const row = document.createElement('div');
          row.className = 'summary-line';
          const span = document.createElement('span');
          span.append(document.createTextNode(line.name || line.id));
          const b = document.createElement('b');
          b.textContent = `× ${line.qty}`;
          span.appendChild(b);
          const strong = document.createElement('strong');
          strong.textContent = line.lineTotalFormatted;
          row.append(span, strong);
          box.insertBefore(row, subtotalRow);
        });
      }
    }
  }

  function flyToCart(form) {
    if (reduceMotion) return;
    const source = form.closest('.product-card')?.querySelector('.product-art') || $('.detail-art-frame .product-art');
    const target = $$('[data-cart-target]').find(el => el.getBoundingClientRect().width > 0);
    if (!source || !target) return;
    const s = source.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'fly-dot';
    const img = document.createElement('img');
    img.src = source.currentSrc || source.src;
    img.alt = '';
    dot.appendChild(img);
    dot.style.left = `${s.left + s.width / 2 - 27}px`;
    dot.style.top = `${s.top + s.height / 2 - 27}px`;
    document.body.appendChild(dot);
    const dx = t.left + t.width / 2 - (s.left + s.width / 2);
    const dy = t.top + t.height / 2 - (s.top + s.height / 2);
    const anim = dot.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.25 - 70}px) scale(.8)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(.18)`, opacity: 0.25 }
    ], { duration: 780, easing: 'cubic-bezier(.45,.05,.55,.95)' });
    anim.onfinish = () => dot.remove();
  }

  document.addEventListener('submit', async event => {
    const form = event.target.closest('form[data-async-form]');
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.asyncForm;
    const productId = form.dataset.productId || form.querySelector('input[name="id"]')?.value || '';
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.classList.add('is-busy');

    try {
      if (kind === 'cart-add') {
        const data = await postJson('/api/cart/add', { id: productId });
        flyToCart(form);
        updateHeaderCounts(data.counts);
        showToast(data.capped ? S.toastCartUpdated : (S.toastCartAdded || 'Added'), {
          actionHref: '/cart', actionLabel: S.openCart || 'Cart', tone: 'success'
        });
        if (submitBtn) {
          submitBtn.classList.add('is-done');
          setTimeout(() => submitBtn.classList.remove('is-done'), 1100);
        }
      } else if (kind === 'cart-update') {
        const qty = Number(form.querySelector('input[name="qty"]')?.value || 0);
        const data = await postJson('/api/cart/update', { id: productId, qty });
        updateHeaderCounts(data.counts);
        if (data.empty) { window.location.reload(); return; }
        const lineEl = form.closest('[data-cart-line]');
        if (qty <= 0) {
          lineEl?.remove();
          refreshCartSummaryDom(data.summary);
          showToast(S.toastCartRemoved || 'Removed');
          return;
        }
        const linePrice = lineEl?.querySelector('[data-line-total]');
        if (linePrice && data.lineTotalFormatted) linePrice.textContent = data.lineTotalFormatted;
        refreshCartSummaryDom(data.summary);
      } else if (kind === 'cart-remove') {
        const data = await postJson('/api/cart/remove', { id: productId });
        updateHeaderCounts(data.counts);
        showToast(S.toastCartRemoved || 'Removed');
        if (data.empty) { window.location.reload(); return; }
        form.closest('[data-cart-line]')?.remove();
        refreshCartSummaryDom(data.summary);
      } else if (kind === 'favorite') {
        const data = await postJson('/api/favorites/toggle', { id: productId });
        updateHeaderCounts(data.counts);
        syncProductToggleButtons('favorite', productId, !!data.active);
        showToast(data.active ? S.toastFavAdded : S.toastFavRemoved, { tone: data.active ? 'success' : 'info' });
        if (!data.active && window.location.pathname === '/favorites') window.location.reload();
      } else if (kind === 'compare') {
        const data = await postJson('/api/compare/toggle', { id: productId });
        updateHeaderCounts(data.counts);
        if (data.full) {
          showToast(S.toastCmpFull || 'Max 4 items', { tone: 'warn' });
        } else {
          syncProductToggleButtons('compare', productId, !!data.active);
          showToast(data.active ? S.toastCmpAdded : S.toastCmpRemoved, { tone: data.active ? 'success' : 'info' });
        }
      }
    } catch (err) {
      showToast(err.message || S.errorGeneric, { tone: 'error' });
    } finally {
      submitBtn?.classList.remove('is-busy');
    }
  });

  document.addEventListener('click', event => {
    const stepBtn = event.target.closest('[data-qty-step]');
    if (!stepBtn) return;
    const form = stepBtn.closest('form.quantity-form');
    const input = form?.querySelector('input[name="qty"]');
    if (!form || !input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 99);
    input.value = String(Math.max(min, Math.min(max, Number(input.value || 1) + Number(stepBtn.dataset.qtyStep || 0))));
    form.requestSubmit();
  });
  $$('form.quantity-form input[name="qty"]').forEach(input => {
    input.addEventListener('change', () => input.form?.requestSubmit());
  });

  /* ------------------------------------------------------- catalog filters */
  const filterToggle = $('[data-filter-toggle]');
  const filterPanel = $('[data-filter-panel]');
  if (filterToggle && filterPanel) {
    filterToggle.addEventListener('click', () => {
      const open = filterPanel.classList.toggle('is-open');
      filterToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    filterPanel.addEventListener('change', event => {
      if (event.target.matches('select, input[type="checkbox"]')) filterPanel.querySelector('form')?.requestSubmit();
    });
  }

  /* -------------------------------------------------------- command palette */
  const paletteInput = document.getElementById('palette-input');
  const paletteResults = document.getElementById('palette-results');
  let searchTimer = null;
  let searchController = null;
  let paletteIndex = -1;

  function syncPaletteSelection() {
    const rows = paletteResults ? $$('.palette-item', paletteResults) : [];
    rows.forEach((row, idx) => {
      const selected = idx === paletteIndex;
      row.classList.toggle('is-selected', selected);
      if (selected) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function openPalette() {
    if (!paletteModal) return;
    paletteIndex = -1;
    openLayer(paletteModal);
    if (paletteInput) { paletteInput.focus(); paletteInput.select(); }
  }

  function renderPaletteItems(items, queryText) {
    if (!paletteResults) return;
    paletteIndex = -1;
    paletteResults.replaceChildren();
    const hint = text => {
      const p = document.createElement('p');
      p.className = 'palette-hint';
      p.textContent = text;
      paletteResults.appendChild(p);
    };
    if (!queryText) return hint(S.shortcutTip || 'Ctrl+K');
    if (!items.length) return hint(S.paletteEmpty || 'No matches');

    const list = document.createElement('div');
    list.className = 'palette-list';
    items.forEach(item => {
      const row = document.createElement('a');
      row.className = 'palette-item';
      row.href = `/product/${encodeURIComponent(item.slug)}`;
      const img = document.createElement('img');
      const original = item.imageUrl || `/images/${encodeURIComponent(item.id)}.jpg`;
      img.src = original.replace(/\.jpg$/, '-400.webp');
      img.onerror = () => { img.onerror = null; img.src = original; };
      img.alt = '';
      img.width = 64;
      img.height = 48;
      const meta = document.createElement('div');
      meta.className = 'palette-item-meta';
      const title = document.createElement('strong');
      title.textContent = item.name;
      const sub = document.createElement('small');
      sub.textContent = `${item.brand} · ${item.categoryLabel}`;
      meta.append(title, sub);
      const price = document.createElement('span');
      price.className = 'palette-item-price';
      price.textContent = item.priceFormatted;
      row.append(img, meta, price);
      list.appendChild(row);
    });
    paletteResults.appendChild(list);
  }

  async function runPaletteSearch(query) {
    const trimmed = query.trim();
    if (!trimmed) return renderPaletteItems([], '');
    if (searchController) searchController.abort();
    searchController = new AbortController();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&lang=${encodeURIComponent(BOOT.lang || 'uz')}`, {
        headers: { Accept: 'application/json' }, signal: searchController.signal
      });
      const data = await res.json();
      renderPaletteItems(Array.isArray(data?.items) ? data.items : [], trimmed);
    } catch (err) {
      if (err.name !== 'AbortError') renderPaletteItems([], trimmed);
    }
  }

  paletteInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runPaletteSearch(paletteInput.value), 140);
  });
  paletteInput?.addEventListener('keydown', event => {
    const rows = paletteResults ? $$('.palette-item', paletteResults) : [];
    if (event.key === 'ArrowDown' && rows.length) {
      event.preventDefault();
      paletteIndex = (paletteIndex + 1) % rows.length;
      syncPaletteSelection();
    } else if (event.key === 'ArrowUp' && rows.length) {
      event.preventDefault();
      paletteIndex = paletteIndex <= 0 ? rows.length - 1 : paletteIndex - 1;
      syncPaletteSelection();
    } else if (event.key === 'Enter') {
      if (paletteIndex >= 0 && rows[paletteIndex]) {
        event.preventDefault();
        rows[paletteIndex].click();
      } else if (paletteInput.value.trim()) {
        event.preventDefault();
        window.location.href = `/catalog?q=${encodeURIComponent(paletteInput.value.trim())}`;
      }
    }
  });

  document.addEventListener('keydown', event => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
    } else if (!typing && event.key === '/') {
      event.preventDefault();
      openPalette();
    } else if (event.key === 'Escape') {
      $$('.modal-backdrop.is-open').forEach(closeLayer);
      pendingConfirmForm = null;
    }
  });


  // Live PC Builder calculator & compatibility checker
  const builderRoot = document.querySelector('[data-builder-root]');
  if (builderRoot) {
    let partsMap = {};
    try {
      partsMap = JSON.parse(builderRoot.dataset.parts || '{}');
    } catch {
      partsMap = {};
    }

    // Product photos may sit in a <picture> with WebP sources; swapping only
    // img.src would leave the old WebP on screen, so drop the sources first.
    const setPickImage = (img, item) => {
      const picture = img.parentElement;
      if (picture && picture.tagName === 'PICTURE') picture.replaceWith(img);
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.src = item.imageUrl;
      img.alt = item.name;
    };

    const tweenMoney = (el, value, lang) => {
      const from = Number(el.dataset.value || 0);
      el.dataset.value = String(value);
      if (reduceMotion || !from || from === value) { el.textContent = formatMoney(value, lang); return; }
      const start = performance.now();
      const step = now => {
        const t = Math.min(1, (now - start) / 450);
        el.textContent = formatMoney(from + (value - from) * (1 - Math.pow(1 - t, 3)), lang);
        if (t < 1) raf(step);
      };
      raf(step);
    };

    const updateBuilder = () => {
      const picks = {};
      builderRoot.querySelectorAll('[data-builder-select]').forEach(select => {
        const field = select.dataset.builderSelect;
        picks[field] = partsMap[select.value] || null;
        const hidden = builderRoot.querySelector(`[data-builder-hidden="${field}"]`);
        if (hidden) hidden.value = select.value;
      });

      const cpu = picks.cpu;
      const board = picks.board;
      const ram = picks.ram;
      const cooler = picks.cooler;
      const gpu = picks.gpu;
      const psu = picks.psu;

      const socketMismatch = Boolean(cpu?.socket && board?.socket && cpu.socket !== board.socket);
      const ramMismatch = Boolean(board?.ddr && ram?.ddr && board.ddr !== ram.ddr);
      const normCooler = String(cooler?.coolerSpec || '').replace(/\s+/g, '');
      const coolerMismatch = Boolean(cpu?.socket && /(AM4|AM5|LGA)/.test(normCooler) && !normCooler.includes(cpu.socket));
      const compatible = !socketMismatch && !ramMismatch && !coolerMismatch && Object.values(picks).every(Boolean);

      const estWatts = (cpu?.cpuWatts || 0) + (gpu?.gpuWatts || 0) + 100;
      const psuWatts = psu?.psuWatts || 0;
      const psuOk = !psuWatts || psuWatts >= Math.round(estWatts * 1.15);
      const total = Object.values(picks).reduce((sum, item) => sum + Number(item?.price || 0), 0);

      const totalEl = builderRoot.querySelector('[data-builder-total]');
      if (totalEl) tweenMoney(totalEl, total, builderRoot.dataset.lang);

      const platformEl = builderRoot.querySelector('[data-builder-platform]');
      if (platformEl) {
        platformEl.textContent = `${cpu?.socket || board?.socket || 'AM5'} · ${board?.ddr || ram?.ddr || 'DDR5'} · PCIe 4.0`;
      }

      const estEl = builderRoot.querySelector('[data-est-watts]');
      if (estEl) estEl.textContent = `${estWatts} W`;

      const psuEl = builderRoot.querySelector('[data-psu-watts]');
      if (psuEl) psuEl.textContent = `${psuWatts || '—'} W`;

      const powerProgress = builderRoot.querySelector('.power-progress');
      if (powerProgress) {
        const pct = psuWatts > 0 ? Math.min(100, Math.round((estWatts / psuWatts) * 100)) : 50;
        powerProgress.value = pct;
        powerProgress.classList.toggle('is-warn', !psuOk);
      }

      const statusBadge = builderRoot.querySelector('[data-builder-status]');
      const statusTextEl = builderRoot.querySelector('[data-builder-status-text]');
      if (statusBadge && statusTextEl) {
        statusBadge.classList.toggle('is-error', !compatible);
        statusBadge.classList.toggle('is-warn', compatible && !psuOk);
        statusTextEl.textContent = !compatible
          ? (S.builderMismatch || 'Mismatch')
          : !psuOk
            ? (S.builderPsuWarning || 'Low PSU')
            : (S.builderCompatible || S.stock || 'Compatible');
      }

      const errEl = builderRoot.querySelector('[data-builder-error]');
      if (errEl) errEl.hidden = compatible;

      const warnEl = builderRoot.querySelector('[data-builder-psu-warn]');
      if (warnEl) warnEl.hidden = !(compatible && !psuOk);

      const addBtn = builderRoot.querySelector('[data-builder-add]');
      if (addBtn) addBtn.disabled = !compatible;

      const mainVisual = builderRoot.querySelector('[data-builder-visual] img');
      const heroPick = picks.case || picks.gpu;
      if (mainVisual && heroPick?.imageUrl) setPickImage(mainVisual, heroPick);
      const caseTag = builderRoot.querySelector('[data-builder-case-name]');
      if (caseTag && heroPick) caseTag.textContent = heroPick.name;

      ['cpu', 'gpu', 'board', 'case'].forEach(field => {
        const thumbImg = builderRoot.querySelector(`[data-builder-thumb="${field}"] img`);
        if (thumbImg && picks[field]?.imageUrl) setPickImage(thumbImg, picks[field]);
      });

      Object.entries(picks).forEach(([field, item]) => {
        const row = builderRoot.querySelector(`[data-builder-row="${field}"]`);
        if (!row) return;
        const nameSpan = row.querySelector('span');
        const markB = row.querySelector('b');
        if (nameSpan) nameSpan.textContent = item ? item.name : '—';
        if (markB) {
          markB.className = compatible ? 'is-ok' : 'is-bad';
          markB.replaceChildren(createSvgIcon(compatible ? 'M5 13l4 4L19 7' : 'M12 9v4m0 4h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z'));
        }
      });

      const nextUrl = new URL(window.location.href);
      Object.entries(picks).forEach(([field, item]) => {
        if (item?.id) nextUrl.searchParams.set(field, item.id);
      });
      window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search);
    };

    builderRoot.addEventListener('change', event => {
      if (event.target.matches('[data-builder-select]')) {
        updateBuilder();
      }
    });
  }

  // Client-side checkout validation preserving user values
  const checkoutForm = document.querySelector('[data-checkout-form]');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', event => {
      const nameInput = checkoutForm.querySelector('#name');
      const phoneInput = checkoutForm.querySelector('#phone');
      const addressInput = checkoutForm.querySelector('#address');

      const name = String(nameInput?.value || '').replace(/\s+/g, ' ').trim();
      const phone = String(phoneInput?.value || '').trim();
      const digits = phone.replace(/\D/g, '');
      const address = String(addressInput?.value || '').replace(/\s+/g, ' ').trim();

      const clearError = input => {
        if (!input) return;
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
        const next = input.nextElementSibling;
        if (next && next.classList.contains('field-error')) next.remove();
      };

      const setError = (input, message) => {
        if (!input || !message) return;
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
        const msg = document.createElement('p');
        msg.className = 'field-error';
        msg.setAttribute('role', 'alert');
        msg.textContent = message;
        input.insertAdjacentElement('afterend', msg);
      };

      [nameInput, phoneInput, addressInput].forEach(clearError);

      let firstInvalid = null;
      if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M}\s.'‘’`ʻʼ-]+$/u.test(name)) {
        setError(nameInput, S.errName || 'Invalid name');
        firstInvalid ||= nameInput;
      }
      if (digits.length < 9 || digits.length > 15 || !/^[+0-9()\-\s]{8,24}$/.test(phone)) {
        setError(phoneInput, S.errPhone || 'Invalid phone');
        firstInvalid ||= phoneInput;
      }
      if (address.length < 6 || address.length > 240) {
        setError(addressInput, S.errAddress || 'Invalid address');
        firstInvalid ||= addressInput;
      }

      if (firstInvalid) {
        event.preventDefault();
        firstInvalid.focus();
      }
    });
  }

  // Friendly phone field: start with the country code
  const phoneField = document.getElementById('phone');
  if (phoneField) {
    phoneField.addEventListener('focus', () => { if (!phoneField.value.trim()) phoneField.value = '+998 '; });
    phoneField.addEventListener('blur', () => { if (phoneField.value.trim() === '+998') phoneField.value = ''; });
  }

  /* --------------------------------------------------------- order success */
  function confetti(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx || reduceMotion) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
    };
    resize();
    const colors = ['#3cf7da', '#22b6ff', '#8f6cff', '#ffb86b', '#ffffff'];
    const pieces = Array.from({ length: 140 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.2,
      y: canvas.height * 0.32,
      vx: (Math.random() - 0.5) * 16 * ratio,
      vy: (-Math.random() * 15 - 4) * ratio,
      size: (Math.random() * 7 + 4) * ratio,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    const started = performance.now();
    const frame = now => {
      const age = now - started;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.vy += 0.36 * ratio;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / 3200);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      });
      if (age < 3200) raf(frame); else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    raf(frame);
  }

  /* ------------------------------------------------------------------ boot */
  function init() {
    initImages();
    initReveal();
    initCountUp();
    const canvas = $('[data-confetti]');
    if (canvas) confetti(canvas);
  }

  // A prerendered page must not play its entrance effects until it is shown.
  if (document.prerendering) document.addEventListener('prerenderingchange', init, { once: true });
  else init();

  // Register for a quiet refresh when the tab becomes visible again after a long pause.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) refreshSession();
  });
})();
