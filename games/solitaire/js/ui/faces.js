// Card art, drawn as SVG and turned into blob URLs once per look.
// Original designs: corner index with rank and suit side by side (so a
// tightly stacked column still shows both), classic pip layouts, and simple
// double-ended court figures.
import { RANK_LABEL } from '../core/cards.js';

const W = 250, H = 350;
const FONT = "'Times New Roman', Times, 'Liberation Serif', serif";

const SUIT = [
  // spade
  'M50 3C62 22 96 39 96 62C96 78 84 87 72 87C63 87 56 82 53 76C54 87 58 92 67 97L33 97C42 92 46 87 47 76C44 82 37 87 28 87C16 87 4 78 4 62C4 39 38 22 50 3Z',
  // heart
  'M50 93C21 71 3 53 3 31C3 15 15 5 29 5C39 5 46 11 50 19C54 11 61 5 71 5C85 5 97 15 97 31C97 53 79 71 50 93Z',
  // diamond
  'M50 2C61 21 75 37 93 50C75 63 61 79 50 98C39 79 25 63 7 50C25 37 39 21 50 2Z',
  // club: three lobes, a hub and a flared stem
  'M29 27a21 21 0 1 0 42 0a21 21 0 1 0 -42 0ZM6 61a21 21 0 1 0 42 0a21 21 0 1 0 -42 0ZM52 61a21 21 0 1 0 42 0a21 21 0 1 0 -42 0ZM37 55a13 13 0 1 0 26 0a13 13 0 1 0 -26 0ZM46 60C46 79 41 89 31 97L69 97C59 89 54 79 54 60Z',
];

const INK = {
  std: ['#17171c', '#c4161c', '#c4161c', '#17171c'],
  four: ['#17171c', '#c4161c', '#1356b8', '#17803a'],
};
const ROBE = ['#24457e', '#b3202a', '#b8541f', '#2c6b3c'];

const esc = (s) => s.replace(/&/g, '&amp;');

function pip(s, cx, cy, size, color, flip = false) {
  const k = size / 100;
  const rot = flip ? ` rotate(180 50 50)` : '';
  return `<path transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${k})${rot}" d="${SUIT[s]}" fill="${color}"/>`;
}

const RANK_W = { A: 0.74, J: 0.42, Q: 0.78, K: 0.78, 10: 0.96 };

function index(card, color, large) {
  const label = RANK_LABEL[card.r];
  const fs = large ? 92 : 66;
  const x = 14;
  const w = (RANK_W[label] ?? 0.5) * fs;
  const ls = label === '10' ? -fs * 0.08 : 0;
  const ps = large ? 60 : 44;
  const baseline = fs * 0.72 + 12;
  const px = x + w + (label === '10' ? -2 : 4) + ps / 2;
  return (
    `<text x="${x}" y="${baseline}" font-family="${esc(FONT)}" font-weight="700" font-size="${fs}" letter-spacing="${ls}" fill="${color}">${label}</text>` +
    pip(card.s, px, baseline - fs * 0.35, ps, color)
  );
}

const PIPS = {
  // [x, y, flipped] in a 250x350 card; x: L 80, C 125, R 170
  2: [[125, 100], [125, 250, 1]],
  3: [[125, 100], [125, 175], [125, 250, 1]],
  4: [[80, 100], [170, 100], [80, 250, 1], [170, 250, 1]],
  5: [[80, 100], [170, 100], [125, 175], [80, 250, 1], [170, 250, 1]],
  6: [[80, 100], [170, 100], [80, 175], [170, 175], [80, 250, 1], [170, 250, 1]],
  7: [[80, 100], [170, 100], [125, 138], [80, 175], [170, 175], [80, 250, 1], [170, 250, 1]],
  8: [[80, 100], [170, 100], [125, 138], [80, 175], [170, 175], [125, 212, 1], [80, 250, 1], [170, 250, 1]],
  9: [[80, 100], [170, 100], [80, 150], [170, 150], [125, 175], [80, 200, 1], [170, 200, 1], [80, 250, 1], [170, 250, 1]],
  10: [[80, 100], [170, 100], [125, 125], [80, 150], [170, 150], [80, 200, 1], [170, 200, 1], [125, 225, 1], [80, 250, 1], [170, 250, 1]],
};

