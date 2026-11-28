'use strict';
/* Selah — classic desktop skin: markup only. Behavior lives in js/planner.js, which loads after this file. */

const SKIN = {
  themeKey: 'selah-theme',
  menuIcon: 15,
  addMenuIcon: t => `<span class="tile ${ITEM_TYPES[t].color}">${icon(t, 13)}</span>`,
  onTitleInput: () => renderCrumbs(),
  initChrome() {
    $('#syncIcon').innerHTML = icon('cloud', 15); $('#presentIcon').innerHTML = icon('present', 15);
    $('#shareChev').innerHTML = icon('chevD', 13); $('#exportChev').innerHTML = icon('chevD', 13); $('#addIcon').innerHTML = icon('plus', 15);
    $('#presPrev').innerHTML = icon('chevL', 18); $('#presNext').innerHTML = icon('chevR', 18); $('#presClose').innerHTML = icon('x', 18);
    $$('#viewSeg button').forEach(b => b.innerHTML = icon(b.dataset.view === 'list' ? 'list' : 'grid', 15));
    $('#dbNote').textContent = `${HYMNS.length} hymns · slide database v2026.09`;
  }
};

/* ------------------------------ Toasts & menus ------------------------------ */
function toast(msg, ic = 'check') {
  const t = document.createElement('div');
  t.className = 'toast'; t.innerHTML = icon(ic, 16) + esc(msg);
  $('#toasts').append(t); setTimeout(() => t.remove(), 2800);
}
function showMenu(anchor, items, { align = 'left' } = {}) {
  const m = $('#menu'); m.innerHTML = '';
  items.forEach(it => {
    if (it.hr) { m.append(document.createElement('hr')); return; }
    if (it.header) { const d = document.createElement('div'); d.className = 'mh'; d.textContent = it.header; m.append(d); return; }
    const b = document.createElement('button');
    b.innerHTML = (it.html || '') + `<span>${esc(it.label)}</span>` + (it.small ? `<small>${esc(it.small)}</small>` : '');
    b.onclick = ev => { ev.stopPropagation(); hideMenu(); it.run && it.run(); };
    m.append(b);
  });
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 6; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  m.style.left = left + 'px'; m.style.top = top + 'px';
}

/* ------------------------------ Sidebar / header ------------------------------ */
function svcPill(s) {
  if (s.status === 'done') return '<span class="pill">Complete</span>';
  const open = s.items.filter(i => i.type === 'song' && !i.hymn).length;
  return open ? `<span class="pill warn">${open} open</span>` : '<span class="pill ok">Ready</span>';
}
function renderSidebar() {
  const sorted = [...S.services].sort((a, b) => a.date.localeCompare(b.date));
  const one = s => {
    const d = parseDate(s.date);
    return `<button class="svc ${s.id === S.cur ? 'on' : ''}" data-svc="${s.id}" title="${esc(s.kind)}">
      <div class="dt"><small>${MONTHS[d.getMonth()]}</small><b>${d.getDate()}</b></div>
      <div><div class="nm">${esc(s.kind)}</div><div class="tm">${s.items.length} items</div></div>${svcPill(s)}</button>`;
  };
  $('#sidebar').innerHTML = `
    <div class="side-sec"><div class="side-h"><span>Upcoming</span><button data-a="newsvc">+ New</button></div>
      ${sorted.filter(s => s.status !== 'done').map(one).join('')}</div>
    <div class="side-sec"><div class="side-h"><span>Recent</span></div>${sorted.filter(s => s.status === 'done').map(one).join('')}</div>
    <div class="side-spacer"></div>
    <div class="side-foot">
      <button class="navlink" data-a="stub" data-msg="Team & roles isn’t part of this mockup">${icon('users', 16)}<span>Team & roles</span></button>
      <button class="navlink" data-a="stub" data-msg="Song requests isn’t part of this mockup">${icon('sparkle', 16)}<span>Song requests</span></button>
      <div class="dbcard"><b>Slide database</b>${HYMNS.length} sample hymns · v2026.09
        <div class="meter"><i style="width:100%"></i></div><div style="margin-top:5px">Downloaded for offline use</div></div>
    </div>`;
}
function renderCrumbs() {
  const s = svc(), d = parseDate(s.date);
  $('#crumbs').innerHTML = `<span style="color:var(--muted)">Services</span>${icon('chevR', 14)}<b>${esc(s.title)}</b><span style="color:var(--muted)">· ${MONTHS[d.getMonth()]} ${d.getDate()}</span>`;
}
function renderChrome() { renderSidebar(); renderCrumbs(); }
function renderHead() {
  const s = svc(), nSongs = s.items.filter(i => i.type === 'song').length;
  $('#svcHead').innerHTML = `
    <div class="svc-title"><input id="svcTitle" value="${esc(s.title)}" aria-label="Service title" spellcheck="false"></div>
    <div class="svc-meta">
      <span>${icon('calendar', 14)} ${fmtLong(s.date)}</span>
      <span>${icon('list', 14)} ${s.items.length} items · ${nSongs} songs</span>
      ${s.theme ? `<span class="tag">Theme: ${esc(s.theme)}</span>` : ''}
      ${s.text ? `<span class="tag">${icon('scripture', 12)} ${esc(s.text)}</span>` : ''}
    </div>`;
}

