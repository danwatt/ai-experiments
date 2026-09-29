'use strict';
/* Selah — mobile companion mockup. Metadata only: no sheet-music slides here. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const M = {
  tab: 'plan', svc: 's1', edit: false,
  q: '', topic: '', sort: 'relevance', ctx: null, added: new Set(),
  sheet: null, live: { idx: 0, run: false, t: 0 },
  confirmed: new Set(['s1:dbrooks:song']), declined: new Set(),
  notif: { assign: true, changes: true, reminders: false }
};
const cur = () => SERVICES.find(s => s.id === M.svc);
const pname = id => (id ? PERSON[id].name : null);
const hnPick = it => { const h = HYMN[it.hymn]; return it.hnPick && h.hn[it.hnPick] ? it.hnPick : Object.keys(h.hn)[0]; };
const SHORT = { s1: 'Sun AM', s2: 'Sun PM', s3: 'Wed' };

function toast(msg, ic = 'check') {
  const t = $('#mtoast'); t.innerHTML = icon(ic, 18) + `<span>${esc(msg)}</span>`; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ------------------------------ Plan ------------------------------ */
function songSub(it) {
  const h = HYMN[it.hymn], sp = startPitch(h, it.shift || 0), num = hnPick(it);
  return `<div class="mchips"><span class="ch key">Key ${sp.keyShifted}</span><span class="ch">Start ${sp.name} (${sp.solfege})</span><span class="ch">${num} ${h.hn[num]}</span>${h.last != null && h.last < 21 ? `<span class="ch warn">Sung ${agoText(h.last).toLowerCase()}</span>` : ''}</div>`;
}
function planView() {
  const s = cur(), tot = s.items.reduce((a, i) => a + i.dur, 0), open = s.items.filter(i => i.type === 'song' && !i.hymn);
  const d = parseDate(s.date);
  let t = toMin(s.time), prev = null, rows = '';
  const flush = () => { if (rows) out += `<div class="mlist">${rows}</div>`; rows = ''; };
  let out = '';
  s.items.forEach((it, idx) => {
    if (it.section !== prev) { flush(); out += `<div class="msec">${esc(it.section)}</div>`; prev = it.section; }
    const h = it.type === 'song' && it.hymn ? HYMN[it.hymn] : null, empty = it.type === 'song' && !h;
    const title = h ? h.title : empty ? `Choose ${ROLES[it.role].label.toLowerCase()}` : it.title;
    const sub = h ? `${esc(pname(it.who) || 'No leader')} · ${it.dur} min` : empty ? `<span style="color:var(--warn);font-weight:650">Tap to find a hymn</span>` : `${esc(pname(it.who) || 'Unassigned')}${it.ref ? ' · ' + esc(it.ref) : ''} · ${it.dur} min`;
    rows += `<button class="mrow ${empty ? 'open' : ''}" data-a="${empty ? 'fill' : 'item'}" data-id="${it.id}">
      <span class="mt">${fmtClock(t)}</span>
      <span class="mtile ${empty ? 'empty' : ITEM_TYPES[it.type].color}">${icon(empty ? 'plus' : it.type, 18)}</span>
      <span><div class="mtl ${h ? 'serif' : ''}">${esc(title)}</div><div class="msub">${sub}</div>${h ? songSub(it) : ''}</span>
      ${M.edit ? `<span class="edit-ctl"><button data-a="up" data-id="${it.id}" aria-label="Move up">${icon('up', 14)}</button><button data-a="down" data-id="${it.id}" aria-label="Move down">${icon('down', 14)}</button></span>` : `<span class="go">${icon('chevR', 16)}</span>`}
    </button>`;
    t += it.dur;
  });
  flush();
  const segs = s.items.map(i => `<i class="${ITEM_TYPES[i.type].color}" style="flex:${i.dur}"></i>`).join('');
  return `
    <div class="h-large"><div><h1>${DAYS[d.getDay()] === 'Sunday' ? 'Sunday' : DAYS[d.getDay()]}${s.kind.includes('Morning') ? ' morning' : s.kind.includes('Evening') && d.getDay() === 0 ? ' evening' : ''}</h1><div class="sub">${MONTHS[d.getMonth()]} ${d.getDate()} · ${fmtClockAP(toMin(s.time))} – ${fmtClockAP(toMin(s.time) + tot)}</div></div>
      <button class="ibtn ${M.edit ? 'on' : ''}" data-a="edit">${M.edit ? 'Done' : 'Edit'}</button></div>
    <div class="seg">${['s1', 's2', 's3'].map(id => `<button class="${M.svc === id ? 'on' : ''}" data-a="svc" data-id="${id}">${SHORT[id]}</button>`).join('')}</div>
    ${open.length ? `<button class="banner" data-a="fill" data-id="${open[0].id}">${icon('alert', 20)}<span><b>${open.length} song slot${open.length > 1 ? 's' : ''} still open.</b> Find a hymn</span>${icon('chevR', 16)}</button>` : ''}
    <div class="card" style="margin-bottom:4px;padding:12px 14px"><div style="display:flex;justify-content:space-between;font-size:13px;color:var(--ink2)"><span><b style="color:var(--ink)">${tot} min</b> planned</span><span>${s.target - tot >= 0 ? `${s.target - tot} min open` : `${tot - s.target} over`}</span></div><div class="budget">${segs}</div></div>
    ${out}
    <button class="fab" data-a="tab" data-t="hymns" aria-label="Add hymn">${icon('plus', 26)}</button>`;
}