/** Top half of a court card, in a 158 x 105 box. The bottom half is the same, turned around. */
function courtHalf(r, s, ink) {
  const robe = ROBE[s];
  const skin = '#f4d2b2', line = '#6e4b33', gold = '#d6a21e';
  let back = '', hat = '', extra = '';
  if (r === 13) {
    extra = `<path d="M62 47C63 63 71 69 79 69C87 69 95 63 96 47C90 56 68 56 62 47Z" fill="#8a5a2e"/><path d="M71 53Q79 49 87 53Q79 57 71 53Z" fill="#6d4423"/>`;
    hat = `<path d="M59 31L61 9L70 20L79 5L88 20L97 9L99 31Z" fill="${gold}" stroke="#9c7212" stroke-width="1.5"/><circle cx="79" cy="22" r="3.6" fill="#c4161c"/><circle cx="66" cy="26" r="2.6" fill="#1356b8"/><circle cx="92" cy="26" r="2.6" fill="#1356b8"/>`;
    extra += `<path d="M120 105L126 40" stroke="${gold}" stroke-width="5" stroke-linecap="round"/><circle cx="126" cy="38" r="7" fill="${gold}"/>`;
  } else if (r === 12) {
    back = `<ellipse cx="79" cy="50" rx="24" ry="28" fill="#7a4520"/>`;
    hat = `<path d="M63 30Q79 15 95 30L91 33Q79 24 67 33Z" fill="${gold}" stroke="#9c7212" stroke-width="1.2"/><circle cx="79" cy="21" r="3.6" fill="#c4161c"/>`;
    extra = `<g transform="translate(34 80)"><circle r="8" fill="#d23a4c"/><circle r="4" fill="#f07a88"/><path d="M0 8L4 25" stroke="#2c6b3c" stroke-width="3"/></g>`;
  } else {
    back = `<path d="M62 44C61 30 70 25 79 25C88 25 97 30 96 44Z" fill="#a0632b"/>`;
    hat = `<path d="M58 33C59 17 99 15 101 33Z" fill="${robe}" stroke="${gold}" stroke-width="2"/><path d="M97 27C110 13 123 8 134 3C126 14 113 23 99 31Z" fill="${gold}"/>`;
    extra = `<path d="M30 105L36 58" stroke="#8a8f98" stroke-width="4" stroke-linecap="round"/><path d="M28 62L44 62" stroke="${gold}" stroke-width="4" stroke-linecap="round"/>`;
  }
  return (
    back +
    `<path d="M12 105C16 81 40 70 79 68C118 70 142 81 146 105Z" fill="${robe}"/>` +
    `<path d="M60 70L79 95L98 70" fill="none" stroke="${gold}" stroke-width="5"/>` +
    (r === 13 ? `<path d="M30 92C50 84 108 84 128 92" fill="none" stroke="#fff" stroke-width="7"/><path d="M40 89h0M56 87h0M72 86h0M88 86h0M104 87h0M120 89h0" stroke="#222" stroke-width="3.5" stroke-linecap="round"/>` : '') +
    `<rect x="73" y="55" width="12" height="15" fill="${skin}"/>` +
    `<circle cx="79" cy="45" r="17" fill="${skin}" stroke="${line}" stroke-width="1.4"/>` +
    `<circle cx="73" cy="44" r="1.9" fill="#3a2a20"/><circle cx="85" cy="44" r="1.9" fill="#3a2a20"/>` +
    `<path d="M73.5 51.5Q79 55.5 84.5 51.5" fill="none" stroke="#a5523e" stroke-width="1.8" stroke-linecap="round"/>` +
    `<circle cx="70" cy="50" r="2.6" fill="#f2a7a0" opacity=".55"/><circle cx="88" cy="50" r="2.6" fill="#f2a7a0" opacity=".55"/>` +
    extra +
    hat +
    pip(s, 18, 16, 24, ink)
  );
}

function court(card, ink) {
  const fx = 46, fy = 72, fw = 158, fh = 210;
  const half = courtHalf(card.r, card.s, ink);
  return (
    `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="6" fill="#fbf3e1" stroke="#d6a21e" stroke-width="3"/>` +
    `<clipPath id="cl"><rect x="${fx}" y="${fy}" width="${fw}" height="${fh / 2}"/></clipPath>` +
    `<g clip-path="url(#cl)"><g transform="translate(${fx} ${fy})">${half}</g></g>` +
    `<g transform="rotate(180 125 177)"><g clip-path="url(#cl)"><g transform="translate(${fx} ${fy})">${half}</g></g></g>` +
    `<path d="M${fx + 4} 177H${fx + fw - 4}" stroke="${ink}" stroke-width="1.5" opacity=".6"/>` +
    `<rect x="${fx + 5}" y="${fy + 5}" width="${fw - 10}" height="${fh - 10}" rx="4" fill="none" stroke="${ink}" stroke-width="1.2" opacity=".5"/>`
  );
}

