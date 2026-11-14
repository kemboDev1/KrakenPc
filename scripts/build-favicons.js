const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function encodePng(width, height, pixels) {
  const crcTable = encodePng.crcTable || (encodePng.crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  const crc = buffer => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc(Buffer.concat([typeBuffer, data])));
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function renderKrakenIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size;
  const scale = s / 64;

  const setPixel = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= s || y >= s || a <= 0) return;
    const idx = (y * s + x) * 4;
    const srcA = a / 255;
    const dstA = pixels[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    pixels[idx] = Math.round((r * srcA + pixels[idx] * dstA * (1 - srcA)) / outA);
    pixels[idx + 1] = Math.round((g * srcA + pixels[idx + 1] * dstA * (1 - srcA)) / outA);
    pixels[idx + 2] = Math.round((b * srcA + pixels[idx + 2] * dstA * (1 - srcA)) / outA);
    pixels[idx + 3] = Math.round(outA * 255);
  };

  // Distance to rounded rectangle
  const cornerR = s * 0.24;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const pad = scale * 2.5;
      const innerW = s - pad * 2;
      const innerH = s - pad * 2;
      const dx = Math.max(0, Math.abs(x - s / 2) - (innerW / 2 - cornerR));
      const dy = Math.max(0, Math.abs(y - s / 2) - (innerH / 2 - cornerR));
      const dist = Math.sqrt(dx * dx + dy * dy) - cornerR;

      if (dist <= 0.5) {
        const aa = Math.max(0, Math.min(1, 0.5 - dist));
        // Deep obsidian background with gradient
        const grad = (y / s) * 0.8 + (x / s) * 0.2;
        let r = Math.round(12 - grad * 7);
        let g = Math.round(20 - grad * 12);
        let b = Math.round(31 - grad * 18);

        // Radial ambient glow in center
        const cdx = (x - s / 2) / (s * 0.5);
        const cdy = (y - s * 0.45) / (s * 0.5);
        const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
        if (cdist < 1.0) {
          const glow = (1.0 - cdist) * 0.35;
          r = Math.round(r + 0 * glow);
          g = Math.round(g + 242 * glow);
          b = Math.round(b + 254 * glow);
        }

        // Glowing border
        if (dist >= -scale * 2.0) {
          const bGrad = x / s;
          const br = Math.round(0 + bGrad * 112);
          const bg = Math.round(242 - bGrad * 120);
          const bb = Math.round(254 + bGrad * 0);
          const edgeAlpha = Math.max(0, Math.min(1, (dist + scale * 2.0) / (scale * 2.0)));
          r = Math.round(r * (1 - edgeAlpha) + br * edgeAlpha);
          g = Math.round(g * (1 - edgeAlpha) + bg * edgeAlpha);
          b = Math.round(b * (1 - edgeAlpha) + bb * edgeAlpha);
        }

        setPixel(x, y, r, g, b, Math.round(aa * 255));
      }
    }
  }

  // Draw lines / curves helper
  const drawLine = (x1, y1, x2, y2, color, thickness) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      const rad = thickness / 2;
      for (let oy = -Math.ceil(rad); oy <= Math.ceil(rad); oy++) {
        for (let ox = -Math.ceil(rad); ox <= Math.ceil(rad); ox++) {
          const d = Math.hypot(ox, oy);
          if (d <= rad) {
            const alpha = Math.max(0, Math.min(1, rad - d + 0.5));
            setPixel(Math.round(px + ox), Math.round(py + oy), color[0], color[1], color[2], Math.round(alpha * 255));
          }
        }
      }
    }
  };

  const drawCircle = (cx, cy, r, color) => {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r + 0.5) {
          const alpha = Math.max(0, Math.min(1, r - d + 0.5));
          setPixel(x, y, color[0], color[1], color[2], Math.round(alpha * 255));
        }
      }
    }
  };

  const cX = s / 2;
  const cyan = [0, 242, 254];
  const neonCyan = [115, 255, 247];
  const emerald = [56, 239, 125];
  const white = [255, 255, 255];
  const thick = Math.max(1.5, scale * 3.2);

  // Central Kraken Spine & Crown
  drawLine(cX, scale * 9, cX - scale * 4.5, scale * 17.5, neonCyan, thick);
  drawLine(cX, scale * 9, cX + scale * 4.5, scale * 17.5, neonCyan, thick);
  drawLine(cX - scale * 4.5, scale * 17.5, cX - scale * 2, scale * 23, cyan, thick);
  drawLine(cX + scale * 4.5, scale * 17.5, cX + scale * 2, scale * 23, cyan, thick);
  drawLine(cX - scale * 2, scale * 23, cX + scale * 2, scale * 23, cyan, thick);

  // Central Glowing Diamond Eye
  const diamondR = scale * 5.0;
  for (let dy = -diamondR; dy <= diamondR; dy += 0.5) {
    const span = (1 - Math.abs(dy) / diamondR) * (diamondR * 0.9);
    for (let dx = -span; dx <= span; dx += 0.5) {
      const px = Math.round(cX + dx);
      const py = Math.round(scale * 31 + dy);
      setPixel(px, py, white[0], white[1], white[2], 240);
    }
  }
  // Inner diamond glow
  const innerR = scale * 3.0;
  for (let dy = -innerR; dy <= innerR; dy += 0.5) {
    const span = (1 - Math.abs(dy) / innerR) * (innerR * 0.9);
    for (let dx = -span; dx <= span; dx += 0.5) {
      const px = Math.round(cX + dx);
      const py = Math.round(scale * 31 + dy);
      setPixel(px, py, emerald[0], emerald[1], emerald[2], 255);
    }
  }

  // Left & Right Cyber Tentacle Blades (symmetric)
  const tentaclePoints = [
    [26, 18], [19, 21], [13, 27], [12, 33], [16, 31], [22, 28], [27, 32],
    [22, 36], [14, 40], [13, 46], [18, 44], [25, 40], [30, 42],
    [27, 49], [30, 52], [32, 43], [32, 37]
  ];

  for (let i = 0; i < tentaclePoints.length - 1; i++) {
    const p1 = tentaclePoints[i];
    const p2 = tentaclePoints[i + 1];
    // Left side
    drawLine(scale * p1[0], scale * p1[1], scale * p2[0], scale * p2[1], cyan, thick);
    // Right side (mirrored)
    drawLine(s - scale * p1[0], scale * p1[1], s - scale * p2[0], scale * p2[1], cyan, thick);
  }

  // Bioluminescent Power Orbs / Sensors
  const orbs = [
    [13, 27, neonCyan],
    [51, 27, neonCyan],
    [14, 41, emerald],
    [50, 41, emerald],
    [28, 51.5, neonCyan],
    [36, 51.5, neonCyan]
  ];

  for (const [ox, oy, color] of orbs) {
    drawCircle(scale * ox, scale * oy, Math.max(1, scale * 1.8), color);
    drawCircle(scale * ox, scale * oy, Math.max(0.6, scale * 0.9), white);
  }

  return encodePng(s, s, pixels);
}

