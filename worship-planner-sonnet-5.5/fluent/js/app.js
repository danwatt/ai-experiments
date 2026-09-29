'use strict';
/* Selah — Fluent (WinUI / Uno look) desktop mockup controller. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* Extra glyphs used by the Fluent chrome */
Object.assign(ICONS, {
  menu:    '<path d="M4 6h16M4 12h16M4 18h16"/>',
  gear:    '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="3.2 3.1"/>',
  info:    '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.6v.01"/>',
  success: '<circle cx="12" cy="12" r="9.5"/><path d="m8 12.2 3 3 5-6"/>',
  warning: '<path d="M12 3.2 2.6 19.6h18.8z"/><path d="M12 10v4.6M12 17.2v.01"/>',
  minus:   '<path d="M6 12h12"/>',
  square:  '<rect x="6" y="6" width="12" height="12" rx="1.5"/>'
});

const S = {
  services: SERVICES, cur: 's1', sel: null, tab: 'library',
  q: '', f: { topics: new Set(), key: '', time: '', meter: '', hymnal: '', pd: false, fresh: false },
  sort: 'relevance', view: 'list', ctx: null, filtersOpen: false, prev: null, verse: 0, checkOpen: false,
  navCompact: false, slides: [], pi: 0
};
let lastResults = [];

const svc = () => S.services.find(s => s.id === S.cur);
const selItem = () => svc().items.find(i => i.id === S.sel) || null;
const pname = id => (id ? PERSON[id].name : null);
const hnPick = it => { const h = HYMN[it.hymn]; return it.hnPick && h.hn[it.hnPick] ? it.hnPick : Object.keys(h.hn)[0]; };
const ROLE_FOR = { song: 'song', prayer: 'prayer', scripture: 'reader', supper: 'table', give: 'give', sermon: 'preacher', welcome: 'welcome' };
const itemTitle = it => (it.type === 'song' && it.hymn ? HYMN[it.hymn].title : it.title);

/* ------------------------------ InfoBar toasts / flyouts / dialogs ------------------------------ */
function toast(msg, ic = 'check') {
  const sev = ic === 'check' || ic === 'download' ? 'success' : ic === 'alert' ? 'caution' : '';
  const glyph = sev === 'success' ? 'success' : sev === 'caution' ? 'warning' : 'info';
  const t = document.createElement('div');
  t.className = 'infobar ' + sev; t.setAttribute('role', 'status');
  t.innerHTML = `<span class="ib-ico">${icon(glyph, 16)}</span><div class="ib-txt"><span>${esc(msg)}</span></div><button class="ib-close" aria-label="Close">${icon('x', 14)}</button>`;
  t.querySelector('.ib-close').onclick = () => t.remove();
  $('#toasts').append(t); setTimeout(() => t.remove(), 3200);
}
function showMenu(anchor, items, { align = 'left' } = {}) {
  const m = $('#menu'); m.innerHTML = '';
  items.forEach(it => {
    if (it.hr) { m.append(document.createElement('hr')); return; }
    if (it.header) { const d = document.createElement('div'); d.className = 'mh'; d.textContent = it.header; m.append(d); return; }
    const b = document.createElement('button');
    if (it.danger) b.className = 'danger';
    b.innerHTML = (it.html || '<span style="width:16px"></span>') + `<span>${esc(it.label)}</span>` + (it.small ? `<small>${esc(it.small)}</small>` : '');
    b.onclick = ev => { ev.stopPropagation(); hideMenu(); it.run && it.run(); };
    m.append(b);
  });
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 4; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = left + 'px'; m.style.top = top + 'px';
}
const hideMenu = () => { $('#menu').hidden = true; };

