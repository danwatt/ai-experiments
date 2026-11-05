'use strict';

(() => {
  const { months, metadata } = window.ERCOT_DATA;
  const $ = id => document.getElementById(id);
  const fuels = [
    { key: 'wind', label: 'Wind', color: '#49c5c1' },
    { key: 'solar', label: 'Solar', color: '#eab45c' },
    { key: 'hydro', label: 'Hydro', color: '#5d8ec0' },
    { key: 'biomass', label: 'Biomass', color: '#9aaf76' },
    { key: 'nuclear', label: 'Nuclear', color: '#9b8db7' },
    { key: 'gas', label: 'Natural gas', color: '#65717a' },
    { key: 'coal', label: 'Coal', color: '#38434c' },
    { key: 'other', label: 'Other', color: '#b3b9bc' },
  ];
  const firstYear = +months[0].date.slice(0, 4);
  const lastYear = +months.at(-1).date.slice(0, 4);
  const state = { start: firstYear, end: lastYear, aggregation: 'monthly', metric: 'share', focus: null, selected: months.at(-1).date, heatSource: 'renewables' };
  let periods = [], geometry;
  const pct = n => `${n.toFixed(1)}%`;
  const num = (n, digits = 1) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const share = (r, key = 'renewables') => r[key] / r.total * 100;
  const dateObject = date => new Date(`${date.length === 4 ? date + '-01' : date}-01T12:00:00Z`);
  const dateLabel = (date, short = false) => date.length === 4 ? date : dateObject(date).toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
  const monthNames = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));

  function aggregate(rows) {
    return Array.from(Map.groupBy ? Map.groupBy(rows, r => r.date.slice(0, 4)) : rows.reduce((map, r) => {
      const year = r.date.slice(0, 4);
      if (!map.has(year)) map.set(year, []);
      map.get(year).push(r);
      return map;
    }, new Map()), ([year, group]) => {
      const result = { date: year, monthCount: group.length, settlement: group.every(r => r.settlement === 'Final') ? 'Final' : group.some(r => r.settlement === 'Initial') ? 'Initial' : 'Historical' };
      for (const key of [...fuels.map(f => f.key), 'storageNet', 'total', 'renewables']) result[key] = group.reduce((s, r) => s + r[key], 0);
      return result;
    });
  }
  const annual = aggregate(months);
  const completeYears = annual.filter(r => r.monthCount === 12);
  const baseline = completeYears[0], latestComplete = completeYears.at(-1);

  function spark(id, key, color) {
    const values = completeYears.map(r => share(r, key));
    const lo = Math.min(...values) * .8, hi = Math.max(...values) * 1.05;
    const points = values.map((v, i) => `${i / (values.length - 1) * 126 + 2},${31 - (v - lo) / (hi - lo || 1) * 27}`);
    $(id).innerHTML = `<path d="M${points.join(' L')}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/><circle cx="128" cy="${points.at(-1).split(',')[1]}" r="2.5" fill="${color}"/>`;
  }

  function initSummary() {
    $('renew-start').textContent = pct(share(baseline));
    $('renew-end').textContent = pct(share(latestComplete));
    $('renew-caption').textContent = `${baseline.date} → ${latestComplete.date} · full-year shares`;
    $('solar-value').textContent = pct(share(latestComplete, 'solar'));
    $('solar-caption').textContent = `${latestComplete.date} · ${num(latestComplete.solar / 1000)} TWh generated`;
    $('coal-start').textContent = pct(share(baseline, 'coal'));
    $('coal-end').textContent = pct(share(latestComplete, 'coal'));
    $('coal-caption').textContent = `${baseline.date} → ${latestComplete.date} · full-year shares`;
    $('coverage-label').textContent = `${firstYear} — ${lastYear}`;
    $('coverage-count').textContent = `${months.length} months · Official ERCOT data`;
    spark('spark-renew', 'renewables', '#49c5c1');
    spark('spark-solar', 'solar', '#eab45c');
    spark('spark-coal', 'coal', '#a0adb4');
    $('takeaway-title').textContent = `Renewables up. Total generation up.`;
    $('takeaway-text').textContent = `Between ${baseline.date} and ${latestComplete.date}, renewable generation grew ${num(latestComplete.renewables / baseline.renewables)}×, while total generation grew ${num((latestComplete.total / baseline.total - 1) * 100, 0)}%. The shift is visible in both the shares and the terawatt-hours.`;
    const snapshot = new Date(metadata.retrieved + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    $('snapshot-date').textContent = `Data snapshot · ${snapshot}`;
    $('source-description').innerHTML = `Official <a href="${metadata.sourcePage}" target="_blank" rel="noopener">ERCOT Fuel Mix Reports</a>, ${dateLabel(months[0].date)}–${dateLabel(months.at(-1).date)}. Monthly summaries are used directly; ${firstYear} is summed from reported daily energy. Downloaded ${snapshot}. Source workbook links and processing notes are in the README.`;
  }

  function renderControls() {
    const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
    $('start-year').innerHTML = years.map(y => `<option value="${y}" ${y === state.start ? 'selected' : ''} ${y > state.end ? 'disabled' : ''}>${y}</option>`).join('');
    $('end-year').innerHTML = years.map(y => `<option value="${y}" ${y === state.end ? 'selected' : ''} ${y < state.start ? 'disabled' : ''}>${y}</option>`).join('');
    document.querySelectorAll('[data-range]').forEach(button => {
      const start = button.dataset.range === 'all' ? firstYear : Math.max(firstYear, lastYear - +button.dataset.range + 1);
      const active = state.start === start && state.end === lastYear;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-metric]').forEach(button => {
      const active = state.metric === button.dataset.metric;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('aggregation').value = state.aggregation;
  }

  function renderLegend() {
    $('legend').innerHTML = fuels.map(f => `<button data-fuel="${f.key}" aria-pressed="${state.focus === f.key}" aria-label="${state.focus === f.key ? 'Clear' : 'Highlight'} ${f.label}" class="${state.focus && state.focus !== f.key ? 'dimmed' : ''}"><i class="swatch" style="--fuel:${f.color}"></i>${f.label}</button>`).join('');
    $('reset-focus').hidden = !state.focus;
  }

  function renderChart() {
    const rows = months.filter(r => +r.date.slice(0, 4) >= state.start && +r.date.slice(0, 4) <= state.end);
    periods = state.aggregation === 'annual' ? aggregate(rows) : rows;
    let selected = state.selected;
    if (state.aggregation === 'annual') selected = selected.slice(0, 4);
    else if (selected.length === 4) selected = periods.filter(r => r.date.startsWith(selected)).at(-1)?.date;
    state.selected = periods.some(r => r.date === selected) ? selected : periods.at(-1).date;
    const svg = $('mix-chart');
    const width = Math.max(260, Math.round(svg.getBoundingClientRect().width));
    const mobile = width < 500;
    const height = mobile ? 260 : 340;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const left = mobile ? 29 : 37, right = 10, top = 28, bottom = 30;
    const pw = width - left - right, ph = height - top - bottom;
    const step = pw / periods.length;
    const maxValue = Math.max(...periods.map(r => r.total / 1000));
    const increment = state.aggregation === 'annual' ? 100 : 10;
    const max = state.metric === 'share' ? 100 : Math.ceil(maxValue / increment) * increment;
    const y = v => top + ph - v / max * ph;
    geometry = { width, height, left, right, top, bottom, step, pw, ph };
    let markup = `<title id="chart-title">ERCOT ${state.aggregation} electricity generation mix, ${state.start}–${state.end}</title><desc id="chart-desc">Stacked columns show eight generation sources in ${state.metric === 'share' ? 'percent of total generation' : 'terawatt-hours'}. The slider below selects exact values shown in the detail panel. Storage charging is excluded from generation.</desc>`;
    for (let i = 0; i <= 4; i++) {
      const v = max / 4 * i;
      markup += `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 8}" y="${y(v) + 3}" text-anchor="end" style="font-size:${mobile ? 8 : 9}px">${num(v, v % 1 ? 1 : 0)}${state.metric === 'share' ? '%' : ''}</text>`;
    }
    markup += `<text class="axis-label" x="${left}" y="12" style="font-size:8px">${state.metric === 'share' ? 'SHARE OF GENERATION (%)' : 'ENERGY GENERATED (TWh)'}</text>`;
    markup += '<g id="selection-background"></g>';
    periods.forEach((r, i) => {
      let positive = 0, negative = 0;
      for (const f of fuels) {
        const value = state.metric === 'share' ? share(r, f.key) : r[f.key] / 1000;
        // Preserve the few small, signed Other values. Negative energy starts at zero.
        const base = value >= 0 ? positive : negative;
        const barY = value >= 0 ? y(base + value) : y(base);
        markup += `<rect class="plotbar" data-fuel="${f.key}" x="${left + i * step + step * .09}" y="${barY}" width="${step * .82}" height="${Math.abs(value) / max * ph}" fill="${f.color}" opacity="${!state.focus || state.focus === f.key ? 1 : .15}"/>`;
        if (value >= 0) positive += value; else negative += value;
      }
    });
    const yearStep = state.end - state.start > 12 ? (mobile ? 5 : 3) : state.end - state.start > 5 ? (mobile ? 3 : 2) : (mobile ? 2 : 1);
    const labels = [];
    periods.forEach((r, i) => {
      const year = +r.date.slice(0, 4);
      if ((state.aggregation === 'annual' || r.date.endsWith('-01')) && (year - state.start) % yearStep === 0) {
        labels.push({ i, label: year });
      }
    });
    if (state.start === state.end && state.aggregation === 'monthly') {
      labels.length = 0;
      periods.forEach((r, i) => { if (i % (mobile ? 2 : 1) === 0) labels.push({ i, label: monthNames[+r.date.slice(5) - 1] }); });
    }
    for (const { i, label } of labels) markup += `<text text-anchor="middle" x="${left + (i + .5) * step}" y="${height - 10}" style="font-size:${mobile ? 8 : 9}px">${label}</text>`;
    markup += '<g id="selection-indicator"></g>';
    svg.innerHTML = markup;
    $('plot-title').textContent = `${state.aggregation === 'annual' ? 'Annual' : 'Monthly'} generation mix`;
    $('plot-subtitle').textContent = `${dateLabel(periods[0].date, true)} – ${dateLabel(periods.at(-1).date, true)} · ${periods.length} ${state.aggregation === 'annual' ? 'years' : 'months'}${state.aggregation === 'annual' && periods.at(-1).monthCount < 12 ? ' · latest year is partial (YTD)' : ''}`;
    $('range-start').textContent = dateLabel(periods[0].date, true);
    $('range-end').textContent = dateLabel(periods.at(-1).date, true);
    $('source-range').textContent = `Source: ERCOT Fuel Mix Reports · ${metadata.unit} → TWh`;
    $('month-slider').max = periods.length - 1;
    updateSelection();
  }

  function updateSelection() {
    const i = periods.findIndex(r => r.date === state.selected);
    const r = periods[i];
    if (!r || !geometry) return;
    const { left, step, top, ph } = geometry;
    const x = left + (i + .5) * step;
    $('selection-background').innerHTML = `<rect class="selection-band" x="${left + i * step}" y="${top}" width="${step}" height="${ph}"/>`;
    $('selection-indicator').innerHTML = `<line class="selection-line" x1="${x}" x2="${x}" y1="${top}" y2="${top + ph}"/><circle cx="${x}" cy="${top + ph + 1}" r="2.4" fill="#eab45c"/>`;
    $('month-slider').value = i;
    $('month-slider').setAttribute('aria-valuetext', `${dateLabel(r.date)}, ${pct(share(r))} renewable, ${num(r.total / 1000)} terawatt-hours total${r.monthCount && r.monthCount < 12 ? ', partial year' : ''}`);
    $('detail-date').textContent = `${dateLabel(r.date)}${r.monthCount && r.monthCount < 12 ? ' · YTD' : ''}`;
    $('detail-total').textContent = num(r.total / 1000, 2);
    $('detail-renewable').textContent = pct(share(r));
    $('breakdown').innerHTML = fuels.map(f => `<div class="fuel-row ${state.focus && state.focus !== f.key ? 'dimmed' : ''}"><span><i class="swatch" style="--fuel:${f.color}"></i>${f.label}</span><span>${num(r[f.key] / 1000, 2)}</span><span>${pct(share(r, f.key))}</span></div>`).join('');
    const storage = Math.abs(r.storageNet) > .000001 ? `Storage (WSL): ${r.storageNet < 0 ? '−' : '+'}${num(Math.abs(r.storageNet) / 1000, 2)} TWh net; excluded above. ` : '';
    const status = r.settlement === 'Final' ? 'Final settlements.' : r.settlement === 'Initial' ? 'Includes initial settlements; subject to revision.' : 'Historical ERCOT report.';
    const coverage = r.monthCount && r.monthCount < 12 ? `${r.monthCount} published months only. ` : '';
    $('detail-status').textContent = `${coverage}${storage}${status} Shares may not sum to 100% due to rounding.`;
    $('previous-month').disabled = i === 0;
    $('next-month').disabled = i === periods.length - 1;
    document.querySelectorAll('.heat-cell.selected').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.heat-cell[data-date="${r.date}"]`)?.classList.add('selected');
  }

  function renderAll() { renderControls(); renderLegend(); renderChart(); }
  function selectPeriod(i) {
    if (i >= 0 && i < periods.length) { state.selected = periods[i].date; updateSelection(); }
  }
  function setFocus(fuel) {
    state.focus = state.focus === fuel ? null : fuel;
    renderLegend();
    document.querySelectorAll('.plotbar').forEach(el => el.setAttribute('opacity', !state.focus || state.focus === el.dataset.fuel ? '1' : '.15'));
    updateSelection();
  }

  function renderHeatmap() {
    const names = { renewables: 'Renewable', wind: 'Wind', solar: 'Solar', coal: 'Coal', gas: 'Natural gas', nuclear: 'Nuclear' };
    const rows = new Map(months.map(r => [r.date, r]));
    let markup = '<span></span>' + monthNames.map(n => `<span class="month-label">${n.toUpperCase()}</span>`).join('');
    for (let year = firstYear; year <= lastYear; year++) {
      markup += `<span class="year-label">${year}</span>`;
      for (let month = 1; month <= 12; month++) {
        const date = `${year}-${String(month).padStart(2, '0')}`, r = rows.get(date);
        if (!r) { markup += `<span class="heat-cell missing" aria-label="${dateLabel(date)}: no published data">—</span>`; continue; }
        const value = share(r, state.heatSource), t = Math.min(1, Math.max(0, value / 60));
        const stops = [[26, 39, 46], [37, 107, 113], [94, 219, 207]];
        const a = t < .5 ? stops[0] : stops[1], b = t < .5 ? stops[1] : stops[2];
        const u = t < .5 ? t * 2 : (t - .5) * 2;
        const color = a.map((v, i) => Math.round(v + (b[i] - v) * u));
        const label = `${dateLabel(date)} · ${pct(value)} ${names[state.heatSource].toLowerCase()}`;
        markup += `<button class="heat-cell ${state.selected === date ? 'selected' : ''}" style="background:rgb(${color.join(',')});color:${t > .58 ? '#0b1b20' : '#d7eeee'}" data-date="${date}" title="${label}" aria-label="${label}. Show generation breakdown."><span>${Math.round(value)}</span></button>`;
      }
    }
    $('heatmap').innerHTML = markup;
    $('heatmap-title').textContent = `${names[state.heatSource]} share, month by month`;
    $('heatmap').setAttribute('aria-label', `Monthly ${names[state.heatSource].toLowerCase()} share heatmap, ${firstYear} to ${lastYear}`);
    $('heatmap-caption').textContent = state.heatSource === 'renewables' ? 'Wind + solar + hydro + separately reported biomass' : `${names[state.heatSource]} as a share of all generation`;
  }

  document.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => { state.metric = b.dataset.metric; renderAll(); }));
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    state.start = b.dataset.range === 'all' ? firstYear : Math.max(firstYear, lastYear - +b.dataset.range + 1);
    state.end = lastYear;
    renderAll();
  }));
  $('start-year').addEventListener('change', e => { state.start = +e.target.value; renderAll(); });
  $('end-year').addEventListener('change', e => { state.end = +e.target.value; renderAll(); });
  $('aggregation').addEventListener('change', e => { state.aggregation = e.target.value; renderAll(); });
  $('legend').addEventListener('click', e => { const b = e.target.closest('[data-fuel]'); if (b) setFocus(b.dataset.fuel); });
  $('reset-focus').addEventListener('click', () => setFocus(state.focus));
  $('month-slider').addEventListener('input', e => selectPeriod(+e.target.value));
  $('previous-month').addEventListener('click', () => selectPeriod(periods.findIndex(r => r.date === state.selected) - 1));
  $('next-month').addEventListener('click', () => selectPeriod(periods.findIndex(r => r.date === state.selected) + 1));
  $('mix-chart').addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    inspectPointer(e, true);
  });
  $('mix-chart').addEventListener('click', e => inspectPointer(e, false));
  $('mix-chart').addEventListener('pointerleave', () => { $('chart-tooltip').hidden = true; });
  function inspectPointer(e, tooltip) {
    const rect = $('mix-chart').getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * geometry.width;
    const y = (e.clientY - rect.top) / rect.height * geometry.height;
    if (x < geometry.left || x > geometry.width - geometry.right || y < geometry.top || y > geometry.top + geometry.ph) { $('chart-tooltip').hidden = true; return; }
    selectPeriod(Math.min(periods.length - 1, Math.floor((x - geometry.left) / geometry.step)));
    const r = periods.find(r => r.date === state.selected);
    $('chart-tooltip').innerHTML = `<strong>${dateLabel(r.date)}${r.monthCount && r.monthCount < 12 ? ' · YTD' : ''}</strong><span>${pct(share(r))} renewable · ${num(r.total / 1000, 2)} TWh total</span>`;
    $('chart-tooltip').hidden = !tooltip;
  }
  $('heat-source').addEventListener('change', e => { state.heatSource = e.target.value; renderHeatmap(); });
  $('heatmap').addEventListener('click', e => {
    const cell = e.target.closest('[data-date]');
    if (!cell) return;
    state.selected = cell.dataset.date;
    const year = +state.selected.slice(0, 4);
    if (year < state.start) state.start = year;
    if (year > state.end) state.end = year;
    state.aggregation = 'monthly';
    renderAll();
    $('explore').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  // Spatial keyboard navigation within the 12-column monthly grid.
  $('heatmap').addEventListener('keydown', e => {
    const cell = e.target.closest('[data-date]');
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -12, ArrowDown: 12 }[e.key];
    if (!cell || !offset) return;
    const i = months.findIndex(r => r.date === cell.dataset.date) + offset;
    if (i >= 0 && i < months.length) { e.preventDefault(); document.querySelector(`.heat-cell[data-date="${months[i].date}"]`)?.focus(); }
  });
  initSummary(); renderAll(); renderHeatmap();
  if ('ResizeObserver' in window) {
    let lastWidth = $('mix-chart').getBoundingClientRect().width;
    new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (Math.abs(width - lastWidth) > 1) { lastWidth = width; renderChart(); }
    }).observe($('mix-chart').parentElement);
  }
})();