/* ------------------------------ Hymns ------------------------------ */
function hymnsView() {
  const f = { topics: new Set(M.topic ? [M.topic] : []), key: '', time: '', meter: '', hymnal: '', pd: false, fresh: false };
  const { results, terms } = searchHymns({ q: M.q, f, sort: M.q.trim() ? 'relevance' : M.sort === 'relevance' ? 'title' : M.sort, ctx: M.ctx });
  const topics = ['Communion', 'Invitation', 'Praise', 'Grace', 'Cross', 'Trust', 'Christmas', 'Assurance', 'Commitment', 'Comfort', 'Baptism', 'Church', 'Thanksgiving'];
  const inSvc = new Set(cur().items.filter(i => i.hymn).map(i => i.hymn));
  const cards = results.map(r => {
    const h = r.h; let note = '';
    if (r.snippet) note = `<div class="snip">“${hl(r.snippet, terms)}”</div>`;
    else if (r.where.includes('scripture')) note = `<div class="snip">${hl(h.scr.join(', '), terms)}</div>`;
    else if (r.where.includes('hymnal #')) note = `<div class="snip">${Object.entries(h.hn).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>`;
    const done = inSvc.has(h.id);
    return `<button class="hcard" data-a="hymn" data-id="${h.id}"><div>
      <div class="t">${hl(h.title, terms)}</div><div class="by">${hl(h.by, terms)}</div>${note}
      <div class="mchips"><span class="ch key">${h.key}</span><span class="ch">${h.time}</span><span class="ch">${esc(h.meter.split(' ')[0])}</span>${Object.entries(h.hn).slice(0, 2).map(([k, v]) => `<span class="ch">${k} ${v}</span>`).join('')}${h.pd ? '' : '<span class="ch lic">Licensed</span>'}</div>
      <div class="last ${freshness(h)}">${h.last == null ? 'Never sung' : 'Sung ' + agoText(h.last).toLowerCase()}</div></div>
      <span class="addb ${done ? 'done' : ''}" data-a="add" data-id="${h.id}" role="button" aria-label="Add">${icon(done ? 'check' : 'plus', 18)}</span></button>`;
  }).join('');
  return `
    <div class="h-large"><div><h1>Hymns</h1><div class="sub">${HYMNS.length} hymns · works offline</div></div></div>
    <div class="search"><div class="sbox">${icon('search', 18)}<input id="mq" type="search" value="${esc(M.q)}" placeholder="Title, lyric, scripture, or # (try SFP 236)" autocomplete="off"></div>
      <div class="chips">${topics.map(t => `<button class="chip ${M.topic === t ? 'on' : ''}" data-a="topic" data-t="${t}">${t}</button>`).join('')}</div></div>
    ${M.ctx ? `<div class="ctxb"><span>Picking the <b>${esc(M.ctx.label.toLowerCase())}</b> · ${M.ctx.topics.join(', ')}</span><button data-a="clearCtx">Clear</button></div>` : ''}
    <div class="rcount"><span>${results.length} hymns</span><button data-a="sort">${M.sort === 'stale' ? 'Longest since sung' : M.sort === 'recent' ? 'Recently sung' : 'A–Z'} ▾</button></div>
    <div id="hlist">${cards || `<div class="empty"><b>No hymns match</b>Try fewer words.</div>`}</div>`;
}

