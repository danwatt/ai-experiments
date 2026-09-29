'use strict';
/* Shared helpers used by both the desktop and mobile mockups. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------ Icons ------------------------------ */
const ICONS = {
  song:      '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  prayer:    '<path d="M12 21s-7-4.6-9.3-9.2C1.2 8.6 3 5 6.3 5c2 0 3.3 1 4.2 2.4h3C14.4 6 15.7 5 17.7 5 21 5 22.800 8.600 21.300 11.800 19 16.400 12 21 12 21z" transform="translate(0 -1)"/>',
  scripture: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  supper:    '<path d="M8 22h8"/><path d="M12 15v7"/><path d="M5 3h14l-1 7a6 6 0 0 1-12 0z"/>',
  give:      '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v9H5v-9"/><path d="M7.500 8a2.500 2.500 0 0 1 0-5C11 3 12 8 12 8s1-5 4.500-5a2.500 2.500 0 0 1 0 5"/>',
  sermon:    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 8h8M8 12h5"/>',
  welcome:   '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.600 16.800a3 3 0 1 1-5.800-1.600"/>',
  custom:    '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  search:    '<circle cx="11" cy="11" r="7.500"/><path d="m21 21-4.300-4.300"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  x:         '<path d="M18 6 6 18M6 6l12 12"/>',
  grip:      '<circle cx="9" cy="6" r="1.200"/><circle cx="15" cy="6" r="1.200"/><circle cx="9" cy="12" r="1.200"/><circle cx="15" cy="12" r="1.200"/><circle cx="9" cy="18" r="1.200"/><circle cx="15" cy="18" r="1.200"/>',
  more:      '<circle cx="5" cy="12" r="1.400"/><circle cx="12" cy="12" r="1.400"/><circle cx="19" cy="12" r="1.400"/>',
  play:      '<path d="M7 4.500v15l13-7.500z"/>',
  present:   '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>',
  download:  '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  share:     '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.600 13.500 6.800 4M15.400 6.500l-6.800 4"/>',
  chevL:     '<path d="m15 18-6-6 6-6"/>',
  chevR:     '<path d="m9 18 6-6-6-6"/>',
  chevD:     '<path d="m6 9 6 6 6-6"/>',
  check:     '<path d="M20 6 9 17l-5-5"/>',
  alert:     '<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18v.01"/>',
  calendar:  '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  library:   '<path d="M4 4v16M9 4v16"/><path d="m14 5 5-1 2 15-5 1z"/>',
  users:     '<circle cx="9" cy="8" r="3.500"/><path d="M2 20c0-3.500 3-6 7-6s7 2.500 7 6"/><path d="M16 4.500a3.500 3.500 0 0 1 0 7M18 14c2.500.7 4 2.700 4 6"/>',
  sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400"/>',
  moon:      '<path d="M21 12.800A9 9 0 1 1 11.200 3a7 7 0 0 0 9.800 9.800z"/>',
  cloud:     '<path d="M17.500 19a4.500 4.500 0 0 0 0-9 6 6 0 0 0-11.500 1.500A4 4 0 0 0 6.500 19z"/>',
  lock:      '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  grid:      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list:      '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.500" cy="6" r="1"/><circle cx="3.500" cy="12" r="1"/><circle cx="3.500" cy="18" r="1"/>',
  volume:    '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.500 8.500a5 5 0 0 1 0 7M18.500 5.500a9 9 0 0 1 0 13"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy:      '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash:     '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  up:        '<path d="m18 15-6-6-6 6"/>',
  down:      '<path d="m6 9 6 6 6-6"/>',
  swap:      '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  home:      '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  radio:     '<circle cx="12" cy="12" r="2"/><path d="M7.800 7.800a6 6 0 0 0 0 8.400M16.200 7.800a6 6 0 0 1 0 8.400M4.900 4.900a10 10 0 0 0 0 14.200M19.100 4.900a10 10 0 0 1 0 14.200"/>',
  person:    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.500-6 8-6s8 2 8 6"/>',
  file:      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  sliders:   '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  sparkle:   '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.500 2.500M15.500 15.500 18 18M18 6l-2.500 2.500M8.500 15.500 6 18"/>'
};
const icon = (n, size = 16, cls = '') =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ------------------------------ Dates ------------------------------ */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtLong = s => { const d = parseDate(s); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const agoText = d => {
  if (d == null) return 'Never';
  if (d < 1) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} wks ago`;
  if (d < 730) return `${Math.round(d / 30)} mo ago`;
  return `${Math.round(d / 365)} yr ago`;
};
const freshness = h => (h.last == null ? 'fresh' : h.last < 21 ? 'recent' : h.last < 56 ? 'warm' : 'fresh');

/* --------------------------- Pitch / key math --------------------------- */
const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = 'CDEFGAB';
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SOLFEGE = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'];
const SIG = { 'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F♯': 6, 'C♯': 7, 'F': -1, 'B♭': -2, 'E♭': -3, 'A♭': -4, 'D♭': -5, 'G♭': -6 };
const keySemi = k => (NAT[k[0]] + (k[1] === '♯' ? 1 : k[1] === '♭' ? -1 : 0) + 12) % 12;
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES  = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

function startPitch(h, shift = 0) {
  const deg = h.start || 1;
  const letter = LETTERS[(LETTERS.indexOf(h.key[0]) + deg - 1) % 7];
  const semi = (keySemi(h.key) + MAJOR[deg - 1]) % 12;
  let acc = ((semi - NAT[letter] + 18) % 12) - 6;
  let name = letter + (acc === 1 ? '♯' : acc === -1 ? '♭' : '');
  let s = semi;
  if (shift) {
    s = (semi + shift + 120) % 12;
    name = (h.key.includes('♭') || h.key === 'F' ? FLAT_NAMES : SHARP_NAMES)[s];
  }
  const midi = 60 + (s > 7 ? s - 12 : s);
  return { name, solfege: SOLFEGE[deg - 1], deg, freq: 440 * Math.pow(2, (midi - 69) / 12), keyShifted: shift ? shiftedKey(h.key, shift) : h.key };
}
function shiftedKey(key, shift) {
  const s = (keySemi(key) + shift + 120) % 12;
  return (key.includes('♭') || key === 'F' ? FLAT_NAMES : SHARP_NAMES)[s];
}
function keyGap(a, b) { const d = Math.abs(keySemi(a) - keySemi(b)); return Math.min(d, 12 - d); }

let _ac;
function playPitch(freq, ms = 1500) {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = _ac.createOscillator(), g = _ac.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, _ac.currentTime);
    g.gain.linearRampToValueAtTime(0.22, _ac.currentTime + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, _ac.currentTime + ms / 1000);
    o.connect(g).connect(_ac.destination);
    o.start(); o.stop(_ac.currentTime + ms / 1000 + 0.05);
  } catch (e) { /* audio unavailable */ }
}

/* ------------------------------ Search ------------------------------ */
function hl(text, terms) {
  if (!terms || !terms.length) return esc(text);
  const re = new RegExp('(' + terms.map(reEsc).join('|') + ')', 'ig');
  return String(text).split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}
const norm = s => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function searchHymns({ q = '', f = {}, sort = 'relevance', ctx = null }) {
  const terms = norm(q).split(/[\s,]+/).map(t => t.replace(/^["']|["']$/g, '')).filter(Boolean);
  const out = [];
  for (const h of HYMNS) {
    // filters
    if (f.topics && f.topics.size && ![...f.topics].every(t => h.topics.includes(t))) continue;
    if (ctx && ctx.topics.length && !ctx.topics.some(t => h.topics.includes(t))) continue;
    if (f.key && h.key !== f.key) continue;
    if (f.time && h.time !== f.time) continue;
    if (f.meter && !h.meter.startsWith(f.meter)) continue;
    if (f.hymnal && !(f.hymnal in h.hn)) continue;
    if (f.pd && !h.pd) continue;
    if (f.fresh && h.last != null && h.last < 56) continue;

    let score = 0, ok = true, where = new Set(), snippet = null;
    const hnStr = Object.entries(h.hn).map(([k, v]) => `${k.toLowerCase()} ${v}`);
    const fields = [
      ['title', norm(h.title), 10], ['alt', norm(h.first), 6], ['tune', norm(h.tune), 5],
      ['author', norm(h.by + ' ' + h.music), 3], ['topic', norm(h.topics.join(' ')), 4],
      ['scripture', norm(h.scr.join(' ')), 5], ['meter', norm(h.meter + ' ' + h.key + ' ' + h.time), 2],
      ['lyrics', norm(h.lyrics), 3]
    ];
    for (const t of terms) {
      let best = 0, bestName = null;
      const isNum = /^\d+$/.test(t);
      if (isNum && Object.values(h.hn).some(n => String(n) === t)) { best = 8; bestName = 'hymnal #'; }
      if (/^(sfp|gsc|hfw|ss)$/.test(t) && t.toUpperCase() in h.hn) { best = Math.max(best, 4); bestName = 'hymnal #'; }
      for (const [name, val, w] of fields) {
        if (val.includes(t) && w > best) { best = w; bestName = name; }
      }
      if (!best) { ok = false; break; }
      score += best; where.add(bestName);
    }
    if (!ok) continue;
    if (terms.length && norm(h.title).startsWith(terms[0])) score += 5;
    if (terms.length && where.has('lyrics') && !where.has('title')) {
      const lines = h.sec.flatMap(s => s[1] || []);
      const ln = lines.find(l => terms.some(t => norm(l).includes(t)));
      if (ln) snippet = ln;
    }
    out.push({ h, score, where: [...where], snippet });
  }
  const cmp = {
    relevance: (a, b) => b.score - a.score || a.h.title.localeCompare(b.h.title),
    title:     (a, b) => a.h.title.localeCompare(b.h.title),
    recent:    (a, b) => (a.h.last ?? 9999) - (b.h.last ?? 9999),
    stale:     (a, b) => (b.h.last ?? 9999) - (a.h.last ?? 9999),
    count:     (a, b) => b.h.cnt - a.h.cnt || a.h.title.localeCompare(b.h.title)
  }[sort] || (() => 0);
  out.sort(cmp);
  return { results: out, terms };
}

const SECTION_LABEL = l => (/^\d+$/.test(l) ? `Verse ${l}` : l);
const ITEM_TYPES = {
  song:      { label: 'Song',                color: 'song' },
  prayer:    { label: 'Prayer',              color: 'prayer' },
  scripture: { label: 'Scripture reading',   color: 'scripture' },
  supper:    { label: 'Lord’s Supper',  color: 'supper' },
  give:      { label: 'Contribution',        color: 'give' },
  sermon:    { label: 'Sermon / Lesson',     color: 'sermon' },
  welcome:   { label: 'Welcome / Announcements', color: 'welcome' },
  custom:    { label: 'Other',               color: 'custom' }
};

/* Plan checks shared by desktop + mobile. */
function planChecks(svc) {
  const out = [];
  svc.items.forEach(it => {
    if (it.type === 'song' && !it.hymn) out.push({ level: 'warn', id: it.id, text: `No hymn chosen for “${ROLES[it.role].label}”.` });
    if (it.type === 'song' && it.hymn) {
      const h = HYMN[it.hymn];
      if (h.last != null && h.last < 21) out.push({ level: 'info', id: it.id, text: `“${h.title}” was sung ${agoText(h.last).toLowerCase()}.` });
      if (h.pending) out.push({ level: 'warn', id: it.id, text: `“${h.title}” has no slide pack yet — request one.` });
    }
    if (!it.who && it.type !== 'song') out.push({ level: 'warn', id: it.id, text: `“${it.title}” has no one assigned.` });
  });
  const songs = svc.items.filter(i => i.type === 'song' && i.hymn);
  for (let i = 1; i < songs.length; i++) {
    const a = HYMN[songs[i - 1].hymn], b = HYMN[songs[i].hymn];
    if (keyGap(a.key, b.key) >= 5) out.push({ level: 'info', id: songs[i].id, text: `Big pitch jump: ${a.title} (${a.key}) → ${b.title} (${b.key}).` });
  }
  return out;
}
