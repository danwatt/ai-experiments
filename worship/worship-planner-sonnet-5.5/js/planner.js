'use strict';
/* Selah — desktop planner controller shared by both skins (vanilla JS, no build step).
 *
 * This file owns state, mutations, search wiring, drag & drop, the presenter and the keyboard.
 * A skin script loaded just before it (js/app.js for the classic look, fluent/js/app.js for Fluent)
 * owns the markup. The skin must define:
 *   SKIN = { themeKey, menuIcon, addMenuIcon(type), initChrome(), confirmRemove?(id), act?(name, el), onTitleInput?() }
 *   toast, showMenu, renderChrome, renderHead, rowHtml, renderCheck, renderFilterBar, renderChips,
 *   renderCtx, renderResults, renderPreview, personSelect, renderItem, renderDeck
 * Load order: data.js, core.js, notation.js, the skin, then this file.
 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const S = {
  services: SERVICES, cur: 's1', sel: null, tab: 'library',
  q: '', f: { topics: new Set(), key: '', time: '', meter: '', hymnal: '', pd: false, fresh: false },
  sort: 'relevance', view: 'list', ctx: null, filtersOpen: false, prev: null, verse: 0, checkOpen: false,
  slides: [], pi: 0
};
let lastResults = [];

const svc = () => S.services.find(s => s.id === S.cur);
const selItem = () => svc().items.find(i => i.id === S.sel) || null;
const pname = id => (id ? PERSON[id].name : null);
const hnPick = it => { const h = HYMN[it.hymn]; return it.hnPick && h.hn[it.hnPick] ? it.hnPick : Object.keys(h.hn)[0]; };
const ROLE_FOR = { song: 'song', prayer: 'prayer', scripture: 'reader', supper: 'table', give: 'give', sermon: 'preacher', welcome: 'welcome' };
const itemTitle = it => (it.type === 'song' && it.hymn ? HYMN[it.hymn].title : it.title);
const NOTES_LABEL = { song: 'Notes for the song leader', prayer: 'Prayer focus / requests', scripture: 'Notes for the reader', supper: 'Thoughts / outline', give: 'Notes', sermon: 'Outline / notes', welcome: 'Announcements', custom: 'Notes' };
const hideMenu = () => { $('#menu').hidden = true; };

/* ------------------------------ Shared render helpers ------------------------------ */
function renderOrder() {
  const s = svc(); let prev = null, html = '';
  s.items.forEach(it => {
    if (it.section !== prev) { html += `<div class="sec-h">${esc(it.section)}</div>`; prev = it.section; }
    html += rowHtml(it);
  });
  $('#orderList').innerHTML = html;
}
function renderTabs() {
  $$('#tabs .tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  $('#paneLibrary').hidden = S.tab !== 'library';
  $('#paneItem').hidden = S.tab !== 'item';
  $('#paneDeck').hidden = S.tab !== 'deck';
  $('#deckCount').textContent = buildSlides(svc()).length;
}
function initFilters() {
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  const keys = [...new Set(HYMNS.map(h => h.key))].sort((a, b) => keySemi(a) - keySemi(b));
  $('#fKey').innerHTML = opt('', 'Any') + keys.map(k => opt(k, k)).join('');
  $('#fTime').innerHTML = opt('', 'Any') + [...new Set(HYMNS.map(h => h.time))].sort().map(k => opt(k, k)).join('');
  $('#fMeter').innerHTML = opt('', 'Any') + [...new Set(HYMNS.map(h => h.meter.split(' ')[0]))].sort().map(k => opt(k, k)).join('');
  $('#fHymnal').innerHTML = opt('', 'Any') + Object.entries(HYMNALS).map(([k, v]) => opt(k, k + ' — ' + v)).join('');
}
function matchNote(r, terms) {
  const h = r.h, w = r.where.filter(x => x !== 'title');
  if (!w.length) return '';
  if (r.snippet) return `<div class="snip"><small>lyrics</small>“${hl(r.snippet, terms)}”</div>`;
  const map = { alt: ['first line', h.first], tune: ['tune', h.tune], author: ['author', h.by + ' / ' + h.music], topic: ['topic', h.topics.join(', ')], scripture: ['scripture', h.scr.join(', ')], meter: ['meter', `${h.meter} · ${h.key} · ${h.time}`], 'hymnal #': ['hymnal', Object.entries(h.hn).map(([k, v]) => `${k} ${v}`).join(' · ')], lyrics: ['lyrics', h.first] };
  const m = map[w[0]]; if (!m) return '';
  return `<div class="snip"><small>${m[0]}</small>${hl(m[1], terms)}</div>`;
}
function lastLabel(h) {
  if (h.last == null) return `<span class="last fresh">Never sung</span>`;
  return `<span class="last ${freshness(h)}" title="${h.cnt}× in the last 12 months">Sung ${agoText(h.last).toLowerCase()}</span>`;
}
function fmtSung(d) { const dt = new Date(TODAY.getTime() - d * 864e5); return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`; }

/* ------------------------------ Deck / presenter ------------------------------ */
function buildSlides(s) {
  const T = Notation.textSlide, out = [];
  const nm = id => pname(id) || '';
  out.push({ svg: T({ kicker: s.kind, title: s.title, sub: fmtLong(s.date) + (s.theme ? ' · ' + s.theme : ''), tone: 'navy' }), label: 'Title', section: '' });
  s.items.forEach(it => {
    const sec = it.section;
    if (it.type === 'song') {
      if (!it.hymn) { out.push({ svg: T({ kicker: ROLES[it.role].label, title: 'Hymn not chosen yet', sub: '', tone: 'slate' }), label: 'Empty song slot', itemId: it.id, section: sec, warn: true }); return; }
      const h = HYMN[it.hymn];
      it.verses.forEach(i => out.push({ svg: Notation.hymnSlide(h, i), label: `${h.title} — ${SECTION_LABEL(h.sec[i][0])}`, itemId: it.id, section: sec }));
    } else {
      const spec = {
        scripture: { kicker: 'Scripture reading', title: it.ref || it.title, sub: nm(it.who), tone: 'gold' },
        supper: { kicker: 'The Lord’s Supper', title: it.title, sub: it.ref || '', tone: 'wine' },
        prayer: { kicker: 'Prayer', title: it.title, sub: nm(it.who), tone: 'teal' },
        give: { kicker: 'Giving', title: 'Contribution', sub: '1 Corinthians 16:1–2', tone: 'teal' },
        sermon: { kicker: 'Sermon', title: it.title, sub: [it.ref, nm(it.who)].filter(Boolean).join(' · '), tone: 'navy' },
        welcome: { kicker: 'Welcome', title: 'Welcome & Announcements', sub: '', tone: 'navy' },
        custom: { kicker: '', title: it.title, sub: it.ref || '', tone: 'slate' }
      }[it.type];
      out.push({ svg: T(spec), label: it.title, itemId: it.id, section: sec });
    }
  });
  return out;
}
function openPresenter(idx = 0) {
  S.slides = buildSlides(svc()); S.pi = Math.max(0, Math.min(idx, S.slides.length - 1));
  $('#presenter').hidden = false; drawPres();
}
function drawPres() {
  const sl = S.slides[S.pi], nx = S.slides[S.pi + 1];
  $('#presStage').innerHTML = sl.svg;
  $('#presInfo').innerHTML = `<b>${esc(sl.label)}</b>${nx ? ` &nbsp;·&nbsp; Next: ${esc(nx.label)}` : ' &nbsp;·&nbsp; End of service'}`;
  $('#presCount').textContent = `${S.pi + 1} / ${S.slides.length}`;
}
const presStep = d => { S.pi = Math.max(0, Math.min(S.slides.length - 1, S.pi + d)); drawPres(); };

/* ------------------------------ Mutations ------------------------------ */
function refresh({ item = true } = {}) {
  renderChrome(); renderHead(); renderOrder(); renderCheck(); renderCtx(); renderResults(); renderPreview();
  if (item) renderItem();
  renderTabs(); if (S.tab === 'deck') renderDeck();
}
function selectItem(id) {
  S.sel = id; const it = selItem();
  if (it && it.type === 'song' && !it.hymn) { S.ctx = ROLES[it.role]; S.tab = 'library'; S.q = ''; $('#q').value = ''; }
  else { S.ctx = null; S.tab = 'item'; if (it && it.hymn) { S.prev = it.hymn; S.verse = 0; } }
  refresh();
  if (S.tab === 'library') $('#q').focus();
}
function addHymn(hid) {
  const s = svc(), sel = selItem(), h = HYMN[hid];
  if (sel && sel.type === 'song' && !sel.hymn) {
    sel.hymn = hid; sel.title = h.title; sel.verses = h.sec.map((_, i) => i); sel.shift = 0; S.ctx = null;
    toast(`“${h.title}” set as ${ROLES[sel.role].label.toLowerCase()}`);
  } else {
    const idx = sel ? s.items.indexOf(sel) + 1 : s.items.length;
    const anchor = sel || s.items[s.items.length - 1];
    const it = { id: nid(), type: 'song', title: h.title, who: sel && sel.type === 'song' ? sel.who : ME, hymn: hid, role: 'general', verses: h.sec.map((_, i) => i), shift: 0, notes: '', section: anchor ? anchor.section : 'Gathering' };
    s.items.splice(idx, 0, it); S.sel = it.id;
    toast(`Added “${h.title}”${sel ? ' after the selected item' : ''}`);
  }
  if (h.last != null && h.last < 21) setTimeout(() => toast(`Heads up: sung ${agoText(h.last).toLowerCase()}`, 'alert'), 400);
  refresh();
}
function moveItem(id, targetId, before) {
  const s = svc(), it = s.items.find(i => i.id === id), tg = s.items.find(i => i.id === targetId);
  if (!it || !tg || it === tg) return;
  s.items.splice(s.items.indexOf(it), 1);
  let idx = s.items.indexOf(tg); if (!before) idx++;
  it.section = tg.section; s.items.splice(idx, 0, it); refresh();
}
function insertHymnAt(hid, targetId, before) {
  const s = svc(), h = HYMN[hid], tg = s.items.find(i => i.id === targetId);
  if (tg && tg.type === 'song' && !tg.hymn) { S.sel = tg.id; addHymn(hid); return; }
  const it = { id: nid(), type: 'song', title: h.title, who: ME, hymn: hid, role: 'general', verses: h.sec.map((_, i) => i), shift: 0, notes: '', section: tg ? tg.section : s.items[s.items.length - 1].section };
  const idx = tg ? s.items.indexOf(tg) + (before ? 0 : 1) : s.items.length;
  s.items.splice(idx, 0, it); S.sel = it.id; S.ctx = null; toast(`Added “${h.title}”`); refresh();
}
function addItemOfType(type) {
  const s = svc(), sel = selItem(), anchor = sel || s.items[s.items.length - 1];
  const titles = { song: ROLES.general.label, prayer: 'Prayer', scripture: 'Scripture Reading', supper: 'Communion Thoughts', give: 'Contribution', sermon: 'Sermon', welcome: 'Welcome & Announcements', custom: 'New item' };
  const it = { id: nid(), type, title: titles[type], who: type === 'song' ? ME : null, section: anchor ? anchor.section : 'Gathering' };
  if (type === 'song') Object.assign(it, { hymn: null, role: 'general', verses: [], shift: 0 });
  s.items.splice(sel ? s.items.indexOf(sel) + 1 : s.items.length, 0, it);
  selectItem(it.id);
}
function removeItem(id) {
  const s = svc(), i = s.items.findIndex(x => x.id === id); if (i < 0) return;
  const [gone] = s.items.splice(i, 1);
  if (S.sel === id) { S.sel = null; S.ctx = null; if (S.tab === 'item') S.tab = 'library'; }
  toast(`Removed “${itemTitle(gone)}”`, 'trash'); refresh();
}
const confirmRemove = id => (SKIN.confirmRemove ? SKIN.confirmRemove(id) : removeItem(id));
function dupItem(id) {
  const s = svc(), i = s.items.findIndex(x => x.id === id); const c = { ...s.items[i], id: nid() };
  if (c.verses) c.verses = [...c.verses]; s.items.splice(i + 1, 0, c); refresh();
}
function shiftItem(id, d) {
  const s = svc(), i = s.items.findIndex(x => x.id === id), j = i + d; if (j < 0 || j >= s.items.length) return;
  [s.items[i], s.items[j]] = [s.items[j], s.items[i]]; refresh();
}
function newService() {
  const n = S.services.filter(x => x.id.startsWith('new')).length;
  const tpl = S.services.find(x => x.id === 's4');
  const d = new Date(2026, 9, 18 + n * 7);
  const ns = { id: 'new' + (n + 1), kind: 'Sunday Morning', title: 'Sunday Morning Worship', date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, status: 'draft', theme: '', text: '', items: tpl.items.map(i => ({ ...i, id: nid(), hymn: i.type === 'song' ? null : i.hymn, who: i.type === 'song' ? ME : null, title: i.type === 'song' ? ROLES[i.role].label : i.title, verses: [] })) };
  S.services.push(ns); S.cur = ns.id; S.sel = null; S.ctx = null; S.tab = 'library'; toast('New service created from your Sunday morning template'); refresh();
}

/* ------------------------------ Actions ------------------------------ */
function act(name, el) {
  if (SKIN.act && SKIN.act(name, el)) return;
  const d = el.dataset, mi = n => icon(n, SKIN.menuIcon);
  switch (name) {
    case 'add': addHymn(d.id); break;
    case 'kebab': {
      const id = el.closest('.row').dataset.id, it = svc().items.find(i => i.id === id);
      showMenu(el, [
        { label: 'Edit details', html: mi('sparkle'), run: () => { S.sel = id; S.tab = 'item'; refresh(); } },
        { label: 'Duplicate', html: mi('copy'), run: () => dupItem(id) },
        { label: 'Move up', html: mi('up'), run: () => shiftItem(id, -1) },
        { label: 'Move down', html: mi('down'), run: () => shiftItem(id, 1) },
        ...(it.type === 'song' && it.hymn ? [{ label: 'Replace hymn…', html: mi('swap'), run: () => { it.hymn = null; it.verses = []; selectItem(id); } }] : []),
        { hr: 1 }, { label: 'Remove', html: mi('trash'), danger: true, run: () => confirmRemove(id) }
      ], { align: 'right' }); break;
    }
    case 'addmenu':
      showMenu(el, [{ header: 'Add to order' },
        ...['song', 'prayer', 'scripture', 'supper', 'give', 'sermon', 'welcome', 'custom'].map(t => ({ label: t === 'song' ? 'Song (pick from library)' : ITEM_TYPES[t].label, html: SKIN.addMenuIcon(t), run: () => addItemOfType(t) }))]); break;
    case 'clearCtx': S.ctx = null; refresh({ item: false }); break;
    case 'clearSel': S.sel = null; S.ctx = null; refresh(); break;
    case 'topic': S.f.topics.has(d.t) ? S.f.topics.delete(d.t) : S.f.topics.add(d.t); renderChips(); renderResults(); renderPreview(); break;
    case 'topicOnly': S.f.topics = new Set([d.t]); renderChips(); renderResults(); renderPreview(); $('#results').scrollTop = 0; break;
    case 'searchq': S.q = d.q; $('#q').value = d.q; renderResults(); renderPreview(); break;
    case 'resetFilters': resetFilters(); break;
    case 'toggleFilters': S.filtersOpen = !S.filtersOpen; renderFilterBar(); break;
    case 'view': S.view = d.view; renderResults(); break;
    case 'verse': S.verse = +d.v; renderPreview(); break;
    case 'vnav': { const h = HYMN[S.prev]; S.verse = (S.verse + +d.d + h.sec.length) % h.sec.length; renderPreview(); break; }
    case 'pitch': { const h = HYMN[d.id], sp = startPitch(h, +(d.shift || 0)); playPitch(sp.freq); toast(`Playing ${sp.name}…`, 'volume'); break; }
    case 'sect': { const it = selItem(), i = +d.i; it.verses = it.verses.includes(i) ? it.verses.filter(x => x !== i) : [...it.verses, i].sort((a, b) => a - b); renderItem(); renderDeck(); renderTabs(); break; }
    // A native checkbox already shows its new state; only chip-style toggles need a re-render.
    case 'helper': { const it = selItem(); it.helpers = it.helpers || []; it.helpers = it.helpers.includes(d.id) ? it.helpers.filter(x => x !== d.id) : [...it.helpers, d.id]; if (el.type !== 'checkbox') renderItem(); break; }
    case 'attach': { selItem().attached = 'Ephesians-2-Sufficiency-of-Grace.pptx'; renderItem(); toast('Attached PowerPoint (sample file)'); break; }
    case 'replace': { const it = selItem(); it.hymn = null; it.verses = []; selectItem(it.id); break; }
    case 'viewlib': { const it = selItem(); if (it && it.hymn) { S.prev = it.hymn; S.verse = 0; } S.tab = 'library'; refresh({ item: false }); break; }
    case 'addAfter': S.tab = 'library'; S.ctx = null; refresh({ item: false }); $('#q').focus(); break;
    case 'remove': confirmRemove(S.sel); break;
    case 'check': S.checkOpen = !S.checkOpen; renderCheck(); break;
    case 'checkgo': if (d.id) selectItem(d.id); break;
    case 'deckgo': openPresenter(+d.i); break;
    case 'present': openPresenter(0); break;
    case 'newsvc': newService(); break;
    case 'stub': toast(d.msg || 'Not part of this mockup', 'sparkle'); break;
    case 'theme': setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break;
    case 'sync': toast(`Slide database v2026.09 · ${HYMNS.length} hymns available offline`, 'cloud'); break;
    case 'export': {
      const n = buildSlides(svc()).length, fn = `${svc().kind.replace(/\s+/g, '-')}-${svc().date}`;
      showMenu(el, [{ header: 'Export' },
        { label: 'PowerPoint (.pptx)', small: `${n} slides`, html: mi('present'), run: () => toast(`Exported ${n} slides → ${fn}.pptx`, 'download') },
        { label: 'PDF slide handout', small: '4 per page', html: mi('file'), run: () => toast(`Exported ${fn}.pdf`, 'download') },
        { label: 'Song leader sheet', small: 'pitches + keys', html: mi('song'), run: () => toast('Exported leader sheet with start pitches', 'download') },
        { label: 'Printable bulletin', html: mi('file'), run: () => toast('Bulletin PDF ready to print', 'download') },
        { hr: 1 }, { label: 'Copy order as text', html: mi('copy'), run: () => toast('Order of service copied') }], { align: 'right' }); break;
    }
    case 'share':
      showMenu(el, [{ header: 'Share with the team' },
        { label: 'Publish to mobile app', small: 'notifies 9 people', html: mi('radio'), run: () => toast('Published — song leaders and readers notified', 'radio') },
        { label: 'Email assignments', html: mi('users'), run: () => toast('Assignment emails queued') },
        { label: 'Copy read-only link', html: mi('share'), run: () => toast('Link copied') }], { align: 'right' }); break;
  }
}
function setTheme(t, { save = true } = {}) {
  document.documentElement.dataset.theme = t;
  if (save) { try { localStorage.setItem(SKIN.themeKey, t); } catch (_) {} }
  $('#btnTheme').innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 16);
}
function resetFilters() {
  S.f = { topics: new Set(), key: '', time: '', meter: '', hymnal: '', pd: false, fresh: false }; S.q = ''; S.ctx = null;
  $('#q').value = ''; ['fKey', 'fTime', 'fMeter', 'fHymnal'].forEach(id => $('#' + id).value = ''); $('#fPd').checked = false; $('#fFresh').checked = false;
  renderChips(); renderFilterBar(); refresh({ item: false });
}

/* ------------------------------ Events ------------------------------ */
document.addEventListener('click', e => {
  if (!e.target.closest('#menu')) hideMenu();
  const a = e.target.closest('[data-a]');
  if (a) { act(a.dataset.a, a); return; }
  const row = e.target.closest('.row'); if (row) { selectItem(row.dataset.id); return; }
  const res = e.target.closest('.res'); if (res) { S.prev = res.dataset.hymn; S.verse = 0; renderResults(); renderPreview(); return; }
  const sv = e.target.closest('[data-svc]'); if (sv) { S.cur = sv.dataset.svc; S.sel = null; S.ctx = null; S.tab = 'library'; refresh(); return; }
  const tab = e.target.closest('.tab'); if (tab) { S.tab = tab.dataset.tab; renderTabs(); if (S.tab === 'deck') renderDeck(); if (S.tab === 'item') renderItem(); return; }
});
document.addEventListener('dblclick', e => { const r = e.target.closest('.row'); if (r) { S.sel = r.dataset.id; S.tab = 'item'; refresh(); } });

$('#q').addEventListener('input', e => { S.q = e.target.value; renderResults(); renderPreview(); });
$('#q').addEventListener('keydown', e => {
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) return;
  if (e.key === 'Escape') { e.target.value = ''; S.q = ''; renderResults(); renderPreview(); return; }
  const i = lastResults.findIndex(r => r.h.id === S.prev);
  if (e.key === 'Enter') { if (S.prev) addHymn(S.prev); return; }
  e.preventDefault();
  const n = Math.max(0, Math.min(lastResults.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
  if (lastResults[n]) { S.prev = lastResults[n].h.id; S.verse = 0; renderResults(); renderPreview(); $('.res.on')?.scrollIntoView({ block: 'nearest' }); }
});
[['fKey', 'key'], ['fTime', 'time'], ['fMeter', 'meter'], ['fHymnal', 'hymnal']].forEach(([id, k]) => $('#' + id).addEventListener('change', e => { S.f[k] = e.target.value; renderFilterBar(); renderResults(); renderPreview(); }));
$('#fPd').addEventListener('change', e => { S.f.pd = e.target.checked; renderFilterBar(); renderResults(); renderPreview(); });
$('#fFresh').addEventListener('change', e => { S.f.fresh = e.target.checked; renderFilterBar(); renderResults(); renderPreview(); });
$('#fSort').addEventListener('change', e => { S.sort = e.target.value; renderResults(); });

/* item form + title editing; selects and range sliders commit on change, text fields on input */
const commitsOnChange = el => el.tagName === 'SELECT' || el.type === 'range';
$('#paneItem').addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f || commitsOnChange(e.target)) return;
  const it = selItem(); if (!it) return;
  it[f] = e.target.value;
  renderHead(); renderOrder(); renderCheck();
});
$('#paneItem').addEventListener('change', e => {
  const f = e.target.dataset.f; if (!f || !commitsOnChange(e.target)) return;
  const it = selItem(); if (!it) return;
  it[f] = f === 'shift' ? +e.target.value : (e.target.value || (f === 'who' ? null : ''));
  if (f === 'role' && it.type === 'song' && !it.hymn) it.title = ROLES[it.role].label;
  refresh();
});
$('#svcHead').addEventListener('input', e => { if (e.target.id === 'svcTitle') { svc().title = e.target.value; SKIN.onTitleInput && SKIN.onTitleInput(); } });
$('#svcHead').addEventListener('change', e => { if (e.target.id === 'svcTitle') renderChrome(); });

/* drag & drop */
let drag = null, drop = null;
const clearDrop = () => $$('.drop-before,.drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'));
$('#orderList').addEventListener('dragstart', e => { const r = e.target.closest('.row'); if (!r) return; drag = { kind: 'item', id: r.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'item'); setTimeout(() => r.classList.add('dragging'), 0); });
$('#results').addEventListener('dragstart', e => { const r = e.target.closest('.res'); if (!r) return; drag = { kind: 'hymn', id: r.dataset.hymn }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'hymn'); $('#orderScroll').classList.add('drag-hymn'); });
document.addEventListener('dragend', () => { drag = null; drop = null; clearDrop(); $$('.dragging').forEach(r => r.classList.remove('dragging')); $('#orderScroll').classList.remove('drag-hymn'); });
$('#orderScroll').addEventListener('dragover', e => {
  if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = drag.kind === 'hymn' ? 'copy' : 'move';
  const r = e.target.closest('.row'); clearDrop();
  if (r) { const rc = r.getBoundingClientRect(), before = e.clientY < rc.top + rc.height / 2; r.classList.add(before ? 'drop-before' : 'drop-after'); drop = { id: r.dataset.id, before }; }
  else drop = null;
});
$('#orderScroll').addEventListener('drop', e => {
  if (!drag) return; e.preventDefault(); const d = drag, t = drop; drag = null; drop = null; clearDrop(); $('#orderScroll').classList.remove('drag-hymn');
  if (d.kind === 'item') { if (t) moveItem(d.id, t.id, t.before); else { const s = svc(), last = s.items[s.items.length - 1]; if (last.id !== d.id) moveItem(d.id, last.id, false); } }
  else insertHymnAt(d.id, t ? t.id : null, t ? t.before : false);
});

/* Enter/Space on a focused order row or library result acts like a click, then keeps focus on it after re-render. */
function activateFocused(el) {
  const sel = el.matches('.row') ? `.row[data-id="${el.dataset.id}"]` : `.res[data-hymn="${el.dataset.hymn}"]`;
  el.click();
  if (document.activeElement === document.body || !document.activeElement) $(sel)?.focus();
}

/* keyboard */
document.addEventListener('keydown', e => {
  const dlg = $('#dialogHost');
  if (dlg && !dlg.hidden) { if (e.key === 'Escape') { dlg.hidden = true; dlg.innerHTML = ''; } return; }
  if (!$('#presenter').hidden) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); presStep(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); presStep(-1); }
    else if (e.key === 'Home') { S.pi = 0; drawPres(); } else if (e.key === 'End') { S.pi = S.slides.length - 1; drawPres(); }
    else if (e.key === 'Escape') $('#presenter').hidden = true;
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.row, .res')) { e.preventDefault(); activateFocused(e.target); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); S.tab = 'library'; renderTabs(); $('#q').focus(); $('#q').select(); }
  else if (e.key === 'F5') { e.preventDefault(); openPresenter(0); }
  else if (e.key === 'Escape') hideMenu();
  else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); S.tab = 'library'; renderTabs(); $('#q').focus(); }
});
$('#presStage').addEventListener('click', () => presStep(1));
$('#presPrev').onclick = () => presStep(-1); $('#presNext').onclick = () => presStep(1); $('#presClose').onclick = () => { $('#presenter').hidden = true; };

/* ------------------------------ Init ------------------------------ */
function init() {
  $$('[data-i]').forEach(el => el.innerHTML = icon(el.dataset.i, 16));
  $$('#viewSeg button').forEach(b => { b.dataset.a = 'view'; });
  Object.entries({ btnPresent: 'present', btnExport: 'export', btnShare: 'share', btnTheme: 'theme', btnSync: 'sync', btnAddItem: 'addmenu' })
    .forEach(([id, a]) => { const b = $('#' + id); if (b) b.dataset.a = a; });
  setTheme(document.documentElement.dataset.theme, { save: false });
  SKIN.initChrome();
  initFilters(); renderChips(); renderFilterBar();
  S.tab = 'library'; refresh();
}
init();