function hymnSheet(id, itemId) {
  const h = HYMN[id], sp = startPitch(h), it = itemId ? cur().items.find(i => i.id === itemId) : null;
  const weeks = Array.from({ length: 52 }, (_, i) => { const w = 51 - i; return h.d.some(d => d >= w * 7 && d < w * 7 + 7); });
  const v1 = h.pd && h.sec[0][1] ? h.sec[0][1].join('\n') : null;
  const spx = it ? startPitch(h, it.shift || 0) : sp;
  return `<div class="grab"></div>
    <div class="sh-h"><div><h2>${esc(h.title)}</h2><div class="p-first">“${esc(h.first)}…”</div><div class="p-credit">${esc(h.by)}</div></div><button class="sh-x" data-a="closeSheet" aria-label="Close">${icon('x', 16)}</button></div>
    ${it ? `<div class="card" style="margin-top:12px;padding:10px 14px;font-size:14px"><b>${esc(ITEM_TYPES.song.label)}</b> · ${esc(pname(it.who) || 'No leader')} · ${it.dur} min${it.notes ? `<div style="color:var(--muted);margin-top:3px">“${esc(it.notes)}”</div>` : ''}</div>` : ''}
    <div class="pitch"><div class="big">${spx.name}</div><div class="txt"><b>Start on ${spx.name} (${spx.solfege})</b>Key of ${spx.keyShifted} · a cappella</div><button class="play" data-a="pitch" data-id="${h.id}" data-shift="${it ? it.shift || 0 : 0}" aria-label="Play pitch">${icon('volume', 22)}</button></div>
    <div class="grid3"><div class="fact"><small>Time</small><b>${h.time}</b><div class="s">${esc(h.tempo.split(',')[0])}</div></div><div class="fact"><small>Meter</small><b style="font-size:13px">${esc(h.meter.split(' ')[0])}</b><div class="s">${esc(h.tune)}</div></div><div class="fact"><small>Slides</small><b>${h.slides}</b><div class="s">on desktop</div></div></div>
    <div class="blk"><div class="blk-h">Announce as</div><div class="tags">${Object.entries(h.hn).map(([k, v]) => `<span class="tagc" title="${esc(HYMNALS[k])}"><b style="color:var(--ink)">${k}</b> ${v}</span>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Scripture</div><div class="tags">${h.scr.map(x => `<span class="tagc scr">${esc(x)}</span>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Topics</div><div class="tags">${h.topics.map(x => `<span class="tagc">${esc(x)}</span>`).join('')}</div></div>
    <div class="blk"><div class="blk-h">Congregation history · ${h.cnt}× in 12 months</div><div class="spark">${weeks.map(o => `<i class="${o ? 'on' : ''}"></i>`).join('')}</div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:4px"><span>12 mo ago</span><span>${h.last == null ? 'Never sung' : 'Last: ' + agoText(h.last).toLowerCase()}</span><span>Today</span></div></div>
    <div class="blk"><div class="blk-h">Lyrics</div>${v1 ? `<div class="lyr"><small>Verse 1 · public domain</small>${esc(v1).replace(/\n/g, '<br>')}</div>` : `<div class="lyr" style="color:var(--muted)"><small>Licensed</small>Lyrics aren’t stored on the phone. ${esc(h.lic || '')}</div>`}</div>
    <div class="blk"><div class="locked"><span class="lk">${icon('lock', 20)}</span><div><b>Sheet-music slides</b>${h.pending ? 'No slide pack yet — request one from the desktop app.' : `${h.slides} slides are ready in the desktop app. Present or export from there.`}</div></div></div>
    ${it ? `<button class="cta sec" data-a="swapHymn" data-id="${it.id}">${icon('swap', 18)} Swap for another hymn</button>` : `<button class="cta" data-a="add" data-id="${h.id}">${icon('plus', 18)} Add to ${SHORT[M.svc] === 'Wed' ? 'Wednesday' : 'Sunday ' + (M.svc === 's2' ? 'evening' : 'morning')}</button>`}`;
}
function itemSheet(id) {
  const it = cur().items.find(i => i.id === id);
  if (it.type === 'song' && it.hymn) return hymnSheet(it.hymn, id);
  return `<div class="grab"></div>
    <div class="sh-h"><div style="display:flex;gap:12px;align-items:center"><span class="mtile ${ITEM_TYPES[it.type].color}" style="width:44px;height:44px">${icon(it.type, 22)}</span><div><h2 style="font-size:23px">${esc(it.title)}</h2><div class="p-credit">${ITEM_TYPES[it.type].label}</div></div></div><button class="sh-x" data-a="closeSheet">${icon('x', 16)}</button></div>
    <dl class="kv" style="margin-top:18px"><dt>${it.type === 'sermon' ? 'Speaker' : 'Assigned to'}</dt><dd>${esc(pname(it.who) || 'Unassigned')}</dd>${it.ref ? `<dt>Scripture</dt><dd>${esc(it.ref)}</dd>` : ''}<dt>Duration</dt><dd>${it.dur} min</dd>${it.notes ? `<dt>Notes</dt><dd>${esc(it.notes)}</dd>` : ''}</dl>
    ${it.who ? '' : `<button class="cta">${icon('person', 18)} Assign someone</button>`}`;
}

/* ------------------------------ Live ------------------------------ */
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function liveView() {
  const s = cur(), L = M.live;
  L.idx = Math.max(0, Math.min(L.idx, s.items.length - 1));
  const it = s.items[L.idx], nx = s.items[L.idx + 1];
  const plannedSec = s.items.slice(0, L.idx).reduce((a, i) => a + i.dur, 0) * 60;
  const drift = L.t - plannedSec, late = drift > 30;
  const h = it.type === 'song' && it.hymn ? HYMN[it.hymn] : null, sp = h ? startPitch(h, it.shift || 0) : null;
  let t = toMin(s.time);
  const list = s.items.map((x, i) => { const r = `<div class="up ${i < L.idx ? 'done' : ''} ${i === L.idx ? 'cur' : ''}" data-a="jump" data-i="${i}"><span class="t">${fmtClock(t)}</span><span><div class="n">${esc(x.type === 'song' && x.hymn ? HYMN[x.hymn].title : x.title)}</div><div class="s">${esc(pname(x.who) || '—')}</div></span><span class="ch">${x.dur}m</span></div>`; t += x.dur; return r; }).join('');
  return `<div class="live">
    <div class="h-large"><div><h1>Leader view</h1><div class="sub">${esc(s.title)} · ${fmtClockAP(toMin(s.time))}</div></div><div style="text-align:right"><div class="clock">${mmss(L.t)}</div><div class="drift ${late ? 'late' : ''}">${L.run ? (Math.abs(drift) < 30 ? 'On plan' : drift > 0 ? `${mmss(drift)} behind` : `${mmss(-drift)} ahead`) : L.t ? 'Paused' : 'Not started'}</div></div></div>
    <button class="start-btn ${L.run ? 'stop' : ''}" data-a="run">${L.run ? 'Pause timer' : L.t ? 'Resume timer' : 'Start service'}</button>
    <div class="now"><div class="lab"><span>Now · ${L.idx + 1} of ${s.items.length}</span><span>${it.dur} min</span></div>
      <h2>${esc(h ? h.title : it.title)}</h2><div class="who">${esc(pname(it.who) || 'Unassigned')}${it.ref ? ' · ' + esc(it.ref) : ''}</div>
      ${h ? `<div class="num"><div><small>Start pitch</small><b>${sp.name}</b><div class="s">${sp.solfege} · key of ${sp.keyShifted}</div></div><div><small>Announce</small><b>${hnPick(it)} ${h.hn[hnPick(it)]}</b><div class="s">${it.verses.length} verse/refrain slide${it.verses.length === 1 ? '' : 's'}</div></div></div>
        <div class="row2"><button class="play2" data-a="pitch" data-id="${h.id}" data-shift="${it.shift || 0}">${icon('volume', 17)} Play pitch</button><button class="sec2" data-a="hymn" data-id="${h.id}">Details</button></div>` : ''}
      ${it.type === 'song' && !it.hymn ? `<div class="note">No hymn chosen yet — pick one from the Hymns tab.</div>` : ''}
      ${it.notes ? `<div class="note">${esc(it.notes)}</div>` : ''}
    </div>
    <div class="nav2"><button data-a="prev">‹ Back</button><button class="go" data-a="next">${nx ? `Next: ${esc((nx.type === 'song' && nx.hymn ? HYMN[nx.hymn].title : nx.title).slice(0, 22))} ›` : 'End of service'}</button></div>
    <div class="msec" style="color:var(--muted)">Order</div>${list}</div>`;
}

/* ------------------------------ Me ------------------------------ */
function meView() {
  const mine = [];
  SERVICES.filter(s => s.status !== 'done').forEach(s => {
    const its = s.items.filter(i => i.who === ME);
    const songs = its.filter(i => i.type === 'song'); const others = its.filter(i => i.type !== 'song');
    if (songs.length) mine.push({ key: `${s.id}:${ME}:song`, s, label: 'Song leader', detail: `${songs.length} songs${songs.some(i => !i.hymn) ? ' · some slots open' : ''}` });
    others.forEach(o => mine.push({ key: `${s.id}:${o.id}`, s, label: o.title, detail: o.ref || '' }));
  });
  if (!mine.some(m => m.s.id === 's3')) mine.push({ key: 's3:extra', s: SERVICES.find(x => x.id === 's3'), label: 'Song leader', detail: 'Pending — 2 songs' });
  const rows = mine.map(m => {
    const d = parseDate(m.s.date), ok = M.confirmed.has(m.key), no = M.declined.has(m.key);
    return `<div class="assn"><div class="a1"><b>${esc(m.label)}</b>${ok ? '<span class="pill ok">Confirmed</span>' : no ? '<span class="pill bad">Declined</span>' : '<span class="pill warn">Needs reply</span>'}</div>
      <div class="a2">${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${fmtClockAP(toMin(m.s.time))}${m.detail ? ' · ' + esc(m.detail) : ''}</div>
      ${!ok && !no ? `<div class="btns"><button data-a="decline" data-k="${m.key}">Can’t make it</button><button class="yes" data-a="accept" data-k="${m.key}">Accept</button></div>` : ''}</div>`;
  }).join('');
  const tg = (k, l, s) => `<div class="setrow"><div>${l}<small>${s}</small></div><button class="tgl ${M.notif[k] ? 'on' : ''}" data-a="tgl" data-k="${k}" aria-label="${l}"></button></div>`;
  return `
    <div class="h-large"><div><h1>Me</h1><div class="sub">Trinity Road Church of Christ</div></div></div>
    <div class="card who-card"><div class="avatar">DB</div><div><b>David Brooks</b><span>Song leader · Prayer · Reader</span></div></div>
    <div class="msec">My assignments</div><div class="mlist">${rows}</div>
    <div class="msec">Notifications</div><div class="mlist">${tg('assign', 'New assignments', 'When you’re added to a service')}${tg('changes', 'Plan changes', 'Order or hymn changes for your items')}${tg('reminders', 'Saturday reminder', 'Evening before you serve')}</div>
    <div class="msec">Data</div><div class="mlist"><div class="setrow"><div>Hymn database<small>${HYMNS.length} hymns · v2026.09 · offline</small></div><span class="pill ok">Up to date</span></div>
      <div class="setrow"><div>Sheet-music slides<small>Desktop app only</small></div>${icon('lock', 18)}</div></div>
    <button class="cta sec" data-a="sync" style="margin-top:14px">${icon('cloud', 18)} Sync now</button>`;
}

/* ------------------------------ Rendering ------------------------------ */
function render() {
  const v = $('#view');
  const y = v.scrollTop;
  v.innerHTML = { plan: planView, hymns: hymnsView, live: liveView, me: meView }[M.tab]();
  if (M.tab !== 'hymns') v.scrollTop = y;
  const open = cur().items.filter(i => i.type === 'song' && !i.hymn).length;
  const tabs = [['plan', 'Plan', 'calendar'], ['hymns', 'Hymns', 'library'], ['live', 'Live', 'radio'], ['me', 'Me', 'person']];
  $('#tabbar').innerHTML = tabs.map(([k, l, ic]) => `<button data-a="tab" data-t="${k}" aria-selected="${M.tab === k}">${icon(ic, 24)}<span>${l}</span>${k === 'plan' && open ? `<i class="badge">${open}</i>` : ''}</button>`).join('');
  const sh = $('#sheetWrap');
  if (M.sheet) { sh.hidden = false; $('#sheet').innerHTML = M.sheet.type === 'hymn' ? hymnSheet(M.sheet.id) : itemSheet(M.sheet.id); } else sh.hidden = true;
  $('.screen').classList.toggle('live-mode', M.tab === 'live');
  $('#sysIcons').innerHTML = `${icon('radio', 16)}${icon('cloud', 16)}<svg width="26" height="13" viewBox="0 0 26 13"><rect x=".5" y=".5" width="22" height="12" rx="3.500" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor"/><rect x="23.500" y="4" width="2" height="5" rx="1" fill="currentColor" opacity=".5"/></svg>`;
}
function fitPhone() {
  if (innerWidth <= 720) { $('#phoneWrap').style.setProperty('--s', 1); return; }
  const s = Math.min(1, (innerHeight - 24) / 868, (innerWidth - 40) / 414);
  $('#phoneWrap').style.setProperty('--s', Math.max(.5, s).toFixed(3));
}

function addHymn(id) {
  const s = cur(), h = HYMN[id];
  if (s.items.some(i => i.hymn === id)) { toast(`“${h.title}” is already in this service`, 'alert'); return; }
  const open = s.items.filter(i => i.type === 'song' && !i.hymn);
  const slot = open.find(i => ROLES[i.role].topics.some(t => h.topics.includes(t))) || open[0];
  if (slot) { slot.hymn = id; slot.title = h.title; slot.verses = h.sec.map((_, i) => i); toast(`“${h.title}” → ${ROLES[slot.role].label.toLowerCase()}`); }
  else {
    const last = s.items[s.items.length - 1];
    s.items.splice(s.items.length - 1, 0, { id: nid(), type: 'song', title: h.title, dur: 3, who: ME, hymn: id, role: 'general', verses: h.sec.map((_, i) => i), shift: 0, section: last.section });
    toast(`Added “${h.title}” before the closing prayer`);
  }
  if (h.last != null && h.last < 21) setTimeout(() => toast(`Heads up: sung ${agoText(h.last).toLowerCase()}`, 'alert'), 1400);
  M.sheet = null; M.ctx = null; render();
}
function move(id, d) { const a = cur().items, i = a.findIndex(x => x.id === id), j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; render(); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const d = el.dataset;
  switch (d.a) {
    case 'tab': M.tab = d.t; M.sheet = null; if (d.t === 'hymns' && !M.ctx) { /* keep */ } render(); $('#view').scrollTop = 0; break;
    case 'svc': M.svc = d.id; M.live.idx = 0; render(); break;
    case 'edit': M.edit = !M.edit; render(); break;
    case 'item': if (!M.edit) { const it = cur().items.find(i => i.id === d.id); M.sheet = { type: 'item', id: d.id }; render(); } break;
    case 'fill': { const it = cur().items.find(i => i.id === d.id); M.ctx = ROLES[it.role]; M.tab = 'hymns'; M.q = ''; M.topic = ''; render(); $('#view').scrollTop = 0; break; }
    case 'up': move(d.id, -1); break; case 'down': move(d.id, 1); break;
    case 'hymn': e.stopPropagation(); if (e.target.closest('.addb')) { addHymn(d.id); break; } M.sheet = { type: 'hymn', id: d.id }; render(); break;
    case 'add': e.stopPropagation(); addHymn(d.id); break;
    case 'swapHymn': { const it = cur().items.find(i => i.id === d.id); it.hymn = null; it.verses = []; M.ctx = ROLES[it.role]; M.sheet = null; M.tab = 'hymns'; render(); break; }
    case 'closeSheet': M.sheet = null; render(); break;
    case 'topic': M.topic = M.topic === d.t ? '' : d.t; render(); $('#view').scrollTop = 0; break;
    case 'clearCtx': M.ctx = null; render(); break;
    case 'sort': M.sort = M.sort === 'title' || M.sort === 'relevance' ? 'stale' : M.sort === 'stale' ? 'recent' : 'title'; render(); break;
    case 'pitch': { const h = HYMN[d.id], sp = startPitch(h, +(d.shift || 0)); playPitch(sp.freq); toast(`Playing ${sp.name} (${sp.solfege})`, 'volume'); break; }
    case 'run': M.live.run = !M.live.run; render(); break;
    case 'next': M.live.idx++; render(); break; case 'prev': M.live.idx--; render(); break;
    case 'jump': M.live.idx = +d.i; render(); break;
    case 'accept': M.confirmed.add(d.k); M.declined.delete(d.k); toast('Confirmed — thanks!'); render(); break;
    case 'decline': M.declined.add(d.k); toast('Declined — the planner was notified', 'alert'); render(); break;
    case 'tgl': M.notif[d.k] = !M.notif[d.k]; render(); break;
    case 'sync': toast('Hymn database is up to date · v2026.09', 'cloud'); break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'mq') return;
  M.q = e.target.value;
  const pos = e.target.selectionStart, v = $('#view'), top = v.scrollTop;
  render(); const i = $('#mq'); i.focus(); i.setSelectionRange(pos, pos); v.scrollTop = top;
});
$('#themeBtn').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('selah-theme', t); } catch (_) {} });
setInterval(() => { if (M.live.run) { M.live.t++; if (M.tab === 'live' && !M.sheet) { const v = $('#view'), y = v.scrollTop; render(); v.scrollTop = y; } } }, 1000);
addEventListener('resize', fitPhone);
fitPhone(); render();
