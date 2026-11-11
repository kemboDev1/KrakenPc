const crypto = require('node:crypto');
const fsSync = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const u = m => (m && typeof m === 'object' && m.default && typeof m.default === 'object' ? m.default : m);
const { esc, localized, ROOT } = u(require('./config'));

const svgCache = new Map();

function productArtworkSvg(product) {
  const title = esc(localized(product, 'name', { lang: 'uz' }));
  const cacheKey = `${product.id}:${product.image}:${title}`;
  if (svgCache.has(cacheKey)) return svgCache.get(cacheKey);

  const accents = ['#62e5ed', '#db8dff', '#ffb66e', '#89e8b7', '#83b7ff'];
  const color = accents[parseInt(crypto.createHash('md5').update(product.id).digest('hex').slice(0, 2), 16) % accents.length];
  const fan = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#111d23" stroke="#51636a" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${r - 9}" fill="none" stroke="${color}" stroke-opacity=".7" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${r - 16}" fill="#0d161c" stroke="#32464e" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${r * .27}" fill="${color}" fill-opacity=".8"/><path d="M${cx} ${cy - 13}l7 10-7 4-7-4z M${cx + 13} ${cy}l-10 7-4-7 4-7z M${cx} ${cy + 13}l-7-10 7-4 7 4z M${cx - 13} ${cy}l10-7 4 7-4 7z" fill="#91a1a4"/>`;
  const tower = `<g filter="url(#shadow)"><path d="M411 90h188l56 29v362l-55 34H411q-12 0-12-14V103q0-13 12-13Z" fill="url(#case)" stroke="#556970" stroke-width="3"/><path d="M417 106h127v387H417q-6 0-6-8V114q0-8 6-8Z" fill="#142329" stroke="#587079" stroke-opacity=".65"/><path d="M429 119h107v358H429Z" fill="url(#glass)"/><path d="M543 109h84v349l-28 22h-56Z" fill="#1b272d" stroke="#556970" stroke-width="2"/><path d="M617 132h6v9h-6zM617 150h6v9h-6z" fill="${color}"/><path d="M565 114v25" stroke="${color}" stroke-width="2"/><path d="M447 155h64v105h-64z" fill="#1c3038" stroke="#6a7c81" stroke-width="2"/><path d="M455 164h48v86h-48z" fill="#172229"/><path d="M455 273h48v7h-48zM455 287h58v6h-58z" fill="${color}" fill-opacity=".55"/><path d="M454 327h63v8h-63zM454 343h50v6h-50z" fill="#566970" opacity=".8"/>${fan(478, 399, 39)}${fan(478, 464, 28)}<path d="m553 115 64 0m-64 8 64 0m-64 8 64 0m-64 8 64 0m-64 8 64 0" stroke="#63767d" stroke-opacity=".45" stroke-width="2"/><path d="M402 173h13m-13 21h13m-13 21h13m-13 21h13m-13 21h13m-13 21h13m-13 21h13m-13 21h13" stroke="#819095" stroke-opacity=".5" stroke-width="2"/></g>`;
  const designs = {
    tower,
    case: tower,
    graphics: `<g filter="url(#shadow)" transform="rotate(-5 400 300)"><path d="M176 212h425l33 25v143l-32 32H175q-15 0-15-15V228q0-16 16-16Z" fill="url(#case)" stroke="#819298" stroke-width="3"/><path d="M180 226h425l24 17v26H175v-29q0-14 5-14Z" fill="#2d3b42"/><path d="M176 280h441v114H175V280Z" fill="#172229" stroke="#596b71"/><path d="M196 296h401v85H196Z" fill="#223139"/><path d="M200 404h319" stroke="${color}" stroke-width="4" stroke-opacity=".7"/>${fan(292, 338, 40)}${fan(410, 338, 40)}${fan(528, 338, 40)}<path d="m616 239 26 16v124l-25 14Z" fill="#303f46"/><path d="M179 249h56" stroke="${color}" stroke-width="3"/></g>`,
    cpu: `<g filter="url(#shadow)" transform="rotate(-9 400 300)"><path d="m400 116 162 91v183l-162 93-162-93V207Z" fill="#34444a" stroke="#89979a" stroke-width="3"/><path d="m400 143 137 77v157l-137 80-137-80V220Z" fill="#131e24" stroke="${color}" stroke-width="3"/><path d="m400 191 91 51v105l-91 53-91-53V242Z" fill="url(#glass)" stroke="#7a888c" stroke-width="3"/><path d="m400 219 67 37v80l-67 40-67-40v-80Z" fill="#25383f"/><path d="m400 238 49 27v58l-49 29-49-29v-58Z" fill="${color}" fill-opacity=".56" stroke="#b3f7f5" stroke-opacity=".7" stroke-width="2"/><path d="M255 201 219 180m347 21 34-21m-345 234-36 20m347-20 34 20M400 140v-39m0 402v-31" stroke="#c2b383" stroke-width="5" stroke-linecap="round"/></g>`,
    board: `<g filter="url(#shadow)" transform="rotate(-8 400 300)"><path d="m252 134 310 0 96 101v188l-94 73H242l-44-44V189Z" fill="#172d2e" stroke="#6d8887" stroke-width="4"/><path d="M270 157h278l78 84v158l-77 70H252l-31-31V197Z" fill="#1b3837" stroke="${color}" stroke-opacity=".45" stroke-width="2"/><path d="M319 219h127v117H319z" fill="#142127" stroke="#829492" stroke-width="3"/><path d="M337 238h91v79h-91z" fill="#303f42" stroke="${color}" stroke-width="2"/><path d="M485 185v175m22-169v185m22-179v170" stroke="#899592" stroke-width="8"/><path d="M253 355h44m-44 17h44m-44 17h44m246 40h88m-88 12h88" stroke="#93b1a0" stroke-opacity=".6" stroke-width="4"/><rect x="501" y="405" width="65" height="16" rx="4" fill="#916d34"/><circle cx="281" cy="198" r="13" fill="${color}"/><path d="M462 275h19v70h-19m-202-70h41v9m-32 104h100v21" fill="none" stroke="#b29660" stroke-width="5"/></g>`,
    memory: `<g filter="url(#shadow)" transform="rotate(-8 400 300)"><path d="M198 245h399l20 20v28H180v-28Z" fill="#26373d" stroke="#879699" stroke-width="3"/><path d="M192 256h401v15H192Z" fill="#152126"/><path d="M210 219h400v26H191Z" fill="#849294"/><path d="M201 294h399l20 20v28H183v-28Z" fill="#26373d" stroke="#879699" stroke-width="3"/><path d="M195 305h401v15H195Z" fill="#152126"/><path d="M212 278h400v26H194Z" fill="#849294"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect x="${222 + i * 44}" y="226" width="33" height="14" rx="3" fill="url(#chip)"/><rect x="${222 + i * 44}" y="285" width="33" height="14" rx="3" fill="url(#chip)"/>`).join('')}<path d="M212 338h35v15h-35m393-16h-31v17h31" fill="#d2bd82"/><path d="M210 238h365" stroke="${color}" stroke-width="3"/></g>`,
    storage: `<g filter="url(#shadow)" transform="rotate(-9 400 300)"><path d="M249 240h334l26 28v87l-26 29H244l-24-26v-95Z" fill="#26373d" stroke="#869499" stroke-width="3"/><path d="M265 254h300v104H264Z" fill="#172328"/><path d="M305 270h218v74H305Z" fill="#33454c" stroke="#64777c" stroke-width="2"/><path d="M328 286h67v42h-67zM410 286h89v42h-89z" fill="#17252a" stroke="#829094"/><path d="M233 276h18v13h-18m0 52h18v13h-18m324-65 13-14m0 82-13-14" stroke="#d5be77" stroke-width="4"/><path d="M336 308h176" stroke="${color}" stroke-width="3"/></g>`,
    power: `<g filter="url(#shadow)" transform="rotate(-8 400 300)"><path d="M245 202h329l43 39v167l-47 42H248l-43-42V241Z" fill="url(#case)" stroke="#798a90" stroke-width="4"/><path d="M271 230h304v190H271Z" fill="#172229"/><circle cx="423" cy="325" r="77" fill="#223238" stroke="#6b7d83" stroke-width="3"/>${fan(423, 325, 58)}<path d="M290 251h72v18h-72zm0 31h72v11h-72m0 17h72v11h-72" fill="#75848a"/><path d="M277 398h242" stroke="${color}" stroke-width="5"/><rect x="522" y="367" width="34" height="25" rx="4" fill="${color}" fill-opacity=".8"/></g>`,
    cooling: `<g filter="url(#shadow)" transform="rotate(-5 400 300)"><rect x="228" y="190" width="350" height="222" rx="22" fill="#202e34" stroke="#829195" stroke-width="4"/><path d="M253 210h302v180H253Z" fill="#151e23"/><path d="M262 215v171m14-171v171m14-171v171m14-171v171" stroke="#6e7d82" stroke-opacity=".48" stroke-width="5"/>${fan(364, 300, 68)}${fan(501, 300, 68)}<path d="M243 406h320" stroke="${color}" stroke-width="4"/><path d="M230 251c-73 1-81 38-71 92m418-96c73 1 80 37 70 92" fill="none" stroke="#87969b" stroke-width="15" stroke-linecap="round"/><circle cx="160" cy="343" r="8" fill="${color}"/><circle cx="647" cy="343" r="8" fill="${color}"/></g>`,
    monitor: `<g filter="url(#shadow)" transform="rotate(-4 400 300)"><path d="M182 127h438q17 0 17 17v251q0 18-17 18H182q-17 0-17-18V144q0-17 17-17Z" fill="#111a20" stroke="#66777d" stroke-width="5"/><rect x="187" y="151" width="427" height="219" rx="8" fill="url(#screen)"/><path d="M200 354c55-7 68-37 121-29 48 8 67-97 122-101 53-4 80 59 158-19v161H200Z" fill="#14303a" opacity=".88"/><path d="M200 354c55-7 68-37 121-29 48 8 67-97 122-101 53-4 80 59 158-19" fill="none" stroke="${color}" stroke-width="5"/><circle cx="444" cy="224" r="13" fill="${color}"/><path d="M368 414v62m-67 11h133m-87-73h42l35 73H316Z" fill="#4a5b62" stroke="#7c8b8f" stroke-width="3"/><path d="M180 145h430" stroke="#bed5d9" stroke-opacity=".2" stroke-width="2"/></g>`,
    keyboard: `<g filter="url(#shadow)" transform="rotate(-9 400 300)"><path d="M161 201q0-18 18-18h438q18 0 18 18v215q0 18-18 18H179q-18 0-18-18Z" fill="#172127" stroke="#66777d" stroke-width="4"/><path d="M183 214h432v182H183Z" fill="#222f35"/>${Array.from({ length: 5 }, (_, row) => Array.from({ length: 13 }, (_, col) => `<rect x="${195 + col * 32}" y="${227 + row * 31}" width="25" height="21" rx="4" fill="${(row + col) % 7 === 0 ? color : '#536168'}" fill-opacity="${(row + col) % 7 === 0 ? '.78' : '.82'}" stroke="#7b888c" stroke-width="1"/>`).join('')).join('')}<rect x="298" y="389" width="167" height="17" rx="8" fill="${color}" fill-opacity=".7"/></g>`,
    mouse: `<g filter="url(#shadow)" transform="rotate(15 400 300)"><path d="M402 116c-107 0-152 78-152 184v84c0 91 49 137 146 137s154-52 154-144v-78c0-104-43-183-148-183Z" fill="url(#case)" stroke="#75868d" stroke-width="4"/><path d="M398 120v139" stroke="#63747a" stroke-width="4"/><path d="M396 139v68" stroke="${color}" stroke-width="5"/><path d="M395 273v102" stroke="#6b7b80" stroke-width="3"/><path d="M365 175q31-32 65 0v63h-65z" fill="#24343b" stroke="#75868d" stroke-width="3"/><rect x="388" y="191" width="18" height="38" rx="9" fill="${color}"/><path d="M304 324c4 86 41 145 97 146 54-1 92-57 97-145-50 32-145 37-194-1Z" fill="#1b292f"/><path d="M319 436c30 30 105 34 157-1" fill="none" stroke="${color}" stroke-width="4" stroke-opacity=".7"/></g>`,
    headset: `<g filter="url(#shadow)"><path d="M226 340v-50c0-105 74-182 175-182s175 77 175 182v50" fill="none" stroke="#7c8c90" stroke-width="35"/><path d="M225 330v-42c0-94 77-165 176-165s176 71 176 165v42" fill="none" stroke="${color}" stroke-opacity=".68" stroke-width="6"/><rect x="183" y="287" width="94" height="152" rx="31" fill="#25353b" stroke="#829094" stroke-width="4"/><rect x="525" y="287" width="94" height="152" rx="31" fill="#25353b" stroke="#829094" stroke-width="4"/><rect x="197" y="305" width="69" height="116" rx="24" fill="#10191f" stroke="${color}" stroke-width="3"/><rect x="536" y="305" width="69" height="116" rx="24" fill="#10191f" stroke="${color}" stroke-width="3"/><path d="M574 431q-11 59-97 55" fill="none" stroke="#a3b0b2" stroke-width="7" stroke-linecap="round"/><circle cx="477" cy="486" r="9" fill="${color}"/></g>`
  };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" role="img" aria-labelledby="t d"><title id="t">${title}</title><desc id="d">Original KrakenPC hardware illustration</desc><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b161c"/><stop offset=".53" stop-color="#15242a"/><stop offset="1" stop-color="#101a20"/></linearGradient><linearGradient id="case" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#34444b"/><stop offset=".48" stop-color="#25343b"/><stop offset="1" stop-color="#151f25"/></linearGradient><linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#182f38"/><stop offset=".55" stop-color="#111d23"/><stop offset="1" stop-color="#24323a"/></linearGradient><linearGradient id="screen" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#163849"/><stop offset="1" stop-color="#12222d"/></linearGradient><linearGradient id="chip" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b0bbc0"/><stop offset="1" stop-color="#6f7e83"/></linearGradient><radialGradient id="glow"><stop stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient><filter id="shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="22" stdDeviation="20" flood-color="#000" flood-opacity=".5"/></filter><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0v32" fill="none" stroke="#b9dee1" stroke-opacity=".045" stroke-width="1"/></pattern></defs><rect width="800" height="600" rx="32" fill="url(#bg)"/><rect x="1" y="1" width="798" height="598" rx="31" fill="url(#grid)" stroke="#91adb1" stroke-opacity=".17" stroke-width="2"/><circle cx="555" cy="295" r="260" fill="url(#glow)"/><path d="M43 481h240M43 490h98M642 96h103M691 108h54" stroke="#92a9ac" stroke-opacity=".25"/><path d="M50 73v63m-8-55h16" stroke="${color}" stroke-opacity=".55"/><text x="69" y="93" fill="#c9d6d8" font-family="Bahnschrift,Segoe UI,sans-serif" font-size="14" letter-spacing="3">KRAKENPC · ORIGINAL HARDWARE ART</text><text x="55" y="534" fill="${color}" fill-opacity=".8" font-family="Bahnschrift,Segoe UI,sans-serif" font-size="11" letter-spacing="2">ENGINEERED FOR PERFORMANCE</text>${designs[product.image] || tower}<path d="M704 516v23m-11-11h22" stroke="${color}" stroke-opacity=".5" stroke-width="2"/></svg>`;
  svgCache.set(cacheKey, svg);
  return svg;
}

