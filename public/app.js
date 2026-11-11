(() => {
  'use strict';

  const bootEl = document.getElementById('kraken-boot');
  let BOOT = { csrf: '', lang: 'uz', theme: 'dark', strings: {} };
  if (bootEl) {
    try {
      BOOT = JSON.parse(bootEl.textContent || '{}');
    } catch {
      // Fall back to default empty boot config when JSON is malformed.
    }
  }
  const S = BOOT.strings || {};

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

  function showToast(message, { actionHref = '', actionLabel = '', tone = 'info' } = {}) {
    const region = document.getElementById('toast-region');
    if (!region || !message) return;

    while (region.children.length >= 4) {
      region.firstElementChild.remove();
    }

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
    closeBtn.addEventListener('click', () => toast.remove());
    toast.appendChild(closeBtn);

    region.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3400);
  }

  function updateHeaderCounts(counts) {
    if (!counts) return;
    if (typeof counts.cart === 'number') {
      document.querySelectorAll('[data-cart-count]').forEach(el => {
        el.textContent = String(counts.cart);
      });
    }
    if (typeof counts.favorites === 'number') {
      document.querySelectorAll('[data-fav-count]').forEach(el => {
        el.textContent = counts.favorites > 0 ? String(counts.favorites) : '';
      });
    }
    if (typeof counts.compare === 'number') {
      document.querySelectorAll('[data-compare-count]').forEach(el => {
        el.textContent = counts.compare > 0 ? String(counts.compare) : '';
      });
    }
  }

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': BOOT.csrf || ''
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error || S.errorGeneric || 'Request failed');
    }
    if (data.csrf) BOOT.csrf = data.csrf;
    return data;
  }

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', next === 'dark' ? '#0b1118' : '#f1f5f6');
    const schemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (schemeMeta) schemeMeta.setAttribute('content', next);
  }

  // Instant theme apply & instant language switch
  const settingsForm = document.querySelector('[data-settings-form]');
  if (settingsForm) {
    const themeSelect = settingsForm.querySelector('#theme');
    const themeToggleBtn = settingsForm.querySelector('[data-theme-toggle]');
    const langSelect = settingsForm.querySelector('#language');

    const saveTheme = async chosen => {
      applyTheme(chosen);
      if (themeSelect) themeSelect.value = chosen;
      try {
        await postJson('/api/settings', { theme: chosen });
      } catch {
        settingsForm.submit();
      }
    };

    if (themeSelect) {
      themeSelect.addEventListener('change', () => saveTheme(themeSelect.value));
    }
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        saveTheme(next);
      });
    }
    if (langSelect) {
      langSelect.addEventListener('change', () => {
        settingsForm.submit();
      });
    }
  }

  function syncProductToggleButtons(kind, productId, active) {
    const selector = `form[data-async-form="${kind}"][data-product-id="${CSS.escape(productId)}"] button`;
    document.querySelectorAll(selector).forEach(btn => {
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (kind === 'favorite') {
        const label = active ? S.removeFavorite : S.addFavorite;
        if (label) {
          btn.title = label;
          btn.setAttribute('aria-label', label);
        }
      } else if (kind === 'compare') {
        const label = active ? S.removeCompare : S.addCompare;
        if (label) {
          btn.title = label;
          btn.setAttribute('aria-label', label);
        }
      }
    });
  }

  function refreshCartSummaryDom(summary) {
    const wrap = document.getElementById('cart-summary-wrap');
    if (!wrap || !summary) return;
    const subtotalEl = wrap.querySelector('.summary-subtotal strong');
    if (subtotalEl && summary.subtotalFormatted) subtotalEl.textContent = summary.subtotalFormatted;

    const deliveryLine = wrap.querySelectorAll('.summary-line');
    if (deliveryLine.length >= 2 && summary.deliveryFormatted) {
      const target = wrap.querySelector('.summary-subtotal + .summary-line strong');
      if (target) target.textContent = summary.deliveryFormatted;
    }

    const totalEl = wrap.querySelector('.summary-total strong');
    if (totalEl && summary.totalFormatted) totalEl.textContent = summary.totalFormatted;

    if (Array.isArray(summary.lines)) {
      const box = wrap.querySelector('.order-summary');
      const subtotalRow = box?.querySelector('.summary-subtotal');
      if (box && subtotalRow) {
        while (subtotalRow.previousElementSibling && subtotalRow.previousElementSibling.classList.contains('summary-line')) {
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
          row.appendChild(span);
          row.appendChild(strong);
          box.insertBefore(row, subtotalRow);
        });
      }
    }
  }

  document.addEventListener('submit', async event => {
    const form = event.target.closest('form[data-async-form]');
    if (!form) return;

    event.preventDefault();
    const kind = form.dataset.asyncForm;
    const productId = form.dataset.productId || form.querySelector('input[name="id"]')?.value || '';
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (kind === 'cart-add') {
        const data = await postJson('/api/cart/add', { id: productId });
        updateHeaderCounts(data.counts);
        showToast(data.capped ? S.toastCartUpdated : (S.toastCartAdded || 'Added'), {
          actionHref: '/cart',
          actionLabel: S.openCart || 'Cart',
          tone: 'success'
        });
      } else if (kind === 'cart-update') {
        const qtyInput = form.querySelector('input[name="qty"]');
        const qty = Number(qtyInput?.value || 0);
        const data = await postJson('/api/cart/update', { id: productId, qty });
        updateHeaderCounts(data.counts);
        if (data.empty) {
          window.location.reload();
          return;
        }
        const lineEl = form.closest('[data-cart-line]');
        if (qty <= 0) {
          if (lineEl) lineEl.remove();
          refreshCartSummaryDom(data.summary);
          showToast(S.toastCartRemoved || 'Removed');
          return;
        }
        const linePrice = lineEl?.querySelector('[data-line-total]');
        if (linePrice && data.lineTotalFormatted) linePrice.textContent = data.lineTotalFormatted;
        refreshCartSummaryDom(data.summary);
        showToast(S.toastCartUpdated || 'Updated', { tone: 'success' });
      } else if (kind === 'cart-remove') {
        const data = await postJson('/api/cart/remove', { id: productId });
        updateHeaderCounts(data.counts);
        showToast(S.toastCartRemoved || 'Removed');
        if (data.empty) {
          window.location.reload();
          return;
        }
        const lineEl = form.closest('[data-cart-line]');
        if (lineEl) lineEl.remove();
        refreshCartSummaryDom(data.summary);
      } else if (kind === 'favorite') {
        const data = await postJson('/api/favorites/toggle', { id: productId });
        updateHeaderCounts(data.counts);
        syncProductToggleButtons('favorite', productId, !!data.active);
        showToast(data.active ? S.toastFavAdded : S.toastFavRemoved, {
          tone: data.active ? 'success' : 'info'
        });
        if (!data.active && window.location.pathname === '/favorites') {
          window.location.reload();
        }
      } else if (kind === 'compare') {
        const data = await postJson('/api/compare/toggle', { id: productId });
        updateHeaderCounts(data.counts);
        if (data.full) {
          showToast(S.toastCmpFull || 'Max 4 items', { tone: 'warn' });
        } else {
          syncProductToggleButtons('compare', productId, !!data.active);
          showToast(data.active ? S.toastCmpAdded : S.toastCmpRemoved, {
            tone: data.active ? 'success' : 'info'
          });
        }
      }
    } catch (err) {
      showToast(err.message || S.errorGeneric, { tone: 'error' });
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Cart - / + quantity stepper buttons
  document.addEventListener('click', event => {
    const stepBtn = event.target.closest('[data-qty-step]');
    if (!stepBtn) return;
    const form = stepBtn.closest('form.quantity-form');
    const input = form?.querySelector('input[name="qty"]');
    if (!form || !input) return;

    const delta = Number(stepBtn.dataset.qtyStep || 0);
    const min = Number(input.min || 0);
    const max = Number(input.max || 99);
    const next = Math.max(min, Math.min(max, Number(input.value || 1) + delta));
    input.value = String(next);
    form.requestSubmit();
  });

  // Custom confirm modal for forms with [data-confirm]
  const confirmModal = document.getElementById('confirm-modal');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmAccept = document.getElementById('confirm-accept');
  let pendingConfirmForm = null;

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (modal === confirmModal) pendingConfirmForm = null;
  }

  document.addEventListener('submit', event => {
    const form = event.target.closest('form[data-confirm]');
    if (!form || form.dataset.confirmed === 'true' || !confirmModal || !confirmMessage) return;
    event.preventDefault();
    pendingConfirmForm = form;
    confirmMessage.textContent = form.dataset.confirm || '';
    confirmModal.hidden = false;
    confirmAccept?.focus();
  });

  confirmAccept?.addEventListener('click', () => {
    if (!pendingConfirmForm) return;
    const targetForm = pendingConfirmForm;
    targetForm.dataset.confirmed = 'true';
    closeModal(confirmModal);
    targetForm.submit();
  });

  // Command palette (Ctrl+K / / / button click)
  const paletteModal = document.getElementById('palette-modal');
  const paletteInput = document.getElementById('palette-input');
  const paletteResults = document.getElementById('palette-results');
  let searchTimer = null;
  let searchController = null;
  let paletteIndex = -1;

  function syncPaletteSelection() {
    const rows = paletteResults ? Array.from(paletteResults.querySelectorAll('.palette-item')) : [];
    rows.forEach((row, idx) => {
      const selected = idx === paletteIndex;
      row.classList.toggle('is-selected', selected);
      if (selected) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function openPalette() {
    if (!paletteModal) return;
    paletteIndex = -1;
    paletteModal.hidden = false;
    if (paletteInput) {
      paletteInput.focus();
      paletteInput.select();
    }
  }

  function renderPaletteItems(items, queryText) {
    if (!paletteResults) return;
    paletteIndex = -1;
    paletteResults.replaceChildren();

    if (!queryText) {
      const hint = document.createElement('p');
      hint.className = 'palette-hint';
      hint.textContent = S.shortcutTip || 'Ctrl+K';
      paletteResults.appendChild(hint);
      return;
    }

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'palette-hint';
      empty.textContent = S.paletteEmpty || 'No matches';
      paletteResults.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'palette-list';

    items.forEach(item => {
      const row = document.createElement('a');
      row.className = 'palette-item';
      row.href = `/product/${encodeURIComponent(item.slug)}`;

      const img = document.createElement('img');
      img.src = item.imageUrl || `/images/${encodeURIComponent(item.id)}.jpg`;
      img.alt = '';
      img.width = 56;
      img.height = 42;
      row.appendChild(img);

      const meta = document.createElement('div');
      meta.className = 'palette-item-meta';
      const title = document.createElement('strong');
      title.textContent = item.name;
      const sub = document.createElement('small');
      sub.textContent = `${item.brand} · ${item.categoryLabel}`;
      meta.appendChild(title);
      meta.appendChild(sub);
      row.appendChild(meta);

      const price = document.createElement('span');
      price.className = 'palette-item-price';
      price.textContent = item.priceFormatted;
      row.appendChild(price);

      list.appendChild(row);
    });

    paletteResults.appendChild(list);
  }

  async function runPaletteSearch(query) {
    const trimmed = query.trim();
    if (!trimmed) {
      renderPaletteItems([], '');
      return;
    }
    if (searchController) searchController.abort();
    searchController = new AbortController();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&lang=${encodeURIComponent(BOOT.lang || 'uz')}`, {
        headers: { 'Accept': 'application/json' },
        signal: searchController.signal
      });
      const data = await res.json();
      renderPaletteItems(Array.isArray(data?.items) ? data.items : [], trimmed);
    } catch (err) {
      if (err.name !== 'AbortError') renderPaletteItems([], trimmed);
    }
  }

  paletteInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runPaletteSearch(paletteInput.value), 160);
  });

  paletteInput?.addEventListener('keydown', event => {
    const rows = paletteResults ? Array.from(paletteResults.querySelectorAll('.palette-item')) : [];
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

  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-palette]')) {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.target.closest('[data-close-modal]')) {
      closeModal(event.target.closest('.modal-backdrop'));
      return;
    }
    if (event.target.classList.contains('modal-backdrop')) {
      closeModal(event.target);
    }
  });

  document.addEventListener('keydown', event => {
    const activeTag = document.activeElement?.tagName;
    const inEditable = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || document.activeElement?.isContentEditable;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }
    if (!inEditable && event.key === '/') {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.key === 'Escape') {
      if (paletteModal && !paletteModal.hidden) closeModal(paletteModal);
      if (confirmModal && !confirmModal.hidden) closeModal(confirmModal);
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
      if (totalEl) totalEl.textContent = formatMoney(total, builderRoot.dataset.lang);

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
      if (mainVisual && heroPick?.imageUrl) {
        mainVisual.src = heroPick.imageUrl;
        mainVisual.alt = heroPick.name;
      }
      const caseTag = builderRoot.querySelector('[data-builder-case-name]');
      if (caseTag && heroPick) caseTag.textContent = heroPick.name;

      ['cpu', 'gpu', 'board', 'case'].forEach(field => {
        const thumbImg = builderRoot.querySelector(`[data-builder-thumb="${field}"] img`);
        if (thumbImg && picks[field]?.imageUrl) {
          thumbImg.src = picks[field].imageUrl;
          thumbImg.alt = picks[field].name;
        }
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
})();
