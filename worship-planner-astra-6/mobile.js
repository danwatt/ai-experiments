'use strict';

Object.assign(MOBILE_ICONS, {
  live:'<path d="M3 12h3l3-7 5 14 3-7h4"/>',
  volume:'<path d="M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="1"/>',
  list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1"/>',
  up:'<path d="m7 14 5-5 5 5"/>'
});
const $=selector=>document.querySelector(selector);
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${MOBILE_ICONS[name]||MOBILE_ICONS.text}</svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hymn=id=>MOBILE_HYMNS.find(h=>h.id===Number(id));
const notes=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const types={hymn:'Hymn',prayer:'Prayer',scripture:'Scripture reading',communion:'The Lord’s Supper',sermon:'Sermon',text:'Announcements'};
const people=['James Wilson','David Miller','Robert Ellis','Michael Adams','Daniel Parker'];
const storageKey='gather-mobile-v1';
const initial={
  version:1, activeService:'morning', saved:[1,4,6], octave:4, volume:25, pitchOverrides:{}, live:null,
  services:{
    morning:{title:'Sunday morning',date:'2026-10-04',time:'09:30',location:'Auditorium',theme:'Great is Your faithfulness',order:structuredClone(MOBILE_DEFAULT_ORDER)},
    evening:{title:'Sunday evening',date:'2026-10-04',time:'17:00',location:'Auditorium',theme:'Peace like a river',order:[{...MOBILE_DEFAULT_ORDER[0],hymnId:6,title:'It Is Well with My Soul'},{...MOBILE_DEFAULT_ORDER[2]},{...MOBILE_DEFAULT_ORDER[6],title:'A Peace That Endures',minutes:20},{...MOBILE_DEFAULT_ORDER[8]}]}
  }
};
let state=structuredClone(initial);
try{
  const stored=JSON.parse(localStorage.getItem(storageKey));
  if(stored?.version===1&&stored.services?.[stored.activeService]&&Array.isArray(stored.saved)&&Object.values(stored.services).every(s=>Array.isArray(s.order)&&s.order.every(i=>i.id&&types[i.type]&&Number.isFinite(i.minutes)&&(!i.hymnId||hymn(i.hymnId)))))state={...state,...stored};
}catch{}
let view='plan',planTab='order',query='',theme='all',key='all',savedOnly=false,sort='suggested';
let toastTimeout,audioContext=null,activeTone=null,audioRequest=0,pendingAudio=false;
const currentService=()=>state.services[state.activeService];
const initials=name=>(name||'Unassigned').split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase();
const dateLabel=date=>new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
const timeLabel=time=>{const [h,m]=time.split(':');return `${Number(h)%12||12}:${m} ${Number(h)>=12?'PM':'AM'}`;};
const duration=()=>currentService().order.reduce((n,i)=>n+i.minutes,0);
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{toast('Storage is unavailable. Changes last for this session.');}}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),3200);}
function renderHeader(){
  $('#app-header').innerHTML=view==='live'?`<span class="live-header-icon">${icon('live')}</span><div class="live-header-title"><strong>Live companion</strong><small>${esc(currentService().title)}</small></div><span class="header-spacer"></span><button class="icon-button" data-action="live-help" aria-label="About live mode">${icon('info')}</button>`:`<span class="brand-symbol">${icon('church')}</span><button class="header-church" data-action="services" aria-label="Choose a service"><span><strong>Brookside</strong><small>Church of Christ</small></span>${icon('down')}</button><span class="header-spacer"></span><button class="header-avatar" data-action="about" aria-label="About Gather mobile"><span class="avatar">JW</span></button>`;
}
function navigate(next){
  stopTone();view=next;
  document.body.classList.toggle('is-live',view==='live');
  $('#browser-theme').content=view==='live'?'#121e30':'#f6f7fb';
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.closest('.bottom-nav')){if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}});
  render();$('#screen').scrollTop=0;
}
function render(){renderHeader();if(view==='plan')renderPlan();else if(view==='hymns')renderLibrary();else renderLive();}
function renderPlan(){
  const s=currentService(),assigned=new Set(s.order.map(i=>i.person).filter(p=>p&&p!=='Unassigned'));
  $('#screen').innerHTML=`<section class="service-hero"><div class="hero-top"><span class="eyebrow">YOUR NEXT GATHERING</span><button class="status-chip" data-action="service-settings" aria-label="Edit service details">Draft · Edit</button></div><h1>${esc(s.title)}</h1><div class="service-date">${icon('calendar')}<span>${dateLabel(s.date)}</span><span class="sep">·</span><span>${timeLabel(s.time)}</span><span class="sep">·</span><span>${esc(s.location)}</span></div><div class="hero-theme">${icon('sun')}<span>${esc(s.theme)}</span></div></section><button class="live-entry" data-view="live"><span class="entry-icon">${icon('live')}</span><span><strong>${state.live?.running?'Return to live service':'Open live companion'}</strong><small>Follow the order. Be ready for your part.</small></span>${icon('right')}</button><div class="plan-tabs" role="tablist" aria-label="Service information"><button data-plan-tab="order" role="tab" aria-selected="${planTab==='order'}" class="${planTab==='order'?'active':''}">Service order</button><button data-plan-tab="people" role="tab" aria-selected="${planTab==='people'}" class="${planTab==='people'?'active':''}">People <span>${assigned.size}</span></button><span>${s.order.length} items · ${duration()} min</span></div>${planTab==='order'?renderOrder():renderPeople()}<button class="button secondary full-width add-service-item" data-action="add-item">${icon('plus')}Add service item</button><div class="quiet-note">${icon('check-circle')}Saved on this device</div>`;
}
function renderOrder(){
  if(!currentService().order.length)return '<div class="empty"><strong>A service starts here.</strong>Add a hymn, prayer, reading, or another item.</div>';
  return `<ol class="order-list">${currentService().order.map((item,index)=>`<li class="order-row" data-item="${esc(item.id)}"><span class="row-number">${String(index+1).padStart(2,'0')}</span><span class="item-icon ${item.type}">${icon(item.type==='hymn'?'music':item.type)}</span><button class="row-copy" data-edit-item="${esc(item.id)}" aria-label="Edit ${esc(item.title)}"><strong>${esc(item.title)}</strong><small>${item.hymnId?'#'+hymn(item.hymnId).number+' · ':''}${esc(item.person||'Unassigned')}</small></button><span class="row-duration">${item.minutes}m</span><button class="row-options" data-edit-item="${esc(item.id)}" aria-label="Options for ${esc(item.title)}">${icon('more')}</button></li>`).join('')}</ol>`;
}
function renderPeople(){
  const groups=new Map();currentService().order.forEach((item,index)=>{const person=item.person||'Unassigned';if(!groups.has(person))groups.set(person,[]);groups.get(person).push({...item,position:index+1});});
  return `<p class="people-summary">Everyone’s part, in one place. Tap a person to see their assignments.</p>${[...groups].map(([person,items])=>`<button class="person-card full-width" data-person="${esc(person)}"><span class="avatar">${initials(person)}</span><span style="text-align:left"><strong>${esc(person)}</strong>${items.map(i=>`<span class="person-task"><b>${String(i.position).padStart(2,'0')}</b>${esc(i.title)}</span>`).join('')}</span></button>`).join('')||'<div class="empty">Add service items to assign your people.</div>'}`;
}
function filteredHymns(){
  const q=query.trim().toLocaleLowerCase();
  const list=MOBILE_HYMNS.filter(h=>(theme==='all'||h.theme===theme)&&(key==='all'||h.key===key)&&(!savedOnly||state.saved.includes(h.id))&&(!q||[h.title,h.author,h.composer,h.number,h.scripture,h.lyrics,h.theme].join(' ').toLocaleLowerCase().includes(q)));
  if(sort==='title')list.sort((a,b)=>a.title.localeCompare(b.title));if(sort==='number')list.sort((a,b)=>a.number-b.number);return list;
}
function renderLibrary(){
  $('#screen').innerHTML=`<div class="screen-heading"><div><h1>Hymn library</h1><p>${MOBILE_HYMNS.length} hymns · Metadata at your fingertips</p></div><button class="icon-button" data-action="library-help" aria-label="About the hymn library">${icon('info')}</button></div><div class="search-box">${icon('search')}<input id="hymn-search" type="search" placeholder="Title, lyrics, number, or scripture" aria-label="Search hymn database" autocomplete="off" value="${esc(query)}"><button data-action="clear-search" aria-label="Clear search" ${query?'':'hidden'}>${icon('close')}</button></div><div class="filter-row"><div class="filter-select"><select id="theme-filter" aria-label="Filter hymns by theme">${['all','Faithfulness','Praise','Communion','Invitation','Assurance'].map(t=>`<option value="${t}" ${theme===t?'selected':''}>${t==='all'?'All themes':t}</option>`).join('')}</select>${icon('down')}</div><div class="filter-select"><select id="key-filter" aria-label="Filter hymns by key">${['all',...notes].map(n=>`<option value="${n}" ${key===n?'selected':''}>${n==='all'?'Any key':n}</option>`).join('')}</select>${icon('down')}</div><button class="filter-toggle ${savedOnly?'active':''}" data-action="saved-filter" aria-pressed="${savedOnly}" aria-label="Show saved hymns">${icon('bookmark')}Saved</button></div><div class="results-summary"><span id="result-count"></span><select id="hymn-sort" aria-label="Sort hymns"><option value="suggested" ${sort==='suggested'?'selected':''}>Suggested</option><option value="title" ${sort==='title'?'selected':''}>Title A–Z</option><option value="number" ${sort==='number'?'selected':''}>Hymn number</option></select></div><div class="hymn-list" id="hymn-list"></div><div class="quiet-note">${icon('info')}Metadata only · No sheet music or slide files</div>`;
  renderHymnResults();
}
function renderHymnResults(){
  const list=filteredHymns();$('#result-count').textContent=`${list.length} hymn${list.length===1?'':'s'}${query?' found':''}`;
  $('#hymn-list').innerHTML=list.length?list.map(h=>{const inPlan=currentService().order.some(i=>i.hymnId===h.id);return `<article class="hymn-row"><span class="hymn-number">${h.number}</span><button class="hymn-info" data-hymn="${h.id}" aria-label="Details for ${esc(h.title)}"><strong>${esc(h.title)}</strong><small>${esc(h.author)}</small><span class="hymn-meta"><span class="key-chip">Key ${h.key}</span><span>${h.verses} verses</span>${inPlan?`<span class="in-plan">${icon('check')}In service</span>`:''}</span></button><button class="add-hymn" data-add-hymn="${h.id}" aria-label="Add ${esc(h.title)} to service">${icon('plus')}</button></article>`;}).join(''):'<div class="empty"><strong>No hymns match that search.</strong>Try a title, number, author, or scripture.<br><button class="button secondary" data-action="reset-filters">Reset filters</button></div>';
  $('.search-box [data-action="clear-search"]').hidden=!query;
}