function pngBuffer(product) {
  const width = 640; const height = 420; const pixels = Buffer.alloc(width * height * 4);
  const colors = { tower: [59, 211, 222], graphics: [116, 170, 255], cpu: [234, 183, 92], board: [114, 217, 166], memory: [211, 157, 255], storage: [124, 214, 206], power: [234, 192, 99], cooling: [96, 196, 226], monitor: [135, 192, 255], keyboard: [223, 161, 255], mouse: [255, 151, 109], headset: [107, 223, 184], case: [59, 211, 222] };
  const accent = colors[product.image] || colors.tower;
  const set = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const o = (y * width + x) * 4; pixels[o] = c[0]; pixels[o + 1] = c[1]; pixels[o + 2] = c[2]; pixels[o + 3] = a; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const k = y / height; set(x, y, [Math.round(10 + k * 7), Math.round(21 + k * 12), Math.round(27 + k * 14)]); }
  const rect = (x, y, w, h, c) => { for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) set(xx, yy, c); };
  const outline = (x, y, w, h, c, thick = 3) => { rect(x, y, w, thick, c); rect(x, y + h - thick, w, thick, c); rect(x, y, thick, h, c); rect(x + w - thick, y, thick, h, c); };
  const circle = (cx, cy, r, c, fill = true, thick = 6) => { for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) { const d = (x - cx) ** 2 + (y - cy) ** 2; if (fill ? d <= r * r : d <= r * r && d >= (r - thick) ** 2) set(x, y, c); } };
  const line = (x1, y1, x2, y2, c, thick = 4) => { const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); for (let i = 0; i <= n; i++) { const x = Math.round(x1 + (x2 - x1) * i / n); const y = Math.round(y1 + (y2 - y1) * i / n); rect(x - thick / 2, y - thick / 2, thick, thick, c); } };
  for (let x = 38; x < width; x += 32) line(x, 38, x, height - 38, [44, 66, 74], 1);
  for (let y = 38; y < height; y += 32) line(38, y, width - 38, y, [44, 66, 74], 1);
  const metal = [41, 57, 64]; const shadow = [20, 32, 38]; const edge = [110, 132, 139]; const glow = accent;
  const drawFan = (cx, cy, r) => { circle(cx, cy, r, shadow, true); circle(cx, cy, r - 5, edge, false, 2); circle(cx, cy, r - 12, glow, false, 3); circle(cx, cy, r - 20, metal, false, 5); circle(cx, cy, 8, glow, true); };
  switch (product.image) {
    case 'tower': case 'case': rect(352, 72, 194, 294, shadow); outline(352, 72, 194, 294, edge, 4); rect(364, 84, 121, 270, [19, 42, 51]); outline(364, 84, 121, 270, [76, 104, 113], 2); rect(491, 83, 43, 272, metal); rect(379, 112, 92, 68, [31, 60, 68]); rect(386, 122, 77, 48, [15, 28, 34]); rect(382, 202, 86, 11, glow); drawFan(418, 269, 34); drawFan(418, 329, 24); for (let i = 0; i < 7; i++) rect(499, 104 + i * 20, 25, 2, edge); rect(316, 370, 257, 9, [9, 16, 20]); line(359, 397, 535, 397, glow, 2); break;
    case 'graphics': rect(124, 142, 397, 142, shadow); outline(124, 142, 397, 142, edge, 4); rect(138, 159, 368, 106, metal); drawFan(228, 212, 31); drawFan(324, 212, 31); drawFan(420, 212, 31); rect(524, 168, 42, 90, [46, 61, 68]); rect(100, 177, 26, 74, [179, 158, 104]); line(150, 288, 496, 288, glow, 4); break;
    case 'cpu': rect(223, 66, 194, 194, metal); outline(223, 66, 194, 194, edge, 5); rect(248, 91, 144, 144, shadow); outline(248, 91, 144, 144, glow, 3); rect(276, 119, 88, 88, [44, 65, 73]); outline(276, 119, 88, 88, [162, 188, 190], 3); rect(297, 140, 47, 47, glow); for (let i = 0; i < 6; i++) { rect(229 + i * 30, 49, 7, 17, [208, 184, 122]); rect(229 + i * 30, 260, 7, 17, [208, 184, 122]); } break;
    case 'board': rect(173, 54, 283, 301, [25, 56, 49]); outline(173, 54, 283, 301, edge, 4); rect(211, 113, 100, 100, metal); outline(211, 113, 100, 100, glow, 3); rect(229, 131, 64, 64, shadow); for (let i = 0; i < 3; i++) { rect(332 + i * 22, 84, 11, 172, edge); rect(331 + i * 22, 104, 13, 120, shadow); } for (let i = 0; i < 6; i++) rect(213, 251 + i * 11, 74, 4, [168, 189, 146]); circle(391, 292, 14, glow); break;
    case 'memory': for (let j = 0; j < 2; j++) { const yy = 125 + j * 100; rect(115, yy, 399, 61, metal); outline(115, yy, 399, 61, edge, 3); rect(132, yy + 9, 360, 37, shadow); for (let i = 0; i < 8; i++) { rect(147 + i * 43, yy + 16, 31, 22, [88, 105, 108]); } line(133, yy + 51, 485, yy + 51, glow, 3); } break;
    case 'storage': rect(194, 141, 266, 114, metal); outline(194, 141, 266, 114, edge, 4); rect(219, 165, 215, 67, shadow); rect(239, 180, 57, 36, glow); rect(309, 180, 102, 36, edge); circle(206, 154, 5, [202, 184, 127]); break;
    case 'power': rect(181, 92, 287, 223, shadow); outline(181, 92, 287, 223, edge, 4); drawFan(340, 204, 70); rect(204, 128, 72, 10, edge); rect(204, 149, 72, 7, edge); line(208, 290, 426, 290, glow, 5); break;
    case 'cooling': rect(147, 121, 349, 178, shadow); outline(147, 121, 349, 178, edge, 4); drawFan(245, 210, 61); drawFan(395, 210, 61); for (let i = 0; i < 7; i++) line(163 + i * 13, 131, 163 + i * 13, 289, edge, 3); break;
    case 'monitor': rect(117, 72, 410, 253, [17, 26, 32]); outline(117, 72, 410, 253, edge, 5); rect(134, 90, 377, 215, [19, 47, 60]); for (let i = 0; i < 35; i++) { const x = 139 + i * 10; const y = 251 - Math.sin(i / 4) * 60 - (i > 16 ? (i - 16) * 2 : 0); rect(x, y, 8, 50, glow); } rect(305, 326, 41, 62, edge); rect(258, 384, 136, 9, metal); break;
    case 'keyboard': rect(106, 106, 430, 191, shadow); outline(106, 106, 430, 191, edge, 4); for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) { rect(123 + c * 33, 123 + r * 37, 24, 23, (r + c) % 8 === 0 ? glow : [94, 110, 116]); } rect(231, 276, 175, 11, glow); break;
    case 'mouse': circle(322, 208, 92, [35, 50, 58]); circle(322, 208, 88, shadow, false, 7); line(321, 128, 321, 196, glow, 4); rect(306, 146, 29, 47, metal); rect(314, 151, 13, 29, glow); break;
    case 'headset': circle(322, 202, 126, [39, 53, 61], false, 22); rect(168, 175, 83, 133, shadow); outline(168, 175, 83, 133, edge, 4); rect(392, 175, 83, 133, shadow); outline(392, 175, 83, 133, edge, 4); rect(180, 191, 58, 102, glow); rect(405, 191, 58, 102, glow); line(428, 307, 390, 361, edge, 7); circle(386, 365, 7, glow); break;
    default: rect(189, 81, 246, 230, shadow); outline(189, 81, 246, 230, edge, 4); drawFan(310, 192, 70);
  }
  return encodePng(width, height, pixels);
}

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
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let cachedFaviconPng = null;
let cachedFaviconIco = null;

