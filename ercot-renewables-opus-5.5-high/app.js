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
  // stacking order for the monthly mix chart, bottom first
  const MIX = ['nuclear', 'solar', 'wind', 'hydro', 'gas', 'other', 'coal'].map(k => SOURCES.find(s => s.key === k));
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
    const c = rgb(hex), s = rgb(css('--surface-raised'));
    return `rgb(${c.map((v, k) => Math.round(v * a + s[k] * (1 - a))).join(', ')})`;
  };
  const isDark = () => document.documentElement.getAttribute('data-bs-theme') === 'dark';

  const state = { from: firstYear, to: lastYear, unit: 'share', focus: N - 1, cmp: 10, heat: 'windsolar', duck: 'net', duckType: 'season', duckSeason: 1, duckMonth: 3,
    priceStat: 'median', priceType: 'season', priceSeason: 2, priceMonth: 7 };
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
    backgroundColor: css('--surface-raised'),
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
        ctx.fillStyle = css('--ink'); ctx.font = '600 11px "Public Sans", system-ui, sans-serif';
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
    const surface = css('--surface-raised');
    const datasets = MIX.map((s, k) => ({
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
    legend('legend-mix', MIX.slice().reverse().map(s => ({ label: s.label, color: css(s.css) })));
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
        ctx.fillStyle = css('--ink'); ctx.font = '600 11px "Public Sans", system-ui, sans-serif'; ctx.textBaseline = 'middle';
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
        ctx.font = '600 11px "Public Sans", system-ui, sans-serif'; ctx.textBaseline = 'middle';
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
          pointBorderColor: css('--surface-raised'), pointBorderWidth: 2, pointStyle: 'circle', tension: 0
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

  // ---------- duck curve (time of day) ----------

  const P = window.ERCOT_PROFILES;
  const SEASONS = [
    { label: 'Winter (Dec, Jan, Feb)', months: [11, 0, 1] },
    { label: 'Spring (Mar–May)', months: [2, 3, 4] },
    { label: 'Summer (Jun–Aug)', months: [5, 6, 7] },
    { label: 'Fall (Sep–Nov)', months: [8, 9, 10] }
  ];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DUCK = {
    demand: { label: 'Demand', sub: 'Average power demand by time of day.' },
    net: { label: 'Net of wind & solar', sub: 'Demand minus wind and solar: what every other source has to cover. Solar carves the midday belly; the evening neck is the ramp when the sun sets.' },
    resid: { label: 'Net of wind, solar & batteries', sub: 'Demand minus wind, solar and net battery output: what gas, coal and nuclear have to cover. Batteries charge in the belly and discharge into the neck, flattening the curve.' }
  };
  const pYears = [...new Set(P.months.map(m => +m.slice(0, 4)))];
  const yrColor = y => css('--yr-' + Math.min(4, Math.max(0, 4 - (pYears[pYears.length - 1] - y))));
  const HOURS = Array.from({ length: 96 }, (_, j) => (j + 1) / 4);  // interval ending, in hours
  const clock = h => {
    const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
    return `${hh % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${hh < 12 ? 'am' : 'pm'}`;
  };
  const gw = (mw, d = 1) => (mw / 1000).toFixed(d) + ' GW';

  const duckPeriod = () => ({ type: state.duckType, season: state.duckSeason, month: state.duckMonth });

  function periodMonths(p = duckPeriod()) {
    if (p.type === 'year') return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    if (p.type === 'season') return SEASONS[p.season].months;
    return [p.month];
  }

  function periodLabel(p = duckPeriod()) {
    if (p.type === 'year') return 'Whole year';
    if (p.type === 'season') return SEASONS[p.season].label;
    return MONTH_NAMES[p.month];
  }

  // day-weighted average of one series over the period's months; null if any month is missing
  function profile(y, ms, f) {
    const idx = ms.map(m => P.months.indexOf(y + '-' + String(m + 1).padStart(2, '0')));
    if (idx.some(i => i < 0)) return null;
    const days = idx.reduce((a, i) => a + P.days[i], 0);
    return HOURS.map((_, j) => idx.reduce((a, i) => a + f(i, j) * P.days[i], 0) / days);
  }

  const S = P.series;
  const METRIC = {
    demand: (i, j) => S.demand[i][j],
    net: (i, j) => S.demand[i][j] - S.wind[i][j] - S.solar[i][j],
    resid: (i, j) => S.demand[i][j] - S.wind[i][j] - S.solar[i][j] - S.storage[i][j],
    storage: (i, j) => S.storage[i][j]
  };

  function duckSeries(f) {
    const ms = periodMonths();
    return pYears.map(y => ({ year: y, data: profile(y, ms, f) })).filter(s => s.data);
  }

  function missingNote(shown, months = P.months) {
    const missing = pYears.filter(y => !shown.some(s => s.year === y));
    if (!missing.length) return '';
    const last = months[months.length - 1];
    return ` ${missing.join(', ')} not shown: data ends ${MON[+last.slice(5, 7) - 1]} ${last.slice(0, 4)}.`;
  }

  // year beside each line's last point, nudged apart so labels never overlap
  const yearLabels = {
    id: 'yearLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const pts = chart.data.datasets.map((ds, k) => {
        const meta = chart.getDatasetMeta(k);
        if (meta.hidden) return null;
        const el = meta.data[meta.data.length - 1];
        return { x: el.x, y: el.y, text: ds.label, color: ds.borderColor };
      }).filter(Boolean).sort((a, b) => a.y - b.y);
      for (let k = 1; k < pts.length; k++) if (pts[k].y - pts[k - 1].y < 13) pts[k].y = pts[k - 1].y + 13;
      ctx.save();
      ctx.font = '600 11px "Public Sans", system-ui, sans-serif'; ctx.textBaseline = 'middle';
      pts.forEach(p => {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x + 8, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = css('--ink-2'); ctx.fillText(p.text, p.x + 15, p.y);
      });
      ctx.restore();
    }
  };

  function timeChart(id, series, opts) {
    const x = baseScales();
    const y = baseScales();
    x.type = 'linear'; x.min = 0; x.max = 24;
    x.grid = { display: false };
    x.ticks.stepSize = 3; x.ticks.maxRotation = 0; x.ticks.autoSkip = false;
    x.ticks.callback = function (v) { return v % (this.chart.width < 560 ? 6 : 3) === 0 ? clock(v) : ''; };
    y.ticks.callback = opts.yTick || (v => (v / 1000).toLocaleString() + ' GW');
    Object.assign(y, opts.y || {});
    const xs = opts.xs || HOURS;
    const fmt = opts.fmt || gw;
    replace(id, {
      type: 'line',
      data: {
        datasets: series.map(s => {
          const c = yrColor(s.year);
          return {
            label: String(s.year), data: s.data.map((v, j) => ({ x: xs[j], y: v })),
            borderColor: c, backgroundColor: c, borderWidth: s.year === series[series.length - 1].year ? 3 : 2,
            pointRadius: 0, pointHoverRadius: 4, pointHoverBorderColor: css('--surface-raised'), pointHoverBorderWidth: 2,
            pointStyle: 'circle', tension: 0.2
          };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 44 } },
        interaction: { mode: 'index', intersect: false },
        scales: { x, y },
        plugins: {
          legend: { display: false },
          crosshair: {},
          tooltip: Object.assign(tooltipStyle(), {
            itemSort: (a, b) => +b.dataset.label - +a.dataset.label,
            callbacks: {
              title: opts.title || (t => `${clock(t[0].parsed.x - 0.25)} – ${clock(t[0].parsed.x)}`),
              label: t => `${t.dataset.label}: ${fmt(t.parsed.y)}`
            }
          })
        }
      },
      plugins: [crosshair, yearLabels].concat(opts.plugins || [])
    });
  }

  // a solid line at zero, so charging and discharging read against it
  const zeroLine = {
    id: 'zeroLine',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a } = chart;
      const py = chart.scales.y.getPixelForValue(0);
      if (py < a.top || py > a.bottom) return;
      ctx.save(); ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke(); ctx.restore();
    }
  };

  function renderDuck() {
    const series = duckSeries(METRIC[state.duck]);
    const note = missingNote(series);
    document.getElementById('duck-sub').textContent = `${periodLabel()}. ${DUCK[state.duck].sub}${note}`;
    timeChart('duck', series, {});
    legend('legend-duck', series.map(s => ({ label: String(s.year), color: yrColor(s.year) })));
    document.querySelectorAll('#legend-duck i').forEach(i => i.classList.add('line'));

    const batt = duckSeries(METRIC.storage);
    document.getElementById('batt-sub').textContent =
      `${periodLabel()}. Net battery output: above zero is discharging to the grid, below zero is charging.${missingNote(batt)}`;
    timeChart('batt', batt, { plugins: [zeroLine] });

    // peak, low and steepest 3-hour rise of the plotted curve, per year
    const rows = series.map(s => {
      const v = s.data;
      let hi = 0, lo = 0, ramp = -Infinity, rampAt = 0;
      v.forEach((x, j) => { if (x > v[hi]) hi = j; if (x < v[lo]) lo = j; });
      for (let j = 0; j + 12 < v.length; j++) if (v[j + 12] - v[j] > ramp) { ramp = v[j + 12] - v[j]; rampAt = j; }
      return { year: s.year, hi, lo, v, ramp, rampAt };
    });
    const at = j => `<div class="sub">${clock(HOURS[j])}</div>`;
    document.getElementById('shape-sub').textContent =
      `${DUCK[state.duck].label} · ${periodLabel()}. The steepest 3-hour rise is the ramp other plants must climb.`;
    document.getElementById('shape').innerHTML = `
      <thead><tr><th>Year</th><th>Low</th><th>Peak</th><th>Peak − low</th><th>Steepest 3-hr rise</th></tr></thead>
      <tbody>${rows.slice().reverse().map(r => `<tr>
        <td><span class="legend"><span><i style="background:${yrColor(r.year)}"></i>${r.year}</span></span></td>
        <td>${gw(r.v[r.lo])}${at(r.lo)}</td>
        <td>${gw(r.v[r.hi])}${at(r.hi)}</td>
        <td>${gw(r.v[r.hi] - r.v[r.lo])}</td>
        <td>${gw(r.ramp)}<div class="sub">${clock(HOURS[r.rampAt])} – ${clock(HOURS[r.rampAt + 12])}</div></td>
      </tr>`).join('')}</tbody>`;
  }

  function fillPeriod(id, p) {
    const sel = document.getElementById(id);
    sel.hidden = p.type === 'year';
    if (p.type === 'season') {
      sel.innerHTML = SEASONS.map((s, k) => `<option value="${k}">${s.label}</option>`).join('');
      sel.value = String(p.season);
    } else if (p.type === 'month') {
      sel.innerHTML = MONTH_NAMES.map((m, k) => `<option value="${k}">${m}</option>`).join('');
      sel.value = String(p.month);
    }
  }

  function fillDuckPeriod() { fillPeriod('duck-period', duckPeriod()); }

  // ---------- wholesale prices ----------

  const PR = window.ERCOT_PRICES;
  const SEASON_KEYS = ['winter', 'spring', 'summer', 'fall'];
  const usd = (v, d = 0) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const prLabel = m => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);

  // months off the top of a capped axis get a marker and their value at the top edge
  const offScale = {
    id: 'offScale',
    afterDatasetsDraw(chart, _, opts) {
      if (!opts.cap) return;
      const { ctx, chartArea: a } = chart;
      ctx.save();
      ctx.font = '600 11px "Public Sans", system-ui, sans-serif'; ctx.textBaseline = 'top';
      chart.data.datasets.forEach((ds, k) => {
        if (chart.getDatasetMeta(k).hidden) return;
        ds.data.forEach((v, i) => {
          if (v <= opts.cap) return;
          const px = chart.getDatasetMeta(k).data[i].x;
          ctx.fillStyle = ds.borderColor;
          ctx.beginPath(); ctx.moveTo(px - 5, a.top + 7); ctx.lineTo(px + 5, a.top + 7); ctx.lineTo(px, a.top); ctx.fill();
          ctx.fillStyle = css('--ink-2');
          const text = `${opts.labels[i]}: ${usd(v)}` + (chart.width < 560 ? '' : ' (off scale)');
          const w = ctx.measureText(text).width;
          // beside the marker on whichever side has room, else centred and kept inside the plot
          ctx.textAlign = 'left';
          const tx = px + 8 + w <= a.right ? px + 8 : px - 8 - w >= a.left ? px - 8 - w : Math.max(a.left, Math.min(px - w / 2, a.right - w));
          ctx.fillText(text, tx, tx === px + 8 || tx === px - 8 - w ? a.top : a.top + 10);
        });
      });
      ctx.restore();
    }
  };

  function renderPrice() {
    const idx = PR.months.map((m, i) => i).filter(i => +PR.months[i].slice(0, 4) >= state.from && +PR.months[i].slice(0, 4) <= state.to);
    const empty = !idx.length;
    document.getElementById('price-empty').hidden = !empty;
    document.getElementById('price').parentElement.hidden = empty;
    if (empty) { document.getElementById('price-sub').textContent = ''; return; }
    const labels = idx.map(i => prLabel(PR.months[i]));
    const series = [
      { label: 'Average', data: idx.map(i => PR.mean[i]), color: css('--bluebonnet') },
      { label: 'Median', data: idx.map(i => PR.median[i]), color: css('--ink-2') }
    ];
    // one scarcity month (Winter Storm Uri) would flatten everything else, so cap the axis above it
    const top = series[0].data.slice().sort((a, b) => b - a);
    const cap = top.length > 1 && top[0] > 2.5 * top[1] ? Math.ceil(top[1] * 1.15 / 50) * 50 : null;
    const years = state.to - state.from + 1;
    const x = baseScales();
    const y = baseScales();
    x.grid = { display: false };
    x.ticks = Object.assign(x.ticks, {
      autoSkip: false, maxRotation: 0,
      callback: function (v) {
        const m = PR.months[idx[v]];
        const step = Math.max(1, Math.ceil(years * 40 / this.width));
        return m.endsWith('-01') && (+m.slice(0, 4) - state.from) % step === 0 ? m.slice(0, 4) : '';
      }
    });
    Object.assign(y, { beginAtZero: true, max: cap || undefined });
    y.ticks.callback = v => usd(v);
    replace('price', {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBorderColor: css('--surface-raised'),
          pointHoverBorderWidth: 2, pointStyle: 'circle', tension: 0
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 64, top: cap ? 4 : 0 } },
        interaction: { mode: 'index', intersect: false },
        scales: { x, y },
        plugins: {
          legend: { display: false },
          crosshair: {},
          offScale: { cap, labels },
          tooltip: Object.assign(tooltipStyle(), {
            callbacks: {
              label: t => `${t.dataset.label}: ${usd(t.parsed.y, 2)}/MWh`,
              footer: t => `Highest hour: ${usd(PR.max[idx[t[0].dataIndex]])}/MWh`
            }
          })
        }
      },
      plugins: [crosshair, yearLabels, offScale]
    });
    legend('legend-price', series.map(s => ({ label: s.label, color: s.color })));
    document.querySelectorAll('#legend-price i').forEach(i => i.classList.add('line'));
    document.getElementById('price-sub').textContent =
      `Day-ahead price at ERCOT's hub average, ${prLabel(PR.months[idx[0]])} – ${prLabel(PR.months[idx[idx.length - 1]])}, in dollars per megawatt-hour. ` +
      'The average includes rare scarcity hours; the median is a typical hour.' +
      (cap ? ' The scale is capped so one extreme month does not flatten the rest.' : '');
  }

  const pricePeriod = () => ({ type: state.priceType, season: state.priceSeason, month: state.priceMonth });

  function renderPriceTod() {
    const p = pricePeriod();
    const key = p.type === 'year' ? 'year' : p.type === 'season' ? SEASON_KEYS[p.season] : 'm' + p.month;
    const series = pYears.filter(y => PR.tod[y] && PR.tod[y][key])
      .map(y => ({ year: y, data: PR.tod[y][key][state.priceStat] }));
    const typical = state.priceStat === 'median';
    document.getElementById('price-tod-sub').textContent =
      `${periodLabel(p)}. ${typical ? 'Median' : 'Average'} day-ahead hub price for each hour of the day` +
      (typical ? ': a typical day, ignoring rare price spikes.' : ', including rare price spikes.') +
      missingNote(series, PR.months);
    timeChart('price-tod', series, {
      xs: Array.from({ length: 24 }, (_, h) => h + 0.5),  // hour ending h+1, drawn mid-hour
      fmt: v => usd(v, 2) + '/MWh',
      yTick: v => usd(v),
      y: { beginAtZero: true },
      title: t => `${clock(t[0].parsed.x - 0.5)} – ${clock(t[0].parsed.x + 0.5)}`
    });
    legend('legend-price-tod', series.map(s => ({ label: String(s.year), color: yrColor(s.year) })));
    document.querySelectorAll('#legend-price-tod i').forEach(i => i.classList.add('line'));
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
    const ink = b => (b >= (dark ? 3 : 4)) ? css('--on-bluebonnet') : css('--ink');

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
    Chart.defaults.font.family = '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.color = css('--ink-2');
    renderMix();
    renderFocus();
    renderAnnual();
    renderDuck();
    renderPrice();
    renderPriceTod();
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
    document.querySelectorAll('input[name=dm]').forEach(r => r.addEventListener('change', () => {
      state.duck = r.value; renderDuck();
    }));
    document.querySelectorAll('input[name=dp]').forEach(r => r.addEventListener('change', () => {
      state.duckType = r.value; fillDuckPeriod(); renderDuck();
    }));
    document.getElementById('duck-period').addEventListener('change', e => {
      if (state.duckType === 'season') state.duckSeason = +e.target.value; else state.duckMonth = +e.target.value;
      renderDuck();
    });
    fillDuckPeriod();
    document.querySelectorAll('input[name=ps]').forEach(r => r.addEventListener('change', () => {
      state.priceStat = r.value; renderPriceTod();
    }));
    document.querySelectorAll('input[name=pp]').forEach(r => r.addEventListener('change', () => {
      state.priceType = r.value; fillPeriod('price-period', pricePeriod()); renderPriceTod();
    }));
    document.getElementById('price-period').addEventListener('change', e => {
      if (state.priceType === 'season') state.priceSeason = +e.target.value; else state.priceMonth = +e.target.value;
      renderPriceTod();
    });
    fillPeriod('price-period', pricePeriod());

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
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
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
    // canvas text needs Public Sans loaded; redraw once the web fonts arrive
    if (document.fonts) document.fonts.ready.then(renderAll);
  }

  init();
})();