const sheet=$('#sheet');
function openSheet(title,body){stopTone();$('#sheet-content').innerHTML=`<div class="sheet-header"><h2 id="sheet-title">${esc(title)}</h2><button class="icon-button" data-action="close-sheet" aria-label="Close">${icon('close')}</button></div><div class="sheet-body">${body}</div>`;if(!sheet.open)sheet.showModal();sheet.scrollTop=0;}
function closeSheet(){sheet.close();}
function hymnDetails(id){
  const h=hymn(id),saved=state.saved.includes(h.id),inPlan=currentService().order.filter(i=>i.hymnId===h.id).length;
  openSheet('Hymn details',`<span class="eyebrow">HYMN ${h.number}</span><h3>${esc(h.title)}</h3><p>${esc(h.author)}<br>${esc(h.composer)}</p><div class="metadata-list">${[['Key',h.key],['Verses',h.verses],['Meter',h.meter],['Theme',h.theme],['Scripture',h.scripture],['Voicing',h.harmony?'SATB · A cappella':'Melody']].map(([label,value])=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div><div class="inline-note">${inPlan?`Already in this service ${inPlan===1?'once':inPlan+' times'}. You can add it again.`:'Add this hymn, then choose a leader, key, and verses in your service plan.'}</div><div class="sheet-actions"><button class="detail-save ${saved?'saved':''}" data-save-hymn="${h.id}" aria-label="${saved?'Unsave':'Save'} hymn" aria-pressed="${saved}">${icon('bookmark')}</button><button class="button primary" data-add-hymn="${h.id}">${icon('plus')}${inPlan?'Add again':'Add to service'}</button></div>`);
}
function addHymn(id){
  const h=hymn(id);currentService().order.push({id:crypto.randomUUID(),type:'hymn',hymnId:h.id,title:h.title,person:'James Wilson',minutes:4,section:'Hymn',key:h.key,notes:`Verses 1–${h.verses}`});persist();if(sheet.open)closeSheet();render();toast(`Added “${h.title}” to the service`);
}
function itemPicker(){openSheet('Add to your service',`<p>Choose the next part of your gathering.</p><div class="type-grid">${Object.entries(types).map(([type,label])=>`<button class="type-option" data-new-item="${type}">${icon(type==='hymn'?'music':type)}${label}</button>`).join('')}</div>`);}
function editItem(id,type){
  const existing=currentService().order.find(i=>i.id===id),item=existing||{type,title:types[type],person:'Unassigned',minutes:type==='sermon'?20:3,notes:''};
  const index=existing?currentService().order.indexOf(existing):-1,h=hymn(item.hymnId),assigned=people.includes(item.person)?people:[...people,item.person];
  openSheet(existing?'Edit service item':'New service item',`<form id="item-form"><label for="item-title">Title</label><input id="item-title" required maxlength="100" value="${esc(item.title)}"><label for="item-person">Who is leading?</label><select id="item-person"><option value="Unassigned">Assign later</option>${assigned.filter(p=>p!=='Unassigned').map(p=>`<option ${p===item.person?'selected':''}>${esc(p)}</option>`).join('')}</select><div class="form-grid"><div><label for="item-minutes">Minutes</label><input id="item-minutes" type="number" min="1" max="180" required value="${item.minutes}"></div>${h?`<div><label for="item-key">Singing key</label><select id="item-key">${notes.map(n=>`<option ${n===(item.key||h.key)?'selected':''}>${n}</option>`).join('')}</select></div>`:''}</div><label for="item-notes">${h?'Verses / song leader’s notes':'Scripture / notes'}</label><textarea id="item-notes" placeholder="A helpful note for the service">${esc(item.notes||'')}</textarea>${existing?`<div class="item-tools"><button type="button" class="button secondary" data-move-item="${esc(item.id)}" data-direction="-1" ${index===0?'disabled':''}>↑ Earlier</button><button type="button" class="button secondary" data-move-item="${esc(item.id)}" data-direction="1" ${index===currentService().order.length-1?'disabled':''}>↓ Later</button><button type="button" class="button danger" data-remove-item="${esc(item.id)}">Remove</button></div>`:''}<div class="sheet-actions"><button type="button" class="button secondary" data-action="close-sheet">Cancel</button><button type="submit" class="button primary">${existing?'Save changes':'Add item'}</button></div></form>`);
  $('#item-form').onsubmit=e=>{e.preventDefault();const title=$('#item-title').value.trim();if(!title){$('#item-title').setCustomValidity('Enter a title.');$('#item-title').reportValidity();return;}const next={...item,id:item.id||crypto.randomUUID(),title,person:$('#item-person').value,minutes:Number($('#item-minutes').value),notes:$('#item-notes').value.trim()};if(h){next.key=$('#item-key').value;if(next.key!==item.key)delete state.pitchOverrides[next.id];}if(existing)Object.assign(existing,next);else currentService().order.push(next);persist();closeSheet();render();toast(existing?'Service item updated':'Service item added');};
  $('#item-title').oninput=()=>$('#item-title').setCustomValidity('');
}
function moveItem(id,direction){const list=currentService().order,index=list.findIndex(i=>i.id===id),target=index+direction;if(target<0||target>=list.length)return;[list[index],list[target]]=[list[target],list[index]];persist();closeSheet();render();toast('Service order updated');}
function removeItem(id){const s=currentService(),index=s.order.findIndex(i=>i.id===id);s.order=s.order.filter(i=>i.id!==id);delete state.pitchOverrides[id];if(state.live?.currentId===id){state.live.currentId=s.order[Math.min(index,s.order.length-1)]?.id||null;state.live.itemMs=0;state.live.itemStartedAt=state.live.running?Date.now():null;}if(!s.order.length&&state.live?.running)pauseLive();persist();closeSheet();render();toast('Item removed from the service');}
function servicePicker(){openSheet('Your services',`${Object.entries(state.services).map(([id,s])=>`<button class="service-option ${id===state.activeService?'active':''}" data-select-service="${esc(id)}">${icon('calendar')}<span><strong>${esc(s.title)}</strong><small>${dateLabel(s.date)} · ${timeLabel(s.time)}</small></span><span class="count">${s.order.length} items</span></button>`).join('')}<button class="button primary full-width" data-action="new-service" style="margin-top:8px">${icon('plus')}New service</button>`);}
function serviceForm(isNew){
  const s=isNew?{title:'',date:'2026-10-11',time:'09:30',location:'Auditorium',theme:''}:currentService();
  openSheet(isNew?'New service':'Service details',`<form id="service-form"><label for="service-name">Service name</label><input id="service-name" required maxlength="80" placeholder="Sunday morning" value="${esc(s.title)}"><div class="form-grid"><div><label for="service-date">Date</label><input id="service-date" type="date" required value="${s.date}"></div><div><label for="service-time">Time</label><input id="service-time" type="time" required value="${s.time}"></div></div><label for="service-location">Location</label><input id="service-location" required value="${esc(s.location)}"><label for="service-theme">Theme</label><input id="service-theme" placeholder="A theme for your gathering" value="${esc(s.theme)}"><div class="sheet-actions"><button type="button" class="button secondary" data-action="close-sheet">Cancel</button><button type="submit" class="button primary">${isNew?'Create service':'Save details'}</button></div></form>`);
  $('#service-form').onsubmit=e=>{e.preventDefault();const title=$('#service-name').value.trim();if(!title){$('#service-name').setCustomValidity('Enter a service name.');$('#service-name').reportValidity();return;}if(isNew&&state.live?.running){toast('Pause the live service before creating another plan.');return;}const next={...s,title,date:$('#service-date').value,time:$('#service-time').value,location:$('#service-location').value.trim()||'Auditorium',theme:$('#service-theme').value.trim()||'Gathered in His name'};if(isNew){const id=crypto.randomUUID();state.services[id]={...next,order:[]};state.activeService=id;state.live=null;}else state.services[state.activeService]=next;persist();closeSheet();navigate('plan');toast(isNew?'New service created':'Service details saved');};
  $('#service-name').oninput=()=>$('#service-name').setCustomValidity('');
}

