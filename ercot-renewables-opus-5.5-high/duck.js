(function () {
  'use strict';

  const P = window.ERCOT_PROFILES;
  const SEASONS = {
    spring: { name: 'spring', range: 'March to May', months: [2, 3, 4] },
    summer: { name: 'summer', range: 'June to August', months: [5, 6, 7] }
  };
  const HOURS = Array.from({ length: 96 }, (_, j) => (j + 1) / 4);  // interval ending, in hours
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const gw = (mw, d = 1) => (mw / 1000).toFixed(d) + ' GW';
  const clock = h => {
    const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
    if (hh === 12 && !mm) return 'noon';
    return `${hh % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${hh < 12 ? 'am' : 'pm'}`;
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);

  // ---------- data ----------

  // day-weighted average over the season's months; null if any month is missing
  function average(y, months, key) {
    const idx = months.map(m => P.months.indexOf(y + '-' + String(m + 1).padStart(2, '0')));
    if (idx.some(i => i < 0)) return null;
    const days = idx.reduce((a, i) => a + P.days[i], 0);
    return HOURS.map((_, j) => idx.reduce((a, i) => a + P.series[key][i][j] * P.days[i], 0) / days);
  }

  function shape(v) {
    let lo = 0, hi = 0;
    v.forEach((x, j) => { if (x < v[lo]) lo = j; if (x > v[hi]) hi = j; });
    // evening ramp: steepest 3-hour rise starting between noon and 9 pm
    let ramp = { v: -Infinity, j0: 0, j1: 0 };
    for (let j = 47; j <= 83; j++) if (v[j + 12] - v[j] > ramp.v) ramp = { v: v[j + 12] - v[j], j0: j, j1: j + 12 };
    return { lo, hi, ramp, v };
  }

  function build(season) {
    const ms = SEASONS[season].months;
    const years = [...new Set(P.months.map(m => +m.slice(0, 4)))].filter(y => average(y, ms, 'demand'));
    const prof = {};
    years.forEach(y => {
      const p = {};
      ['demand', 'wind', 'solar', 'storage'].forEach(k => { p[k] = average(y, ms, k); });
      p.net = p.demand.map((v, j) => v - p.wind[j] - p.solar[j]);
      p.res = p.net.map((v, j) => v - p.storage[j]);
      prof[y] = p;
    });
    const y0 = years[0], y1 = years[years.length - 1];
    const peak = Math.max(...years.map(y => Math.max(...prof[y].demand)));
    return {
      season: SEASONS[season], years, prof, y0, y1,
      yMax: Math.ceil(peak * 1.06 / 10000) * 10000,
      s0: { demand: shape(prof[y0].demand), net: shape(prof[y0].net), wind: shape(prof[y0].wind), solar: shape(prof[y0].solar), storage: shape(prof[y0].storage) },
      s1: { demand: shape(prof[y1].demand), net: shape(prof[y1].net), res: shape(prof[y1].res), solar: shape(prof[y1].solar), storage: shape(prof[y1].storage) }
    };
  }

  // a profile for a fractional year, blending the two neighbouring years
  function at(key, year) {
    const lo = Math.floor(year), hi = Math.min(D.y1, lo + 1), t = year - lo;
    const a = D.prof[lo][key], b = D.prof[hi][key];
    return t ? a.map((v, j) => v + (b[j] - v) * t) : a;
  }

  // ---------- scenes ----------

  const words = s => s.replace(/<[^>]+>/g, '').split(/\s+/).length;
  const night = j => HOURS[j] < 7 || HOURS[j] > 21;

  const SCENES = [
    {
      step: 'Demand',
      title: d => `An average ${d.season.name} day, ${d.y0}`,
      text: d => {
        const s = d.s0.demand;
        return `This line is <strong>power demand</strong> on the Texas grid through an average ${d.season.name} day in ${d.y0}: every 15-minute slot averaged over ${d.season.range}. ` +
          `Demand bottoms out at <strong>${gw(s.v[s.lo])}</strong> around ${clock(HOURS[s.lo])} and peaks at <strong>${gw(s.v[s.hi])}</strong> around ${clock(HOURS[s.hi])}.`;
      },
      frame: d => ({ year: d.y0, w: 0, s: 0, b: 0, under: 0 }),
      notes: (d, n) => {
        const s = d.s0.demand;
        n.point(s.lo, s.v[s.lo], [night(s.lo) ? 'Overnight low' : 'Daily low', `${gw(s.v[s.lo])} · ${clock(HOURS[s.lo])}`], 'below');
        n.point(s.hi, s.v[s.hi], ['Peak demand', `${gw(s.v[s.hi])} · ${clock(HOURS[s.hi])}`], 'above');
      }
    },
    {
      step: 'Wind',
      title: () => 'Wind takes the first bite',
      text: d => {
        const w = d.s0.wind;
        return `Wind farms supplied the shaded band, about <strong>${gw(avgOf(w.v))}</strong> on average. ` +
          `Texas wind blows hardest around ${clock(HOURS[w.hi])} and is weakest around ${clock(HOURS[w.lo])}, so the line underneath (what is still left to supply) sits lowest at night.`;
      },
      frame: d => ({ year: d.y0, w: 1, s: 0, b: 0, under: 0 }),
      notes: (d, n) => {
        const j = bestIn(d.prof[d.y0].wind, 1, 6);
        const top = d.prof[d.y0].demand[j];
        n.band(j, top, top - d.prof[d.y0].wind[j], 'Wind');
      }
    },
    {
      step: 'Solar',
      title: () => 'Then solar takes the middle of the day',
      text: d => {
        const s = d.s0.solar;
        return `Solar farms peaked at <strong>${gw(s.v[s.hi])}</strong> around ${clock(HOURS[s.hi])}. ` +
          `They produce nothing before sunrise and fade to zero in the evening, just as demand is near its peak.`;
      },
      frame: d => ({ year: d.y0, w: 1, s: 1, b: 0, under: 0 }),
      notes: (d, n) => {
        const p = d.prof[d.y0], j = d.s0.solar.hi;
        const top = p.demand[j] - p.wind[j];
        n.band(j, top, top - p.solar[j], 'Solar');
      }
    },
    {
      step: 'Net load',
      title: () => 'What is left is the net load',
      text: d => {
        const s = d.s0.net;
        return `Demand minus wind and solar is the <strong>net load</strong>: what gas, coal, nuclear and other plants must supply. ` +
          `In ${d.y0} it was lowest around ${clock(HOURS[s.lo])} and peaked at <strong>${gw(s.v[s.hi])}</strong> around ${clock(HOURS[s.hi])}. ` +
          `Its steepest afternoon or evening climb was <strong>${gw(s.ramp.v)}</strong> over three hours.`;
      },
      frame: d => ({ year: d.y0, w: 1, s: 1, b: 0, under: 1 }),
      notes: (d, n) => {
        const s = d.s0.net;
        n.under(s.lo < 32 ? 50 : 12, ['Left for gas, coal,', 'nuclear and others']);
        n.point(s.lo, s.v[s.lo], ['Low', `${gw(s.v[s.lo])} · ${clock(HOURS[s.lo])}`], 'below');
        n.point(s.hi, s.v[s.hi], ['Peak', `${gw(s.v[s.hi])} · ${clock(HOURS[s.hi])}`], 'above');
        n.ramp(s.ramp, [`+${gw(s.ramp.v)}`, 'in 3 hours']);
      }
    },
    {
      step: '{y0} → {y1}',
      title: d => `${d.y0} to ${d.y1}: solar grows a duck`,
      text: d => {
        const a = d.s0, b = d.s1;
        const moved = night(a.net.lo) && !night(b.net.lo)
          ? ` The low point of the day moved from ${clock(HOURS[a.net.lo])} to <strong>${clock(HOURS[b.net.lo])}</strong>: the duck's <strong>belly</strong>.`
          : ` The midday <strong>belly</strong> sank to ${gw(b.net.v[b.net.lo])}.`;
        return `By ${d.y1}, the ${d.season.name} solar peak had grown from ${gw(a.solar.v[a.solar.hi])} to <strong>${gw(b.solar.v[b.solar.hi])}</strong>.${moved} ` +
          `When the sun sets, other plants now climb <strong>${gw(b.net.ramp.v)}</strong> in three hours (the <strong>neck</strong>, up from ${gw(a.net.ramp.v)}) ` +
          `to an evening peak of ${gw(b.net.v[b.net.hi])} (the <strong>head</strong>). The dashed line is ${d.y0}.`;
      },
      frame: d => ({ year: d.y1, w: 1, s: 1, b: 0, under: 1 }),
      ghost: d => ({ year: d.y0, key: 'net', label: `${d.y0} net load`, h: 12 }),
      dur: 4800,
      notes: (d, n) => {
        const s = d.s1.net;
        n.point(s.lo, s.v[s.lo], ['Belly', `${gw(s.v[s.lo])} · ${clock(HOURS[s.lo])}`], 'below');
        n.ramp(s.ramp, ['Neck', `+${gw(s.ramp.v)} in 3 h`]);
        n.point(s.hi, s.v[s.hi], ['Head', `${gw(s.v[s.hi])} · ${clock(HOURS[s.hi])}`], 'above');
      }
    },
    {
      step: 'Batteries',
      title: () => 'Enter batteries',
      text: d => {
        const b = d.s1.storage, b0 = d.s0.storage;
        const tiny = Math.max(Math.abs(b0.v[b0.lo]), b0.v[b0.hi]);
        return `Batteries charge on cheap midday solar (up to <strong>${gw(-b.v[b.lo])}</strong> around ${clock(HOURS[b.lo])}) ` +
          `and discharge after sunset (up to <strong>${gw(b.v[b.hi])}</strong> around ${clock(HOURS[b.hi])}). ` +
          `Charging adds to what other plants must supply at midday, filling in the belly; discharging cuts into the evening peak. ` +
          `In ${d.y0} batteries barely registered, never above ${gw(tiny)}.`;
      },
      frame: d => ({ year: d.y1, w: 1, s: 1, b: 1, under: 1 }),
      ghost: () => ({ year: D.y1, key: 'net', label: 'Without batteries' }),
      notes: (d, n) => {
        const b = d.s1.storage, p = d.prof[d.y1];
        n.band(b.lo, p.res[b.lo], p.net[b.lo], 'Charging', 'above');
        n.band(b.hi, p.net[b.hi], p.res[b.hi], 'Discharging', 'below');
      }
    },
    {
      step: 'Flatter',
      title: () => 'The duck is flattening',
      text: d => {
        const n = d.s1.net, r = d.s1.res;
        return `With batteries, the evening climb for other plants shrinks from ${gw(n.ramp.v)} to <strong>${gw(r.ramp.v)}</strong> in three hours, ` +
          `and the evening peak they must meet drops from ${gw(n.v[n.hi])} to <strong>${gw(r.v[r.hi])}</strong>. ` +
          `The midday low rises from ${gw(n.v[n.lo])} to ${gw(r.v[r.lo])}. Solar made the duck; batteries are flattening it.`;
      },
      frame: d => ({ year: d.y1, w: 1, s: 1, b: 1, under: 1 }),
      ghost: () => ({ year: D.y1, key: 'net', label: null }),
      notes: (d, n) => {
        const r = d.s1.res, s = d.s1.net;
        n.point(r.lo, r.v[r.lo], [`Low ${gw(r.v[r.lo])}`, `was ${gw(s.v[s.lo])}`], 'below');
        n.ramp(r.ramp, [`+${gw(r.ramp.v)} in 3 h`, `was +${gw(s.ramp.v)}`]);
        n.point(r.hi, r.v[r.hi], [`Peak ${gw(r.v[r.hi])}`, `was ${gw(s.v[s.hi])}`], 'above');
      }
    }
  ];

  function avgOf(v) { return v.reduce((a, x) => a + x, 0) / v.length; }
  // index of the largest value between two clock hours
  function bestIn(v, h0, h1) {
    let k = -1;
    v.forEach((x, j) => { if (HOURS[j] >= h0 && HOURS[j] <= h1 && (k < 0 || x > v[k])) k = j; });
    return k;
  }

  // ---------- chart ----------

  const svg = d3.select('#chart');
  const root = svg.append('g');
  const gGrid = root.append('g');
  const gAxisX = root.append('g');
  const gAxisY = root.append('g');
  const pUnder = root.append('path');
  const pWind = root.append('path');
  const pSolar = root.append('path');
  const pBatt = root.append('path');
  const pGhost = root.append('path').attr('class', 'ghost');
  const pDemand = root.append('path');
  const pNet = root.append('path');
  const gNotes = root.append('g');
  const tYear = root.append('text');
  svg.append('defs').append('marker')
    .attr('id', 'arrow').attr('viewBox', '0 0 10 10').attr('refX', 8).attr('refY', 5)
    .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto-start-reverse')
    .append('path').attr('d', 'M0,0 L10,5 L0,10 z').attr('class', 'arrowhead');

  let D, W = 0, H = 0, M, x, y, narrow = false;
  const frame = { year: 0, w: 0, s: 0, b: 0, under: 0, draw: 1 };
  let ghost = null;

  function layout() {
    const box = svg.node().getBoundingClientRect();
    W = box.width; H = box.height;
    narrow = W < 560;
    M = { t: 36, r: narrow ? 14 : 28, b: 28, l: narrow ? 46 : 58 };
    x = d3.scaleLinear().domain([0, 24]).range([M.l, W - M.r]);
    y = d3.scaleLinear().domain([0, D.yMax]).range([H - M.b, M.t]);

    const step = narrow ? 6 : 3;
    gGrid.selectAll('*').remove();
    gGrid.selectAll('line').data(y.ticks(narrow ? 5 : 7)).join('line')
      .attr('x1', M.l).attr('x2', W - M.r).attr('y1', d => y(d)).attr('y2', d => y(d))
      .attr('stroke', css('--grid'));
    gAxisY.selectAll('*').remove();
    gAxisY.selectAll('text').data(y.ticks(narrow ? 5 : 7)).join('text')
      .attr('x', M.l - 8).attr('y', d => y(d)).attr('dy', '0.32em').attr('text-anchor', 'end')
      .attr('fill', css('--muted')).attr('font-size', 11).text(d => `${d / 1000} GW`);
    gAxisX.selectAll('*').remove();
    gAxisX.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', H - M.b).attr('y2', H - M.b).attr('stroke', css('--axis'));
    gAxisX.selectAll('text').data(d3.range(0, 25, step)).join('text')
      .attr('x', d => x(d)).attr('y', H - M.b + 18).attr('text-anchor', d => d === 0 ? 'start' : d === 24 ? 'end' : 'middle')
      .attr('fill', css('--muted')).attr('font-size', 11).text(d => clock(d));

    pUnder.attr('fill', css('--left'));
    pWind.attr('fill', css('--s-wind')).attr('fill-opacity', 0.55);
    pSolar.attr('fill', css('--s-solar')).attr('fill-opacity', 0.6);
    pBatt.attr('fill', css('--s-batt')).attr('fill-opacity', 0.8);
    pGhost.attr('fill', 'none').attr('stroke', css('--muted')).attr('stroke-width', 2).attr('stroke-dasharray', '5 4');
    pDemand.attr('fill', 'none').attr('stroke', css('--ink-2')).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round');
    pNet.attr('fill', 'none').attr('stroke', css('--ink')).attr('stroke-width', 3).attr('stroke-linejoin', 'round');
    svg.select('.arrowhead').attr('fill', css('--ink-2'));
    tYear.attr('x', M.l + 4).attr('y', M.t - 14).attr('fill', css('--ink')).attr('font-weight', 600).attr('font-size', narrow ? 15 : 17);
  }

  const line = d3.line().x((_, j) => x(HOURS[j])).y(v => y(v)).curve(d3.curveMonotoneX);
  const area = (top, bot) => d3.area().x((_, j) => x(HOURS[j])).y0((_, j) => y(bot[j])).y1(v => y(v)).curve(d3.curveMonotoneX)(top);

  function render() {
    const dem = at('demand', frame.year), wind = at('wind', frame.year), solar = at('solar', frame.year), sto = at('storage', frame.year);
    const l1 = dem.map((v, j) => v - frame.w * wind[j]);
    const l2 = l1.map((v, j) => v - frame.s * solar[j]);
    const l3 = l2.map((v, j) => v - frame.b * sto[j]);
    pUnder.attr('d', area(l3, l3.map(() => 0))).attr('opacity', frame.under);
    pWind.attr('d', area(dem, l1)).attr('opacity', frame.w > 0.001 ? 1 : 0);
    pSolar.attr('d', area(l1, l2)).attr('opacity', frame.s > 0.001 ? 1 : 0);
    pBatt.attr('d', area(l2, l3)).attr('opacity', frame.b > 0.001 ? 1 : 0);
    pNet.attr('d', line(l3)).attr('opacity', Math.min(1, (frame.w + frame.s + frame.b) * 4));
    pDemand.attr('d', line(dem));
    if (frame.draw < 1) {
      const len = pDemand.node().getTotalLength();
      pDemand.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len * (1 - frame.draw));
    } else {
      pDemand.attr('stroke-dasharray', null).attr('stroke-dashoffset', null);
    }
    if (ghost) pGhost.attr('d', line(at(ghost.key, ghost.year)));
    pGhost.attr('opacity', ghost ? 1 : 0);
    tYear.text(`${cap(D.season.name)} ${Math.round(frame.year)}`);
  }

  // ---------- annotations ----------

  function notesFor(scene, fade) {
    gNotes.selectAll('*').remove();
    const g = gNotes.append('g').attr('class', 'note' + (fade ? '' : ' on'));
    const fs = narrow ? 11 : 12;
    const anchorFor = px => px < M.l + 70 ? 'start' : px > W - M.r - 70 ? 'end' : 'middle';
    const textLines = (px, py, lines, anchor, dir) => {
      if (narrow) lines = lines.slice(0, 1);  // phones get the headline only; the caption has the rest
      const t = g.append('text').attr('text-anchor', anchor).attr('font-size', fs);
      lines.forEach((s, k) => t.append('tspan').attr('x', px)
        .attr('y', dir === 'above' ? py - (lines.length - 1 - k) * (fs + 3) : py + k * (fs + 3))
        .attr('class', k === 0 ? 'strong' : null).text(s));
      return t;
    };
    const n = {
      point(j, v, lines, pos) {
        const px = x(HOURS[j]), py = y(v);
        g.append('circle').attr('cx', px).attr('cy', py).attr('r', 4.5)
          .attr('fill', css('--ink')).attr('stroke', css('--surface')).attr('stroke-width', 2);
        const gap = 14;
        const ty = pos === 'above' ? py - gap : py + gap + fs;
        g.append('line').attr('x1', px).attr('x2', px).attr('y1', pos === 'above' ? py - 6 : py + 6)
          .attr('y2', pos === 'above' ? ty + 3 : ty - fs + 1);
        const anchor = anchorFor(px);
        textLines(anchor === 'start' ? px - 4 : anchor === 'end' ? px + 4 : px, ty, lines, anchor, pos);
      },
      band(j, top, bot, label, pos) {
        const px = x(HOURS[j]);
        const anchor = anchorFor(px);
        const thin = Math.abs(y(bot) - y(top)) < fs + 8;
        let py = (y(top) + y(bot)) / 2 + fs / 3;
        if (pos === 'above' || (thin && pos !== 'below')) py = Math.min(y(top), y(bot)) - 8;
        if (pos === 'below') py = Math.max(y(top), y(bot)) + fs + 6;
        textLines(px, py, [label], anchor, 'below');
      },
      under(j, lines) {
        const px = x(HOURS[j]);
        textLines(px, y(D.yMax * 0.12), lines, anchorFor(px), 'above');
      },
      ramp(r, lines) {
        const v = at(r.key || (frame.b ? 'res' : 'net'), frame.year);
        const x0 = x(HOURS[r.j0]), x1 = x(HOURS[r.j1]), y0 = y(v[r.j0]), y1 = y(v[r.j1]);
        g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y0).attr('y2', y0).attr('stroke-dasharray', '3 3');
        g.append('line').attr('x1', x1).attr('x2', x1).attr('y1', y0).attr('y2', y1 + 6).attr('marker-end', 'url(#arrow)');
        const right = x1 < W - M.r - 110;
        textLines(right ? x1 + 8 : x1 - 8, (y0 + y1) / 2 + fs / 2, lines, right ? 'start' : 'end', 'below');
      }
    };
    if (ghost && ghost.label && !narrow) {
      const gv = at(ghost.key, ghost.year);
      const j = ghost.h ? HOURS.indexOf(ghost.h) : bestIn(gv, 18, 22);
      const px = x(HOURS[j]);
      textLines(px, y(gv[j]) - 10, [ghost.label], anchorFor(px), 'above').select('tspan').attr('class', null);
    }
    scene.notes(D, n);
    if (fade) requestAnimationFrame(() => requestAnimationFrame(() => g.classed('on', true)));
  }

  // ---------- playback ----------

  const caption = document.getElementById('caption');
  const playBtn = document.getElementById('play');
  const bar = document.getElementById('progress');
  let idx = 0, playing = !reduced, anim = null, timer = null, settled = false;
  let dwellTotal = 0, dwellLeft = 0, dwellStart = 0;

  function stepLabel(s) { return s.step.replace('{y0}', D.y0).replace('{y1}', D.y1); }

  function renderSteps() {
    document.getElementById('steps').innerHTML = SCENES.map((s, k) =>
      `<button type="button" class="btn btn-sm ${k === idx ? 'btn-secondary' : 'btn-outline-secondary'}" data-k="${k}" aria-current="${k === idx}">${k + 1}. ${stepLabel(s)}</button>`).join('');
  }

  function setCaption(scene) {
    const text = scene.text(D);
    caption.innerHTML = `<div class="kicker">Step ${idx + 1} of ${SCENES.length}</div><h2>${scene.title(D)}</h2><p>${text}</p>`;
    svg.attr('aria-label', `${scene.title(D)}. ${text.replace(/<[^>]+>/g, '')}`);
  }

  function animateTo(to, dur, done) {
    if (anim) anim.stop();
    const from = Object.assign({}, frame);
    const keys = Object.keys(to);
    if (reduced || dur <= 0) { Object.assign(frame, to); render(); done(); return; }
    anim = d3.timer(el => {
      const t = Math.min(1, el / dur), e = d3.easeCubicInOut(t);
      keys.forEach(k => { frame[k] = from[k] + (to[k] - from[k]) * e; });
      render();
      if (t === 1) { anim.stop(); anim = null; done(); }
    });
  }

  function setBar(pct, ms) {
    bar.style.transition = 'none';
    bar.style.width = pct + '%';
    if (ms) {
      void bar.offsetWidth;
      bar.style.transition = `width ${ms}ms linear`;
      bar.style.width = '100%';
    }
  }

  function startDwell(ms) {
    clearTimeout(timer);
    dwellLeft = ms;
    if (!playing) return;
    dwellStart = performance.now();
    setBar(100 * (1 - ms / dwellTotal), ms);
    timer = setTimeout(() => { if (idx < SCENES.length - 1) go(idx + 1); else finish(); }, ms);
  }

  function finish() {
    playing = false;
    playBtn.textContent = 'Replay';
    setBar(100);
  }

  function go(k, opts = {}) {
    clearTimeout(timer);
    idx = k;
    const scene = SCENES[k];
    settled = false;
    gNotes.selectAll('*').remove();
    ghost = scene.ghost ? scene.ghost(D) : null;
    setCaption(scene);
    renderSteps();
    frame.draw = opts.drawIn ? 0 : 1;
    const target = Object.assign(scene.frame(D), { draw: 1 });
    const dur = opts.instant ? 0 : opts.drawIn ? 2200 : scene.dur || 1400;
    dwellTotal = Math.max(6000, words(scene.text(D)) * 300 + 1500);
    setBar(0);
    if (playing) playBtn.textContent = 'Pause';
    else playBtn.textContent = idx === SCENES.length - 1 ? 'Replay' : 'Play';
    animateTo(target, dur, () => {
      settled = true;
      notesFor(scene, !opts.instant);
      startDwell(dwellTotal);
    });
  }

  function togglePlay() {
    if (playing) {
      playing = false;
      clearTimeout(timer);
      if (settled) {
        dwellLeft = Math.max(0, dwellLeft - (performance.now() - dwellStart));
        setBar(100 * (1 - dwellLeft / dwellTotal));
      }
      playBtn.textContent = 'Play';
      return;
    }
    playing = true;
    playBtn.textContent = 'Pause';
    if (settled) startDwell(dwellLeft);
  }

  function load(season) {
    D = build(season);
    Object.assign(frame, SCENES[0].frame(D));
    layout();
    go(0, { drawIn: true });
  }

  playBtn.addEventListener('click', () => {
    if (!playing && idx === SCENES.length - 1 && settled) { playing = true; go(0, { drawIn: true }); return; }
    togglePlay();
  });
  document.getElementById('prev').addEventListener('click', () => { if (idx > 0) go(idx - 1); });
  document.getElementById('next').addEventListener('click', () => { if (idx < SCENES.length - 1) go(idx + 1); });
  document.getElementById('steps').addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (b) go(+b.dataset.k);
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight' && idx < SCENES.length - 1) go(idx + 1);
    else if (e.key === 'ArrowLeft' && idx > 0) go(idx - 1);
    else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); playBtn.click(); }
  });
  document.querySelectorAll('input[name=season]').forEach(r => r.addEventListener('change', () => load(r.value)));

  function legend() {
    const it = (cls, color, label) => `<span><i class="${cls}" style="${color ? 'background:' + color : ''}"></i>${label}</span>`;
    document.getElementById('legend').innerHTML = [
      it('line', css('--ink-2'), 'Demand'),
      it('', css('--s-wind'), 'Wind'),
      it('', css('--s-solar'), 'Solar'),
      it('', css('--s-batt'), 'Batteries'),
      it('line', css('--ink'), 'Net load'),
      it('dash', '', 'Earlier')
    ].join('');
  }

  // redraw at the current state without replaying anything
  function redraw() {
    layout();
    render();
    if (settled) notesFor(SCENES[idx], false);
    legend();
  }

  new ResizeObserver(() => { if (D) redraw(); }).observe(svg.node());

  // theme: auto follows the OS; light/dark override it (shared with the explorer page)
  let theme = 'auto';
  try { theme = localStorage.getItem('ercot-theme') || 'auto'; } catch (e) {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const dark = theme === 'dark' || (theme === 'auto' && mq.matches);
    document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    if (D) redraw();
  };
  document.getElementById('th-' + theme).checked = true;
  document.querySelectorAll('input[name=theme]').forEach(r => r.addEventListener('change', () => {
    theme = r.value;
    try { localStorage.setItem('ercot-theme', theme); } catch (e) {}
    applyTheme();
  }));
  mq.addEventListener('change', () => { if (theme === 'auto') applyTheme(); });

  legend();
  load('spring');
})();
