const icons = {
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
  music:'<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/>',
  church:'<path d="M3 21V10l4 2V8l5-4 5 4v4l4-2v11zM10 21v-5h4v5M12 1v5M10 3h4M11 10h2"/>',
  chevrons:'<path d="m8 9 4-4 4 4m-8 6 4 4 4-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',down:'<path d="m7 10 5 5 5-5"/>',
  left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud:'<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13 0 5 5 0 0 1 0 10M9 16l2 2 4-4"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  upload:'<path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',play:'<path d="m9 4 12 8-12 8z" transform="translate(-2 0)"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  more:'<circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/>',
  grip:'<path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01" stroke-width="3"/>',
  prayer:'<path d="m4 20 5-5 2-10q1-3 2 0v9l5 6M4 16l3-4m10 0 3 4M12 15l-4 6m5-6 4 6"/>',
  scripture:'<path d="M12 5v16M3 4q5-1 9 2 4-3 9-2v15q-5-1-9 2-4-3-9-2zM6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
  communion:'<path d="M5 4h14v3a7 7 0 0 1-14 0zM12 14v6m-5 1h10M5 7h14"/>',
  sermon:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  slides:'<rect x="3" y="3" width="18" height="13" rx="1"/><path d="M12 16v5m-4 0h8M7 7h10m-10 4h6"/>',
  sliders:'<path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  text:'<path d="M4 5h16M12 5v15m-4 0h8"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.text}</svg>`;
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
hydrateIcons();

// Deliberately fictional catalog numbers and slide assets for this UI prototype.
const hymns = [
  {id:1,number:189,title:'Great Is Thy Faithfulness',author:'Thomas O. Chisholm',composer:'William M. Runyan',key:'D',meter:'11.10.11.10 with refrain',theme:'Faithfulness',slides:4,verses:3,scripture:'Lamentations 3:22–23',lyrics:'Morning by morning new mercies I see',harmony:true,ready:true},
  {id:2,number:225,title:'How Great Thou Art',author:'Stuart K. Hine',composer:'Swedish melody',key:'B♭',meter:'11.10.11.10 with refrain',theme:'Praise',slides:5,verses:4,scripture:'Psalm 8',lyrics:'Consider all the worlds',harmony:true,ready:true},
  {id:3,number:154,title:'Holy, Holy, Holy',author:'Reginald Heber',composer:'John B. Dykes',key:'E♭',meter:'11.12.12.10',theme:'Praise',slides:4,verses:4,scripture:'Isaiah 6:3',lyrics:'Lord God Almighty early in the morning',harmony:true,ready:true},
  {id:4,number:350,title:'When I Survey the Wondrous Cross',author:'Isaac Watts',composer:'Lowell Mason',key:'F',meter:'8.8.8.8',theme:'Communion',slides:4,verses:4,scripture:'Galatians 6:14',lyrics:'On which the Prince of glory died',harmony:true,ready:true},
  {id:5,number:533,title:'Just As I Am',author:'Charlotte Elliott',composer:'William B. Bradbury',key:'E♭',meter:'8.8.8.6',theme:'Invitation',slides:4,verses:4,scripture:'John 6:37',lyrics:'Without one plea O Lamb of God I come',harmony:true,ready:true},
  {id:6,number:601,title:'It Is Well with My Soul',author:'Horatio G. Spafford',composer:'Philip P. Bliss',key:'D',meter:'11.8.11.9 with refrain',theme:'Assurance',slides:4,verses:4,scripture:'Philippians 4:7',lyrics:'When peace like a river attendeth my way',harmony:true,ready:true},
  {id:7,number:456,title:'Blessed Assurance',author:'Fanny J. Crosby',composer:'Phoebe P. Knapp',key:'D',meter:'9.10.9.9 with refrain',theme:'Assurance',slides:3,verses:3,scripture:'Hebrews 10:22',lyrics:'Jesus is mine foretaste of glory divine',harmony:true,ready:true},
  {id:8,number:210,title:'To God Be the Glory',author:'Fanny J. Crosby',composer:'William H. Doane',key:'A♭',meter:'11.11.11.11 with refrain',theme:'Praise',slides:3,verses:3,scripture:'Galatians 1:5',lyrics:'Great things he hath done',harmony:true,ready:true},
  {id:9,number:318,title:'In the Sweet By and By',author:'Sanford F. Bennett',composer:'Joseph P. Webster',key:'G',meter:'9.9.9.9 with refrain',theme:'Assurance',slides:3,verses:3,scripture:'John 14:2',lyrics:'There is a land that is fairer than day',harmony:true,ready:true},
  {id:10,number:122,title:'Doxology',author:'Thomas Ken',composer:'Louis Bourgeois',key:'G',meter:'8.8.8.8',theme:'Praise',slides:1,verses:1,scripture:'Psalm 100',lyrics:'Praise God from whom all blessings flow',harmony:true,ready:true},
  {id:11,number:401,title:'Amazing Grace',author:'John Newton',composer:'Traditional American melody',key:'C',meter:'8.6.8.6',theme:'Assurance',slides:4,verses:4,scripture:'Ephesians 2:8',lyrics:'How sweet the sound that saved',harmony:true,ready:true},
  {id:12,number:330,title:'Break Thou the Bread of Life',author:'Mary A. Lathbury',composer:'William F. Sherwin',key:'E♭',meter:'6.4.6.4',theme:'Communion',slides:0,verses:4,scripture:'John 6:35',lyrics:'Dear Lord to me as thou didst break',harmony:false,ready:false}
];
const hymnById = id => hymns.find(hymn => hymn.id === Number(id));
const initialOrder = [
  {id:'a',type:'hymn',hymnId:3,title:'Holy, Holy, Holy',person:'James Wilson',minutes:4,section:'Opening hymn'},
  {id:'b',type:'scripture',title:'Scripture reading',person:'David Miller',minutes:3,notes:'Lamentations 3:22–26'},
  {id:'c',type:'prayer',title:'Opening prayer',person:'Robert Ellis',minutes:3},
  {id:'d',type:'hymn',hymnId:1,title:'Great Is Thy Faithfulness',person:'James Wilson',minutes:4,section:'Hymn of praise'},
  {id:'e',type:'hymn',hymnId:4,title:'When I Survey the Wondrous Cross',person:'James Wilson',minutes:4,section:'Before communion'},
  {id:'f',type:'communion',title:'The Lord’s Supper',person:'Michael Adams',minutes:8,notes:'A remembrance of Christ'},
  {id:'g',type:'sermon',title:'Faithful in Every Season',person:'Daniel Parker',minutes:22,notes:'Lamentations 3:22–26'},
  {id:'h',type:'hymn',hymnId:5,title:'Just As I Am',person:'James Wilson',minutes:4,section:'Invitation hymn'},
  {id:'i',type:'prayer',title:'Closing prayer',person:'David Miller',minutes:2}
];
const services = {
  morning:{title:'Sunday morning',date:'October 4, 2026',time:'9:30 AM',location:'Auditorium',theme:'Great is Your faithfulness',order:initialOrder},
  evening:{title:'Sunday evening',date:'October 4, 2026',time:'5:00 PM',location:'Auditorium',theme:'Peace like a river',order:[{...initialOrder[0],hymnId:6,title:'It Is Well with My Soul'}, {...initialOrder[2]}, {...initialOrder[6],title:'A Peace That Endures',minutes:20}, {...initialOrder[8]}]},
  wednesday:{title:'Wednesday gathering',date:'October 7, 2026',time:'7:00 PM',location:'Fellowship hall',theme:'Walking together in faith',order:[{...initialOrder[0],hymnId:7,title:'Blessed Assurance'},{...initialOrder[2]},{...initialOrder[1],title:'Bible study',minutes:30,notes:'Hebrews 10:19–25'},{...initialOrder[8]}]}
};
let state = {services:structuredClone(services),activeService:'morning',saved:[1,4,6],selectedHymn:1};
try { const stored = JSON.parse(localStorage.getItem('gather-fluent-prototype-v1')); if(stored?.services?.morning && stored.services[stored.activeService] && Array.isArray(stored.saved)) state = stored; } catch {}
let previewPage = 1, readyOnly = true, presentationIndex = 0, dragId = null, detailTab = 'music';
const service = () => state.services[state.activeService];
function persist(){try { localStorage.setItem('gather-fluent-prototype-v1',JSON.stringify(state)); } catch { toast('Storage is unavailable. Changes will last for this session.'); }}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3200);}
function renderService(){
  const current=service();
  $('#service-title').textContent=current.title;$('#breadcrumb-date').textContent=current.date;$('#service-date').textContent=current.date;$('#service-time').textContent=current.time;$('#service-location').textContent=current.location;$('#theme-title').textContent=current.theme;
  $('.theme-verse').hidden=state.activeService!=='morning';$('.verse-ref').hidden=state.activeService!=='morning';
  $('#item-count').textContent=current.order.length;$('#duration').textContent=current.order.reduce((sum,item)=>sum+item.minutes,0);
  $('.nav-count').textContent=Object.keys(state.services).length;
  document.querySelectorAll('[data-service]').forEach(el=>el.classList.toggle('selected',el.dataset.service===state.activeService));
  $('#service-list').innerHTML=current.order.length?current.order.map((item,index)=>{
    const hymn=hymnById(item.hymnId);
    const detail=hymn?`<b>#${hymn.number}</b> &nbsp;·&nbsp; ${escapeHTML(item.section||'Hymn')} &nbsp;·&nbsp; ${escapeHTML(item.person)}`:`${escapeHTML(item.person)}${item.type==='scripture'?' &nbsp;·&nbsp; '+escapeHTML(item.notes||''):''}`;
    return `<li class="service-item ${item.hymnId===state.selectedHymn?'selected':''}" draggable="true" data-item="${escapeHTML(item.id)}"><span class="drag-handle" aria-hidden="true">${icon('grip')}</span><span class="item-type ${item.type}">${icon(item.type==='hymn'?'music':item.type)}</span><button class="item-copy" data-service-select="${item.id}" aria-label="Select ${escapeHTML(item.title)}"><strong>${escapeHTML(item.title)}</strong><small>${detail}</small></button><span class="item-duration">${item.minutes} min</span><button class="item-menu" data-edit="${item.id}" aria-label="Options for item ${index+1}">${icon('more')}</button></li>`;
  }).join(''):'<li class="empty-state"><strong>Room for a new service</strong>Add your first hymn, prayer, or reading below.</li>';
}
function filteredHymns(){
  const query=$('#hymn-search').value.trim().toLocaleLowerCase(),theme=$('#theme-filter').value,key=$('#key-filter').value;
  let list=hymns.filter(h=>(!readyOnly||h.ready)&&(theme==='all'||h.theme===theme)&&(key==='all'||h.key===key)&&(!$('#favorites-filter').checked||state.saved.includes(h.id))&&(!$('#fourpart-filter').checked||h.harmony)&&(!query||[h.title,h.author,h.composer,h.number,h.lyrics,h.scripture,h.theme].join(' ').toLocaleLowerCase().includes(query)));
  if($('#sort').value==='title') list.sort((a,b)=>a.title.localeCompare(b.title));
  if($('#sort').value==='number') list.sort((a,b)=>a.number-b.number);
  return list;
}
function renderResults(){
  const list=filteredHymns();$('#result-count').textContent=`${list.length} hymn${list.length===1?'':'s'} ${$('#hymn-search').value?'found':'in your library'}`;
  $('#hymn-results').innerHTML=list.length?list.map(h=>`<div class="hymn-card ${state.selectedHymn===h.id?'selected':''}" data-hymn="${h.id}" role="button" tabindex="0" aria-label="Preview ${escapeHTML(h.title)}" aria-pressed="${state.selectedHymn===h.id}"><span class="hymn-number">${h.number}</span><div class="hymn-copy"><h3>${escapeHTML(h.title)}</h3><p>${escapeHTML(h.author)}<span>·</span>Key of ${h.key}<span>·</span>${h.verses} verses</p></div><div class="hymn-tags"><span class="slide-badge">${icon(h.ready?'slides':'info')}${h.ready?h.slides+' slides':'Metadata'}</span><button class="hymn-add" data-add="${h.id}" aria-label="Add ${escapeHTML(h.title)} to service">${icon('plus')}</button></div></div>`).join(''):'<div class="empty-state"><strong>No hymns found</strong>Try another title or reset the filters.<br><button class="button secondary" id="reset-filters" style="margin-top:12px">Reset filters</button></div>';
}
function musicSVG(variant=0){
  let lines='',notes='';const pitches=[12,17,12,7,2,7,12,22,17,12,7,12,17,22,27,17];
  for(const y of [15,65]) for(let i=0;i<5;i++)lines+=`<line x1="8" y1="${y+i*5}" x2="570" y2="${y+i*5}"/>`;
  for(const x of [68,190,314,438,569])lines+=`<line x1="${x}" y1="15" x2="${x}" y2="85"/>`;
  for(let i=0;i<16;i++){let x=82+i*30,y=pitches[(i+variant)%pitches.length]+12;notes+=`<ellipse cx="${x}" cy="${y}" rx="4.2" ry="2.9" transform="rotate(-18 ${x} ${y})"/><path d="M${x+4} ${y}v-19"/><ellipse cx="${x}" cy="${y+46}" rx="4.2" ry="2.9" transform="rotate(-18 ${x} ${y+46})"/><path d="M${x-4} ${y+46}v19"/>`;}
  return `<svg class="music-svg" viewBox="0 0 580 112" role="img" aria-label="Illustrative four-part sheet music, not a playable score"><g stroke="currentColor" stroke-width=".65" opacity=".65">${lines}<path d="M8 15v70M5 15q-8 20 0 35-8 20 0 35" fill="none"/></g><g fill="currentColor" stroke="currentColor" stroke-width="1">${notes}</g><text x="18" y="45" font-size="39" font-family="serif">𝄞</text><text x="20" y="88" font-size="27" font-family="serif">𝄢</text><g font-family="Georgia,serif" fill="currentColor" font-size="13"><text x="49" y="25">4</text><text x="49" y="36">4</text><text x="49" y="75">4</text><text x="49" y="86">4</text></g><text x="290" y="108" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="8" fill="#9ca38e">Illustrative notation · Sample slide ${variant+1}</text></svg>`;
}
function renderDetail(){
  const h=hymnById(state.selectedHymn)||hymns[0];
  const details=[['Hymn number','#'+h.number],['Words',h.author],['Music',h.composer],['Key',h.key],['Meter',h.meter],['Verses',h.verses],['Scripture',h.scripture],['Theme',h.theme],['Voicing',h.harmony?'SATB · A cappella':'Melody'],['Slides',h.ready?h.slides+' illustrative samples':'Not available']];
  const music=h.ready?`<div class="sheet-wrap"><div class="sheet-title">${escapeHTML(h.title)}</div><div class="sheet-top"><span>${escapeHTML(h.author)}</span><span>${escapeHTML(h.composer)}</span></div>${musicSVG(previewPage-1)}<div class="sheet-watermark">ILLUSTRATIVE SAMPLE · NOT FOR PROJECTION</div></div><div class="preview-navigation"><span>16:9 · Four-part notation</span><div class="preview-page"><button id="previous-slide" aria-label="Previous sample slide" ${previewPage===1?'disabled':''}>${icon('left')}</button><span>${previewPage} of ${h.slides}</span><button id="next-slide" aria-label="Next sample slide" ${previewPage===h.slides?'disabled':''}>${icon('right')}</button><button id="expand-preview" aria-label="Expand hymn preview">${icon('expand')}</button></div></div><div class="slide-thumbnails" aria-label="Sample slides">${Array.from({length:h.slides},(_,i)=>`<button class="slide-thumb ${previewPage===i+1?'selected':''}" data-slide="${i+1}" aria-label="Preview slide ${i+1}" aria-pressed="${previewPage===i+1}"><span class="thumb-score" aria-hidden="true"></span><small>Slide ${i+1}</small></button>`).join('')}</div><div class="arrangement-info"><h4>Presentation arrangement</h4><div class="info-line"><span>Format</span><strong class="format-icon">${icon('slides')}PowerPoint · 16:9</strong></div><div class="info-line"><span>Voicing</span><strong>${h.harmony?'SATB · A cappella':'Melody'}</strong></div><div class="info-line"><span>Included</span><strong>${h.verses} verses · ${h.slides} sample slides</strong></div></div>`:'<div class="notes-area" style="margin:0 17px 20px">Metadata only. A slide arrangement has not been added for this hymn.</div>';
  $('#selection-detail').innerHTML=`<div class="detail-heading"><div><div class="detail-eyebrow">HYMN ${h.number}</div><h3>${escapeHTML(h.title)}</h3><p>${escapeHTML(h.author)}<br>${escapeHTML(h.composer)}</p></div><button class="icon-button ${state.saved.includes(h.id)?'saved-icon':''}" id="save-hymn" aria-label="${state.saved.includes(h.id)?'Unsave':'Save'} hymn" aria-pressed="${state.saved.includes(h.id)}">${icon('bookmark')}</button></div><div class="detail-tags"><span class="detail-tag">Key of ${h.key}</span><span class="detail-tag">${h.theme}</span><span class="detail-tag">${h.scripture}</span></div><div class="inspector-tabs" role="tablist" aria-label="Hymn information"><button role="tab" class="${detailTab==='music'?'active':''}" data-detail-tab="music" aria-selected="${detailTab==='music'}">Sheet music</button><button role="tab" class="${detailTab==='details'?'active':''}" data-detail-tab="details" aria-selected="${detailTab==='details'}">Details</button></div>${detailTab==='music'?music:`<div class="metadata-sheet">${details.map(([label,value])=>`<div class="info-line"><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join('')}</div>`}<div class="detail-footer"><span>${icon(h.ready?'check-circle':'info')}${h.ready?'Slide-ready · Sample arrangement':'Metadata-only hymn'}</span><button class="button primary" data-add="${h.id}">${icon('plus')}Add to service</button></div>`;
  $('#status-hint').textContent=`Hymn ${h.number} · ${h.ready?h.slides+' sample slides':'Metadata only'}`;
}
function selectHymn(id){state.selectedHymn=Number(id);previewPage=1;renderResults();renderDetail();renderService();persist();if(matchMedia('(max-width: 930px)').matches)showMobileTab('preview');}
function addHymn(id){const h=hymnById(id);service().order.push({id:crypto.randomUUID(),type:'hymn',hymnId:h.id,title:h.title,person:'James Wilson',minutes:4,section:'Hymn'});persist();renderService();toast(`“${h.title}” added to service`);}
function renderAll(){renderService();renderResults();renderDetail();}

const dialog=$('#dialog');
function openModal(title,body,wide=false){dialog.classList.toggle('presentation-dialog',wide);$('#dialog-content').innerHTML=`<div class="modal-head"><h2>${escapeHTML(title)}</h2><button class="icon-button" data-close aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${body}</div>`;if(!dialog.open)dialog.showModal();}
function closeModal(){dialog.close();dialog.classList.remove('presentation-dialog');}
function itemPicker(){openModal('Make room for…',`<p>Choose what comes next in your service.</p><div class="type-options">${[['hymn','Hymn'],['prayer','Prayer'],['scripture','Scripture reading'],['communion','The Lord’s Supper'],['sermon','Sermon'],['text','Announcements']].map(([type,label])=>`<button class="type-option" data-new-type="${type}">${icon(type==='hymn'?'music':type)}${label}</button>`).join('')}</div>`);}
function editItem(id,type){
  const existing=service().order.find(i=>i.id===id),item=existing||{type,title:{prayer:'Prayer',scripture:'Scripture reading',communion:'The Lord’s Supper',sermon:'Sermon',text:'Announcements'}[type],person:'',minutes:3,notes:''};
  openModal(existing?'Service item':'Add service item',`<form id="item-form"><label for="item-title">Title</label><input id="item-title" required value="${escapeHTML(item.title)}"><div class="modal-grid"><div><label for="item-person">Led by</label><input id="item-person" placeholder="Assign a person" value="${escapeHTML(item.person)}"></div><div><label for="item-minutes">Estimated minutes</label><input type="number" id="item-minutes" min="1" max="180" required value="${item.minutes}"></div></div><label for="item-notes">${item.type==='hymn'?'Verse selection / notes':'Scripture / notes'}</label><textarea id="item-notes" placeholder="Add a note for your team">${escapeHTML(item.notes||'')}</textarea>${existing?'<div class="move-actions"><button type="button" class="button secondary" id="move-up">↑ Move earlier</button><button type="button" class="button secondary" id="move-down">↓ Move later</button></div>':''}<div class="modal-actions">${existing?'<button type="button" class="button danger-button" id="remove-item">Remove item</button>':''}<button type="button" class="button secondary" data-close>Cancel</button><button class="button primary" type="submit">${existing?'Save changes':'Add item'}</button></div></form>`);
  $('#item-form').addEventListener('submit',event=>{event.preventDefault();const title=$('#item-title').value.trim();if(!title){$('#item-title').setCustomValidity('Enter an item title.');$('#item-title').reportValidity();return;}const next={...item,id:existing?.id||crypto.randomUUID(),title,person:$('#item-person').value.trim()||'Unassigned',minutes:Number($('#item-minutes').value),notes:$('#item-notes').value.trim()};if(existing)Object.assign(existing,next);else service().order.push(next);persist();renderService();closeModal();toast(existing?'Service item updated':'Service item added');});
  $('#item-title').addEventListener('input',()=>$('#item-title').setCustomValidity(''));
  if(existing){const index=service().order.indexOf(existing);$('#move-up').disabled=index===0;$('#move-down').disabled=index===service().order.length-1;$('#move-up').onclick=()=>moveItem(id,-1);$('#move-down').onclick=()=>moveItem(id,1);$('#remove-item').onclick=()=>{service().order=service().order.filter(i=>i.id!==id);persist();renderService();closeModal();toast('Item removed from service');};}
}
function moveItem(id,direction){const list=service().order,index=list.findIndex(i=>i.id===id);[list[index],list[index+direction]]=[list[index+direction],list[index]];persist();renderService();closeModal();toast('Service order updated');}
function showMobileTab(tab){document.body.classList.toggle('mobile-library',tab==='library');document.body.classList.toggle('mobile-preview',tab==='preview');document.querySelectorAll('[data-mobile]').forEach(b=>{b.classList.toggle('active',b.dataset.mobile===tab);b.setAttribute('aria-selected',b.dataset.mobile===tab);});}
function showPresentation(){
  const item=service().order[presentationIndex];if(!item){toast('Add a service item to start presenting');return;}
  const h=hymnById(item.hymnId);
  openModal('Presentation preview',`<div class="present-screen"><div class="detail-eyebrow" style="justify-content:center">${escapeHTML(service().title)} · ${escapeHTML(service().date)}</div><h2>${escapeHTML(item.title)}</h2>${h&&h.ready?musicSVG():`<p>${escapeHTML(item.notes||item.person)}</p>`}<p style="font-size:11px">${h?'Illustrative sample only · The production app would display the hymn’s actual slide deck.':'Led by '+escapeHTML(item.person)}</p></div><div class="present-controls"><button class="button secondary" id="present-prev" ${presentationIndex===0?'disabled':''}>${icon('left')}Previous</button><span>Item ${presentationIndex+1} of ${service().order.length} · Use ← →</span><button class="button primary" id="present-next" ${presentationIndex===service().order.length-1?'disabled':''}>Next${icon('right')}</button></div>`,true);
}
function downloadOutline(){const text=[service().title,`${service().date} · ${service().time} · ${service().location}`,`Theme: ${service().theme}`,'',...service().order.map((i,n)=>`${n+1}. ${i.title}${i.hymnId?' (#'+hymnById(i.hymnId).number+')':''}\n   ${i.person} · ${i.minutes} min${i.notes?'\n   '+i.notes:''}`),'',`Estimated duration: ${service().order.reduce((s,i)=>s+i.minutes,0)} minutes`,'','Gather UI prototype — sample service data'].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download=service().title.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-service-plan.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);closeModal();toast('Service plan downloaded');}

$('#hymn-search').addEventListener('input',renderResults);
for(const id of ['theme-filter','key-filter','sort','favorites-filter','fourpart-filter'])$('#'+id).addEventListener('change',renderResults);
$('#ready-filter').onclick=()=>{readyOnly=!readyOnly;$('#ready-filter').classList.toggle('active',readyOnly);$('#ready-filter').setAttribute('aria-pressed',readyOnly);renderResults();};
$('#more-filters').onclick=()=>{$('#extra-filters').hidden=!$('#extra-filters').hidden;$('#more-filters').setAttribute('aria-expanded',!$('#extra-filters').hidden);};
$('#add-item').onclick=itemPicker;
$('#present').onclick=()=>{presentationIndex=0;showPresentation();};
$('#export').onclick=()=>openModal('Take your service with you',`<p>Download a readable outline with the service order, leaders, timings, and notes.</p><div class="notes-area">This prototype demonstrates the slide-library workflow. Actual PowerPoint export needs verified hymn slide files and is not included.</div><div class="modal-actions"><button class="button secondary" data-close>Close</button><button class="button primary" id="download-outline">${icon('upload')}Download service plan (.txt)</button></div>`);
$('#help').onclick=()=>openModal('A little more room for worship',`<p>Gather is a concept for planning worship in churches of Christ. Arrange a service, search hymn metadata, and keep presentation materials close at hand.</p><p><strong>Try it:</strong> search by hymn title, catalog number, author, lyric fragment, or Scripture. Filter by key or theme, add hymns, and drag service items into place. You can also move items using their options.</p><p>Your changes save locally in this browser. The desktop workspace keeps three panes visible. Narrow windows switch between service order, library, and preview tabs.</p><div class="notes-area">All people and catalog numbers are fictional. The music notation, availability badges, and slide counts are visual samples, not verified hymn arrangements. This Fluent concept uses system fonts and makes no external requests.</div><div class="modal-actions"><button class="button primary" data-close>Got it</button></div>`);
$('#church-info').onclick=()=>openModal('Brookside Church of Christ',`<p>A fictional congregation used to demonstrate the worship planner.</p><div class="notes-area">Auditorium · Sunday 9:30 AM and 5:00 PM<br>Fellowship hall · Wednesday 7:00 PM<br>Congregational a cappella singing</div>`);
$('#profile').onclick=()=>openModal('James Wilson',`<p>Worship coordinator · Brookside Church of Christ</p><div class="notes-area">Prototype profile. Service edits and saved hymns are stored on this device.</div>`);
$('#edit-theme').onclick=()=>{openModal('This week’s theme',`<form id="theme-form"><label for="theme-input">Service theme</label><input id="theme-input" required value="${escapeHTML(service().theme)}"><div class="modal-actions"><button class="button secondary" type="button" data-close>Cancel</button><button class="button primary">Save theme</button></div></form>`);$('#theme-form').onsubmit=event=>{event.preventDefault();if(!$('#theme-input').value.trim())return;service().theme=$('#theme-input').value.trim();persist();renderService();closeModal();toast('Service theme updated');};};
$('#order-options').onclick=()=>openModal('Service details',`<p>${escapeHTML(service().title)} · ${service().order.length} items · ${service().order.reduce((s,i)=>s+i.minutes,0)} minutes</p><div class="notes-area">Drag items to reorder them, or open an item and choose “Move earlier” or “Move later”.</div><div class="modal-actions"><button class="button secondary" id="duplicate-service">Duplicate service</button><button class="button primary" id="download-outline">Download outline</button></div>`);
$('#new-service').onclick=()=>{openModal('Plan a new service',`<form id="new-service-form"><label for="new-title">Service name</label><input id="new-title" required placeholder="Sunday morning"><div class="modal-grid"><div><label for="new-date">Date</label><input type="date" required id="new-date" value="2026-10-11"></div><div><label for="new-time">Time</label><input type="time" required id="new-time" value="09:30"></div></div><div class="modal-actions"><button type="button" class="button secondary" data-close>Cancel</button><button class="button primary">Create service</button></div></form>`);$('#new-service-form').onsubmit=e=>{e.preventDefault();const title=$('#new-title').value.trim();if(!title)return;const date=new Date($('#new-date').value+'T12:00:00');const [h,m]=$('#new-time').value.split(':');const id=crypto.randomUUID();state.services[id]={title,date:date.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),time:`${Number(h)%12||12}:${m} ${Number(h)>=12?'PM':'AM'}`,location:'Auditorium',theme:'Gathered in His name',order:[]};state.activeService=id;persist();renderCustomServices();renderAll();closeModal();showMobileTab('order');toast('New service created');};};
function renderCustomServices(){document.querySelectorAll('.custom-service').forEach(e=>e.remove());const anchor=$('.sidebar-bottom');Object.entries(state.services).filter(([id])=>!services[id]).forEach(([id,s])=>{const button=document.createElement('button');button.className='upcoming custom-service';button.dataset.service=id;button.innerHTML=`<span class="date-block">${icon('calendar')}</span><span><strong>${escapeHTML(s.title)}</strong><small>${escapeHTML(s.date)}</small></span>`;anchor.before(button);});}

document.addEventListener('click',event=>{
  const button=event.target.closest('button'),card=event.target.closest('[data-hymn]');
  if(button?.dataset.add){addHymn(button.dataset.add);return;}
  if(card){selectHymn(card.dataset.hymn);return;}
  if(!button)return;
  if(button.dataset.serviceSelect){const item=service().order.find(i=>i.id===button.dataset.serviceSelect);if(item?.hymnId)selectHymn(item.hymnId);else if(item)editItem(item.id);}
  if(button.dataset.detailTab){detailTab=button.dataset.detailTab;renderDetail();$(`[data-detail-tab="${detailTab}"]`).focus();}
  if(button.dataset.slide){previewPage=Number(button.dataset.slide);renderDetail();$(`[data-slide="${previewPage}"]`).focus();}
  if(button.hasAttribute('data-close'))closeModal();
  if(button.dataset.edit)editItem(button.dataset.edit);
  if(button.dataset.service){state.activeService=button.dataset.service;persist();renderAll();showMobileTab('order');}
  if(button.dataset.mobile)showMobileTab(button.dataset.mobile);
  if(button.dataset.newType){if(button.dataset.newType==='hymn'){closeModal();showMobileTab('library');$('#hymn-search').focus();}else editItem(null,button.dataset.newType);}
  if(button.id==='save-hymn'){const i=state.saved.indexOf(state.selectedHymn);if(i<0)state.saved.push(state.selectedHymn);else state.saved.splice(i,1);persist();renderDetail();renderResults();toast(i<0?'Hymn saved to your collection':'Hymn removed from saved collection');}
  if(button.id==='next-slide'||button.id==='previous-slide'){previewPage+=button.id==='next-slide'?1:-1;renderDetail();}
  if(button.id==='expand-preview'){const h=hymnById(state.selectedHymn);openModal('Sheet music preview',`<div class="present-screen"><h2>${escapeHTML(h.title)}</h2>${musicSVG(previewPage-1)}<p style="font-size:12px">Illustrative sample · Slide ${previewPage} of ${h.slides}<br>Verified sheet music would appear here in the production app.</p></div>`,true);}
  if(button.id==='present-next'||button.id==='present-prev'){presentationIndex+=button.id==='present-next'?1:-1;showPresentation();}
  if(button.id==='download-outline')downloadOutline();
  if(button.id==='reset-filters'){resetFilters();renderResults();}
  if(button.id==='duplicate-service'){const id=crypto.randomUUID();state.services[id]={...structuredClone(service()),title:service().title+' (copy)'};state.activeService=id;persist();renderCustomServices();renderAll();closeModal();toast('Service duplicated');}
  if(button.dataset.nav){
    const nav=button.dataset.nav;
    if(nav==='planner'){showMobileTab('order');$('.order-panel').scrollIntoView({behavior:'smooth',block:'nearest'});}
    if(nav==='library'){showMobileTab('library');$('#hymn-search').focus();}
    if(nav==='saved')openModal('Saved collections',`<p>Your hymns, ready for the right moment.</p><button class="collection-row" data-collection="saved">${icon('bookmark')}Saved hymns<span>${state.saved.length} hymns →</span></button><button class="collection-row" data-collection="Communion">${icon('communion')}Around the table<span>Communion hymns →</span></button><button class="collection-row" data-collection="Praise">${icon('sun')}Songs of praise<span>Praise hymns →</span></button>`);
    if(nav==='team')openModal('People who help us gather',`<p>Sample service team · Brookside Church of Christ</p>${[['JW','James Wilson','Song leader · Worship coordinator'],['DM','David Miller','Scripture reading · Prayer'],['RE','Robert Ellis','Prayer'],['MA','Michael Adams','Communion'],['DP','Daniel Parker','Minister']].map(([initial,name,role])=>`<div class="person-row"><span class="avatar">${initial}</span><span><strong>${name}</strong><small>${role}</small></span></div>`).join('')}`);
  }
  if(button.dataset.collection){resetFilters();if(button.dataset.collection==='saved'){$('#favorites-filter').checked=true;$('#extra-filters').hidden=false;}else $('#theme-filter').value=button.dataset.collection;renderResults();closeModal();showMobileTab('library');$('#hymn-search').focus();}
});
function resetFilters(){$('#hymn-search').value='';$('#theme-filter').value='all';$('#key-filter').value='all';$('#favorites-filter').checked=false;$('#fourpart-filter').checked=false;readyOnly=false;$('#ready-filter').classList.remove('active');$('#ready-filter').setAttribute('aria-pressed','false');}
document.addEventListener('keydown',event=>{
  const typing=['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName);
  if(event.key==='/'&&!typing&&!dialog.open){event.preventDefault();showMobileTab('library');$('#hymn-search').focus();}
  if((event.metaKey||event.ctrlKey)&&event.key==='k'&&!dialog.open){event.preventDefault();itemPicker();}
  if(!typing&&(event.key==='Enter'||event.key===' ')&&event.target.matches('[data-hymn]')){event.preventDefault();selectHymn(event.target.dataset.hymn);}
  if(dialog.open&&$('#present-next')&&!typing){if(event.key==='ArrowRight'&&presentationIndex<service().order.length-1){event.preventDefault();presentationIndex++;showPresentation();}if(event.key==='ArrowLeft'&&presentationIndex>0){event.preventDefault();presentationIndex--;showPresentation();}}
});
dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeModal();}});
$('#service-list').addEventListener('dragstart',event=>{const row=event.target.closest('[data-item]');if(!row)return;dragId=row.dataset.item;row.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragId);});
$('#service-list').addEventListener('dragover',event=>{const row=event.target.closest('[data-item]');if(!row)return;event.preventDefault();document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));row.classList.add('drag-over');});
$('#service-list').addEventListener('drop',event=>{event.preventDefault();const row=event.target.closest('[data-item]');if(!row||!dragId)return;const list=service().order,from=list.findIndex(i=>i.id===dragId),to=list.findIndex(i=>i.id===row.dataset.item);if(from<0||to<0)return;const [item]=list.splice(from,1);list.splice(to,0,item);persist();renderService();toast('Service order updated');});
$('#service-list').addEventListener('dragend',()=>{dragId=null;document.querySelectorAll('.dragging,.drag-over').forEach(el=>el.classList.remove('dragging','drag-over'));});
$('#append-item').onclick=itemPicker;
$('#toggle-navigation').onclick=()=>{const collapsed=document.body.classList.toggle('navigation-collapsed');$('#toggle-navigation').setAttribute('aria-expanded',!collapsed);};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Full screen is not available in this browser.');}};
document.addEventListener('fullscreenchange',()=>$('#fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit full screen':'Enter full screen'));
renderCustomServices();renderAll();