// The live companion follows a local plan. It does not connect to presentation software.
function ensureLive(){
  const order=currentService().order;
  if(!state.live||state.live.serviceId!==state.activeService){state.live={serviceId:state.activeService,currentId:order[0]?.id||null,running:false,startedAt:null,totalMs:0,itemStartedAt:null,itemMs:0,complete:false};persist();}
  if(!order.some(i=>i.id===state.live.currentId)&&order.length){state.live.currentId=order[0].id;state.live.itemMs=0;state.live.itemStartedAt=state.live.running?Date.now():null;persist();}
  return state.live;
}
const liveItem=()=>currentService().order.find(i=>i.id===state.live?.currentId);
const elapsed=(item=false)=>{const l=state.live;if(!l)return 0;const base=item?l.itemMs:l.totalMs,start=item?l.itemStartedAt:l.startedAt;return base+(l.running&&start?Math.max(0,Date.now()-start):0);};
function timerLabel(ms){const seconds=Math.floor(ms/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function updateTimers(){if(view!=='live')return;if($('#total-timer'))$('#total-timer').textContent=timerLabel(elapsed());if($('#item-timer'))$('#item-timer').textContent=timerLabel(elapsed(true));}
function pauseLive(){const l=state.live;if(!l?.running)return;l.totalMs=elapsed();l.itemMs=elapsed(true);l.running=false;l.startedAt=null;l.itemStartedAt=null;persist();}
function toggleTimer(){stopTone();const l=ensureLive();if(l.running)pauseLive();else{l.running=true;l.startedAt=Date.now();l.itemStartedAt=Date.now();persist();}renderLive();}
function selectLiveItem(id){stopTone();const l=ensureLive();if(!currentService().order.some(i=>i.id===id))return;l.currentId=id;l.itemMs=0;l.itemStartedAt=l.running?Date.now():null;l.complete=false;persist();if(sheet.open)closeSheet();renderLive();$('#screen').scrollTop=0;}
function advanceLive(direction){const l=ensureLive(),list=currentService().order,index=list.findIndex(i=>i.id===l.currentId),target=index+direction;if(target>=list.length){finishLive();return;}if(target>=0)selectLiveItem(list[target].id);}
function finishLive(){stopTone();pauseLive();state.live.complete=true;persist();closeSheet();renderLive();$('#screen').scrollTop=0;}
function resetLive(){stopTone();state.live=null;persist();renderLive();$('#screen').scrollTop=0;}
function renderLive(){
  const l=ensureLive(),list=currentService().order,item=liveItem();
  if(!list.length){$('#screen').innerHTML=`<div class="live-complete"><span class="complete-icon">${icon('calendar')}</span><h1>A little planning first</h1><p>Add a few service items, then come back here to follow along.</p><button class="button primary full-width" data-view="plan">Build your service</button></div>`;return;}
  if(l.complete){$('#screen').innerHTML=`<div class="live-complete"><span class="complete-icon">${icon('check-circle')}</span><span class="eyebrow" style="justify-content:center">SERVICE COMPLETE</span><h1>Faithfully gathered.</h1><p>${esc(currentService().title)}<br>${list.length} service items · ${timerLabel(elapsed())} elapsed</p><button class="button primary full-width" data-view="plan">Back to the service plan</button><button class="button secondary full-width" data-action="reset-live">Start a new run</button></div>`;return;}
  const index=list.indexOf(item),h=hymn(item.hymnId),next=list[index+1],pitch=selectedPitch();
  $('#screen').innerHTML=`<div class="live-state-bar"><span class="live-status ${l.running?'running':''}"><i></i>${l.running?'Live on this device':l.totalMs||l.itemMs?'Paused':'Ready when you are'}</span><button data-action="live-order">${icon('list')}Full order</button></div><div class="progress-segments" aria-label="Item ${index+1} of ${list.length}">${list.map((_,i)=>`<span class="${i<index?'done':i===index?'current':''}"></span>`).join('')}</div><section class="current-card"><div class="current-meta"><span>${esc((item.section||types[item.type]).toUpperCase())}</span><span>${String(index+1).padStart(2,'0')} / ${String(list.length).padStart(2,'0')}</span></div><h1>${esc(item.title)}</h1>${h?`<div class="current-hymn-meta"><span class="live-key">Key ${item.key||h.key}</span><span>#${h.number}</span><span>·</span><span>${h.verses} verses</span></div>`:`<div class="current-hymn-meta">${item.minutes} min planned</div>`}${item.notes?`<p class="live-note">${esc(item.notes)}</p>`:''}<div class="leader-row"><span class="avatar">${initials(item.person)}</span><span><small>${h?'SONG LEADER':'LEADING THIS PART'}</small><strong>${esc(item.person||'Unassigned')}</strong></span>${icon('users')}</div></section><div class="live-timers"><div class="timer-block"><small>Service elapsed</small><strong id="total-timer">${timerLabel(elapsed())}</strong></div><span class="timer-divider"></span><div class="timer-block"><small>This item · ${item.minutes}m planned</small><strong id="item-timer">${timerLabel(elapsed(true))}</strong></div><button class="timer-control" data-action="toggle-timer">${icon(l.running?'pause':'play')}${l.running?'Pause':l.totalMs||l.itemMs?'Resume':'Start'}</button></div>${h?`<section class="pitch-card" aria-label="Pitch pipe"><div class="tool-title"><strong>${icon('volume')}Pitch pipe</strong><button data-action="pitch-settings">Change note${icon('down')}</button></div><div class="pitch-center"><button class="pitch-play" id="pitch-play" data-action="play-pitch" aria-label="Play ${pitch.note}${pitch.octave} for three seconds" aria-pressed="false"><span class="pitch-letter">${pitch.note}</span><span class="pitch-octave">${pitch.octave}</span></button><div class="pitch-caption"><strong id="pitch-state-label">Tap to sound ${pitch.note}${pitch.octave}</strong><small>${state.pitchOverrides[item.id]?'Your selected reference note':'Tonic of the singing key'}<br>Sounds for 3 seconds</small><span class="sound-label">${icon('volume')}Plays through your device</span></div></div><div class="volume-row">${icon('volume')}<input id="pitch-volume" type="range" min="0" max="100" step="5" value="${state.volume}" aria-label="Pitch pipe volume"><output id="volume-output">${state.volume}%</output></div></section><p class="pitch-explainer">A reference pitch, not necessarily the melody’s first note.</p>`:`<section class="non-hymn-tool"><h3>${icon(item.type)}For this part</h3><p>${item.notes?esc(item.notes):`Follow ${esc(item.person||'the assigned leader')} for ${esc(types[item.type].toLowerCase())}.`}<br>Move to the next item when you’re ready.</p></section>`}${next?`<div class="next-up"><span class="next-number">${String(index+2).padStart(2,'0')}</span><span><small>UP NEXT</small><strong>${esc(next.title)}</strong><span class="next-person">${esc(next.person||'Unassigned')}</span></span>${icon('right')}</div>`:'<div class="next-up"><span><small>LAST ITEM</small><strong>A moment to close together.</strong></span></div>'}<div class="live-navigation"><button class="button previous" data-action="previous-item" aria-label="Previous service item" ${index===0?'disabled':''}>${icon('left')}</button><button class="button next" data-action="next-item"><span>${next?'Next service item':'Finish service'}</span>${icon(next?'right':'check')}</button></div><p class="live-footnote">Personal guide · Follow along manually</p>`;
}
function showLiveOrder(){const l=ensureLive();openSheet('Follow the service',`<p>Choose the current item. This only changes your personal guide.</p><div class="live-queue">${currentService().order.map((item,i)=>`<button class="queue-item ${item.id===l.currentId?'current':''}" data-live-item="${esc(item.id)}"><span class="queue-number">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.person||'Unassigned')} · ${item.minutes} min</small></span>${item.id===l.currentId?icon('check'):''}</button>`).join('')}</div><button class="danger-full" data-action="confirm-finish">End this service run</button>`);}

