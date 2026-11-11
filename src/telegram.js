const fs = require('node:fs/promises');
const path = require('node:path');
const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const { ROOT, formatPrice, tashkentDayStart } = u(require('./config'));
const { getStore, productById, saveStore } = u(require('./storage'));
const { pngBuffer } = u(require('./artwork'));

let botStopped = false;
let pollTimer = null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function telegramCall(method, body, { timeout = 15000 } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !process.env.TELEGRAM_ADMIN_ID) return { ok: false, disabled: true };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeout)
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Telegram returned an unreadable response'); }
  if (!response.ok || !result.ok) throw new Error(result.description || 'Telegram request was not accepted');
  return result;
}

async function sendOrderReport(order) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_ADMIN_ID) return false;
  const store = getStore();
  const chatId = process.env.TELEGRAM_ADMIN_ID;
  try {
    for (const item of order.items) {
      const imageProduct = productById(item.id) || { id: item.id, name: { uz: item.name }, image: 'tower' };
      let bytes;
      let mime = 'image/jpeg';
      let ext = 'jpg';
      const safeId = String(imageProduct.id || '').replace(/[^a-z0-9-]/gi, '');
      try {
        if (!safeId) throw new Error('missing id');
        bytes = await fs.readFile(path.join(ROOT, 'public', 'images', `${safeId}.jpg`));
      } catch {
        bytes = pngBuffer(imageProduct);
        mime = 'image/png';
        ext = 'png';
      }
      const form = new FormData();
      form.append('chat_id', chatId);
      const caption = `${order.id} · ${item.name}\n${formatPrice(item.price, 'uz')} × ${item.qty}\n\n${(item.specs || []).join(' · ')}`.slice(0, 990);
      form.append('caption', caption);
      form.append('photo', new Blob([bytes], { type: mime }), `${item.id}.${ext}`);
      const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(15000)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.description || 'Order photo was not accepted');
    }
    const report = [
      `KRAKENPC · YANGI BUYURTMA · ${order.id}`,
      `Mijoz: ${order.name}`,
      `Telefon: ${order.phone}`,
      `Yetkazish manzili: ${order.address}`,
      order.note ? `Izoh: ${order.note}` : '',
      'Buyurtma tarkibi:', ...order.items.map(i => `• ${i.name} × ${i.qty} — ${formatPrice(i.price * i.qty, 'uz')}`),
      `Mahsulotlar: ${formatPrice(order.subtotal, 'uz')}`,
      `Yetkazish: ${order.delivery === 0 ? 'Bepul' : formatPrice(order.delivery, 'uz')}`,
      `JAMI: ${formatPrice(order.total, 'uz')}`,
      `Holat: ${order.status}`,
      `Sana: ${order.createdAt}`
    ].filter(Boolean).join('\n');
    await telegramCall('sendMessage', { chat_id: chatId, text: report.slice(0, 4000), disable_web_page_preview: true });
    const saved = store.orders.find(item => item.id === order.id);
    if (saved) {
      saved.telegramStatus = 'sent';
      delete saved.telegramError;
      await saveStore();
    }
    return true;
  } catch (error) {
    const saved = store.orders.find(item => item.id === order.id);
    if (saved) {
      saved.telegramStatus = 'failed';
      saved.telegramError = String(error?.message || 'Telegram error').slice(0, 140);
      await saveStore();
    }
    console.warn(`Telegram order report failed for ${order.id}. Check token, chat id, or bot permissions.`);
    return false;
  }
}

async function sendStatusReport(order) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_ADMIN_ID) return;
  try {
    await telegramCall('sendMessage', {
      chat_id: process.env.TELEGRAM_ADMIN_ID,
      text: `KRAKENPC · BUYURTMA HOLATI YANGILANDI · ${order.id}\nHolat: ${order.status}\nMijoz: ${order.name}\nJami: ${formatPrice(order.total, 'uz')}`
    });
  } catch {
    console.warn(`Telegram order update failed for ${order.id}.`);
  }
}

async function replyToAdmin(message) {
  const store = getStore();
  if (!message?.chat || String(message.chat.id) !== String(process.env.TELEGRAM_ADMIN_ID) || String(message.from?.id) !== String(process.env.TELEGRAM_ADMIN_ID)) return;
  const command = String(message.text || '').trim().split(/\s+/)[0].replace(/@[^@]+$/, '').toLowerCase();
  if (!['/start', '/help', '/today', '/orders'].includes(command)) return;
  let text;
  if (command === '/today') {
    const start = tashkentDayStart();
    const list = store.orders.filter(order => new Date(order.createdAt).getTime() >= start);
    text = `KRAKENPC · BUGUNGI BUYURTMALAR\n${list.length} ta · ${formatPrice(list.reduce((sum, order) => sum + order.total, 0), 'uz')}\n` + (list.length ? list.slice(-10).map(o => `${o.id} · ${o.name} · ${formatPrice(o.total, 'uz')} · ${o.status}`).join('\n') : 'Bugun buyurtmalar yo‘q.');
  } else if (command === '/orders') {
    text = `KRAKENPC · SO‘NGGI BUYURTMALAR\n` + (store.orders.length ? store.orders.slice(-10).reverse().map(o => `${o.id} · ${o.name} · ${formatPrice(o.total, 'uz')} · ${o.status}`).join('\n') : 'Hali buyurtmalar yo‘q.');
  } else {
    text = 'KrakenPC buyurtma botiga xush kelibsiz.\n/today — bugungi buyurtmalar va jami\n/orders — so‘nggi buyurtmalar';
  }
  try {
    await telegramCall('sendMessage', { chat_id: process.env.TELEGRAM_ADMIN_ID, text: text.slice(0, 4000), disable_web_page_preview: true });
  } catch {
    console.warn('Telegram admin command could not be answered.');
  }
}

async function pollTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_ADMIN_ID) return;
  const store = getStore();
  while (!botStopped) {
    try {
      const offset = Number(store.botOffset || 0);
      const result = await telegramCall('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, { timeout: 35000 });
      if (!result.ok || !Array.isArray(result.result)) throw new Error('No update list');
      for (const update of result.result) {
        store.botOffset = update.update_id + 1;
        await saveStore();
        await replyToAdmin(update.message);
      }
    } catch {
      if (!botStopped) {
        console.warn('Telegram bot polling is unavailable. It will retry shortly.');
        await wait(12000);
      }
    }
  }
}

function startBotPolling() {
  botStopped = false;
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_ID) {
    pollTimer = setTimeout(() => { void pollTelegram(); }, 2500);
    pollTimer.unref?.();
  }
}

function stopBotPolling() {
  botStopped = true;
  if (pollTimer) clearTimeout(pollTimer);
}

module.exports = { sendOrderReport, sendStatusReport, startBotPolling, stopBotPolling };

