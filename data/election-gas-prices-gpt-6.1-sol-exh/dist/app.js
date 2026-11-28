import { TANK, makeRows, metricValue, adjustedPrice } from './model.js';

const $ = id => document.getElementById(id);
const money = n => n == null ? '—' : `$${n.toFixed(2)}`;
const decimal = (n, digits = 1) => n == null ? '—' : n.toFixed(digits);
const month = date => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Unavailable';
const prettyDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const icons = {
  pump: '<svg viewBox="0 0 20 20"><path d="M4 17V4h8v13M2 17h12M6 6h4v5H6zM12 10h2v4a1.5 1.5 0 0 0 3 0V7l-2-2"/></svg>',
  inflation: '<svg viewBox="0 0 20 20"><path d="M3 15h14M4 11l4-4 4 2 4-6m-4 0h4v4"/></svg>',
  clock: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>'
};
let data, rows;
const defaults = { startYear: 2008, endYear: 2026, electionType: 'federal', metric: 'price', adjustment: 'inflation', baseYear: 2024, cpi: 'cpiDfw', includeEstimates: true, selectedYear: 2026, compareA: 2008, compareB: 2024, chartStyle: 'line' };
const state = { ...defaults };
const fields = ['startYear', 'endYear', 'electionType', 'metric', 'baseYear', 'cpi', 'selectedYear', 'compareA', 'compareB'];
const numeric = ['startYear', 'endYear', 'baseYear', 'selectedYear', 'compareA', 'compareB'];
const metricLabels = { price: 'Price per gallon', fillup: 'Cost of a 14.5-gallon fill-up', minutes: 'Minutes of work per gallon', tankMinutes: 'Minutes of work per fill-up', gallons: 'Gallons per hour of work' };
const isWork = () => ['minutes', 'tankMinutes', 'gallons'].includes(state.metric);
const baseRow = () => rows.find(r => r.year === state.baseYear);
const currentRows = () => rows.filter(r => r.year >= state.startYear && r.year <= state.endYear && (state.electionType === 'all' || r.year % (state.electionType === 'presidential' ? 4 : 2) === 0) && (state.includeEstimates || !r.preliminary));
const valueFor = (row, adjustment = state.adjustment) => metricValue(row, state.metric, adjustment, baseRow(), state.cpi);
const formatValue = n => ['price','fillup'].includes(state.metric) ? money(n) : `${decimal(n)}${state.metric === 'gallons' ? ' gal' : ' min'}`;
const status = row => `<span class="status-tag ${row.preliminary ? 'preliminary' : 'historical'}">${row.preliminary ? 'Preliminary estimate' : 'Historical proxy'}</span>`;
function populate(id, years) { $(id).innerHTML = years.map(y => `<option value="${y}">${y}${y === 2026 ? ' · est.' : ''}</option>`).join(''); }
function syncControls() {
  for (const id of fields) $(id).value = state[id];
  $('includeEstimates').checked = state.includeEstimates;
  document.querySelectorAll('[name="adjustment"]').forEach(input => input.checked = input.value === state.adjustment);
  document.querySelector('.adjustment-field').disabled = isWork();
  $('adjustment-note').hidden = !isWork();
  $('baseYear').disabled = isWork() || state.adjustment === 'nominal';
  $('cpi').disabled = isWork() || state.adjustment !== 'inflation';
  $('lineView').classList.toggle('active', state.chartStyle === 'line');
  $('barView').classList.toggle('active', state.chartStyle === 'bar');
  $('lineView').setAttribute('aria-pressed', state.chartStyle === 'line');
  $('barView').setAttribute('aria-pressed', state.chartStyle === 'bar');
}
function updateUrl() {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) if (value !== defaults[key]) p.set(key, String(value));
  history.replaceState(null, '', `${location.pathname}${p.size ? '?' + p : ''}${location.hash || '#explore'}`);
}
function render() {
  const filtered = currentRows();
  if (filtered.length && !filtered.some(r => r.year === state.selectedYear)) state.selectedYear = filtered.at(-1).year;
  populate('selectedYear', filtered.map(r => r.year));
  syncControls();
  renderSummary(); renderChart(); renderDetail(); renderComparison(); updateUrl();
}
function renderSummary() {
  const row = currentRows().find(r => r.year === state.selectedYear);
  if (!row) { $('summary').innerHTML = ''; $('sign-price').textContent = '—'; $('sign-year').textContent = '—'; $('sign-status').textContent = 'No matching year'; $('sign-status').className = 'status-tag'; $('sign-input').textContent = 'Choose a wider year range'; return; }
  $('sign-price').textContent = row.price == null ? '—' : row.price.toFixed(2);
  $('sign-year').textContent = row.year;
  $('sign-status').textContent = row.preliminary ? 'Preliminary estimate' : 'Historical proxy';
  $('sign-status').className = `status-tag ${row.preliminary ? 'preliminary' : 'historical'}`;
  $('sign-input').textContent = `Price input: ${month(row.inputs.gas.month)} · monthly metro ${row.preliminary ? 'estimate' : 'average'}`;
  const adjusted = adjustedPrice(row, 'inflation', baseRow(), state.cpi);
  const minutes = row.price && row.wage ? 60 * row.price / row.wage : null;
  $('summary').innerHTML = [
    { icon: 'pump', label: 'At the pump', value: money(row.price), unit: '/ gal', note: `${money(row.price == null ? null : row.price * TANK)} for a 14.5-gallon fill-up` },
    { icon: 'inflation', label: 'Inflation adjusted', value: money(adjusted), unit: '/ gal', note: `In <strong>${state.baseYear} dollars</strong> · ${state.cpi === 'cpiDfw' ? 'DFW' : 'U.S.'} CPI-U` },
    { icon: 'clock', label: 'Time at work', value: decimal(minutes), unit: 'min / gal', note: `${decimal(minutes == null ? null : minutes * TANK)} minutes for a 14.5-gallon fill-up` }
  ].map(card => `<article class="summary-card"><div class="summary-card-top"><span class="summary-label">${icons[card.icon]}${card.label}</span><span class="small-year">${row.year}${row.preliminary ? ' EST.' : ''}</span></div><div class="summary-value">${card.value}<small>${card.unit}</small></div><p class="summary-note">${card.note}</p>${status(row)}</article>`).join('');
}
function renderChart() {
  const filtered = currentRows();
  $('chart-range').textContent = `${state.startYear} — ${state.endYear} / DFW METRO / REGULAR UNLEADED`;
  $('chart-title').textContent = metricLabels[state.metric];
  const adjustLabel = isWork() ? 'Based on DFW gross hourly earnings' : state.adjustment === 'nominal' ? 'Nominal dollars · the price in each year' : state.adjustment === 'inflation' ? `Inflation adjusted to ${state.baseYear} dollars · ${state.cpi === 'cpiDfw' ? 'DFW' : 'U.S.'} CPI-U` : `Equivalent share of ${state.baseYear} DFW hourly earnings`;
  $('chart-subtitle').textContent = adjustLabel;
  $('legend-primary').textContent = isWork() ? 'Work-based affordability' : state.adjustment === 'nominal' ? 'At the pump' : state.adjustment === 'inflation' ? 'Inflation adjusted' : 'Wage adjusted';
  const showNominal = !isWork() && state.adjustment !== 'nominal' && state.chartStyle === 'line';
  $('legend-nominal').style.display = showNominal ? 'flex' : 'none';
  const usable = filtered.filter(r => valueFor(r) != null);
  const unavailable = filtered.length - usable.length;
  $('record-count').textContent = `${usable.length} ${usable.length===1?'year':'years'}${unavailable ? ` · ${unavailable} unavailable` : ''}`;
  const container = $('chart');
  if (!usable.length) {
    const reason = !filtered.length ? 'Choose a wider range or include preliminary estimates.' : isWork() || state.adjustment === 'wage' ? 'DFW hourly earnings begin in 2007. Select a later year range.' : state.adjustment === 'inflation' && state.cpi === 'cpiDfw' ? 'DFW November CPI starts in 1998. Choose U.S. CPI or a later range.' : 'Choose a wider range or include preliminary estimates.';
    container.innerHTML = `<div class="empty-state"><strong>No data for this view.</strong><span>${reason}</span></div>`;
    return;
  }
  const width = Math.max(container.clientWidth || 700, 280), height = container.clientHeight || 350;
  const left = 43, right = 23, top = 39, bottom = 42, plotW = width-left-right, plotH = height-top-bottom;
  const values = usable.flatMap(row => [valueFor(row), ...(showNominal ? [valueFor(row,'nominal')] : [])]).filter(v => v != null);
  const peak = Math.max(...values), roughStep = peak * 1.16 / 4;
  const scale = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
  const step = [1, 2, 2.5, 5, 10].map(x=>x*scale).find(x=>x>=roughStep) || scale*10;
  const max = Math.ceil(peak * 1.12 / step) * step;
  const first = filtered[0]?.year, last = filtered.at(-1)?.year;
  const x = row => first === last ? left + plotW / 2 : left + (row.year-first)/(last-first)*plotW;
  const y = value => top + plotH * (1-value/max);
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${metricLabels[state.metric]} by election year. ${adjustLabel}. Monthly proxies; 2026 is preliminary."><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b23c2c" stop-opacity=".15"/><stop offset="100%" stop-color="#b23c2c" stop-opacity=".015"/></linearGradient></defs>`;
  for (let tick=0; tick<=max+.0001; tick+=step) {
    const label = ['price','fillup'].includes(state.metric) ? `$${tick % 1 === 0 ? tick.toFixed(0) : tick.toFixed(1)}` : decimal(tick, tick%1===0 ? 0 : 1);
    svg += `<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-axis" x="${left-12}" y="${y(tick)+3}" text-anchor="end">${label}</text>`;
  }
  const tickEvery = Math.max(1, Math.ceil(filtered.length / (width < 450 ? 5 : 10)));
  filtered.forEach((row,i) => { if (i % tickEvery === 0 || i===filtered.length-1) svg += `<text class="chart-axis" x="${x(row)}" y="${height-15}" text-anchor="middle">${row.year}</text>`; });
  const selected = usable.find(r=>r.year===state.selectedYear);
  if (selected) svg += `<line class="selected-guide" x1="${x(selected)}" x2="${x(selected)}" y1="${top-15}" y2="${height-bottom}"/>`;
  const segments = [];
  let run = [];
  for (const row of filtered) { if(valueFor(row)!=null && !row.preliminary) run.push(row); else if(run.length){segments.push(run);run=[];} }
  if(run.length) segments.push(run);
  if(state.chartStyle === 'line') {
    for(const segment of segments) if(segment.length>1) svg += `<path d="M${x(segment[0])},${y(0)} L${segment.map(r=>`${x(r)},${y(valueFor(r))}`).join(' L')} L${x(segment.at(-1))},${y(0)} Z" fill="url(#area)"/>`;
    if(showNominal) for(let i=1;i<filtered.length;i++){
      const a=filtered[i-1], b=filtered[i], av=valueFor(a,'nominal'), bv=valueFor(b,'nominal');
      if(av != null && bv != null) svg += `<path d="M${x(a)},${y(av)} L${x(b)},${y(bv)}" fill="none" stroke="#8a8772" stroke-width="1.8" ${a.preliminary||b.preliminary?'stroke-dasharray="4 5"':''}/>`;
    }
    for(let i=1;i<filtered.length;i++){
      const a=filtered[i-1], b=filtered[i], av=valueFor(a), bv=valueFor(b);
      if(av!=null&&bv!=null) svg += `<path d="M${x(a)},${y(av)} L${x(b)},${y(bv)}" fill="none" stroke="${a.preliminary||b.preliminary?'#a27520':'#b23c2c'}" stroke-width="2.5" stroke-linejoin="round" ${a.preliminary||b.preliminary?'stroke-dasharray="5 5"':''}/>`;
    }
  }
  usable.forEach(row => {
    const cx=x(row), cy=y(valueFor(row)), isSelected=row.year===state.selectedYear;
    const barW=Math.min(38,plotW/Math.max(filtered.length,2)*.55);
    svg += `<g class="chart-point" data-year="${row.year}" tabindex="0" role="button" aria-label="${row.year}: ${formatValue(valueFor(row))}. ${row.preliminary?'Preliminary estimate':'Historical monthly proxy'}. Select year.">`;
    if(state.chartStyle==='bar') svg += `<rect x="${cx-barW/2}" y="${cy}" width="${barW}" height="${y(0)-cy}" rx="3" fill="${row.preliminary?'#f1dfb3':isSelected?'#b23c2c':'#d59a7f'}" stroke="${row.preliminary?'#a27520':'none'}" ${row.preliminary?'stroke-dasharray="4 3"':''}/>`;
    else {
      if(isSelected) svg += `<circle cx="${cx}" cy="${cy}" r="9" fill="${row.preliminary?'#f1dfb3':'#f1d1bd'}"/>`;
      svg += `<circle class="point-core" cx="${cx}" cy="${cy}" r="${isSelected?4.5:3.5}" fill="${row.preliminary?'#fffaf0':'#b23c2c'}" stroke="${row.preliminary?'#a27520':'#fffaf0'}" stroke-width="${row.preliminary?2:1.5}"/>`;
    }
    svg += `<rect class="point-target" x="${cx-12}" y="${cy-15}" width="24" height="${state.chartStyle==='bar'? y(0)-cy+20:30}"/></g>`;
    if(isSelected) svg += `<text class="point-label" x="${cx}" y="${cy-17}" text-anchor="${cx>width-80?'end':cx<80?'start':'middle'}">${formatValue(valueFor(row))}${row.preliminary?'*':''}</text>`;
  });
  svg += '</svg><div id="chart-tooltip" class="chart-tooltip" hidden></div>';
  container.innerHTML=svg;
  container.querySelectorAll('[data-year]').forEach(el=>{
    const row=rows.find(r=>r.year===Number(el.dataset.year));
    const show=()=>{
      const tooltip=$('chart-tooltip');
      tooltip.innerHTML=`<strong>${row.year} · ${formatValue(valueFor(row))}</strong>${prettyDate(row.date)} · ${row.election}<small class="${row.preliminary?'tooltip-estimate':''}">${row.preliminary?'Preliminary carry-forward estimate':'Historical November monthly proxy'}<br>Price input: ${month(row.inputs.gas.month)}${isWork()||state.adjustment==='wage'?`<br>Wage input: ${month(row.inputs.wage.month)}`:''}</small>`;
      tooltip.hidden=false;
      const position=Math.min(Math.max(x(row)-80,8),width-tooltip.offsetWidth-3);
      tooltip.style.left=`${position}px`;tooltip.style.top=`${Math.max(5,Math.min(y(valueFor(row))+17,height-tooltip.offsetHeight-5))}px`;
    };
    el.addEventListener('mouseenter',show);el.addEventListener('focus',show);
    el.addEventListener('mouseleave',()=>{$('chart-tooltip').hidden=true;});
    el.addEventListener('blur',()=>{$('chart-tooltip').hidden=true;});
    const select=()=>{state.selectedYear=row.year;render();};
    el.addEventListener('click',select);
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();$('chart').querySelector(`[data-year="${row.year}"]`)?.focus();}});
  });
}
function renderDetail() {
  const visible = currentRows();
  const row=visible.find(r=>r.year===state.selectedYear);
  $('selectedYear').disabled = !row;
  if(!row){$('detail-numbers').innerHTML='<p>No years match the selected filters.</p>';$('detail-date').textContent='Try a wider range.';$('detail-status').textContent='';return;}
  $('detail-status').textContent=row.preliminary?'Preliminary estimate':'Historical proxy';
  $('detail-status').className=`status-tag ${row.preliminary?'preliminary':'historical'}`;
  $('detail-date').textContent=`${prettyDate(row.date)} · ${row.election}${row.election==='Off-year'?' calendar date':''}`;
  const mins = row.price && row.wage ? row.price / row.wage *60:null;
  $('detail-numbers').innerHTML=[
    {label:'A gallon at the pump',value:money(row.price),unit:'',note:`Price: ${month(row.inputs.gas.month)}`},
    {label:'A 14.5-gallon fill-up',value:money(row.price==null?null:row.price*TANK),unit:'',note:'Nominal dollars'},
    {label:'Time for a fill-up',value:decimal(mins==null?null:mins*TANK),unit:' min',note:row.wage?`Wage: ${money(row.wage)}/hr · ${month(row.inputs.wage.month)}`:'No published wage before 2007'},
    {label:'An hour of pay buys',value:decimal(row.price&&row.wage?row.wage/row.price:null),unit:' gal',note:row.wage?`${decimal(row.wage/(row.price*TANK),2)} fill-ups / work-hour`:'Hourly earnings unavailable'}
  ].map(d=>`<div class="detail-stat"><span>${d.label}</span><strong>${d.value}<small>${d.unit}</small></strong><p>${d.note}</p></div>`).join('');
}
function renderComparison() {
  const a=rows.find(r=>r.year===state.compareA), b=rows.find(r=>r.year===state.compareB), base=baseRow();
  if(!a||!b)return;
  const time=(r,tank=false)=>r.price&&r.wage?60*r.price/r.wage*(tank?TANK:1):null;
  const compareRows=[
    {group:'The price on the sign'},
    {label:'One gallon',note:'Dollars of the day',fn:r=>r.price,format:money},
    {label:'14.5-gallon fill-up',note:'Dollars of the day',fn:r=>r.price==null?null:r.price*TANK,format:money},
    {group:`Same ${state.baseYear} purchasing power · ${state.cpi==='cpiDfw'?'DFW':'U.S.'} CPI-U`},
    {label:'Inflation-adjusted gallon',note:`In ${state.baseYear} dollars`,fn:r=>adjustedPrice(r,'inflation',base,state.cpi),format:money},
    {label:'Inflation-adjusted fill-up',note:`14.5 gallons in ${state.baseYear} dollars`,fn:r=>{const p=adjustedPrice(r,'inflation',base,state.cpi);return p==null?null:p*TANK;},format:money},
    {label:'Wage-adjusted gallon',note:`Equivalent share of ${state.baseYear} pay`,fn:r=>adjustedPrice(r,'wage',base,state.cpi),format:money},
    {group:'The time & buying power · gross DFW average hourly earnings'},
    {label:'Minutes for one gallon',note:'Price ÷ hourly pay × 60',fn:r=>time(r),format:n=>`${decimal(n)}${n==null?'':' min'}`},
    {label:'Minutes for a fill-up',note:'14.5 gallons',fn:r=>time(r,true),format:n=>`${decimal(n)}${n==null?'':' min'}`},
    {label:'Gallons per hour of work',note:'One hour of gross pay',fn:r=>r.price&&r.wage?r.wage/r.price:null,format:n=>`${decimal(n)}${n==null?'':' gal'}`,higherBetter:true},
    {label:'Fill-ups per hour of work',note:'14.5 gallons each',fn:r=>r.price&&r.wage?r.wage/(r.price*TANK):null,format:n=>decimal(n,2),higherBetter:true},
    {label:'Average hourly earnings',note:'All private employees · before tax',fn:r=>r.wage,format:money,higherBetter:true}
  ];
  let html=`<p class="table-scroll-hint">Swipe to see the change →</p><div class="comparison-table" tabindex="0" role="region" aria-label="Year comparison; scroll horizontally for all columns"><table><thead><tr><th scope="col">THE MEASURE</th>${[a,b].map(r=>`<th scope="col"><div class="comparison-year">${r.year}</div><p>${prettyDate(r.date)} · ${r.election}</p>${status(r)}<p style="margin-top:8px">Price: ${month(r.inputs.gas.month)}<br>Wage: ${month(r.inputs.wage.month)}</p></th>`).join('')}<th scope="col">CHANGE<br><small>${a.year} → ${b.year}</small></th></tr></thead><tbody>`;
  for(const item of compareRows){
    if(item.group){html+=`<tr class="group-row"><td colspan="4">${item.group}</td></tr>`;continue;}
    const av=item.fn(a),bv=item.fn(b),change=av&&bv!=null?(bv/av-1)*100:null;
    const higher=change!=null&&(item.higherBetter?change<0:change>0);
    html+=`<tr><th scope="row">${item.label}<small>${item.note}</small></th><td><span class="number">${item.format(av)}</span></td><td><span class="number">${item.format(bv)}</span></td><td>${change==null?'<small>Unavailable</small>':`<span class="change-pill ${higher?'higher':''}">${change>0?'+':''}${change.toFixed(1)}%${a.preliminary||b.preliminary?'*':''}</span>`}</td></tr>`;
  }
  html+='</tbody></table></div>';
  $('comparison').innerHTML=html;
}
function download() {
  const header=['year','calendar_date','election_type','price_status','nominal_price_per_gallon','price_input_month','gross_hourly_wage','wage_input_month','cpi_dfw','cpi_dfw_input_month','cpi_us','cpi_us_input_month','nominal_fillup_14_5_gallons','minutes_per_gallon','minutes_per_fillup','gallons_per_work_hour','selected_metric','adjustment','reference_year','inflation_index','selected_metric_value','snapshot_date'];
  const records=currentRows().map(r=>[r.year,r.date,r.election,r.preliminary?'preliminary carry-forward estimate':'historical November monthly proxy',r.price,r.inputs.gas.month,r.wage,r.inputs.wage.month,r.cpiDfw,r.inputs.cpiDfw.month,r.cpiUs,r.inputs.cpiUs.month,r.price==null?null:r.price*TANK,metricValue(r,'minutes','nominal',baseRow(),state.cpi),metricValue(r,'tankMinutes','nominal',baseRow(),state.cpi),metricValue(r,'gallons','nominal',baseRow(),state.cpi),state.metric,isWork()?'nominal price and wage':state.adjustment,state.baseYear,state.cpi,valueFor(r),data.asOf]);
  const escape=value=>value==null?'':`"${String(value).replaceAll('"','""')}"`;
  const csv=[header,...records].map(record=>record.map(escape).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a');link.href=url;link.download=`dfw-election-gas-${state.startYear}-${state.endYear}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  const toast=$('toast');toast.textContent=`Exported ${records.length} years with source months and estimate labels.`;toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),3500);
}
function navigate() {
  const hash=location.hash.slice(1), tab=['compare','methodology'].includes(hash)?hash:['dates','sources','math','estimates'].includes(hash)?'methodology':'explore';
  for(const name of ['explore','compare','methodology']){
    $(`${name}-view`).hidden=name!==tab;
    const link=document.querySelector(`[data-tab="${name}"]`);link.classList.toggle('active',name===tab);if(name===tab)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  if(data&&tab==='explore')requestAnimationFrame(renderChart);
  if(['dates','sources','math','estimates'].includes(hash))requestAnimationFrame(()=>$(hash).scrollIntoView());
}
async function init() {
  try{
    const response=await fetch('data/observations.json');if(!response.ok)throw Error('The data file could not be loaded.');
    data=await response.json();rows=makeRows(data);
    const years=rows.map(r=>r.year);
    for(const id of ['startYear','endYear','compareA','compareB'])populate(id,years);
    populate('baseYear',years.filter(y=>y>=2007&&y<=2024&&rows.find(r=>r.year===y)?.cpiDfw&&rows.find(r=>r.year===y)?.wage));
    const params=new URLSearchParams(location.search);
    for(const key of Object.keys(defaults))if(params.has(key)){
      const raw=params.get(key);
      if(numeric.includes(key)){const n=Number(raw);if(years.includes(n)&&(!(key==='baseYear')||(n>=2007&&n<=2024)))state[key]=n;}
      else if(key==='includeEstimates')state[key]=raw==='true';
      else if(key==='adjustment'&&['nominal','inflation','wage'].includes(raw))state[key]=raw;
      else if(key==='chartStyle'&&['line','bar'].includes(raw))state[key]=raw;
      else if($(key)&&Array.from($(key).options).some(o=>o.value===raw))state[key]=raw;
    }
    if(state.startYear>state.endYear)[state.startYear,state.endYear]=[state.endYear,state.startYear];
    for(const id of fields)$(id).addEventListener('change',()=>{
      state[id]=numeric.includes(id)?Number($(id).value):$(id).value;
      if(id==='startYear'&&state.startYear>state.endYear)state.endYear=state.startYear;
      if(id==='endYear'&&state.endYear<state.startYear)state.startYear=state.endYear;
      render();
    });
    document.querySelectorAll('[name="adjustment"]').forEach(input=>input.addEventListener('change',()=>{state.adjustment=input.value;render();}));
    $('includeEstimates').addEventListener('change',()=>{state.includeEstimates=$('includeEstimates').checked;render();});
    $('reset').addEventListener('click',()=>{Object.assign(state,defaults);render();});
    $('lineView').addEventListener('click',()=>{state.chartStyle='line';render();});
    $('barView').addEventListener('click',()=>{state.chartStyle='bar';render();});
    $('download').addEventListener('click',download);
    $('swapYears').addEventListener('click',()=>{[state.compareA,state.compareB]=[state.compareB,state.compareA];render();});
    $('source-latest').innerHTML=`<div class="source-latest">${Object.entries(data.observations).map(([key,series])=>`<span>${{gas:'Gas price',wage:'Hourly wage',cpiDfw:'DFW CPI',cpiUs:'U.S. CPI'}[key]}: latest ${month(Object.keys(series).sort().at(-1))}</span>`).join('')}</div>`;
    $('loading').hidden=true;navigate();render();
    let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!$('explore-view').hidden)renderChart();},120);}).observe($('chart'));
  }catch(error){$('loading').innerHTML='<strong>The historical data could not be loaded.</strong><p>Please refresh to try again.</p>';console.error(error);}
}
window.addEventListener('hashchange',navigate);
init();