/* ------------------------------ Order list ------------------------------ */
function rowHtml(it) {
  const t = ITEM_TYPES[it.type];
  const h = it.type === 'song' && it.hymn ? HYMN[it.hymn] : null;
  const empty = it.type === 'song' && !h;
  const dot = '<i class="dot"></i>';
  let title, sub;
  if (empty) {
    title = `Choose ${ROLES[it.role].label.toLowerCase()}…`;
    sub = `<span>${esc(pname(it.who) || 'No leader')}</span>${dot}<span class="warn">Search the library →</span>`;
  } else if (h) {
    const sp = startPitch(h, it.shift || 0), num = hnPick(it);
    const parts = [pname(it.who) ? esc(pname(it.who)) : '<span class="unassigned">No leader</span>', `Key ${sp.keyShifted}`, `start ${sp.name} <span style="opacity:.7">(${sp.solfege})</span>`, h.time, `${num} ${h.hn[num]}`];
    if (h.last != null && h.last < 21) parts.push(`<span class="warn">sung ${agoText(h.last).toLowerCase()}</span>`);
    title = h.title; sub = parts.join(dot);
  } else {
    title = it.title;
    const bits = [];
    bits.push(it.who ? esc(pname(it.who)) : '<span class="unassigned">Unassigned</span>');
    if (it.ref) bits.push(esc(it.ref));
    sub = bits.join(dot);
  }
  return `<div class="row ${S.sel === it.id ? 'sel' : ''} ${empty ? 'empty' : ''}" draggable="true" data-id="${it.id}" tabindex="0">
    <span class="grip">${icon('grip', 14)}</span>
    <span class="tile ${t.color}">${empty ? icon('plus', 16) : icon(it.type, 16)}</span>
    <div class="main"><div class="ttl ${h ? 'serif' : ''}">${esc(title)}</div><div class="sub">${sub}</div></div>
    <button class="kebab" data-a="kebab" aria-label="Item actions">${icon('more', 16)}</button>
  </div>`;
}
function renderCheck() {
  const list = planChecks(svc()), n = list.length;
  $('#checkDock').innerHTML = `
    <button class="check-head" data-a="check">${icon(n ? 'alert' : 'check', 15)} Plan check <span class="n ${n ? '' : 'zero'}">${n || '✓'}</span>
      <span style="flex:1"></span><span style="color:var(--muted);font-weight:500">${n ? 'suggestions' : 'All clear'}</span>${icon(S.checkOpen ? 'chevD' : 'up', 14)}</button>
    ${S.checkOpen && n ? `<div class="check-list">${list.map(c => `<button class="check-item" data-a="checkgo" data-id="${c.id || ''}"><i class="lv ${c.level}"></i><span>${esc(c.text)}</span></button>`).join('')}</div>` : ''}`;
}