// Audio is created only from an explicit Play tap, never from navigation or timers.
function selectedPitch(){const item=liveItem(),h=hymn(item?.hymnId);return {note:state.pitchOverrides[item?.id]||item?.key||h?.key||'C',octave:state.octave===3?3:4};}
function pitchFrequency(note,octave){const midi=12*(octave+1)+notes.indexOf(note);return 440*Math.pow(2,(midi-69)/12);}
function updatePitchUI(playing){const button=$('#pitch-play');if(!button)return;const pitch=selectedPitch();button.classList.toggle('playing',playing);button.setAttribute('aria-pressed',String(playing));button.setAttribute('aria-label',playing?'Stop pitch':`Play ${pitch.note}${pitch.octave} for three seconds`);button.innerHTML=playing?`${icon('stop')}`:`<span class="pitch-letter">${pitch.note}</span><span class="pitch-octave">${pitch.octave}</span>`;$('#pitch-state-label').textContent=playing?`Sounding ${pitch.note}${pitch.octave} · Tap to stop`:`Tap to sound ${pitch.note}${pitch.octave}`;}
function stopTone(){
  audioRequest++;pendingAudio=false;
  const tone=activeTone;activeTone=null;
  if(tone){clearTimeout(tone.timeout);try{const t=audioContext.currentTime;tone.gain.gain.cancelScheduledValues(t);tone.gain.gain.setTargetAtTime(0,t,.012);tone.oscillator.stop(t+.05);}catch{}setTimeout(()=>{tone.oscillator.disconnect();tone.gain.disconnect();},90);}
  updatePitchUI(false);
}
async function playPitch(){
  if(activeTone||pendingAudio){stopTone();return;}
  if(view!=='live'||!hymn(liveItem()?.hymnId))return;
  if(state.volume===0){toast('Raise the pitch pipe volume to hear the note.');return;}
  const request=++audioRequest;pendingAudio=true;
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw new Error('Web Audio unavailable');
    if(!audioContext||audioContext.state==='closed')audioContext=new Audio();
    await audioContext.resume();
    if(request!==audioRequest||view!=='live'||sheet.open)return;
    pendingAudio=false;const pitch=selectedPitch(),oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
    oscillator.type='triangle';oscillator.frequency.setValueAtTime(pitchFrequency(pitch.note,pitch.octave),now);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(state.volume/100*.16,now+.035);gain.gain.setValueAtTime(state.volume/100*.16,now+2.9);gain.gain.linearRampToValueAtTime(0,now+3);
    oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(now);oscillator.stop(now+3.05);
    const tone={oscillator,gain,timeout:null};activeTone=tone;updatePitchUI(true);
    tone.timeout=setTimeout(()=>{if(activeTone===tone){activeTone=null;updatePitchUI(false);}oscillator.disconnect();gain.disconnect();},3100);
  }catch{if(request===audioRequest){pendingAudio=false;toast('Audio could not start. Tap again in a browser with audio enabled.');updatePitchUI(false);}}
}
function pitchSettings(){const pitch=selectedPitch(),h=hymn(liveItem()?.hymnId);openSheet('Choose a reference pitch',`<p>The singing key is <strong>${esc(liveItem()?.key||h?.key||'C')}</strong>. Choose a tonic or another note your song leader needs.</p><div class="pitch-notes">${notes.map(n=>`<button class="${n===pitch.note?'active':''}" data-pitch-note="${n}" aria-pressed="${n===pitch.note}">${n}</button>`).join('')}</div><div class="note-options"><label for="pitch-octave">Octave</label><select id="pitch-octave"><option value="3" ${pitch.octave===3?'selected':''}>3 · Lower</option><option value="4" ${pitch.octave===4?'selected':''}>4 · Middle</option></select></div><p class="pitch-hint">A4 = 440 Hz. Changing the reference note does not transpose the hymn. Audio plays only when you tap the pitch pipe.</p><div class="sheet-actions"><button class="button secondary" data-action="reset-pitch">Use hymn key</button><button class="button primary" data-action="close-sheet">Done</button></div>`);}