// Generate all sizes
const ROOT = path.resolve(__dirname, '..');
const publicDir = path.join(ROOT, 'public');

const sizes = [
  { file: 'favicon-16.png', size: 16 },
  { file: 'favicon-32x32.png', size: 32 },
  { file: 'favicon-48.png', size: 48 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon.png', size: 192 },
  { file: 'favicon-512.png', size: 512 }
];

for (const { file, size } of sizes) {
  const buf = renderKrakenIcon(size);
  fs.writeFileSync(path.join(publicDir, file), buf);
  console.log(`Generated ${file} (${size}x${size}) - ${buf.length} bytes`);
}

// Build multi-res favicon.ico containing 16x16, 32x32, 48x48 PNGs
const png16 = fs.readFileSync(path.join(publicDir, 'favicon-16.png'));
const png32 = fs.readFileSync(path.join(publicDir, 'favicon-32x32.png'));
const png48 = fs.readFileSync(path.join(publicDir, 'favicon-48.png'));

const images = [
  { size: 16, data: png16 },
  { size: 32, data: png32 },
  { size: 48, data: png48 }
];

const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // ICO type
icoHeader.writeUInt16LE(images.length, 4); // count

let offset = 6 + images.length * 16;
const entries = [];
for (const img of images) {
  const entry = Buffer.alloc(16);
  entry[0] = img.size;
  entry[1] = img.size;
  entry[2] = 0; // color palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(img.data.length, 8); // image size
  entry.writeUInt32LE(offset, 12); // image offset
  entries.push(entry);
  offset += img.data.length;
}

const icoBuffer = Buffer.concat([icoHeader, ...entries, ...images.map(i => i.data)]);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
console.log(`Generated favicon.ico (multi-resolution 16/32/48) - ${icoBuffer.length} bytes`);