/* ------------------------------ Library ------------------------------ */
function renderFilterBar() {
  const f = S.f, n = (f.key ? 1 : 0) + (f.time ? 1 : 0) + (f.meter ? 1 : 0) + (f.hymnal ? 1 : 0) + (f.pd ? 1 : 0) + (f.fresh ? 1 : 0);
  $('#filtersMore').hidden = !S.filtersOpen;
  $('#btnFilters').innerHTML = icon('sliders', 14) + ' Filters' + (n ? ` <span class="pill info">${n}</span>` : '') + icon(S.filtersOpen ? 'up' : 'down', 13);
}
function renderChips() {
  const counts = {}; HYMNS.forEach(h => h.topics.forEach(t => counts[t] = (counts[t] || 0) + 1));
  const tops = ALL_TOPICS.slice().sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  $('#topicChips').innerHTML = tops.map(t => `<button class="chip ${S.f.topics.has(t) ? 'on' : ''}" data-a="topic" data-t="${esc(t)}">${esc(t)} <span style="opacity:.6;font-size:11px">${counts[t]}</span></button>`).join('');
}
function renderCtx() {
  const s = svc(), it = selItem();
  let html = '';
  if (S.ctx && it && it.type === 'song' && !it.hymn) {
    html = `<div class="ctx-banner">${icon('sparkle', 16)}<div class="grow">Picking the <b>${esc(ROLES[it.role].label.toLowerCase())}</b> · showing hymns tagged ${S.ctx.topics.map(t => `<b>${esc(t)}</b>`).join(', ')} · least recently sung first</div><button class="btn sm" data-a="clearCtx">Show all hymns</button></div>`;
  } else if (it) {
    const label = it.type === 'song' && it.hymn ? HYMN[it.hymn].title : it.title;
    html = `<div class="ctx-banner" style="background:var(--panel);border-color:var(--line2)">${icon('plus', 16)}<div class="grow">New hymns will be added after <b style="color:var(--ink)">${esc(label)}</b></div><button class="btn sm" data-a="clearSel">Add to end instead</button></div>`;
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
  const rows = results.map(r => {
    const h = r.h;
    return `<div class="res ${h.id === S.prev ? 'on' : ''}" draggable="true" data-hymn="${h.id}" tabindex="0" role="button">
      <div class="thumb">${Notation.hymnSlide(h, 0, { mini: true })}</div>
      <div class="mid">
        <div class="t">${hl(h.title, terms)} ${inSvc.has(h.id) ? '<span class="in-svc">In service</span>' : ''}</div>
        <div class="by">${hl(h.by, terms)}</div>
        ${matchNote(r, terms)}
        <div class="meta-chips">
          <span class="mc key">${h.key}</span><span class="mc">${h.time}</span><span class="mc">${esc(h.meter.split(' ')[0])}</span>
          ${Object.entries(h.hn).slice(0, 2).map(([k, v]) => `<span class="mc">${k} ${v}</span>`).join('')}
          ${h.pd ? '' : '<span class="mc lic">Licensed</span>'}${h.pending ? '<span class="mc wait">No slides yet</span>' : ''}
        </div>
        <div class="by" style="margin-top:4px">${lastLabel(h)}</div>
      </div>
      <div class="side"><button class="add-mini" data-a="add" data-id="${h.id}" title="Add to service" aria-label="Add ${esc(h.title)} to service">${icon('plus', 16)}</button></div>
    </div>`;
  }).join('');
  const el = $('#results');
  el.classList.toggle('grid-view', S.view === 'grid');
  el.innerHTML = `<div class="res-count"><span><b style="color:var(--ink)">${results.length}</b> of ${HYMNS.length} hymns</span><span>sorted by ${sortName}</span></div>` +
    (results.length ? `<div class="res-list">${rows}</div>` :
      `<div class="empty-state"><b>No hymns match</b>Try fewer words, or clear a filter.<br><br><button class="btn sm" data-a="resetFilters">Reset filters</button></div>`);
  $$('#viewSeg button').forEach(b => { b.classList.toggle('on', b.dataset.view === S.view); });
}
function renderPreview() {
  const el = $('#preview'), h = HYMN[S.prev];
  if (!h || !lastResults.length) { el.innerHTML = `<div class="empty-state"><b>No hymn selected</b>Search or filter to preview slides.</div>`; return; }
  if (S.verse >= h.sec.length) S.verse = 0;
  const it = selItem();
  const sp = startPitch(h);
  const weeks = Array.from({ length: 52 }, (_, i) => { const w = 51 - i; return h.d.some(d => d >= w * 7 && d < w * 7 + 7); });
  let addLabel = 'Add to end of service';
  if (it && it.type === 'song' && !it.hymn) addLabel = `Use as ${ROLES[it.role].label.toLowerCase()}`;
  else if (it) addLabel = `Add after “${(it.type === 'song' && it.hymn ? HYMN[it.hymn].title : it.title).slice(0, 26)}”`;
  const already = svc().items.some(i => i.hymn === h.id);
  el.innerHTML = `
    <div class="slide-frame">${Notation.hymnSlide(h, S.verse)}
      <button class="slide-nav l" data-a="vnav" data-d="-1" aria-label="Previous slide">${icon('chevL', 16)}</button>
      <button class="slide-nav r" data-a="vnav" data-d="1" aria-label="Next slide">${icon('chevR', 16)}</button></div>
    <div class="verse-pills"><span class="lbl">Slides</span>${h.sec.map((s, i) => `<button class="vp ${i === S.verse ? 'on' : ''}" data-a="verse" data-v="${i}">${/^\d+$/.test(s[0]) ? s[0] : esc(s[0])}</button>`).join('')}</div>
    <div class="p-title">${esc(h.title)}</div>
    <div class="p-first">“${esc(h.first)}…”</div>
    <div class="p-credit">Words: ${esc(h.by)}<br>Music: ${esc(h.music)}</div>
    <div class="facts">
      <div class="fact pitch"><div><small>Start pitch · a cappella</small><b>${sp.name}</b> <span class="sub">(${sp.solfege}) · Key of ${h.key}</span></div>
        <button class="play" data-a="pitch" data-id="${h.id}" title="Play starting pitch" aria-label="Play starting pitch">${icon('volume', 16)}</button></div>
      <div class="fact"><small>Time</small><b>${h.time}</b><div class="sub">${esc(h.tempo)}</div></div>
      <div class="fact" style="grid-column: span 2"><small>Meter</small><b style="font-size:14px">${esc(h.meter)}</b><div class="sub">Tune: ${esc(h.tune)}</div></div>
      <div class="fact"><small>Slides</small><b>${h.slides}</b><div class="sub">16:9 · .pptx</div></div>
    </div>
    <div class="blk"><div class="blk-h">Hymnals</div><div class="tags">${Object.entries(h.hn).map(([k, v]) => `<span class="tagc hn" title="${esc(HYMNALS[k])}">${k}<b>${v}</b></span>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Scripture</div><div class="tags">${h.scr.map(x => `<button class="tagc scr" data-a="searchq" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Topics</div><div class="tags">${h.topics.map(x => `<button class="tagc" data-a="topicOnly" data-t="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Congregation history <span style="text-transform:none;letter-spacing:0;font-weight:500">${h.cnt}× in 12 months</span></div>
      <div class="usage"><div class="spark">${weeks.map(o => `<i class="${o ? 'on' : ''}"></i>`).join('')}</div>
      <div class="spark-legend"><span>12 months ago</span><span>${h.d.length ? 'Last: ' + h.d.slice().sort((a, b) => a - b).slice(0, 3).map(fmtSung).join(', ') : 'Never sung'}</span><span>Today</span></div></div></div>
    <div class="blk"><div class="blk-h">License</div><div class="license">${h.pd ? `<span class="pill ok">Public domain</span> No reporting required` : `<span class="pill warn">Licensed</span> ${esc(h.lic)}`}</div></div>
    <div class="actions">
      <button class="btn primary" data-a="add" data-id="${h.id}">${icon('plus', 16)} ${esc(addLabel)}</button>
      ${h.pending ? `<button class="btn" data-a="stub" data-msg="Slide pack requested from the slide library team">Request slides</button>` : `<button class="btn" data-a="stub" data-msg="Slide pack copied — paste into PowerPoint or Keynote">${icon('copy', 15)} Copy slides</button>`}
    </div>
    ${already ? `<div style="text-align:center;margin-top:16px;font-size:12px;color:var(--ok)">Already in this service</div>` : ''}`;
}

/* ------------------------------ Item editor ------------------------------ */
function personSelect(field, cur, type) {
  const role = ROLE_FOR[type];
  const o = p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`;
  const sug = PEOPLE.filter(p => p.roles.includes(role)), rest = PEOPLE.filter(p => !p.roles.includes(role));
  return `<select data-f="${field}"><option value="">— Unassigned —</option>${sug.length ? `<optgroup label="Suggested for this role">${sug.map(o).join('')}</optgroup>` : ''}<optgroup label="Everyone">${rest.map(o).join('')}</optgroup></select>`;
}
function renderItem() {
  const el = $('#paneItem'), it = selItem();
  if (!it) { el.innerHTML = `<div class="empty-state"><b>Nothing selected</b>Pick an item in the order of service to edit its details.</div>`; return; }
  const t = ITEM_TYPES[it.type], isSong = it.type === 'song', h = isSong && it.hymn ? HYMN[it.hymn] : null;
  const head = `<div class="item-h"><span class="tile ${t.color}">${icon(it.type, 20)}</span><div><h2>${esc(h ? h.title : isSong ? ROLES[it.role].label : it.title)}</h2><div class="sub">${t.label}${isSong ? ' · ' + ROLES[it.role].label.toLowerCase() : ''}</div></div>
    <span style="flex:1"></span><button class="btn sm" data-a="addAfter">${icon('plus', 14)} Add hymns after this</button><button class="btn sm danger" data-a="remove">${icon('trash', 14)} Remove</button></div>`;
  let body = '';
  if (isSong) {
    const roleSel = `<div class="fld"><label>Purpose</label><select data-f="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${it.role === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>`;
    if (!h) {
      body = `<div class="card" style="border-style:dashed;text-align:center;padding:26px"><b style="font-size:15px">No hymn chosen yet</b><div class="sub" style="color:var(--muted);margin:4px 0 12px">Search ${HYMNS.length} hymns with ready-made slides, filtered for this purpose.</div><button class="btn primary" data-a="viewlib">${icon('search', 15)} Search the library</button></div>
        <div class="form-2"><div class="fld"><label>Song leader</label>${personSelect('who', it.who, 'song')}</div>${roleSel}</div>`;
    } else {
      const sp = startPitch(h, it.shift || 0), base = startPitch(h);
      const shifts = [-3, -2, -1, 0, 1, 2, 3].map(n => `<option value="${n}" ${n === (it.shift || 0) ? 'selected' : ''}>${n === 0 ? `As printed — key of ${h.key}` : `${n > 0 ? '↑' : '↓'} ${Math.abs(n)} half step${Math.abs(n) > 1 ? 's' : ''} — key of ${shiftedKey(h.key, n)}`}</option>`).join('');
      const nSel = it.verses.length;
      body = `
        <div class="card hymn-card">
          <div><div class="thumb">${Notation.hymnSlide(h, it.verses[0] ?? 0, { mini: true })}</div></div>
          <div><div class="t">${esc(h.title)}</div><div class="p-credit">${esc(h.by)} · ${esc(h.tune)}</div>
            <div class="meta-chips"><span class="mc key">${h.key}</span><span class="mc">${h.time}</span><span class="mc">${esc(h.meter)}</span>${Object.entries(h.hn).map(([k, v]) => `<span class="mc">${k} ${v}</span>`).join('')}</div>
            <div style="margin-top:12px;display:flex;gap:8px"><button class="btn sm" data-a="replace">${icon('swap', 14)} Replace hymn</button><button class="btn sm" data-a="viewlib">View in library</button></div></div>
        </div>
        <div class="fld"><label>Slides to show</label>
          <div class="sect-pills">${h.sec.map((s, i) => `<button class="sp ${it.verses.includes(i) ? 'on' : ''}" data-a="sect" data-i="${i}">${it.verses.includes(i) ? icon('check', 13) : ''}${esc(SECTION_LABEL(s[0]))}</button>`).join('')}</div>
          <div class="help">${nSel} of ${h.sec.length} slides included in the deck. Order follows the printed hymn.</div></div>
        <div class="fld"><label>Starting pitch</label>
          <div class="pitch-box"><div class="big">${sp.name}</div>
            <div class="txt"><b>Start on ${sp.name} (${sp.solfege})</b> — ${it.shift ? `${sp.keyShifted} shown to the leader; slides still print in ${h.key}` : `printed key of ${h.key}`}.<br>
            <select data-f="shift" style="margin-top:6px;height:28px;border:1px solid var(--line2);border-radius:7px;background:var(--panel);font-size:12.5px;padding:0 6px">${shifts}</select></div>
            <button class="play" data-a="pitch" data-id="${h.id}" data-shift="${it.shift || 0}" title="Play pitch">${icon('volume', 16)}</button></div>
          <div class="help">Song leaders get the start pitch on the mobile app’s Leader view.</div></div>
        <div class="form-2"><div class="fld"><label>Song leader</label>${personSelect('who', it.who, 'song')}</div>
          <div class="fld"><label>Announce as</label><select data-f="hnPick">${Object.entries(h.hn).map(([k, v]) => `<option value="${k}" ${hnPick(it) === k ? 'selected' : ''}>${k} #${v} — ${esc(HYMNALS[k])}</option>`).join('')}</select></div></div>
        <div class="form-2">${roleSel}<div></div></div>`;
    }
  } else {
    const showRef = ['scripture', 'supper', 'sermon', 'custom'].includes(it.type);
    body = `<div class="form-2"><div class="fld" style="grid-column: span 2"><label>Title</label><input type="text" data-f="title" value="${esc(it.title)}"></div></div>
      <div class="form-2"><div class="fld"><label>${it.type === 'sermon' ? 'Speaker' : it.type === 'scripture' ? 'Reader' : 'Assigned to'}</label>${personSelect('who', it.who, it.type)}</div><div></div></div>
      ${showRef ? `<div class="fld"><label>Scripture reference</label><input type="text" data-f="ref" value="${esc(it.ref || '')}" placeholder="e.g. Ephesians 2:1–10"><div class="help">Shown on the slide with the text from your default version (Settings → Bible version).</div></div>` : ''}
      ${it.type === 'supper' || it.type === 'give' ? `<div class="fld"><label>${it.type === 'supper' ? 'Servers' : 'Collectors'}</label><div class="people-chips">${PEOPLE.filter(p => p.roles.some(r => ['table', 'give', 'elder'].includes(r))).map(p => `<button class="sp ${(it.helpers || []).includes(p.id) ? 'on' : ''}" data-a="helper" data-id="${p.id}">${(it.helpers || []).includes(p.id) ? icon('check', 13) : ''}${esc(p.name)}</button>`).join('')}</div></div>` : ''}
      ${it.type === 'sermon' ? `<div class="fld"><label>Slides</label>${it.attached ? `<span class="pill ok">${icon('file', 12)} ${esc(it.attached)}</span>` : `<button class="btn sm" data-a="attach">${icon('plus', 14)} Attach PowerPoint…</button>`}<div class="help">Attached decks are merged after the hymn slides when you export.</div></div>` : ''}
      <div class="fld"><label>${NOTES_LABEL[it.type]}</label><textarea data-f="notes" placeholder="Optional">${esc(it.notes || '')}</textarea></div>`;
  }
  if (isSong && h) body += `<div class="fld"><label>${NOTES_LABEL.song}</label><textarea data-f="notes" placeholder="e.g. Start softly, build in verse 2">${esc(it.notes || '')}</textarea></div>`;
  else if (isSong) body += `<div class="fld"><label>${NOTES_LABEL.song}</label><textarea data-f="notes">${esc(it.notes || '')}</textarea></div>`;
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
  $('#paneDeck').innerHTML = `<div class="deck-wrap"><div class="deck-h"><h2>${slides.length} slides</h2><span class="pill">${esc(s.title)}</span><span style="flex:1"></span>
    <button class="btn" data-a="export">${icon('download', 15)} Export .pptx</button><button class="btn primary" data-a="present">${icon('present', 15)} Present</button></div>
    <div class="deck-grid">${grid}</div></div>`;
}
