'use strict';
/* Selah — Fluent (WinUI / Uno look) desktop skin: markup only. Behavior lives in ../js/planner.js, which loads after this file. */

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

const SKIN = {
  themeKey: 'selah-fluent-theme',
  menuIcon: 16,
  addMenuIcon: t => icon(t, 16),
  confirmRemove: askRemove,
  act(name) {
    if (name !== 'navtoggle') return false;
    S.navCompact = !S.navCompact; renderNav(); return true;
  },
  initChrome() {
    $('#appIco').innerHTML = icon('song', 13);
    $('#asbBtn').innerHTML = icon('search', 16);
    $('#capMin').innerHTML = icon('minus', 14); $('#capMax').innerHTML = icon('square', 14); $('#capClose').innerHTML = icon('x', 14);
    $('#presPrev').innerHTML = icon('chevL', 16); $('#presNext').innerHTML = icon('chevR', 16); $('#presClose').innerHTML = icon('x', 16);
    $$('#viewSeg button').forEach(b => { b.innerHTML = icon(b.dataset.view === 'list' ? 'list' : 'grid', 16); });
    $('#dbNote').textContent = `${HYMNS.length} hymns · database v2026.09`;
    S.navCompact = innerWidth < 1240;
    // The AutoSuggestBox lives in the title bar, so using it jumps to the library tab.
    const toLibrary = () => { if (S.tab !== 'library') { S.tab = 'library'; renderTabs(); } };
    $('#asbBtn').addEventListener('click', () => $('#q').focus());
    $('#q').addEventListener('focus', toLibrary);
    $('#q').addEventListener('input', toLibrary);
  }
};

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
function askRemove(id) {
  const it = svc().items.find(x => x.id === id); if (!it) return;
  confirmDialog({ title: `Remove “${itemTitle(it)}”?`, body: 'This item will be taken out of the order of service. You can add it back from the library.', primary: 'Remove', onPrimary: () => removeItem(id) });
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
const renderChrome = () => renderNav();
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
function renderCheck() {
  const list = planChecks(svc()), n = list.length;
  $('#checkDock').innerHTML = `
    <button class="check-head" data-a="check" aria-expanded="${S.checkOpen}">${icon(n ? 'warning' : 'success', 16)} Plan check
      ${n ? `<span class="infobadge caution">${n}</span>` : '<span class="pill ok">All clear</span>'}<span class="chev">${icon(S.checkOpen ? 'chevD' : 'up', 14)}</span></button>
    ${S.checkOpen && n ? `<div class="check-list">${list.map(c => `<button class="check-item" data-a="checkgo" data-id="${c.id || ''}"><span class="lv ${c.level}">${icon(c.level === 'warn' ? 'warning' : 'info', 14)}</span><span>${esc(c.text)}</span></button>`).join('')}</div>` : ''}`;
}

/* ------------------------------ Library ------------------------------ */
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

/* ------------------------------ Deck ------------------------------ */
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