function readPublicAsset(name) {
  try {
    return fsSync.readFileSync(path.join(ROOT, 'public', name));
  } catch {
    return null;
  }
}

function faviconPngBuffer() {
  if (cachedFaviconPng) return cachedFaviconPng;
  const fromDisk = readPublicAsset('favicon.png');
  if (fromDisk && fromDisk.length > 0) {
    cachedFaviconPng = fromDisk;
    return cachedFaviconPng;
  }
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  const paint = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const o = (y * size + x) * 4;
    pixels[o] = c[0]; pixels[o + 1] = c[1]; pixels[o + 2] = c[2]; pixels[o + 3] = 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const border = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      paint(x, y, border ? [72, 211, 223] : [16, 25, 31]);
    }
  }
  for (let i = 0; i < 12; i++) {
    paint(18 - Math.floor(i * 0.65), 6 + i, [72, 211, 223]);
    paint(19 - Math.floor(i * 0.65), 6 + i, [72, 211, 223]);
    paint(14 + Math.floor(i * 0.5), 14 + i, [72, 211, 223]);
    paint(15 + Math.floor(i * 0.5), 14 + i, [72, 211, 223]);
  }
  for (let x = 11; x <= 20; x++) paint(x, 16, [72, 211, 223]);
  cachedFaviconPng = encodePng(size, size, pixels);
  return cachedFaviconPng;
}

function faviconIcoBuffer() {
  if (cachedFaviconIco) return cachedFaviconIco;
  const fromDisk = readPublicAsset('favicon.ico');
  if (fromDisk && fromDisk.length > 0) {
    cachedFaviconIco = fromDisk;
    return cachedFaviconIco;
  }
  const png = faviconPngBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32;
  header[7] = 32;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  cachedFaviconIco = Buffer.concat([header, png]);
  return cachedFaviconIco;
}

module.exports = { productArtworkSvg, pngBuffer, faviconPngBuffer, faviconIcoBuffer };