function confirmDialog({ title, body, primary, close = 'Cancel', onPrimary }) {
  const h = $('#dialogHost');
  h.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><div class="d-body"><h2>${esc(title)}</h2><p>${esc(body)}</p></div>
    <div class="d-cmd"><button class="btn accent" data-d="primary">${esc(primary)}</button><button class="btn" data-d="close">${esc(close)}</button></div></div>`;
  h.hidden = false;
  const done = () => { h.hidden = true; h.innerHTML = ''; };
  h.querySelector('[data-d=primary]').onclick = () => { done(); onPrimary && onPrimary(); };
  h.querySelector('[data-d=close]').onclick = done;
  h.onclick = e => { if (e.target === h) done(); };
  h.querySelector('[data-d=primary]').focus();
}

/* ------------------------------ NavigationView ------------------------------ */
function openSlots(s) { return s.items.filter(i => i.type === 'song' && !i.hymn).length; }
function renderNav() {
  const nav = $('#nav');
  nav.classList.toggle('compact', S.navCompact);
  const sorted = [...S.services].sort((a, b) => a.date.localeCompare(b.date));
  const one = s => {
    const d = parseDate(s.date), open = s.status === 'done' ? 0 : openSlots(s);
    return `<button class="nav-item ${s.id === S.cur ? 'on' : ''}" data-svc="${s.id}" title="${MONTHS[d.getMonth()]} ${d.getDate()} · ${esc(s.kind)}" aria-current="${s.id === S.cur}">
      ${icon(s.status === 'done' ? 'check' : 'calendar', 16)}<span class="nav-label">${MONTHS[d.getMonth()]} ${d.getDate()} · ${esc(s.kind)}</span>${open ? `<span class="infobadge caution" title="${open} open song slot${open > 1 ? 's' : ''}">${open}</span>` : ''}</button>`;
  };
  nav.innerHTML = `
    <div class="nav-top"><button class="nav-toggle" data-a="navtoggle" aria-label="Toggle navigation pane">${icon('menu', 18)}</button></div>
    <div class="nav-scroll">
      <div class="nav-header">Upcoming</div>${sorted.filter(s => s.status !== 'done').map(one).join('')}
      <div class="nav-header">Recent</div>${sorted.filter(s => s.status === 'done').map(one).join('')}
      <hr class="nav-sep">
      <button class="nav-item" data-a="newsvc" title="New service">${icon('plus', 16)}<span class="nav-label">New service</span></button>
    </div>
    <div class="nav-footer">
      <button class="nav-item" data-a="stub" data-msg="Team & roles isn’t part of this mockup" title="Team & roles">${icon('users', 16)}<span class="nav-label">Team & roles</span></button>
      <button class="nav-item" data-a="stub" data-msg="Settings isn’t part of this mockup" title="Settings">${icon('gear', 16)}<span class="nav-label">Settings</span></button>
    </div>`;
}
function renderHead() {
  const s = svc(), nSongs = s.items.filter(i => i.type === 'song').length;
  $('#svcHead').innerHTML = `
    <input class="title-input" id="svcTitle" value="${esc(s.title)}" aria-label="Service title" spellcheck="false">
    <div class="ph-meta">
      <span>${icon('calendar', 14)} ${fmtLong(s.date)}</span>
      <span>${icon('list', 14)} ${s.items.length} items · ${nSongs} songs</span>
      ${s.theme ? `<span>${icon('sparkle', 14)} Theme: ${esc(s.theme)}</span>` : ''}
      ${s.text ? `<span>${icon('scripture', 14)} ${esc(s.text)}</span>` : ''}
    </div>`;
}

/* ------------------------------ Order list ------------------------------ */
function rowHtml(it) {
  const h = it.type === 'song' && it.hymn ? HYMN[it.hymn] : null, empty = it.type === 'song' && !h;
  const dot = '<i class="dot"></i>';
  let title, sub;
  if (empty) {
    title = `Choose ${ROLES[it.role].label.toLowerCase()}…`;
    sub = `<span>${esc(pname(it.who) || 'No leader')}</span>${dot}<span class="warn">Search the library</span>`;
  } else if (h) {
    const sp = startPitch(h, it.shift || 0), num = hnPick(it);
    const parts = [pname(it.who) ? esc(pname(it.who)) : 'No leader', `Key ${sp.keyShifted}`, `start ${sp.name} (${sp.solfege})`, `${num} ${h.hn[num]}`];
    if (h.last != null && h.last < 21) parts.push(`<span class="warn">sung ${agoText(h.last).toLowerCase()}</span>`);
    title = h.title; sub = parts.join(dot);
  } else {
    title = it.title;
    sub = [it.who ? esc(pname(it.who)) : '<span class="warn">Unassigned</span>', it.ref ? esc(it.ref) : null].filter(Boolean).join(dot);
  }
  return `<div class="row ${S.sel === it.id ? 'sel' : ''} ${empty ? 'empty' : ''}" draggable="true" data-id="${it.id}" tabindex="0" role="option" aria-selected="${S.sel === it.id}">
    <span class="grip">${icon('grip', 14)}</span>
    <span class="tile ${it.type}">${empty ? icon('plus', 16) : icon(it.type, 16)}</span>
    <div class="main"><div class="ttl">${esc(title)}</div><div class="sub">${sub}</div></div>
    <button class="kebab" data-a="kebab" aria-label="More options for ${esc(title)}">${icon('more', 16)}</button>
  </div>`;
}
function renderOrder() {
  const s = svc(); let prev = null, html = '';
  s.items.forEach(it => {
    if (it.section !== prev) { html += `<div class="sec-h">${esc(it.section)}</div>`; prev = it.section; }
    html += rowHtml(it);
  });
  $('#orderList').innerHTML = html;
}
function renderCheck() {
  const list = planChecks(svc()), n = list.length;
  $('#checkDock').innerHTML = `
    <button class="check-head" data-a="check" aria-expanded="${S.checkOpen}">${icon(n ? 'warning' : 'success', 16)} Plan check
      ${n ? `<span class="infobadge caution">${n}</span>` : '<span class="pill ok">All clear</span>'}<span class="chev">${icon(S.checkOpen ? 'chevD' : 'up', 14)}</span></button>
    ${S.checkOpen && n ? `<div class="check-list">${list.map(c => `<button class="check-item" data-a="checkgo" data-id="${c.id || ''}"><span class="lv ${c.level}">${icon(c.level === 'warn' ? 'warning' : 'info', 14)}</span><span>${esc(c.text)}</span></button>`).join('')}</div>` : ''}`;
}

/* ------------------------------ Tabs ------------------------------ */
function renderTabs() {
  $$('#tabs .tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  $('#paneLibrary').hidden = S.tab !== 'library';
  $('#paneItem').hidden = S.tab !== 'item';
  $('#paneDeck').hidden = S.tab !== 'deck';
  $('#deckCount').textContent = buildSlides(svc()).length;
}

/* ------------------------------ Library ------------------------------ */
function initFilters() {
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  const keys = [...new Set(HYMNS.map(h => h.key))].sort((a, b) => keySemi(a) - keySemi(b));
  $('#fKey').innerHTML = opt('', 'Any') + keys.map(k => opt(k, k)).join('');
  $('#fTime').innerHTML = opt('', 'Any') + [...new Set(HYMNS.map(h => h.time))].sort().map(k => opt(k, k)).join('');
  $('#fMeter').innerHTML = opt('', 'Any') + [...new Set(HYMNS.map(h => h.meter.split(' ')[0]))].sort().map(k => opt(k, k)).join('');
  $('#fHymnal').innerHTML = opt('', 'Any') + Object.entries(HYMNALS).map(([k, v]) => opt(k, k + ' — ' + v)).join('');
  $('#dbNote').textContent = `${HYMNS.length} hymns · database v2026.09`;
}
function renderFilterBar() {
  const f = S.f, n = (f.key ? 1 : 0) + (f.time ? 1 : 0) + (f.meter ? 1 : 0) + (f.hymnal ? 1 : 0) + (f.pd ? 1 : 0) + (f.fresh ? 1 : 0);
  $('#filtersMore').hidden = !S.filtersOpen;
  $('#btnFilters').innerHTML = icon('sliders', 16) + ' Filters' + (n ? ` <span class="infobadge">${n}</span>` : '') + icon(S.filtersOpen ? 'up' : 'down', 12);
}
function renderChips() {
  const counts = {}; HYMNS.forEach(h => h.topics.forEach(t => counts[t] = (counts[t] || 0) + 1));
  const tops = ALL_TOPICS.slice().sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  $('#topicChips').innerHTML = tops.map(t => `<button class="chip ${S.f.topics.has(t) ? 'on' : ''}" data-a="topic" data-t="${esc(t)}" aria-pressed="${S.f.topics.has(t)}">${esc(t)}<span class="n">${counts[t]}</span></button>`).join('');
}
function renderCtx() {
  const it = selItem();
  let html = '';
  if (S.ctx && it && it.type === 'song' && !it.hymn) {
    html = `<div class="infobar caution" role="status"><span class="ib-ico">${icon('info', 16)}</span>
      <div class="ib-txt"><b>Picking the ${esc(ROLES[it.role].label.toLowerCase())}</b><span>Showing hymns tagged ${S.ctx.topics.map(esc).join(', ')}, least recently sung first.</span></div>
      <button class="btn sm" data-a="clearCtx">Show all hymns</button><button class="ib-close" data-a="clearCtx" aria-label="Dismiss">${icon('x', 14)}</button></div>`;
  } else if (it) {
    html = `<div class="infobar" role="status"><span class="ib-ico">${icon('info', 16)}</span>
      <div class="ib-txt"><b>Insert position</b><span>New hymns are added after “${esc(itemTitle(it))}”.</span></div>
      <button class="btn sm" data-a="clearSel">Add to end instead</button></div>`;
  }
  $('#ctxBanner').innerHTML = html;
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
function renderResults() {
  const eff = S.ctx && !S.q.trim() && S.sort === 'relevance' ? 'stale' : S.sort;
  const { results, terms } = searchHymns({ q: S.q, f: S.f, sort: eff, ctx: S.ctx });
  lastResults = results;
  if (results.length && !results.some(r => r.h.id === S.prev)) { S.prev = results[0].h.id; S.verse = 0; }
  const inSvc = new Set(svc().items.filter(i => i.hymn).map(i => i.hymn));
  const sortName = { relevance: S.q.trim() ? 'relevance' : 'title', title: 'title', recent: 'recently sung', stale: 'longest since sung', count: 'most sung' }[eff] || eff;
  const sep = '<i class="sep"></i>';
  const rows = results.map(r => {
    const h = r.h;
    return `<div class="res ${h.id === S.prev ? 'on' : ''}" draggable="true" data-hymn="${h.id}" tabindex="0" role="option" aria-selected="${h.id === S.prev}">
      <div class="thumb">${Notation.hymnSlide(h, 0, { mini: true })}</div>
      <div class="mid">
        <div class="t">${hl(h.title, terms)}${inSvc.has(h.id) ? `<span class="in-svc">${icon('check', 12)} In service</span>` : ''}</div>
        <div class="by">${hl(h.by, terms)}</div>
        ${matchNote(r, terms)}
        <div class="meta"><b>${h.key}</b>${sep}<span>${h.time}</span>${sep}<span>${esc(h.meter.split(' ')[0])}</span>${sep}<span>${Object.entries(h.hn).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
          ${h.pd ? '' : `${sep}<span class="lic">Licensed</span>`}${h.pending ? `${sep}<span class="wait">No slides yet</span>` : ''}</div>
        <div class="meta" style="margin-top:2px">${lastLabel(h)}</div>
      </div>
      <div class="side"><button class="btn icon" data-a="add" data-id="${h.id}" title="Add to service" aria-label="Add ${esc(h.title)} to service">${icon('plus', 16)}</button></div>
    </div>`;
  }).join('');
  const el = $('#results');
  el.classList.toggle('grid-view', S.view === 'grid');
  el.innerHTML = `<div class="res-count"><span>${S.q.trim() ? `Results for “${esc(S.q.trim())}” · ` : ''}<b style="color:var(--TextFillColorPrimary)">${results.length}</b> of ${HYMNS.length} hymns</span><span>Sorted by ${sortName}</span></div>` +
    (results.length ? `<div class="res-list" role="listbox">${rows}</div>` :
      `<div class="empty-state"><b>No hymns match</b>Try fewer words, or clear a filter.<br><br><button class="btn" data-a="resetFilters">Reset filters</button></div>`);
  $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
}
function fmtSung(d) { const dt = new Date(TODAY.getTime() - d * 864e5); return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`; }
function renderPreview() {
  const el = $('#preview'), h = HYMN[S.prev];
  if (!h || !lastResults.length) { el.innerHTML = `<div class="empty-state"><b>No hymn selected</b>Search or filter to preview slides.</div>`; return; }
  if (S.verse >= h.sec.length) S.verse = 0;
  const it = selItem(), sp = startPitch(h);
  const weeks = Array.from({ length: 52 }, (_, i) => { const w = 51 - i; return h.d.some(d => d >= w * 7 && d < w * 7 + 7); });
  let addLabel = 'Add to end of service';
  if (it && it.type === 'song' && !it.hymn) addLabel = `Use as ${ROLES[it.role].label.toLowerCase()}`;
  else if (it) addLabel = `Add after “${itemTitle(it).slice(0, 24)}”`;
  const already = svc().items.some(i => i.hymn === h.id);
  el.innerHTML = `
    <div class="slide-frame">${Notation.hymnSlide(h, S.verse)}
      <button class="slide-nav l" data-a="vnav" data-d="-1" aria-label="Previous slide">${icon('chevL', 16)}</button>
      <button class="slide-nav r" data-a="vnav" data-d="1" aria-label="Next slide">${icon('chevR', 16)}</button></div>
    <div class="verse-pills"><span class="lbl">Slides</span>${h.sec.map((s, i) => `<button class="vp ${i === S.verse ? 'on' : ''}" data-a="verse" data-v="${i}">${/^\d+$/.test(s[0]) ? s[0] : esc(s[0])}</button>`).join('')}</div>
    <div class="p-title">${esc(h.title)}</div>
    <div class="p-first">“${esc(h.first)}…”</div>
    <div class="p-credit">Words: ${esc(h.by)}<br>Music: ${esc(h.music)}</div>
    <div class="pitch"><div class="big">${sp.name}</div><div class="txt"><b>Start on ${sp.name} (${sp.solfege})</b>Key of ${h.key} · a cappella</div>
      <button class="btn accent icon" data-a="pitch" data-id="${h.id}" title="Play starting pitch" aria-label="Play starting pitch">${icon('volume', 16)}</button></div>
    <div class="kv">
      <div><small>Time signature</small><b>${h.time}</b></div><div><small>Tempo</small><b>${esc(h.tempo.split(',')[0])}</b></div><div><small>Slides</small><b>${h.slides}</b></div>
      <div class="wide"><small>Meter</small><b>${esc(h.meter)}</b></div><div><small>Tune</small><b>${esc(h.tune)}</b></div>
    </div>
    <div class="blk"><div class="blk-h">Hymnals</div><div class="tags">${Object.entries(h.hn).map(([k, v]) => `<span class="tagc" title="${esc(HYMNALS[k])}">${k}<b>${v}</b></span>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Scripture</div><div class="tags">${h.scr.map(x => `<button class="tagc" data-a="searchq" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Topics</div><div class="tags">${h.topics.map(x => `<button class="tagc" data-a="topicOnly" data-t="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Congregation history <span>${h.cnt}× in 12 months</span></div>
      <div class="spark">${weeks.map(o => `<i class="${o ? 'on' : ''}"></i>`).join('')}</div>
      <div class="spark-legend"><span>12 months ago</span><span>${h.d.length ? 'Last: ' + h.d.slice().sort((a, b) => a - b).slice(0, 3).map(fmtSung).join(', ') : 'Never sung'}</span><span>Today</span></div></div>
    <div class="blk"><div class="blk-h">License</div>${h.pd ? `<span class="pill ok">Public domain</span> <span class="hint">No reporting required</span>` : `<span class="pill warn">Licensed</span> <span class="hint">${esc(h.lic)}</span>`}</div>
    <div class="actions">
      <button class="btn accent" data-a="add" data-id="${h.id}">${icon('plus', 16)} ${esc(addLabel)}</button>
      ${h.pending ? `<button class="btn" data-a="stub" data-msg="Slide pack requested from the slide library team">Request slides</button>` : `<button class="btn" data-a="stub" data-msg="Slide pack copied — paste into PowerPoint or Keynote">${icon('copy', 16)} Copy slides</button>`}
    </div>
    ${already ? `<div style="text-align:center;margin:0 -20px;padding:0 0 10px;background:var(--SolidBackgroundFillColorTertiary);font-size:12px;color:var(--SystemFillColorSuccess)">Already in this service</div>` : ''}`;
}

/* ------------------------------ Item editor ------------------------------ */
function personSelect(field, cur, type) {
  const role = ROLE_FOR[type];
  const o = p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`;
  const sug = PEOPLE.filter(p => p.roles.includes(role)), rest = PEOPLE.filter(p => !p.roles.includes(role));
  return `<select class="combo" data-f="${field}"><option value="">Unassigned</option>${sug.length ? `<optgroup label="Suggested for this role">${sug.map(o).join('')}</optgroup>` : ''}<optgroup label="Everyone">${rest.map(o).join('')}</optgroup></select>`;
}
const NOTES_LABEL = { song: 'Notes for the song leader', prayer: 'Prayer focus / requests', scripture: 'Notes for the reader', supper: 'Thoughts / outline', give: 'Notes', sermon: 'Outline / notes', welcome: 'Announcements', custom: 'Notes' };
function renderItem() {
  const el = $('#paneItem'), it = selItem();
  if (!it) { el.innerHTML = `<div class="empty-state"><b>Nothing selected</b>Pick an item in the order of service to edit its details.</div>`; return; }
  const t = ITEM_TYPES[it.type], isSong = it.type === 'song', h = isSong && it.hymn ? HYMN[it.hymn] : null;
  const head = `<div class="item-h"><span class="tile ${it.type}">${icon(it.type, 20)}</span><div><h2>${esc(h ? h.title : isSong ? ROLES[it.role].label : it.title)}</h2><div class="sub">${t.label}${isSong ? ' · ' + ROLES[it.role].label.toLowerCase() : ''}</div></div>
    <span class="grow"></span><button class="btn" data-a="addAfter">${icon('plus', 16)} Add hymns after this</button><button class="btn danger" data-a="remove">${icon('trash', 16)} Remove</button></div>`;
  let body = '';
  if (isSong) {
    const roleSel = `<div class="fld"><label>Purpose</label><select class="combo" data-f="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${it.role === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>`;
    if (!h) {
      body = `<div class="card-in" style="border-style:dashed;text-align:center;padding:28px"><b style="font-size:16px;font-weight:600">No hymn chosen yet</b><div class="hint" style="margin:4px 0 14px">Search ${HYMNS.length} hymns with ready-made slides, filtered for this purpose.</div><button class="btn accent" data-a="viewlib">${icon('search', 16)} Search the library</button></div>
        <div class="form-2"><div class="fld"><label>Song leader</label>${personSelect('who', it.who, 'song')}</div>${roleSel}</div>`;
    } else {
      const sp = startPitch(h, it.shift || 0), shift = it.shift || 0;
      const nSel = it.verses.length;
      body = `
        <div class="card-in hymn-card">
          <div><div class="thumb">${Notation.hymnSlide(h, it.verses[0] ?? 0, { mini: true })}</div></div>
          <div><div class="t">${esc(h.title)}</div><div class="p-credit">${esc(h.by)} · ${esc(h.tune)}</div>
            <div class="meta" style="margin-top:8px"><b>${h.key}</b><i class="sep"></i><span>${h.time}</span><i class="sep"></i><span>${esc(h.meter)}</span></div>
            <div class="meta">${Object.entries(h.hn).map(([k, v]) => `<span>${k} ${v}</span>`).join('<i class="sep"></i>')}</div>
            <div style="margin-top:12px;display:flex;gap:8px"><button class="btn" data-a="replace">${icon('swap', 16)} Replace hymn</button><button class="btn" data-a="viewlib">View in library</button></div></div>
        </div>
        <div class="fld"><div class="lbl">Slides to include</div>
          <div class="checks">${h.sec.map((s, i) => `<label class="check-box"><input type="checkbox" data-a="sect" data-i="${i}" ${it.verses.includes(i) ? 'checked' : ''}>${esc(SECTION_LABEL(s[0]))}</label>`).join('')}</div>
          <div class="help">${nSel} of ${h.sec.length} slides in the deck. Order follows the printed hymn.</div></div>
        <div class="fld"><div class="lbl">Starting pitch</div>
          <div class="pitch" style="margin:0 0 10px"><div class="big">${sp.name}</div>
            <div class="txt"><b>Start on ${sp.name} (${sp.solfege})</b>${shift ? `${sp.keyShifted} for the leader · slides still print in ${h.key}` : `Printed key of ${h.key}`}</div>
            <button class="btn accent icon" data-a="pitch" data-id="${h.id}" data-shift="${shift}" title="Play pitch" aria-label="Play pitch">${icon('volume', 16)}</button></div>
          <input type="range" class="slider" min="-3" max="3" step="1" value="${shift}" data-f="shift" aria-label="Transpose in half steps">
          <div class="slider-ticks"><span>−3</span><span>−2</span><span>−1</span><span>Printed</span><span>+1</span><span>+2</span><span>+3</span></div>
          <div class="help">Transpose in half steps for the leader. The phone app shows this pitch in the Leader view.</div></div>
        <div class="form-2"><div class="fld"><label>Song leader</label>${personSelect('who', it.who, 'song')}</div>
          <div class="fld"><label>Announce as</label><select class="combo" data-f="hnPick">${Object.entries(h.hn).map(([k, v]) => `<option value="${k}" ${hnPick(it) === k ? 'selected' : ''}>${k} #${v} — ${esc(HYMNALS[k])}</option>`).join('')}</select></div></div>
        <div class="form-2">${roleSel}<div></div></div>`;
    }
  } else {
    const showRef = ['scripture', 'supper', 'sermon', 'custom'].includes(it.type);
    body = `<div class="fld"><label>Title</label><input type="text" data-f="title" value="${esc(it.title)}"></div>
      <div class="form-2"><div class="fld"><label>${it.type === 'sermon' ? 'Speaker' : it.type === 'scripture' ? 'Reader' : 'Assigned to'}</label>${personSelect('who', it.who, it.type)}</div><div></div></div>
      ${showRef ? `<div class="fld"><label>Scripture reference</label><input type="text" data-f="ref" value="${esc(it.ref || '')}" placeholder="e.g. Ephesians 2:1–10"><div class="help">Shown on the slide with text from your default Bible version.</div></div>` : ''}
      ${it.type === 'supper' || it.type === 'give' ? `<div class="fld"><div class="lbl">${it.type === 'supper' ? 'Servers' : 'Collectors'}</div><div class="people-chips">${PEOPLE.filter(p => p.roles.some(r => ['table', 'give', 'elder'].includes(r))).map(p => `<label class="check-box"><input type="checkbox" data-a="helper" data-id="${p.id}" ${(it.helpers || []).includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}</div></div>` : ''}
      ${it.type === 'sermon' ? `<div class="fld"><div class="lbl">Slides</div>${it.attached ? `<span class="pill ok">${icon('file', 12)} ${esc(it.attached)}</span>` : `<button class="btn" data-a="attach">${icon('plus', 16)} Attach PowerPoint…</button>`}<div class="help">Attached decks are merged after the hymn slides when you export.</div></div>` : ''}
      <div class="fld"><label>${NOTES_LABEL[it.type]}</label><textarea data-f="notes" placeholder="Optional">${esc(it.notes || '')}</textarea></div>`;
  }
  if (isSong) body += `<div class="fld"><label>${NOTES_LABEL.song}</label><textarea data-f="notes" placeholder="e.g. Start softly, build in verse 2">${esc(it.notes || '')}</textarea></div>`;
  el.innerHTML = `<div class="item-wrap">${head}<div class="form">${body}</div></div>`;
}

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
function renderDeck() {
  const s = svc(), slides = buildSlides(s); let prev = null;
  const grid = slides.map((sl, i) => {
    let sep = '';
    if (sl.section && sl.section !== prev) { sep = `<div class="dk-sep">${esc(sl.section)}</div>`; prev = sl.section; }
    return sep + `<button class="dk" data-a="deckgo" data-i="${i}"><div class="thumb">${sl.svg}</div><div class="cap"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(sl.label)}${sl.warn ? ' <span class="pill warn">needs hymn</span>' : ''}</span></div></button>`;
  }).join('');
  $('#paneDeck').innerHTML = `<div class="deck-wrap"><div class="deck-h"><h2>${slides.length} slides</h2><span class="grow"></span>
    <button class="btn" data-a="export">${icon('download', 16)} Export .pptx</button><button class="btn accent" data-a="present">${icon('present', 16)} Present</button></div>
    <div class="deck-grid">${grid}</div></div>`;
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
  renderNav(); renderHead(); renderOrder(); renderCheck(); renderCtx(); renderResults(); renderPreview();
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
function askRemove(id) {
  const it = svc().items.find(x => x.id === id); if (!it) return;
  confirmDialog({ title: `Remove “${itemTitle(it)}”?`, body: 'This item will be taken out of the order of service. You can add it back from the library.', primary: 'Remove', onPrimary: () => removeItem(id) });
}
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
  const d = el.dataset;
  switch (name) {
    case 'navtoggle': S.navCompact = !S.navCompact; renderNav(); break;
    case 'add': addHymn(d.id); break;
    case 'kebab': {
      const id = el.closest('.row').dataset.id, it = svc().items.find(i => i.id === id);
      showMenu(el, [
        { label: 'Edit details', html: icon('sparkle', 16), run: () => { S.sel = id; S.tab = 'item'; refresh(); } },
        { label: 'Duplicate', html: icon('copy', 16), run: () => dupItem(id) },
        { label: 'Move up', html: icon('up', 16), run: () => shiftItem(id, -1) },
        { label: 'Move down', html: icon('down', 16), run: () => shiftItem(id, 1) },
        ...(it.type === 'song' && it.hymn ? [{ label: 'Replace hymn…', html: icon('swap', 16), run: () => { it.hymn = null; it.verses = []; selectItem(id); } }] : []),
        { hr: 1 }, { label: 'Remove', html: icon('trash', 16), danger: true, run: () => askRemove(id) }
      ], { align: 'right' }); break;
    }
    case 'addmenu':
      showMenu(el, [{ header: 'Add to order' },
        ...['song', 'prayer', 'scripture', 'supper', 'give', 'sermon', 'welcome', 'custom'].map(t => ({ label: t === 'song' ? 'Song (pick from library)' : ITEM_TYPES[t].label, html: icon(t, 16), run: () => addItemOfType(t) }))]); break;
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
    case 'helper': { const it = selItem(); it.helpers = it.helpers || []; it.helpers = it.helpers.includes(d.id) ? it.helpers.filter(x => x !== d.id) : [...it.helpers, d.id]; break; }
    case 'attach': { selItem().attached = 'Ephesians-2-Sufficiency-of-Grace.pptx'; renderItem(); toast('Attached PowerPoint (sample file)'); break; }
    case 'replace': { const it = selItem(); it.hymn = null; it.verses = []; selectItem(it.id); break; }
    case 'viewlib': { const it = selItem(); if (it && it.hymn) { S.prev = it.hymn; S.verse = 0; } S.tab = 'library'; refresh({ item: false }); break; }
    case 'addAfter': S.tab = 'library'; S.ctx = null; refresh({ item: false }); $('#q').focus(); break;
    case 'remove': askRemove(S.sel); break;
    case 'check': S.checkOpen = !S.checkOpen; renderCheck(); break;
    case 'checkgo': if (d.id) selectItem(d.id); break;
    case 'deckgo': openPresenter(+d.i); break;
    case 'present': openPresenter(0); break;
    case 'newsvc': newService(); break;
    case 'stub': toast(d.msg || 'Not part of this mockup', 'sparkle'); break;
    case 'theme': setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break;
    case 'export': {
      const n = buildSlides(svc()).length, fn = `${svc().kind.replace(/\s+/g, '-')}-${svc().date}`;
      showMenu(el, [{ header: 'Export' },
        { label: 'PowerPoint (.pptx)', small: `${n} slides`, html: icon('present', 16), run: () => toast(`Exported ${n} slides → ${fn}.pptx`, 'download') },
        { label: 'PDF slide handout', small: '4 per page', html: icon('file', 16), run: () => toast(`Exported ${fn}.pdf`, 'download') },
        { label: 'Song leader sheet', small: 'pitches + keys', html: icon('song', 16), run: () => toast('Exported leader sheet with start pitches', 'download') },
        { label: 'Printable bulletin', html: icon('file', 16), run: () => toast('Bulletin PDF ready to print', 'download') },
        { hr: 1 }, { label: 'Copy order as text', html: icon('copy', 16), run: () => toast('Order of service copied') }], { align: 'right' }); break;
    }
    case 'share':
      showMenu(el, [{ header: 'Share with the team' },
        { label: 'Publish to mobile app', small: 'notifies 9 people', html: icon('radio', 16), run: () => toast('Published — song leaders and readers notified', 'radio') },
        { label: 'Email assignments', html: icon('users', 16), run: () => toast('Assignment emails queued') },
        { label: 'Copy read-only link', html: icon('share', 16), run: () => toast('Link copied') }], { align: 'right' }); break;
  }
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('selah-fluent-theme', t); } catch (_) {}
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
$('#asbBtn').addEventListener('click', () => $('#q').focus());

const q = $('#q');
q.addEventListener('focus', () => { if (S.tab !== 'library') { S.tab = 'library'; renderTabs(); } });
q.addEventListener('input', e => { S.q = e.target.value; if (S.tab !== 'library') { S.tab = 'library'; renderTabs(); } renderResults(); renderPreview(); });
q.addEventListener('keydown', e => {
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

/* item form + title editing */
$('#paneItem').addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f || e.target.tagName === 'SELECT' || e.target.type === 'range') return;
  const it = selItem(); if (!it) return;
  it[f] = e.target.value;
  renderHead(); renderOrder(); renderCheck();
});
$('#paneItem').addEventListener('change', e => {
  const f = e.target.dataset.f; if (!f || !(e.target.tagName === 'SELECT' || e.target.type === 'range')) return;
  const it = selItem(); if (!it) return;
  it[f] = f === 'shift' ? +e.target.value : (e.target.value || (f === 'who' ? null : ''));
  if (f === 'role' && it.type === 'song' && !it.hymn) it.title = ROLES[it.role].label;
  refresh();
});
$('#svcHead').addEventListener('input', e => { if (e.target.id === 'svcTitle') svc().title = e.target.value; });
$('#svcHead').addEventListener('change', e => { if (e.target.id === 'svcTitle') renderNav(); });

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

/* keyboard */
document.addEventListener('keydown', e => {
  if (!$('#dialogHost').hidden) { if (e.key === 'Escape') { $('#dialogHost').hidden = true; $('#dialogHost').innerHTML = ''; } return; }
  if (!$('#presenter').hidden) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); presStep(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); presStep(-1); }
    else if (e.key === 'Home') { S.pi = 0; drawPres(); } else if (e.key === 'End') { S.pi = S.slides.length - 1; drawPres(); }
    else if (e.key === 'Escape') $('#presenter').hidden = true;
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); S.tab = 'library'; renderTabs(); q.focus(); q.select(); }
  else if (e.key === 'F5') { e.preventDefault(); openPresenter(0); }
  else if (e.key === 'Escape') hideMenu();
  else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); S.tab = 'library'; renderTabs(); q.focus(); }
});
$('#presStage').addEventListener('click', () => presStep(1));
$('#presPrev').onclick = () => presStep(-1); $('#presNext').onclick = () => presStep(1); $('#presClose').onclick = () => { $('#presenter').hidden = true; };

/* ------------------------------ Init ------------------------------ */
function init() {
  $$('[data-i]').forEach(el => el.innerHTML = icon(el.dataset.i, 16));
  $('#appIco').innerHTML = icon('song', 13);
  $('#asbBtn').innerHTML = icon('search', 16);
  $('#capMin').innerHTML = icon('minus', 14); $('#capMax').innerHTML = icon('square', 14); $('#capClose').innerHTML = icon('x', 14);
  $('#presPrev').innerHTML = icon('chevL', 16); $('#presNext').innerHTML = icon('chevR', 16); $('#presClose').innerHTML = icon('x', 16);
  $$('#viewSeg button').forEach(b => { b.innerHTML = icon(b.dataset.view === 'list' ? 'list' : 'grid', 16); b.dataset.a = 'view'; });
  Object.entries({ btnPresent: 'present', btnExport: 'export', btnShare: 'share', btnTheme: 'theme', btnAddItem: 'addmenu' }).forEach(([id, a]) => { $('#' + id).dataset.a = a; });
  setTheme(document.documentElement.dataset.theme);
  S.navCompact = innerWidth < 1240;
  initFilters(); renderChips(); renderFilterBar();
  S.tab = 'library'; refresh();
}
init();