document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.view){if(sheet.open)closeSheet();navigate(b.dataset.view);return;}
  if(b.dataset.planTab){planTab=b.dataset.planTab;renderPlan();return;}
  if(b.dataset.hymn){hymnDetails(b.dataset.hymn);return;}
  if(b.dataset.addHymn){addHymn(b.dataset.addHymn);return;}
  if(b.dataset.editItem){editItem(b.dataset.editItem);return;}
  if(b.dataset.newItem){if(b.dataset.newItem==='hymn'){closeSheet();navigate('hymns');$('#hymn-search').focus();}else editItem(null,b.dataset.newItem);return;}
  if(b.dataset.moveItem){moveItem(b.dataset.moveItem,Number(b.dataset.direction));return;}
  if(b.dataset.removeItem){removeItem(b.dataset.removeItem);return;}
  if(b.dataset.saveHymn){const id=Number(b.dataset.saveHymn);state.saved=state.saved.includes(id)?state.saved.filter(i=>i!==id):[...state.saved,id];persist();hymnDetails(id);if(view==='hymns')renderHymnResults();return;}
  if(b.dataset.selectService){if(b.dataset.selectService===state.activeService){closeSheet();return;}if(state.live?.running){toast('Pause the live service before switching plans.');return;}state.activeService=b.dataset.selectService;state.live=null;persist();closeSheet();navigate('plan');return;}
  if(b.dataset.person){const assignments=currentService().order.filter(i=>i.person===b.dataset.person);openSheet(b.dataset.person,`<p>Assigned in ${esc(currentService().title)}</p>${assignments.map(i=>`<button class="service-option" data-edit-item="${esc(i.id)}">${icon(i.type==='hymn'?'music':i.type)}<span><strong>${esc(i.title)}</strong><small>${esc(i.section||types[i.type])} · ${i.minutes} min</small></span>${icon('right')}</button>`).join('')}`);return;}
  if(b.dataset.liveItem){selectLiveItem(b.dataset.liveItem);return;}
  if(b.dataset.pitchNote){state.pitchOverrides[liveItem().id]=b.dataset.pitchNote;persist();document.querySelectorAll('[data-pitch-note]').forEach(n=>{n.classList.toggle('active',n.dataset.pitchNote===b.dataset.pitchNote);n.setAttribute('aria-pressed',n.dataset.pitchNote===b.dataset.pitchNote);});renderLive();return;}
  switch(b.dataset.action){
    case 'close-sheet':closeSheet();break;
    case 'services':servicePicker();break;
    case 'new-service':serviceForm(true);break;
    case 'service-settings':serviceForm(false);break;
    case 'add-item':itemPicker();break;
    case 'clear-search':query='';$('#hymn-search').value='';renderHymnResults();$('#hymn-search').focus();break;
    case 'reset-filters':query='';theme='all';key='all';savedOnly=false;sort='suggested';renderLibrary();break;
    case 'saved-filter':savedOnly=!savedOnly;renderLibrary();break;
    case 'toggle-timer':toggleTimer();break;
    case 'previous-item':advanceLive(-1);break;
    case 'next-item':advanceLive(1);break;
    case 'live-order':showLiveOrder();break;
    case 'reset-live':resetLive();break;
    case 'confirm-finish':openSheet('Finish this service run?',`<p>Your service plan stays saved. This will stop the elapsed timer and mark your personal run complete.</p><div class="sheet-actions"><button class="button secondary" data-action="live-order">Keep going</button><button class="button primary" data-action="finish-live">Finish service</button></div>`);break;
    case 'finish-live':finishLive();break;
    case 'play-pitch':playPitch();break;
    case 'pitch-settings':pitchSettings();break;
    case 'reset-pitch':delete state.pitchOverrides[liveItem().id];persist();renderLive();pitchSettings();break;
    case 'library-help':openSheet('A hymn library in your pocket',`<p>Search the sample catalog by title, number, author, lyric fragment, or scripture. Filter by theme or key, and save hymns for later.</p><div class="inline-note">This mobile app contains metadata only. It has no notated music, slide files, or PowerPoint connection.</div>`);break;
    case 'live-help':openSheet('Your personal service companion',`<p>See the current item, who is leading it, and what comes next. Advance manually as the service unfolds.</p><p><strong>Start</strong> runs the service and item timers. Pausing stops both. The pitch pipe plays a three-second reference tone only when tapped, and stops when you leave this screen.</p><div class="inline-note">The pitch defaults to the key tonic, not necessarily the melody’s first note. Set a different note or octave with “Change note”. This mode does not control PowerPoint or anyone else’s device.</div>`);break;
    case 'about':openSheet('Gather for mobile',`<p>Brookside Church of Christ<br>James Wilson · Worship coordinator</p><p>Build a service, find hymn metadata, and follow along with the people serving beside you.</p><div class="inline-note">Interactive prototype with fictional people and sample hymn metadata. Changes are saved only in this browser, independently from the desktop mockups. No account or cloud sync is connected.</div>`);break;
  }
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='hymn-search'){query=el.value;renderHymnResults();}
  if(el.id==='pitch-volume'){state.volume=Number(el.value);$('#volume-output').textContent=state.volume+'%';if(activeTone)stopTone();persist();}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='theme-filter'){theme=el.value;renderHymnResults();}
  if(el.id==='key-filter'){key=el.value;renderHymnResults();}
  if(el.id==='hymn-sort'){sort=el.value;renderHymnResults();}
  if(el.id==='pitch-octave'){state.octave=Number(el.value);persist();renderLive();}
});
sheet.addEventListener('click',event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSheet();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopTone();persist();}else updateTimers();});
window.addEventListener('pagehide',()=>{stopTone();persist();});
setInterval(updateTimers,1000);
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
navigate('plan');
