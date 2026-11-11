const { BUILD_FIELDS } = require('./config');

function normalizeToken(raw) {
  return String(raw || '').toUpperCase().replace(/\s+/g, '');
}

function specsBlob(product) {
  if (!product) return '';
  const nameUz = product.name?.uz || product.name?.en || '';
  return [nameUz, ...(product.specs || [])].join(' ');
}

function extractSocket(product) {
  const match = specsBlob(product).match(/\b(AM5|AM4|LGA\s?1851|LGA\s?1700|LGA\s?1200)\b/i);
  return match ? normalizeToken(match[1]) : '';
}

function extractDdr(product) {
  const match = specsBlob(product).match(/\b(DDR5|DDR4|DDR3)\b/i);
  return match ? normalizeToken(match[1]) : '';
}

function extractPsuWatts(product) {
  const match = specsBlob(product).match(/\b(\d{3,4})\s*W\b/i);
  return match ? Number(match[1]) : 0;
}

function estimateCpuWatts(product) {
  const tdpMatch = specsBlob(product).match(/\b(\d{2,3})\s*W\b/i);
  if (tdpMatch) return Math.max(45, Number(tdpMatch[1]));
  const name = specsBlob(product).toLowerCase();
  if (/i9|ryzen 9/.test(name)) return 170;
  if (/i7|ryzen 7/.test(name)) return 125;
  return 75;
}

function estimateGpuWatts(product) {
  const blob = specsBlob(product);
  const wMatch = blob.match(/\b(\d{3})\s*W\b/i);
  if (wMatch) return Number(wMatch[1]);
  const low = blob.toLowerCase();
  if (/4090/.test(low)) return 450;
  if (/4080/.test(low)) return 320;
  if (/4070\s*ti\s*super/.test(low)) return 285;
  if (/4070\s*super|4070\s*ti/.test(low)) return 225;
  if (/4070/.test(low)) return 200;
  if (/4060\s*ti/.test(low)) return 165;
  if (/4060/.test(low)) return 115;
  if (/7900\s*xtx/.test(low)) return 355;
  if (/7900/.test(low)) return 300;
  if (/7800/.test(low)) return 263;
  if (/7700/.test(low)) return 245;
  if (/7600/.test(low)) return 165;
  return 180;
}

/**
 * Evaluate a full 8-part custom PC selection for stock, socket/RAM compatibility,
 * and PSU power headroom.
 */
function evaluateBuild(products, choices = {}, { allowOutOfStockFallback = false } = {}) {
  const selected = {};
  const issues = [];

  for (const [field, cat, , fallbackId] of BUILD_FIELDS) {
    const requestedId = String(choices?.[field] || '').trim();
    const candidates = products.filter(p => p.category === cat && p.stock > 0);
    let item = requestedId ? products.find(p => p.id === requestedId && p.category === cat) : null;
    if (!item && allowOutOfStockFallback) {
      item = candidates.find(p => p.id === fallbackId) || candidates[0] || products.find(p => p.category === cat);
    }
    if (!item || item.category !== cat || item.stock < 1) {
      issues.push('missing');
    }
    if (item) selected[field] = item;
  }

  const cpuSocket = extractSocket(selected.cpu);
  const boardSocket = extractSocket(selected.board);
  const boardDdr = extractDdr(selected.board);
  const ramDdr = extractDdr(selected.ram);
  const coolerText = specsBlob(selected.cooler).toUpperCase();

  if (cpuSocket && boardSocket && cpuSocket !== boardSocket) {
    issues.push('socket_mismatch');
  }
  if (boardDdr && ramDdr && boardDdr !== ramDdr) {
    issues.push('ram_mismatch');
  }
  if (cpuSocket && coolerText && /(AM4|AM5|LGA)/.test(coolerText) && !normalizeToken(coolerText).includes(cpuSocket)) {
    issues.push('cooler_mismatch');
  }

  const estimatedWatts =
    (selected.cpu ? estimateCpuWatts(selected.cpu) : 0) +
    (selected.gpu ? estimateGpuWatts(selected.gpu) : 0) +
    100;
  const psuWatts = extractPsuWatts(selected.psu);
  const psuOk = !psuWatts || psuWatts >= Math.round(estimatedWatts * 1.15);
  if (!psuOk) {
    issues.push('low_psu');
  }

  const hardIssues = issues.filter(code => code !== 'low_psu');
  const compatible = hardIssues.length === 0 && Object.keys(selected).length === BUILD_FIELDS.length;
  const total = BUILD_FIELDS.reduce((sum, [field]) => sum + Number(selected[field]?.price || 0), 0);

  return {
    ok: compatible,
    compatible,
    psuOk,
    issues,
    selected,
    choices: Object.fromEntries(BUILD_FIELDS.map(([field]) => [field, selected[field]?.id || ''])),
    socket: cpuSocket || boardSocket || 'AM5',
    ddr: boardDdr || ramDdr || 'DDR5',
    estimatedWatts,
    psuWatts,
    recommendedPsuWatts: Math.ceil((estimatedWatts * 1.35) / 50) * 50,
    total
  };
}

module.exports = {
  extractSocket,
  extractDdr,
  extractPsuWatts,
  estimateCpuWatts,
  estimateGpuWatts,
  evaluateBuild
};

