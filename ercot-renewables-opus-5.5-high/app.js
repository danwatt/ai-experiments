(function () {
  'use strict';

  const D = window.ERCOT;
  const F = D.fuels;
  const N = D.months.length;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Display series, bottom of the stack first. Colors come from CSS custom properties.
  const SOURCES = [
    { key: 'wind', label: 'Wind', css: '--s-wind', get: i => F.wind[i] },
    { key: 'solar', label: 'Solar', css: '--s-solar', get: i => F.solar[i] },
    { key: 'hydro', label: 'Hydro & biomass', css: '--s-hydro', get: i => F.hydro[i] + F.biomass[i] },
    { key: 'nuclear', label: 'Nuclear', css: '--s-nuclear', get: i => F.nuclear[i] },
    { key: 'gas', label: 'Natural gas', css: '--s-gas', get: i => F.gasCC[i] + F.gasOther[i] + F.gasUnsplit[i] },
    { key: 'other', label: 'Other / storage', css: '--s-other', get: i => F.other[i] },
    { key: 'coal', label: 'Coal', css: '--s-coal', get: i => F.coal[i] }
  ];
  const GROUPS = [
    { label: 'Renewables', css: '--s-wind', keys: ['wind', 'solar', 'hydro'] },
    { label: 'Natural gas', css: '--s-gas', keys: ['gas'] },
    { label: 'Nuclear', css: '--s-nuclear', keys: ['nuclear'] },
    { label: 'Coal', css: '--s-coal', keys: ['coal'] }
  ];
  const HEAT = {
    windsolar: { label: 'Wind + solar', keys: ['wind', 'solar'] },
    solar: { label: 'Solar', keys: ['solar'] },
    coal: { label: 'Coal', keys: ['coal'] },
    gas: { label: 'Natural gas', keys: ['gas'] }
  };

  // Precompute GWh per source and month, plus totals (battery charging excluded).
  const V = {};
  // a few months report slightly negative "Other" (net consumption); clamp so the stack stays well formed
  SOURCES.forEach(s => { V[s.key] = D.months.map((_, i) => Math.max(0, s.get(i))); });
  const TOTAL = D.months.map((_, i) => SOURCES.reduce((a, s) => a + V[s.key][i], 0));
  const year = i => +D.months[i].slice(0, 4);
  const monthOf = i => +D.months[i].slice(5, 7) - 1;
  const label = i => MON[monthOf(i)] + ' ' + year(i);
  const sumKeys = (keys, i) => keys.reduce((a, k) => a + V[k][i], 0);
  const share = (keys, i) => 100 * sumKeys(keys, i) / TOTAL[i];
  const indexOf = (y, m) => D.months.indexOf(y + '-' + String(m + 1).padStart(2, '0'));
  const firstYear = year(0);
  const lastYear = year(N - 1);

  const pct = (v, d = 1) => v.toFixed(d) + '%';
  const twh = (gwh, d = 1) => (gwh / 1000).toFixed(d) + ' TWh';
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const alpha = (hex, a) => `rgba(${rgb(hex).join(', ')}, ${a})`;
  // opaque mix of a color over the surface, so overlapping area edges never darken
  const tint = (hex, a) => {
    const c = rgb(hex), s = rgb(css('--surface'));
    return `rgb(${c.map((v, k) => Math.round(v * a + s[k] * (1 - a))).join(', ')})`;
  };
  const isDark = () => document.documentElement.getAttribute('data-bs-theme') === 'dark';

  const state = { from: firstYear, to: lastYear, unit: 'share', focus: N - 1, cmp: 10, heat: 'windsolar' };
  const charts = {};

  function rangeIdx() {
    const out = [];
    for (let i = 0; i < N; i++) if (year(i) >= state.from && year(i) <= state.to) out.push(i);
    return out;
  }

  function sumRange(keys, lo, hi) {
    let a = 0, t = 0;
    for (let i = lo; i <= hi; i++) { a += sumKeys(keys, i); t += TOTAL[i]; }
    return { gwh: a, share: 100 * a / t };
  }

  // ---------- headline ----------

  function renderStats() {
    const hi = N - 1, lo = N - 12;
    const lo10 = lo - 120, hi10 = hi - 120;
    const ws = sumRange(['wind', 'solar'], lo, hi);
    const ws10 = sumRange(['wind', 'solar'], lo10, hi10);
    const coal = sumRange(['coal'], lo, hi);
    const coal07 = sumRange(['coal'], 0, 11);
    const solar = sumRange(['solar'], lo, hi);
    const solar10 = sumRange(['solar'], lo10, hi10);
    let best = 0;
    for (let i = 1; i < N; i++) if (share(['wind', 'solar'], i) > share(['wind', 'solar'], best)) best = i;
    const span = (a, b) => `${label(a)} – ${label(b)}`;

    const tiles = [
      { k: 'Wind + solar, last 12 months', v: pct(ws.share), d: `up from ${pct(ws10.share)} ten years earlier`, t: span(lo, hi) },
      { k: 'Coal, last 12 months', v: pct(coal.share), d: `down from ${pct(coal07.share)} in ${firstYear}`, t: span(lo, hi) },
      { k: 'Solar, last 12 months', v: twh(solar.gwh, 0), d: `up from ${twh(solar10.gwh)} ten years earlier`, t: `${Math.round(solar.gwh / solar10.gwh)}× growth` },
      { k: 'Best wind + solar month', v: pct(share(['wind', 'solar'], best)), d: label(best), t: `${twh(sumKeys(['wind', 'solar'], best))} of ${twh(TOTAL[best])}` }
    ];
    document.getElementById('stats').innerHTML = tiles.map(t => `
      <div class="col-6 col-lg-3">
        <div class="card h-100"><div class="card-body">
          <div class="stat-label mb-1">${t.k}</div>
          <div class="stat-value">${t.v}</div>
          <div class="stat-delta mt-1">${t.d}</div>
          <div class="small text-muted-ink">${t.t}</div>
        </div></div>
      </div>`).join('');

    const w07 = sumRange(['wind'], 0, 11).share;
    document.getElementById('lede').textContent =
      `In ${firstYear}, wind supplied ${pct(w07, 0)} of the electricity on Texas's main grid and solar almost none. ` +
      `Over the last 12 months, wind and solar together supplied ${pct(ws.share, 0)}, while coal fell from ` +
      `${pct(coal07.share, 0)} to ${pct(coal.share, 0)}. Monthly data from ERCOT's fuel mix reports, ${label(0)} to ${label(N - 1)}.`;
    document.getElementById('coverage').textContent = `This page covers ${label(0)} – ${label(N - 1)}; built ${D.built}.`;
  }

  // ---------- shared chart bits ----------

  function legend(el, items) {
    document.getElementById(el).innerHTML = items.map(it =>
      `<span><i class="${it.faded ? 'faded' : ''}" style="background:${it.color}"></i>${it.label}</span>`).join('');
  }

  function baseScales() {
    return {
      grid: { color: css('--grid'), drawTicks: false },
      border: { color: css('--axis') },
      ticks: { color: css('--muted'), padding: 6, font: { size: 11 } }
    };
  }

  const tooltipStyle = () => ({
    backgroundColor: css('--surface'),
    titleColor: css('--ink'),
    bodyColor: css('--ink-2'),
    footerColor: css('--ink'),
    borderColor: css('--hairline'),
    borderWidth: 1,
    padding: 10,
    boxPadding: 4,
    usePointStyle: true,
    titleFont: { weight: '600' },
    footerFont: { weight: '600' }
  });

  // vertical hairline under the hovered month, plus a marker for the focus month
  const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart, _, opts) {
      const { ctx, chartArea: a } = chart;
      const x = chart.scales.x;
      const line = (px, color, w) => {
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore();
      };
      if (opts.focusIndex != null && opts.focusIndex >= 0) {
        const px = x.getPixelForValue(opts.focusIndex);
        line(px, css('--ink'), 1.5);
        ctx.save();
        ctx.fillStyle = css('--ink'); ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = px > a.right - 60 ? 'right' : 'left';
        ctx.fillText(opts.focusLabel, px + (ctx.textAlign === 'right' ? -4 : 4), a.top + 12);
        ctx.restore();
      }
      const act = chart.tooltip && chart.tooltip.getActiveElements();
      if (act && act.length) line(act[0].element.x, css('--ink-2'), 1);
    }
  };

  // ---------- monthly mix ----------

  function renderMix() {
    const idx = rangeIdx();
    const asShare = state.unit === 'share';
    const surface = css('--surface');
    const datasets = SOURCES.map((s, k) => ({
      label: s.label,
      key: s.key,
      data: idx.map(i => asShare ? 100 * V[s.key][i] / TOTAL[i] : V[s.key][i] / 1000),
      backgroundColor: tint(css(s.css), 0.88),
      borderColor: surface,
      borderWidth: 1,
      pointRadius: 0,
      pointHoverRadius: 0,
      pointStyle: 'rectRounded',
      fill: k === 0 ? 'origin' : '-1',
      tension: 0
    }));
    const years = state.to - state.from + 1;
    const x = baseScales();
    const y = baseScales();
    x.grid = { display: false };
    x.ticks = Object.assign(x.ticks, {
      autoSkip: false, maxRotation: 0,
      // label Januaries, thinning years to ~40px apiece on narrow charts
      callback: function (v) {
        const i = idx[v];
        const step = Math.max(1, Math.ceil(years * 40 / this.width));
        return monthOf(i) === 0 && (year(i) - state.from) % step === 0 ? year(i) : '';
      }
    });
    Object.assign(y, { stacked: true, beginAtZero: true });
    if (asShare) { y.max = 100; y.ticks.stepSize = 20; y.ticks.callback = v => v + '%'; } else { y.ticks.callback = v => v + ' TWh'; }

    const fi = idx.indexOf(state.focus);
    const cfg = {
      type: 'line',
      data: { labels: idx.map(label), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: { x, y },
        onClick: (ev, els, chart) => {
          const hit = chart.getElementsAtEventForMode(ev, 'index', { intersect: false }, false);
          if (hit.length) setFocus(idx[hit[0].index]);
        },
        plugins: {
          legend: { display: false },
          crosshair: { focusIndex: fi, focusLabel: fi >= 0 ? label(state.focus) : '' },
          tooltip: Object.assign(tooltipStyle(), {
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
            callbacks: {
              label: c => {
                const i = idx[c.dataIndex];
                const v = V[c.dataset.key][i];
                let txt = `${c.dataset.label}: ${pct(100 * v / TOTAL[i])} · ${twh(v, 2)}`;
                if (c.dataset.key === 'gas' && F.gasCC[i] > 0) {
                  txt = [txt, `   combined cycle ${twh(F.gasCC[i], 2)}, other ${twh(F.gasOther[i], 2)}`];
                }
                return txt;
              },
              footer: items => {
                const i = idx[items[0].dataIndex];
                return [`Total ${twh(TOTAL[i])}`, `Wind + solar ${pct(share(['wind', 'solar'], i))}`];
              }
            }
          })
        }
      },
      plugins: [crosshair]
    };
    replace('mix', cfg);
    legend('legend-mix', SOURCES.slice().reverse().map(s => ({ label: s.label, color: css(s.css) })));
    document.getElementById('mix-sub').textContent = (asShare
      ? 'Share of each month\'s generation, '
      : 'Generation per month in terawatt-hours, ') + `${state.from}–${state.to}. Click a month to focus it below.`;
  }

  // ---------- focus month ----------

  function cmpIndex() {
    const y = year(state.focus) - state.cmp;
    return indexOf(y, monthOf(state.focus));
  }

  function renderFocus() {
    const f = state.focus;
    const c = cmpIndex();
    const asShare = state.unit === 'share';
    const val = (k, i) => asShare ? 100 * V[k][i] / TOTAL[i] : V[k][i] / 1000;
    const fmt = v => asShare ? pct(v) : v.toFixed(2) + ' TWh';
    const colors = SOURCES.map(s => css(s.css));
    const datasets = [];
    if (c >= 0) {
      datasets.push({
        label: label(c), when: c,
        data: SOURCES.map(s => val(s.key, c)),
        backgroundColor: colors.map(col => alpha(col, 0.32)),
        borderRadius: 4, borderSkipped: 'start',
        barPercentage: 0.9, categoryPercentage: 0.8
      });
    }
    datasets.push({
      label: label(f), when: f,
      data: SOURCES.map(s => val(s.key, f)),
      backgroundColor: colors,
      borderRadius: 4, borderSkipped: 'start',
      barPercentage: 0.9, categoryPercentage: 0.8
    });

    // value label at the end of each focus-month bar
    const endLabels = {
      id: 'endLabels',
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(chart.data.datasets.length - 1);
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = css('--ink'); ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        meta.data.forEach((bar, k) => ctx.fillText(fmt(meta._dataset.data[k]), bar.x + 6, bar.y));
        ctx.restore();
      }
    };
    const x = baseScales();
    const y = baseScales();
    x.beginAtZero = true;
    x.ticks.callback = v => asShare ? v + '%' : v + ' TWh';
    y.grid = { display: false };
    y.ticks.color = css('--ink-2');
    y.ticks.font = { size: 12 };
    replace('month', {
      type: 'bar',
      data: { labels: SOURCES.map(s => s.label), datasets },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 64 } },
        interaction: { mode: 'index', intersect: false, axis: 'y' },
        scales: { x, y },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign(tooltipStyle(), {
            callbacks: {
              labelColor: t => ({ backgroundColor: t.dataset.backgroundColor[t.dataIndex], borderColor: 'transparent' }),
              label: t => {
                const i = t.dataset.when;
                const k = SOURCES[t.dataIndex].key;
                return `${t.dataset.label}: ${pct(100 * V[k][i] / TOTAL[i])} · ${twh(V[k][i], 2)}`;
              }
            }
          })
        }
      },
      plugins: [endLabels]
    });

    const neutral = css('--ink-2');
    const items = [{ label: label(f), color: neutral }];
    if (c >= 0) items.unshift({ label: label(c) + ' (faded)', color: neutral, faded: true });
    legend('legend-focus', items);
    document.getElementById('focus-title').textContent = `${label(f)}${c >= 0 ? ' vs ' + label(c) : ''}`;
    const ws = share(['wind', 'solar'], f);
    document.getElementById('focus-sub').textContent = c >= 0
      ? `Wind + solar ${pct(ws)} vs ${pct(share(['wind', 'solar'], c))}. Total generation ${twh(TOTAL[f])} vs ${twh(TOTAL[c])}.`
      : `Wind + solar ${pct(ws)}. Total generation ${twh(TOTAL[f])}. No data ${state.cmp} years earlier.`;
  }

  // ---------- annual ----------

  function renderAnnual() {
    const years = [];
    for (let y = state.from; y <= state.to; y++) years.push(y);
    const months = y => D.months.map((m, i) => i).filter(i => year(i) === y);
    const partial = y => months(y).length < 12;
    const series = GROUPS.map(g => ({
      label: g.label,
      color: css(g.css),
      data: years.map(y => {
        const ms = months(y);
        return 100 * ms.reduce((a, i) => a + sumKeys(g.keys, i), 0) / ms.reduce((a, i) => a + TOTAL[i], 0);
      })
    }));
    const labels = years.map(y => partial(y) ? `${y}*` : String(y));

    // series name + latest value beside each line's last point, nudged apart so they never overlap
    const endLabels = {
      id: 'annualLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const pts = chart.data.datasets.map((ds, k) => {
          const el = chart.getDatasetMeta(k).data[ds.data.length - 1];
          return { x: el.x, y: el.y, text: `${ds.label} ${pct(ds.data[ds.data.length - 1], 0)}`, color: ds.borderColor };
        }).sort((a, b) => a.y - b.y);
        for (let k = 1; k < pts.length; k++) if (pts[k].y - pts[k - 1].y < 14) pts[k].y = pts[k - 1].y + 14;
        ctx.save();
        ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        pts.forEach(p => {
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x + 10, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = css('--ink-2'); ctx.fillText(p.text, p.x + 18, p.y);
        });
        ctx.restore();
      }
    };
    const x = baseScales();
    const y = baseScales();
    x.grid = { display: false };
    x.ticks.maxRotation = 0;
    x.ticks.autoSkipPadding = 8;
    y.beginAtZero = true;
    y.ticks.callback = v => v + '%';
    replace('annual', {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label, data: s.data,
          borderColor: s.color, backgroundColor: s.color,
          borderWidth: 2, pointRadius: years.length > 12 ? 0 : 3, pointHoverRadius: 5,
          pointBorderColor: css('--surface'), pointBorderWidth: 2, pointStyle: 'circle', tension: 0
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 128 } },
        interaction: { mode: 'index', intersect: false },
        scales: { x, y },
        plugins: {
          legend: { display: false },
          crosshair: {},
          tooltip: Object.assign(tooltipStyle(), {
            itemSort: (a, b) => b.raw - a.raw,
            callbacks: {
              title: t => {
                const y = years[t[0].dataIndex];
                const ms = months(y);
                return partial(y) ? `${y} (${MON[monthOf(ms[0])]}–${MON[monthOf(ms[ms.length - 1])]})` : String(y);
              },
              label: t => `${t.dataset.label}: ${pct(t.raw)}`
            }
          })
        }
      },
      plugins: [crosshair, endLabels]
    });
    const items = series.map(s => ({ label: s.label, color: s.color }));
    legend('legend-annual', items);
    if (years.some(partial)) {
      document.getElementById('legend-annual').insertAdjacentHTML('beforeend', '<span>* partial year</span>');
    }
  }

  // ---------- heatmap ----------

  function renderHeat() {
    const m = HEAT[state.heat];
    // fixed scale per metric across all years, so changing the range never rescales colors
    let max = 0;
    for (let i = 0; i < N; i++) max = Math.max(max, share(m.keys, i));
    const top = Math.ceil(max / 10) * 10;
    const STEPS = 8;
    const bin = v => Math.min(STEPS - 1, Math.floor(v / top * STEPS));
    const ramp = Array.from({ length: STEPS }, (_, k) => css('--seq-' + k));
    const dark = isDark();
    const ink = b => dark ? (b >= 6 ? '#0b0b0b' : css('--ink')) : (b >= 4 ? '#ffffff' : css('--ink'));

    let html = '<thead><tr><th class="yr"></th>' + MON.map(n => `<th scope="col">${n}</th>`).join('') + '</tr></thead><tbody>';
    for (let y = state.from; y <= state.to; y++) {
      html += `<tr><th scope="row" class="yr">${y}</th>`;
      for (let mo = 0; mo < 12; mo++) {
        const i = indexOf(y, mo);
        if (i < 0) { html += '<td class="na">–</td>'; continue; }
        const v = share(m.keys, i);
        const b = bin(v);
        const tip = `${label(i)}: ${m.label} ${pct(v)} (${twh(sumKeys(m.keys, i), 2)} of ${twh(TOTAL[i])})`;
        html += `<td style="background:${ramp[b]};color:${ink(b)}" title="${tip}" aria-label="${tip}">${v.toFixed(0)}</td>`;
      }
      html += '</tr>';
    }
    document.getElementById('heat').innerHTML = html + '</tbody>';
    document.getElementById('heat-scale').innerHTML =
      `<span class="me-1">${m.label} share: 0%</span>` +
      ramp.map(c => `<i style="background:${c}"></i>`).join('') +
      `<span class="ms-1">${top}%</span>`;
  }

  // ---------- table + CSV ----------

  const COLS = [
    ['Wind', i => F.wind[i]], ['Solar', i => F.solar[i]], ['Hydro', i => F.hydro[i]], ['Biomass', i => F.biomass[i]],
    ['Nuclear', i => F.nuclear[i]], ['Gas CC', i => F.gasCC[i]], ['Gas other', i => F.gasOther[i]],
    ['Gas (unsplit)', i => F.gasUnsplit[i]], ['Coal', i => F.coal[i]], ['Other', i => F.other[i]],
    ['Battery charging', i => F.storageCharge[i]], ['Total', i => TOTAL[i]]
  ];

  function renderTable() {
    const idx = rangeIdx().reverse();
    const n0 = v => Math.round(v).toLocaleString();
    let html = '<thead><tr><th scope="col">Month</th>' + COLS.map(c => `<th scope="col">${c[0]}</th>`).join('') +
      '<th scope="col">Wind + solar %</th></tr></thead><tbody>';
    idx.forEach(i => {
      html += `<tr><td>${label(i)}</td>` + COLS.map(c => `<td>${n0(c[1](i))}</td>`).join('') +
        `<td>${pct(share(['wind', 'solar'], i))}</td></tr>`;
    });
    document.getElementById('table').innerHTML = html + '</tbody>';
  }

  function downloadCsv() {
    const rows = [['month', ...COLS.map(c => c[0].toLowerCase().replace(/[^a-z]+/g, '_').replace(/_$/, '') + '_gwh')]];
    for (let i = 0; i < N; i++) rows.push([D.months[i], ...COLS.map(c => c[1](i).toFixed(1))]);
    const blob = new Blob([rows.map(r => r.join(',')).join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ercot-monthly-generation-by-fuel.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- controls ----------

  function replace(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }

  function setFocus(i) {
    state.focus = i;
    document.getElementById('focus').value = String(i);
    renderMix();
    renderFocus();
  }

  function fillCmp() {
    const sel = document.getElementById('cmp');
    const opts = [1, 5, 10, 15].filter(n => indexOf(year(state.focus) - n, monthOf(state.focus)) >= 0);
    if (!opts.includes(state.cmp)) state.cmp = opts.length ? opts[opts.length - 1] : 1;
    sel.innerHTML = opts.map(n => `<option value="${n}">${n} yr ago</option>`).join('') || '<option>none</option>';
    sel.value = String(state.cmp);
  }

  function renderAll() {
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.color = css('--ink-2');
    renderMix();
    renderFocus();
    renderAnnual();
    renderHeat();
    renderTable();
  }

  function syncRange() {
    document.getElementById('from').value = String(state.from);
    document.getElementById('to').value = String(state.to);
    document.querySelectorAll('[data-span]').forEach(b => {
      const span = +b.dataset.span;
      const on = state.to === lastYear && (span ? state.from === lastYear - span + 1 : state.from === firstYear);
      b.classList.toggle('active', on);
    });
  }

  function init() {
    const yrs = [];
    for (let y = firstYear; y <= lastYear; y++) yrs.push(`<option value="${y}">${y}</option>`);
    const from = document.getElementById('from'), to = document.getElementById('to');
    from.innerHTML = to.innerHTML = yrs.join('');
    from.addEventListener('change', () => { state.from = Math.min(+from.value, state.to); syncRange(); renderAll(); });
    to.addEventListener('change', () => { state.to = Math.max(+to.value, state.from); syncRange(); renderAll(); });
    document.querySelectorAll('[data-span]').forEach(b => b.addEventListener('click', () => {
      const span = +b.dataset.span;
      state.to = lastYear;
      state.from = span ? lastYear - span + 1 : firstYear;
      syncRange(); renderAll();
    }));
    document.querySelectorAll('input[name=unit]').forEach(r => r.addEventListener('change', () => {
      state.unit = r.value; renderMix(); renderFocus();
    }));
    document.querySelectorAll('input[name=hm]').forEach(r => r.addEventListener('change', () => {
      state.heat = r.value; renderHeat();
    }));

    const focus = document.getElementById('focus');
    focus.innerHTML = D.months.map((_, i) => i).reverse().map(i => `<option value="${i}">${label(i)}</option>`).join('');
    focus.value = String(state.focus);
    focus.addEventListener('change', () => { state.focus = +focus.value; fillCmp(); renderMix(); renderFocus(); });
    document.getElementById('cmp').addEventListener('change', e => { state.cmp = +e.target.value; renderFocus(); });
    fillCmp();

    document.getElementById('csv').addEventListener('click', downloadCsv);
    const tc = document.getElementById('table-collapse');
    const tb = document.querySelector('[data-bs-target="#table-collapse"]');
    tc.addEventListener('shown.bs.collapse', () => { tb.textContent = 'Hide table'; });
    tc.addEventListener('hidden.bs.collapse', () => { tb.textContent = 'Show table'; });

    // theme: auto follows the OS; light/dark override it
    let theme = 'auto';
    try { theme = localStorage.getItem('ercot-theme') || 'auto'; } catch (e) {}
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches);
      document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
      renderAll();
    };
    document.getElementById('th-' + theme).checked = true;
    document.querySelectorAll('input[name=theme]').forEach(r => r.addEventListener('change', () => {
      theme = r.value;
      try { localStorage.setItem('ercot-theme', theme); } catch (e) {}
      applyTheme();
    }));
    mq.addEventListener('change', () => { if (theme === 'auto') applyTheme(); });

    renderStats();
    syncRange();
    renderAll();
  }

  init();
})();