export function faceSVG(card, { fourColor = false, large = false } = {}) {
  const ink = (fourColor ? INK.four : INK.std)[card.s];
  let body = '';
  if (large) {
    body = pip(card.s, 125, 212, 140, ink);
    if (card.r >= 11) {
      const lbl = RANK_LABEL[card.r];
      body += `<text x="125" y="236" text-anchor="middle" font-family="${esc(FONT)}" font-weight="700" font-size="74" fill="#fff">${lbl}</text>`;
    }
  } else if (card.r === 1) {
    body = card.s === 0
      ? `<circle cx="125" cy="175" r="74" fill="none" stroke="${ink}" stroke-width="2" opacity=".35"/><circle cx="125" cy="175" r="66" fill="none" stroke="${ink}" stroke-width="1" opacity=".3"/>` + pip(0, 125, 175, 112, ink)
      : pip(card.s, 125, 175, 104, ink);
  } else if (card.r <= 10) {
    for (const [x, y, f] of PIPS[card.r]) body += pip(card.s, x, y, 46, ink, !!f);
  } else {
    body = court(card, ink);
  }
  const idx = index(card, ink, large);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect x="1.5" y="1.5" width="247" height="347" rx="17" fill="#fffdf8" stroke="#cfc9bc" stroke-width="3"/>` +
    body +
    idx +
    `<g transform="rotate(180 125 175)">${idx}</g>` +
    `</svg>`
  );
}

// ---------- backs ----------

function seeded(n) {
  let a = n;
  return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

export const BACKS = {
  lattice: { name: 'Royal blue', color: '#1d4f91' },
  diamonds: { name: 'Crimson', color: '#a3151b' },
  waves: { name: 'Emerald', color: '#17654a' },
  stars: { name: 'Starry night', color: '#1a2150' },
  floral: { name: 'Plum garden', color: '#5c2c6f' },
  sunset: { name: 'Sunset', color: '#e0603a' },
};

export function backSVG(design) {
  const c = BACKS[design]?.color || '#1d4f91';
  let defs = '', fill = c, over = '';
  if (design === 'lattice') {
    defs = `<pattern id="p" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="${c}"/><path d="M0 0L22 22M22 0L0 22" stroke="#fff" stroke-opacity=".32" stroke-width="2"/><circle cx="11" cy="11" r="2.4" fill="#fff" fill-opacity=".55"/></pattern>`;
    fill = 'url(#p)';
    over = `<ellipse cx="125" cy="175" rx="54" ry="70" fill="${c}" stroke="#fff" stroke-opacity=".8" stroke-width="3"/><ellipse cx="125" cy="175" rx="44" ry="60" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>` +
      pip(0, 125, 150, 30, '#fff') + pip(1, 100, 178, 26, '#fff') + pip(2, 150, 178, 26, '#fff') + pip(3, 125, 205, 30, '#fff');
  } else if (design === 'diamonds') {
    defs = `<pattern id="p" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="${c}"/><path d="M13 1L25 13L13 25L1 13Z" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/><path d="M13 8L18 13L13 18L8 13Z" fill="#ffd9a0" fill-opacity=".55"/></pattern>`;
    fill = 'url(#p)';
  } else if (design === 'waves') {
    defs = `<pattern id="p" width="40" height="18" patternUnits="userSpaceOnUse"><rect width="40" height="18" fill="${c}"/><path d="M0 9C10 1 10 1 20 9C30 17 30 17 40 9" fill="none" stroke="#bff0d8" stroke-opacity=".5" stroke-width="2.2"/><path d="M0 16C10 8 10 8 20 16C30 24 30 24 40 16" fill="none" stroke="#bff0d8" stroke-opacity=".22" stroke-width="1.5"/></pattern>`;
    fill = 'url(#p)';
    over = `<circle cx="125" cy="175" r="40" fill="${c}" stroke="#bff0d8" stroke-opacity=".8" stroke-width="3"/>` + pip(3, 125, 175, 44, '#d9fbe9');
  } else if (design === 'stars') {
    const rnd = seeded(7);
    let st = '';
    for (let i = 0; i < 70; i++) {
      const x = 16 + rnd() * 218, y = 16 + rnd() * 318, r = 0.6 + rnd() * 1.8;
      st += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#fff6c8" opacity="${(0.4 + rnd() * 0.6).toFixed(2)}"/>`;
    }
    const star = (x, y, R) => {
      let d = '';
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? R * 0.45 : R;
        d += (k ? 'L' : 'M') + (x + rr * Math.cos(a)).toFixed(1) + ' ' + (y + rr * Math.sin(a)).toFixed(1);
      }
      return `<path d="${d}Z" fill="#f4c542"/>`;
    };
    defs = `<radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#2f3a86"/><stop offset="1" stop-color="${c}"/></radialGradient>`;
    fill = 'url(#g)';
    over = st + `<circle cx="125" cy="165" r="38" fill="#f6e7a8"/><circle cx="141" cy="155" r="34" fill="#28327a"/>` + star(80, 250, 13) + star(170, 95, 10) + star(160, 265, 8);
  } else if (design === 'floral') {
    defs = `<pattern id="p" width="38" height="38" patternUnits="userSpaceOnUse"><rect width="38" height="38" fill="${c}"/>` +
      [0, 72, 144, 216, 288].map((a) => `<ellipse cx="19" cy="11" rx="5" ry="8" fill="#f3c6e8" fill-opacity=".45" transform="rotate(${a} 19 19)"/>`).join('') +
      `<circle cx="19" cy="19" r="4" fill="#ffd56b" fill-opacity=".8"/><circle cx="0" cy="0" r="3" fill="#f3c6e8" fill-opacity=".35"/><circle cx="38" cy="0" r="3" fill="#f3c6e8" fill-opacity=".35"/><circle cx="0" cy="38" r="3" fill="#f3c6e8" fill-opacity=".35"/><circle cx="38" cy="38" r="3" fill="#f3c6e8" fill-opacity=".35"/></pattern>`;
    fill = 'url(#p)';
  } else if (design === 'sunset') {
    defs = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset=".55" stop-color="#e8573c"/><stop offset="1" stop-color="#8e2a6b"/></linearGradient>`;
    fill = 'url(#g)';
    let rays = '';
    for (let k = 0; k < 18; k++) rays += `<path d="M125 205L${125 + 300 * Math.cos((k * Math.PI) / 9)} ${205 + 300 * Math.sin((k * Math.PI) / 9)}L${125 + 300 * Math.cos((k * Math.PI) / 9 + 0.09)} ${205 + 300 * Math.sin((k * Math.PI) / 9 + 0.09)}Z" fill="#fff" opacity=".12"/>`;
    over = rays + `<circle cx="125" cy="205" r="42" fill="#ffe08a" opacity=".95"/><path d="M12 262C60 246 90 270 125 258C160 246 196 268 238 252L238 338L12 338Z" fill="#5d1f4f" opacity=".75"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs}<clipPath id="in"><rect x="13" y="13" width="224" height="324" rx="10"/></clipPath></defs>` +
    `<rect x="1.5" y="1.5" width="247" height="347" rx="17" fill="#fbfaf6" stroke="#cfc9bc" stroke-width="3"/>` +
    `<g clip-path="url(#in)"><rect x="13" y="13" width="224" height="324" fill="${fill}"/>${over}</g>` +
    `<rect x="13" y="13" width="224" height="324" rx="10" fill="none" stroke="${c}" stroke-width="2"/>` +
    `<rect x="19" y="19" width="212" height="312" rx="7" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.5"/>` +
    `</svg>`
  );
}

// ---------- cache of blob URLs ----------

const toURL = (svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

export class Faces {
  constructor() {
    this.urls = new Map();
    this.back = null;
    this.opts = null;
  }
  /** Rebuild when the look changes. Returns true if anything changed. */
  configure({ fourColor, large, back }) {
    const k = `${fourColor}|${large}`;
    let changed = false;
    if (k !== this.opts) {
      for (const u of this.urls.values()) URL.revokeObjectURL(u);
      this.urls.clear();
      this.opts = k;
      this.fourColor = fourColor;
      this.large = large;
      changed = true;
    }
    if (back !== this.backName) {
      if (this.back) URL.revokeObjectURL(this.back);
      this.back = toURL(backSVG(back));
      this.backName = back;
      changed = true;
    }
    return changed;
  }
  face(card) {
    const k = card.s * 16 + card.r;
    let u = this.urls.get(k);
    if (!u) {
      u = toURL(faceSVG(card, { fourColor: this.fourColor, large: this.large }));
      this.urls.set(k, u);
    }
    return u;
  }
}
