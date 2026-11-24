(() => {
  "use strict";
  const H = window.HIST;
  const LAST = H.last;
  const NO_SAVE_START = 1e6; // starting balance when "years saving" is 0
  const RAMSEY_REAL = 1.12 / 1.04 - 1;

  // ---------- state ----------
  const DEFAULTS = { wr: 8, stocks: 100, fee: 0, load: 0, rule: 0, save: 30, contrib: 10000, ret: 30, from: 1872, sel: 1966 };
  const KEYS = { wr: "wr", stocks: "st", fee: "fee", load: "load", rule: "rule", save: "save", contrib: "c", ret: "ret", from: "from", sel: "sel" };
  const state = { ...DEFAULTS };
  (function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const [k, h] of Object.entries(KEYS)) if (p.has(h) && !isNaN(+p.get(h))) state[k] = +p.get(h);
    if (state.from !== 1872 && state.from !== 1928) state.from = 1872;
    if (![0, 1, 2].includes(state.load)) state.load = 0;
    if (![0, 1, 2, 3].includes(state.rule)) state.rule = 0;
  })();
  function writeHash() {
    const p = new URLSearchParams();
    for (const [k, h] of Object.entries(KEYS)) p.set(h, state[k]);
    history.replaceState(null, "", "#" + p.toString());
  }
  const PRESETS = {
    ramsey: { wr: 8, stocks: 100, fee: 0, load: 0, rule: 0 },
    practiced: { wr: 8, stocks: 100, fee: 0.65, load: 1, rule: 0 },
    bengen: { wr: 4, stocks: 50, fee: 0, load: 0, rule: 0 },
    four100: { wr: 4, stocks: 100, fee: 0, load: 0, rule: 0 },
  };

  // ---------- formatting ----------
  const $ = (s) => document.querySelector(s);
  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
  const spct = (v, d = 1) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + "%";
  function money(v) {
    const a = Math.abs(v);
    if (a >= 1e7) return "$" + (v / 1e6).toFixed(1) + "M";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (a >= 1e4) return "$" + Math.round(v / 1e3) + "K";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + Math.round(v);
  }
  function moneyTick(v) {
    if (v === 0) return "$0";
    if (Math.abs(v) >= 1e6) return "$" + +(v / 1e6).toFixed(1) + "M";
    if (Math.abs(v) >= 1e3) return "$" + +(v / 1e3).toFixed(0) + "K";
    return "$" + v;
  }
  const yrs = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1)) + " years";
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // ---------- math ----------
  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }
  function ticks(min, max, count, minStep = 0) {
    let step = Math.max(minStep, niceStep(max - min, count));
    if (minStep >= 1) step = step <= 1 ? 1 : step <= 2 ? 2 : step <= 5 ? 5 : 10 * Math.ceil(step / 10);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function scale(d0, d1, r0, r1) {
    const f = (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
    f.inv = (p) => d0 + ((p - r0) / (r1 - r0)) * (d1 - d0);
    return f;
  }
  const cagr = (rets) => (rets.length ? Math.pow(rets.reduce((a, r) => a * (1 + r), 1), 1 / rets.length) - 1 : NaN);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  function quantile(a, q) {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  }

  // yearly data for the current settings: real and nominal portfolio return after fees, inflation
  function yearData(st) {
    const w = st.stocks / 100, fee = st.fee / 100;
    return H.stocks.map((s, i) => {
      const n = (1 + w * s + (1 - w) * H.bonds[i]) * (1 - fee) - 1;
      return { year: H.first + i, n, i: H.infl[i], r: (1 + n) / (1 + H.infl[i]) - 1 };
    });
  }
  const idx = (year) => year - H.first;

  // front-end sales load on a deposit, by account size in today's dollars (typical equity A-share schedule)
  const BREAKPOINTS = [[1e6, 0], [750e3, 0.015], [500e3, 0.02], [250e3, 0.025], [100e3, 0.035], [50e3, 0.045], [25e3, 0.05], [0, 0.0575]];
  function loadRate(mode, account) {
    if (mode === 2) return 0.0575;
    if (mode === 1) return BREAKPOINTS.find(([min]) => account >= min)[1];
    return 0;
  }

  // Spending rules (all incomes in today's dollars, withdrawn at the end of each year)
  //  0 fixed: first-year income kept up with inflation forever (Ramsey, Bengen)
  //  1 skip: same, but no inflation raise after a year the portfolio lost money
  //  2 guardrails (Guyton-Klinger): skip rule, plus cut 10% when the current rate drifts 20% above
  //    the starting rate (not in the last 15 years), raise 10% when it drifts 20% below
  //  3 percent: withdraw the same % of whatever the balance is
  const RULES = ["Fixed, raised with inflation", "Skip raise after a losing year", "Guardrails (Guyton-Klinger)", "Same % of balance each year"];
  const RULES_INLINE = ["a fixed income raised with inflation", "no raise after a losing year", "Guyton-Klinger guardrails", "the same % of the balance each year"];
  function drawdown(B, wr, ys, N, rule) {
    const W0 = wr * B, path = [B], inc = [];
    let W = W0, lasted = 0, status = "ok";
    for (let k = 0; k < N; k++) {
      if (k >= ys.length) { status = "running"; break; }
      const y = ys[k], pre = B * (1 + y.r);
      if (rule === 3) W = wr * pre;
      else {
        if (rule >= 1 && y.n < 0) W = W / (1 + y.i);
        if (rule === 2 && pre > 0) {
          const rate = W / pre;
          if (rate > wr * 1.2 && N - k > 15) W *= 0.9;
          else if (rate < wr * 0.8) W *= 1.1;
        }
      }
      if (pre < W) { inc.push(pre); lasted = k + pre / W; B = 0; path.push(0); status = "fail"; break; }
      B = pre - W; inc.push(W); path.push(B); lasted = k + 1;
    }
    const minInc = status === "fail" ? 0 : inc.length ? Math.min(...inc) / W0 : 1;
    return { path, inc, W0, lasted, status, end: B, minInc };
  }
  // highest fixed real withdrawal rate that lasts the whole window (end-of-year withdrawals)
  function safeMax(rets) {
    let a = 1, b = 0;
    for (const r of rets) { a *= 1 + r; b = b * (1 + r) + 1; }
    return a / b;
  }

  function simulate(st) {
    const Y = yearData(st);
    const S = st.save, N = st.ret, wr = st.wr / 100;
    const cohorts = [];
    for (let r = st.from + S; r <= LAST; r++) {
      const s0 = r - S;
      let B = S === 0 ? NO_SAVE_START : 0, loads = 0;
      const path = [B];
      for (let k = 0; k < S; k++) {
        const fee = st.contrib * loadRate(st.load, B + st.contrib);
        loads += fee;
        B = B * (1 + Y[idx(s0 + k)].r) + st.contrib - fee;
        path.push(B);
      }
      const nest = B;
      const ys = Y.slice(idx(r), Math.min(idx(r) + N, idx(LAST) + 1));
      const rets = ys.map((y) => y.r);
      const d = drawdown(nest, wr, ys, N, st.rule);
      const complete = rets.length === N;
      cohorts.push({
        r, s0, nest, W: d.W0, ys, rets, loads, inc: d.inc, minInc: d.minInc,
        path: path.concat(d.path.slice(1)),
        retPath: d.path, status: d.status, lasted: d.lasted, end: d.end, complete,
        cape: H.cape[idx(r)],
        safe: complete ? safeMax(rets) : NaN,
        first10: cagr(rets.slice(0, 10)), full: complete ? cagr(rets) : NaN,
      });
    }
    // Ramsey's straight-line world: 12% a year, 4% inflation, his fixed withdrawal
    let B = S === 0 ? NO_SAVE_START : 0;
    const ramsey = [B];
    for (let k = 0; k < S; k++) { B = B * (1 + RAMSEY_REAL) + st.contrib; ramsey.push(B); }
    const rW = wr * B;
    for (let k = 0; k < N; k++) { B = Math.max(0, B * (1 + RAMSEY_REAL) - rW); ramsey.push(B); }
    return { Y, cohorts, ramsey, ramseyNest: ramsey[S] };
  }

  function sweep(st, cohorts) {
    const done = cohorts.filter((c) => c.complete);
    const out = [];
    for (let wr = 2; wr <= 10.0001; wr += 0.25) {
      let ok = 0, worst = Infinity;
      for (const c of done) {
        const d = drawdown(1, wr / 100, c.ys, st.ret, st.rule);
        if (d.status === "ok") ok++;
        worst = Math.min(worst, d.minInc);
      }
      out.push({ wr, rate: done.length ? ok / done.length : NaN, worst: done.length ? worst : NaN });
    }
    return out;
  }

  // ---------- tooltip ----------
  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const row = (k, v) => `<div class="t-row"><span>${k}</span><b>${v}</b></div>`;

  const STATUS = {
    ok: { cls: "ok", icon: "✓", label: "Lasted" },
    fail: { cls: "fail", icon: "✕", label: "Ran out" },
    running: { cls: "running", icon: "…", label: "Still running" },
  };
  function outcomeText(c, N) {
    if (c.status === "fail") return `Ran out after ${yrs(c.lasted)}`;
    if (c.status === "running") return `${c.lasted} of ${N} years so far, ${money(c.end)} left`;
    return `Lasted ${N} years, ${money(c.end)} left`;
  }
  function cohortTip(c, st) {
    const saved = st.save ? `Saved ${c.s0}–${c.r - 1}` : "Started with $1M";
    return `<b>Retired in ${c.r}</b><br><span class="muted">${saved}</span>` +
      row("Nest egg", money(c.nest)) + row("Income / yr", money(c.W)) +
      row(STATUS[c.status].icon + " Outcome", outcomeText(c, st.ret).replace(/^Lasted \d+ years, /, "Lasted, ")) +
      (st.rule ? row("Leanest year's income", pct(c.minInc, 0) + " of first") : "") +
      (st.load && st.save ? row("Sales loads paid", money(c.loads)) : "") +
      row("First 10 yrs, real", isNaN(c.first10) ? "—" : spct(c.first10) + "/yr") +
      row("CAPE on retirement day", c.cape == null ? "—" : c.cape.toFixed(1));
  }
  const legend = (items) => items.map(([cls, label, kind]) =>
    `<span><i class="key ${kind || ""}" style="background:var(--${cls})"></i>${label}</span>`).join("");

  // ---------- render: 12% section ----------
  function renderTwelve(st) {
    const a = idx(st.from), b = idx(LAST) + 1;
    const s = H.stocks.slice(a, b), inf = H.infl.slice(a, b);
    const real = s.map((x, i) => (1 + x) / (1 + inf[i]) - 1);
    const am = mean(s), g = cagr(s), rg = cagr(real);
    const near = s.filter((x) => x >= 0.10 && x <= 0.14).length;
    const neg = s.filter((x) => x < 0).length;
    const tile = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    $("#twelve-tiles").innerHTML =
      tile("Average year (arithmetic)", pct(am), "add up the years, divide: the figure Ramsey quotes") +
      tile("Compound growth (CAGR)", pct(g), "what a dollar actually grew at each year") +
      tile("After inflation", pct(rg), `vs. the ${pct(RAMSEY_REAL)} Ramsey's numbers imply`) +
      tile("Years that returned 10–14%", `${near} of ${s.length}`, `${neg} years lost money`);
    $("#twelve-note").innerHTML =
      `From ${st.from} to ${LAST} the S&amp;P 500 averaged ${pct(am)} a year with dividends. An average of yearly returns overstates growth: a +50% year followed by a −50% year averages 0% and leaves 75¢ of every dollar. Compounded, the market grew ${pct(g)} a year, and ${pct(rg)} after inflation. Ramsey's own numbers imply ${pct(RAMSEY_REAL)} real growth (1.12 ÷ 1.04, not 12 − 4), a little under the 8% he spends, and they assume it arrives every year without a bad one. History delivered less, and never smoothly.`;
  }

  // ---------- render: summary ----------
  function renderSummary(st, sim) {
    const { cohorts, ramseyNest } = sim;
    const done = cohorts.filter((c) => c.complete);
    const ok = done.filter((c) => c.status === "ok");
    const fails = cohorts.filter((c) => c.status === "fail");
    const recent = cohorts.filter((c) => !c.complete);
    const runFail = recent.filter((c) => c.status === "fail").length;
    const worst = fails.length ? fails.reduce((a, c) => (c.lasted < a.lasted ? c : a)) : null;
    const rate = done.length ? ok.length / done.length : NaN;
    const nests = cohorts.map((c) => c.nest);
    const tile = (label, value, sub, status) => `<div class="tile"><div class="label">${label}</div><div class="value">${status ? `<span class="status">${value}</span>` : value}</div><div class="sub">${sub}</div></div>`;
    const firstDone = done.length ? done[0].r : null, lastDone = done.length ? done[done.length - 1].r : null;
    $("#summary").innerHTML =
      tile("Retirements that lasted", isNaN(rate) ? "—" : pct(rate, 0), done.length ? `✓ ${ok.length} of ${done.length} finished retirements, ${firstDone}–${lastDone}` : "no retirement has finished in this window") +
      tile("Worst case", worst ? yrs(worst.lasted) : "never ran out", worst ? `✕ retired ${worst.r}, money gone by ${worst.r + Math.ceil(worst.lasted) - 1}` : `every start year lasted ${st.ret} years`) +
      tile(st.save ? "Nest egg at retirement" : "Starting balance", money(median(nests)), st.save ? `median; ${money(Math.min(...nests))} to ${money(Math.max(...nests))}. Ramsey's math: ${money(ramseyNest)}` : "fixed, so only the spending phase varies") +
      tile("First-year income", money((st.wr / 100) * median(nests)), `${st.wr}% of the median nest egg; ${["then raised with inflation", "raised with inflation except after losing years", "then adjusted by the guardrails", "then rises and falls with the balance"][st.rule]}`) +
      (st.rule ? tile("Leanest year", pct(median(done.map((c) => c.minInc)), 0), (() => {
        const w = done.reduce((a, c) => (c.minInc < a.minInc ? c : a), done[0]);
        return `of first-year income, median retiree. Worst: ${pct(w.minInc, 0)}, retired ${w.r}`;
      })()) : "") +
      (st.load && st.save ? tile("Sales loads paid", money(median(cohorts.map((c) => c.loads))), `median over ${st.save} years of deposits, in today's dollars`) : "") +
      (recent.length ? tile("Not finished yet", recent.length, `retired ${recent[0].r}–${recent[recent.length - 1].r}, left out of the rate; ✕ ${runFail} already ran out`) : "");
    let v = "";
    if (done.length) {
      const failDone = done.length - ok.length;
      const costs = [st.fee ? `${st.fee}% yearly fees` : "", st.load ? `${st.load === 1 ? "sales loads with breakpoints" : "a 5.75% sales load"}` : ""].filter(Boolean).join(" and ");
      const rule = st.rule ? `, taking <b>${RULES_INLINE[st.rule]}</b>` : "";
      v = `At <b>${st.wr}%</b> with <b>${st.stocks}% stocks</b>${costs ? ` and ${costs}` : ""}${rule}, <b>${failDone} of ${done.length}</b> retirements that started from ${firstDone} to ${lastDone} ran out of money before ${st.ret} years were up.`;
      if (worst) v += ` The worst, retiring in ${worst.r}, was broke in ${yrs(worst.lasted)}.`;
      if (runFail) v += ` ${runFail} more that retired recently have already run out.`;
      if (st.rule) {
        const m = median(done.map((c) => c.minInc));
        v += st.rule === 3 ? ` This rule can't run out by design; the cost is income that swings with the market. In the median retirement the leanest year paid ${pct(m, 0)} of the first year's income.`
          : ` In the median retirement the leanest year paid ${pct(m, 0)} of the first year's income.`;
      }
    }
    $("#verdict").innerHTML = v;
  }

  // ---------- render: spaghetti ----------
  let focusR = null;
  function setFocus(r, hovering = true) {
    focusR = r;
    for (const root of ["#paths"]) {
      const el = $(root);
      el.classList.toggle("has-focus", hovering && r != null);
      el.querySelectorAll(".path.focus").forEach((p) => p.classList.remove("focus"));
      if (r != null) {
        const p = el.querySelector(`.path[data-r="${r}"]`);
        if (p) { p.classList.add("focus"); p.parentNode.appendChild(p); }
      }
    }
    document.querySelectorAll("#bars .bar").forEach((b) => b.classList.toggle("dim", hovering && r != null && +b.dataset.r !== r));
  }
  const restoreFocus = () => setFocus(state.sel, false);

  function renderPaths(st, sim) {
    const el = $("#paths");
    const W = Math.max(320, el.clientWidth), Ht = Math.max(280, Math.min(420, W * 0.45));
    const m = { l: 58, r: 14, t: 14, b: 34 };
    const S = st.save, N = st.ret;
    const x = scale(-S, N, m.l, W - m.r);
    const peaks = sim.cohorts.map((c) => Math.max(...c.path));
    let yMax = Math.max(quantile(peaks, 0.97), Math.max(...sim.ramsey)) * 1.05;
    const yt = ticks(0, yMax, 5);
    yMax = Math.max(yMax, yt[yt.length - 1]);
    const y = scale(0, yMax, Ht - m.b, m.t);
    let g = "";
    for (const t of yt) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${moneyTick(t)}</text>`;
    const xt = ticks(-S, N, Math.max(4, Math.floor(W / 90)), 1);
    for (const t of xt) g += `<text x="${x(t)}" y="${Ht - m.b + 16}" text-anchor="middle">${t === 0 ? "Retire" : t < 0 ? `${-t} yrs before` : `${t} yrs after`}</text>`;
    g += `<line class="axisline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    if (S > 0) g += `<line class="retire-line" x1="${x(0)}" x2="${x(0)}" y1="${m.t}" y2="${y(0)}"/>`;
    g += `<text class="ink2" x="${x(-S) + 4}" y="${m.t + 4}">${S ? "Saving" : ""}</text><text class="ink2" x="${x(0) + 6}" y="${m.t + 4}">Spending</text>`;
    const line = (pts) => pts.map((v, i) => `${i ? "L" : "M"}${x(i - S).toFixed(1)},${y(Math.min(v, yMax * 1.5)).toFixed(1)}`).join("");
    let paths = "";
    for (const c of sim.cohorts) paths += `<path class="path ${c.status}" data-r="${c.r}" d="${line(c.path)}"/>`;
    const rl = line(sim.ramsey);
    const rPeak = sim.ramsey[S];
    const rLabelY = Math.max(m.t + 28, y(Math.min(rPeak, yMax)) - 10);
    const ramsey = `<path class="ramsey" d="${rl}"/><text class="ink strong" x="${x(0) + 8}" y="${rLabelY}">Ramsey's assumption</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" aria-label="Real balance paths for every cohort"><defs><clipPath id="clip-p"><rect x="${m.l}" y="${m.t - 2}" width="${W - m.l - m.r}" height="${Ht - m.t - m.b + 4}"/></clipPath></defs>${g}<g clip-path="url(#clip-p)"><g class="lines">${paths}</g>${ramsey}</g><line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${y(0)}" visibility="hidden"/><rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${Ht - m.t - m.b}"/></svg>`;
    $("#legend-paths").innerHTML = legend([["ok", "✓ Lasted", "line"], ["fail", "✕ Ran out", "line"], ["running", "… Still running", "line"]]) +
      `<span><i class="key dash"></i>Ramsey: 12% a year, 4% inflation</span>`;
    const hit = el.querySelector(".hit"), cross = el.querySelector(".crosshair"), svgEl = el.querySelector("svg");
    function nearest(ev) {
      const pt = svgEl.getBoundingClientRect();
      const mx = ev.clientX - pt.left, my = ev.clientY - pt.top;
      const xv = Math.round(x.inv(mx)), p = xv + S;
      let best = null, bd = 28;
      for (const c of sim.cohorts) {
        if (p < 0 || p >= c.path.length) continue;
        const d = Math.abs(y(Math.min(c.path[p], yMax * 1.5)) - my);
        if (d < bd) { bd = d; best = c; }
      }
      return { best, xv };
    }
    hit.addEventListener("pointermove", (ev) => {
      const { best, xv } = nearest(ev);
      cross.setAttribute("x1", x(xv)); cross.setAttribute("x2", x(xv)); cross.setAttribute("visibility", "visible");
      if (best) {
        setFocus(best.r);
        const p = xv + S, cal = best.s0 + p;
        showTip(cohortTip(best, st) + row(`Balance, end of ${cal - 1}`, money(best.path[p])), ev);
      } else { restoreFocus(); hideTip(); }
    });
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); restoreFocus(); });
    hit.addEventListener("click", (ev) => { const { best } = nearest(ev); if (best) select(best.r, true); });
  }

  // ---------- render: bars ----------
  function rbar(x, yBase, yEnd, w, r) {
    const h = Math.abs(yBase - yEnd);
    if (h < 0.5) return "";
    r = Math.min(r, w / 2, h);
    const s = yEnd < yBase ? 1 : -1;
    return `M${x},${yBase}V${yEnd + s * r}Q${x},${yEnd} ${x + r},${yEnd}H${x + w - r}Q${x + w},${yEnd} ${x + w},${yEnd + s * r}V${yBase}Z`;
  }
  function renderBars(st, sim) {
    const el = $("#bars");
    const W = Math.max(320, el.clientWidth), Ht = 230;
    const m = { l: 58, r: 14, t: 12, b: 34 };
    const cs = sim.cohorts, n = cs.length, N = st.ret;
    const band = (W - m.l - m.r) / Math.max(1, n);
    const gap = band > 6 ? 2 : band > 3 ? 1 : 0, bw = Math.max(1, Math.min(24, band - gap));
    const inc = barMode === "income";
    const val = (c) => (inc ? c.minInc : Math.min(c.lasted, N));
    const top = inc ? Math.max(1, ...cs.map((c) => c.minInc)) : N;
    const yt = ticks(0, top, 4);
    const y = scale(0, Math.max(top, yt[yt.length - 1]), Ht - m.b, m.t);
    let g = "";
    for (const t of yt) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${inc ? Math.round(t * 100) + "%" : t + " yrs"}</text>`;
    document.querySelectorAll("[data-barmode]").forEach((b) => b.setAttribute("aria-checked", b.dataset.barmode === barMode));
    $("#bars-note").textContent = inc
      ? "Each bar is the retiree's leanest year: the smallest income they received, as a share of their first year's (in today's dollars). Running out counts as 0%."
      : "A full-height bar made it the whole way. A short red bar ran dry that many years in. Gray bars retired too recently to finish.";
    $("#h-bars").textContent = inc ? "Leanest year's income, by year of retirement" : "How long the money lasted, by year of retirement";
    const every = band * 10 > 46 ? 10 : 20;
    let bars = "";
    cs.forEach((c, i) => {
      const x0 = m.l + i * band + (band - bw) / 2;
      bars += `<g class="bar" data-r="${c.r}"><rect class="hit" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${Ht - m.t - m.b}"/><path class="${c.status}" d="${rbar(x0, y(0), y(val(c)), bw, 2)}"/></g>`;
      if (c.r % every === 0) g += `<text x="${x0 + bw / 2}" y="${Ht - m.b + 16}" text-anchor="middle">${c.r}</text>`;
      if (c.r === state.sel) g += `<path class="sel-mark" d="M${x0 + bw / 2 - 5},${Ht - m.b + 28}l5,-7l5,7z" style="fill:var(--text-primary)"/>`;
    });
    g += `<line class="axisline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" aria-label="${inc ? "Leanest year's income" : "Years each cohort's money lasted"}, by retirement year">${g}${bars}</svg>`;
    $("#legend-bars").innerHTML = legend([["ok", "✓ Lasted"], ["fail", "✕ Ran out"], ["running", "… Still running"]]);
    el.querySelectorAll(".bar").forEach((b) => {
      const c = cs.find((k) => k.r === +b.dataset.r);
      b.addEventListener("pointermove", (ev) => { setFocus(c.r); showTip(cohortTip(c, st), ev); });
      b.addEventListener("pointerleave", () => { hideTip(); restoreFocus(); });
      b.addEventListener("click", () => select(c.r, true));
    });
  }

  let barMode = "lasted";
  const complete = (c) => c.complete;

  // two-line chart (actual vs reversed) over years of retirement
  function duoChart(el, c, len, A, B, Ht, aria, tipTitle, showZone) {
    const W = Math.max(320, el.clientWidth);
    const m = { l: 58, r: 74, t: 12, b: 28 };
    const x = scale(0, len, m.l, W - m.r);
    let yMax = Math.max(...A.map((p) => p[1]), ...B.map((p) => p[1])) * 1.08 || 1;
    const yt = ticks(0, yMax, 4);
    yMax = Math.max(yMax, yt[yt.length - 1]);
    const y = scale(0, yMax, Ht - m.b, m.t);
    let g = "";
    for (const t of yt) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${moneyTick(t)}</text>`;
    const xt = ticks(0, len, Math.max(3, Math.floor(W / 80)), 1);
    for (const t of xt) g += `<text x="${x(t)}" y="${Ht - m.b + 16}" text-anchor="middle">${t === 0 ? c.r : "yr " + t}</text>`;
    g += `<rect class="zone" x="${x(0)}" y="${m.t}" width="${x(Math.min(10, len)) - x(0)}" height="${Ht - m.t - m.b}"/>` +
      (showZone ? `<text class="ink2" x="${x(0) + 6}" y="${m.t + 14}">First decade</text>` : "");
    const ln = (p) => p.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const endLbl = (p, cls, other) => {
      if (!p.length) return "";
      const [i, v] = p[p.length - 1];
      let yy = y(v) + 4;
      const o = other[other.length - 1];
      if (o && cls === "rev" && Math.abs(x(o[0]) - x(i)) < 60 && Math.abs(yy - (y(o[1]) + 4)) < 14) yy = y(o[1]) + 4 + (yy >= y(o[1]) + 4 ? 14 : -14);
      return `<circle class="end-dot" cx="${x(i)}" cy="${y(v)}" r="4.5" style="fill:var(--${cls === "rev" ? "reverse" : "ok"})"/><text class="ink" x="${x(i) + 8}" y="${yy}">${v === 0 ? "$0" : money(v)}</text>`;
    };
    g += `<line class="axisline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    g += `<path class="line-rev" d="${ln(B)}"/><path class="line-ok" d="${ln(A)}"/>`;
    g += endLbl(B, "rev", A) + endLbl(A, "ok", B);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" aria-label="${aria}">${g}<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${y(0)}" visibility="hidden"/><rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${Ht - m.t - m.b}"/></svg>`;
    const cross = el.querySelector(".crosshair");
    const at = (P, i) => { const p = P.find((q) => q[0] === i); return p ? money(p[1]) : "out of money"; };
    el.querySelector(".hit").addEventListener("pointermove", (ev) => {
      const b = el.querySelector("svg").getBoundingClientRect();
      const i = Math.max(A[0][0], Math.min(len, Math.round(x.inv(ev.clientX - b.left))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      showTip(`<b>${tipTitle(i)}</b>` + row("Actual order", at(A, i)) + row("Reversed order", at(B, i)), ev);
    });
    el.querySelector(".hit").addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  }

  // ---------- render: detail ----------
  function renderDetail(st, sim) {
    const c = sim.cohorts.find((k) => k.r === state.sel);
    if (!c) return;
    const N = st.ret;
    $("#h-detail").textContent = `Retired in ${c.r}` + (st.save ? ` after saving ${c.s0}–${c.r - 1}` : " with $1M");
    const rev = drawdown(c.nest, st.wr / 100, [...c.ys].reverse(), c.ys.length, st.rule);
    const tile = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    const S = STATUS[c.status];
    const fullAvailable = c.rets.length;
    $("#detail-tiles").innerHTML =
      tile(st.save ? "Nest egg" : "Starting balance", money(c.nest), st.save ? `${money(st.contrib)} a year for ${st.save} years` : "") +
      tile(st.rule ? "First-year income" : "Income each year", money(c.W), st.rule ? `leanest year: ${money(c.minInc * c.W)}, ${pct(c.minInc, 0)} of the first` : `${st.wr}% of the nest egg, kept up with inflation`) +
      (st.load && st.save ? tile("Sales loads paid", money(c.loads), "taken off deposits before they were invested") : "") +
      tile("Outcome", `${S.icon} ${c.status === "fail" ? yrs(c.lasted) : c.status === "ok" ? money(c.end) : money(c.end)}`,
        c.status === "fail" ? `ran out in ${c.r + Math.ceil(c.lasted) - 1}` : c.status === "ok" ? `left after ${N} years` : `left after ${c.lasted} of ${N} years`) +
      tile("First 10 years, real", spct(c.first10) + "/yr", "portfolio growth after fees and inflation") +
      tile(fullAvailable === N ? `All ${N} years, real` : `${fullAvailable} years so far, real`, spct(cagr(c.rets)) + "/yr", "same in either order") +
      tile("CAPE on retirement day", c.cape == null ? "—" : c.cape.toFixed(1), complete(c) ? `highest fixed rate that lasted: ${pct(c.safe)}` : "stock prices ÷ 10-year average earnings");
    const revTxt = rev.status === "fail" ? `run out after ${yrs(rev.lasted)}` : `end with ${money(rev.end)}`;
    const actTxt = c.status === "fail" ? `ran out after ${yrs(c.lasted)}` : `ended with ${money(c.end)}`;
    $("#reverse-note").innerHTML = `Take the same ${fullAvailable} yearly returns, with the same ${spct(cagr(c.rets))} compound average, and play them back last year first. In the real order this retiree ${actTxt}${c.status === "running" ? " so far" : ""}. Reversed, they would ${revTxt}.`;
    $("#legend-detail").innerHTML = `<span><i class="key line" style="background:var(--ok)"></i>Actual order</span><span><i class="key line" style="background:var(--reverse)"></i>Reversed order</span>`;

    const len = fullAvailable;
    const pts = (arr, off = 0) => arr.map((v, i) => [i + off, v]);
    const incPts = (d) => {
      const p = pts(d.inc, 1);
      if (d.status === "fail" && p.length < len) p.push([p.length + 1, 0]);
      return p;
    };
    duoChart($("#detail-balance"), c, len, pts(c.retPath), pts(rev.path), 230, "Balance through retirement, actual vs reversed order",
      (i) => (i === 0 ? "Retirement day" : `End of year ${i} (${c.r + i - 1})`), true);
    duoChart($("#detail-income"), c, len, incPts(c), incPts(rev), 180, "Income each year, actual vs reversed order",
      (i) => (i === 0 ? "" : `Year ${i} (${c.r + i - 1}) income`), false);
    // returns bars
    const el2 = $("#detail-returns");
    const W2 = Math.max(320, el2.clientWidth), H2 = 170;
    const m2 = { l: 58, r: 74, t: 10, b: 26 };
    const lo = Math.min(-0.1, ...c.rets), hi = Math.max(0.1, ...c.rets);
    const rt = ticks(lo, hi, 4);
    const y2 = scale(Math.min(lo, rt[0]), Math.max(hi, rt[rt.length - 1]), H2 - m2.b, m2.t);
    const band = (W2 - m2.l - m2.r) / Math.max(1, len), bw = Math.max(1, Math.min(24, band - 2));
    let g2 = `<rect class="zone" x="${m2.l}" y="${m2.t}" width="${band * Math.min(10, len)}" height="${H2 - m2.t - m2.b}"/>`;
    for (const t of rt) g2 += `<line class="gridline" x1="${m2.l}" x2="${W2 - m2.r}" y1="${y2(t)}" y2="${y2(t)}"/><text x="${m2.l - 8}" y="${y2(t) + 4}" text-anchor="end">${Math.round(t * 100)}%</text>`;
    let bars = "";
    c.rets.forEach((v, i) => {
      const x0 = m2.l + i * band + (band - bw) / 2;
      bars += `<g class="bar" data-i="${i}"><rect class="hit" x="${m2.l + i * band}" y="${m2.t}" width="${band}" height="${H2 - m2.t - m2.b}"/><path class="${v >= 0 ? "ret-pos" : "ret-neg"}" d="${rbar(x0, y2(0), y2(v), bw, 3)}"/></g>`;
      const yr = c.r + i;
      if (yr % (band > 22 ? 5 : 10) === 0) g2 += `<text x="${x0 + bw / 2}" y="${H2 - m2.b + 16}" text-anchor="middle">${yr}</text>`;
    });
    g2 += `<line class="axisline" x1="${m2.l}" x2="${W2 - m2.r}" y1="${y2(0)}" y2="${y2(0)}"/>`;
    el2.innerHTML = `<svg viewBox="0 0 ${W2} ${H2}" height="${H2}" aria-label="Real portfolio return each year of retirement">${g2}${bars}</svg>`;
    el2.querySelectorAll(".bar").forEach((b) => {
      const i = +b.dataset.i, di = idx(c.r + i);
      b.addEventListener("pointermove", (ev) => showTip(`<b>${c.r + i}</b> <span class="muted">· year ${i + 1}</span>` +
        row("S&amp;P 500", spct(H.stocks[di])) + row("10-yr Treasury", spct(H.bonds[di])) + row("Inflation", spct(H.infl[di])) +
        row("Portfolio, real", spct(c.rets[i])), ev));
      b.addEventListener("pointerleave", hideTip);
    });

    // table selection
    document.querySelectorAll("#table tr[data-r]").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.r === c.r));
  }

  // ---------- render: scatter ----------
  function renderScatter(st, sim) {
    const pts = sim.cohorts.filter((c) => c.status !== "running" && !isNaN(c.full));
    const el = $("#scatter");
    const W = Math.max(320, el.clientWidth), Ht = Math.max(260, Math.min(360, W * 0.4));
    const m = { l: 58, r: 16, t: 26, b: 40 };
    if (!pts.length) { el.innerHTML = `<p class="note">No finished retirements in this window.</p>`; $("#scatter-note").textContent = ""; return; }
    const xs = pts.map((c) => c.first10), ys = pts.map((c) => c.full);
    const xl = Math.min(...xs), xh = Math.max(...xs), yl = Math.min(...ys), yh = Math.max(...ys);
    const xt = ticks(xl, xh, 6), yt = ticks(yl, yh, 5);
    const x = scale(Math.min(xl, xt[0]), Math.max(xh, xt[xt.length - 1]), m.l, W - m.r);
    const y = scale(Math.min(yl, yt[0]), Math.max(yh, yt[yt.length - 1]), Ht - m.b, m.t);
    let g = "";
    for (const t of yt) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${(t * 100).toFixed(t * 100 % 1 ? 1 : 0)}%</text>`;
    for (const t of xt) g += `<line class="gridline" x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${Ht - m.b}"/><text x="${x(t)}" y="${Ht - m.b + 16}" text-anchor="middle">${(t * 100).toFixed(t * 100 % 1 ? 1 : 0)}%</text>`;
    g += `<text class="ink2" x="${(m.l + W - m.r) / 2}" y="${Ht - 4}" text-anchor="middle">Real return per year, first 10 years of retirement</text>`;
    g += `<text class="ink2" x="${m.l - 8}" y="${m.t - 14}" text-anchor="start">↑ Real return per year, all ${st.ret} years</text>`;
    const sorted = [...pts].sort((a, b) => (a.r === state.sel) - (b.r === state.sel));
    let dots = "";
    for (const c of sorted) dots += `<circle class="dot ${c.status}${c.r === state.sel ? " focus" : ""}" data-r="${c.r}" cx="${x(c.first10)}" cy="${y(c.full)}" r="${c.r === state.sel ? 6 : 4.5}"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" aria-label="First-decade return vs full-period return">${g}${dots}</svg>`;
    $("#legend-scatter").innerHTML = legend([["ok", "✓ Lasted", "dot"], ["fail", "✕ Ran out", "dot"]]);
    el.querySelectorAll(".dot").forEach((d) => {
      const c = pts.find((k) => k.r === +d.dataset.r);
      d.addEventListener("pointermove", (ev) => showTip(cohortTip(c, st) + row(`All ${st.ret} yrs, real`, spct(c.full) + "/yr"), ev));
      d.addEventListener("pointerleave", hideTip);
      d.addEventListener("click", () => select(c.r, true));
    });
    const okp = pts.filter((c) => c.status === "ok"), fp = pts.filter((c) => c.status === "fail");
    let note = `Each dot is one finished retirement: across, how the portfolio did in its first ten years; up, how it did over all ${st.ret}.`;
    if (okp.length && fp.length) {
      const bestFailFull = Math.max(...fp.map((c) => c.full)), worstOkFull = Math.min(...okp.map((c) => c.full));
      const minOk10 = Math.min(...okp.map((c) => c.first10)), maxFail10 = Math.max(...fp.map((c) => c.first10));
      if (bestFailFull > worstOkFull) {
        const bf = fp.find((c) => c.full === bestFailFull), wo = okp.find((c) => c.full === worstOkFull);
        note += ` The long-run average doesn't settle it: the ${bf.r} retiree's portfolio grew ${spct(bestFailFull)} a year and still ran out, while the ${wo.r} retiree made it on ${spct(worstOkFull)}.`;
      }
      note += ` The first decade does: no retirement whose first ten years averaged under ${spct(minOk10)} survived, and none above ${spct(maxFail10)} ran out.`;
    } else if (!fp.length) note += " At these settings nothing ran out.";
    else note += " At these settings nothing survived.";
    $("#scatter-note").innerHTML = note;
  }

  // ---------- render: valuation ----------
  function renderCape(st, sim) {
    const pts = sim.cohorts.filter((c) => c.complete && c.cape != null);
    const el = $("#cape");
    const now = H.capeNow, wr = st.wr / 100;
    const W = Math.max(320, el.clientWidth), Ht = Math.max(280, Math.min(380, W * 0.42));
    const m = { l: 58, r: 16, t: 26, b: 40 };
    if (!pts.length) { el.innerHTML = `<p class="note">No finished retirements with valuation data in this window.</p>`; $("#cape-note").textContent = ""; return; }
    const xh = Math.max(now.cape, ...pts.map((c) => c.cape)) * 1.04;
    const ys = pts.map((c) => c.safe);
    const yl = Math.min(0, ...ys), yh = Math.max(wr, ...ys) * 1.05;
    const xt = ticks(0, xh, 7), yt = ticks(yl, yh, 5);
    const x = scale(0, Math.max(xh, xt[xt.length - 1]), m.l, W - m.r);
    const y = scale(Math.min(yl, yt[0]), Math.max(yh, yt[yt.length - 1]), Ht - m.b, m.t);
    let g = "";
    for (const t of yt) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${+(t * 100).toFixed(1)}%</text>`;
    for (const t of xt) g += `<text x="${x(t)}" y="${Ht - m.b + 16}" text-anchor="middle">${t}</text>`;
    g += `<text class="ink2" x="${(m.l + W - m.r) / 2}" y="${Ht - 4}" text-anchor="middle">CAPE (Shiller P/E10) in January of the retirement year</text>`;
    g += `<text class="ink2" x="${m.l - 8}" y="${m.t - 14}">↑ Highest fixed withdrawal rate that lasted ${st.ret} years</text>`;
    g += `<line class="axisline" x1="${m.l}" x2="${W - m.r}" y1="${y(Math.max(0, yt[0]))}" y2="${y(Math.max(0, yt[0]))}"/>`;
    const refs = [...new Set([wr, 0.04])];
    for (const r of refs) {
      const mine = r === wr;
      g += `<line class="${mine ? "crosshair" : "axisline"}" x1="${m.l}" x2="${W - m.r}" y1="${y(r)}" y2="${y(r)}"/><text class="ink${mine ? " strong" : "2"}" x="${W - m.r}" y="${y(r) - 6}" text-anchor="end">${mine ? `Your ${st.wr}%` : "4%"}</text>`;
    }
    const nx = x(now.cape);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    g += `<line class="retire-line" x1="${nx}" x2="${nx}" y1="${m.t}" y2="${Ht - m.b}"/><text class="ink strong" x="${nx - 6}" y="${m.t + 12}" text-anchor="end">Today: ${now.cape}</text><text class="ink2" x="${nx - 6}" y="${m.t + 27}" text-anchor="end">${months[now.month - 1]} ${now.year}</text>`;
    const sorted = [...pts].sort((a, b) => (a.r === state.sel) - (b.r === state.sel));
    let dots = "";
    for (const c of sorted) {
      const cls = c.safe >= wr ? "ok" : "fail";
      dots += `<circle class="dot ${cls}${c.r === state.sel ? " focus" : ""}" data-r="${c.r}" cx="${x(c.cape)}" cy="${y(c.safe)}" r="${c.r === state.sel ? 6 : 4.5}"/>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" aria-label="Valuation on retirement day vs highest sustainable withdrawal rate">${g}${dots}</svg>`;
    $("#legend-cape").innerHTML = legend([["ok", `✓ ${st.wr}% fixed would have lasted`, "dot"], ["fail", `✕ ${st.wr}% fixed would have run out`, "dot"]]);
    el.querySelectorAll(".dot").forEach((d) => {
      const c = pts.find((k) => k.r === +d.dataset.r);
      d.addEventListener("pointermove", (ev) => showTip(`<b>Retired in ${c.r}</b>` + row("CAPE that January", c.cape.toFixed(1)) +
        row(`Highest rate that lasted ${st.ret} yrs`, pct(c.safe)) + row(`All ${st.ret} yrs, real`, spct(c.full) + "/yr"), ev));
      d.addEventListener("pointerleave", hideTip);
      d.addEventListener("click", () => select(c.r, true));
    });
    // note
    const okp = pts.filter((c) => c.safe >= wr);
    let note = `Each dot is one finished retirement with ${st.stocks}% stocks${st.fee ? ` and ${st.fee}% fees` : ""}: across, how expensive stocks were on retirement day; up, the highest fixed, inflation-adjusted withdrawal rate that would have lasted all ${st.ret} years (often called SAFEMAX).`;
    if (okp.length && okp.length < pts.length) {
      const maxOk = okp.reduce((a, c) => (c.cape > a.cape ? c : a));
      const above = pts.filter((c) => c.cape > maxOk.cape).length;
      if (above) note += ` Every retirement that could sustain ${st.wr}% began with a CAPE of ${maxOk.cape.toFixed(1)} or lower (${maxOk.r}); all ${above} that began higher fell short.`;
    } else if (!okp.length) note += ` None could sustain ${st.wr}%.`;
    else note += ` All of them could sustain ${st.wr}%.`;
    const hi = pts.filter((c) => c.cape > 22);
    if (hi.length) {
      const best = hi.reduce((a, c) => (c.safe > a.safe ? c : a));
      note += ` The ${hi.length} that began above 22 topped out at ${pct(best.safe)} (${best.r}).`;
    }
    const higher = H.cape.map((v, i) => [H.first + i, v]).filter(([, v]) => v != null && v >= now.cape);
    note += ` Today's CAPE is ${now.cape}. ` + (higher.length
      ? `Only ${higher.length} ${higher.length === 1 ? "January" : "Januaries"} in the record were as high (${higher.map(([yr]) => yr).join(", ")})` + (() => {
          const done = pts.filter((c) => c.cape >= now.cape);
          return done.length ? `; the best of those retirements could sustain ${pct(Math.max(...done.map((c) => c.safe)))}.` : `, and none has had ${st.ret} years to play out.`;
        })()
      : "No January in the record was as high.");
    note += " Valuation can't call any single year, but it has set the ceiling on what a retirement could spend.";
    $("#cape-note").innerHTML = note;
  }

  // ---------- render: sweep ----------
  function renderSweep(st, sim) {
    const data = sweep(st, sim.cohorts);
    const el = $("#sweep");
    const W = Math.max(320, el.clientWidth), Ht = 240;
    const m = { l: 58, r: 16, t: 14, b: 34 };
    const x = scale(2, 10, m.l, W - m.r), y = scale(0, 1, Ht - m.b, m.t);
    let g = "";
    for (const t of [0, 0.25, 0.5, 0.75, 1]) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text>`;
    for (let t = 2; t <= 10; t++) g += `<text x="${x(t)}" y="${Ht - m.b + 16}" text-anchor="middle">${t}%</text>`;
    g += `<text class="ink2" x="${(m.l + W - m.r) / 2}" y="${Ht - 2}" text-anchor="middle">First-year withdrawal rate</text>`;
    const valid = data.filter((d) => !isNaN(d.rate));
    const d = valid.map((p, i) => `${i ? "L" : "M"}${x(p.wr).toFixed(1)},${y(p.rate).toFixed(1)}`).join("");
    const area = valid.length ? d + `L${x(valid[valid.length - 1].wr)},${y(0)}L${x(valid[0].wr)},${y(0)}Z` : "";
    g += `<path class="area-ok" d="${area}"/><path class="line-ok" d="${d}"/><line class="axisline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    if (st.rule) {
      const d2 = valid.map((p, i) => `${i ? "L" : "M"}${x(p.wr).toFixed(1)},${y(Math.min(1, p.worst)).toFixed(1)}`).join("");
      g += `<path class="line-rev" d="${d2}"/>`;
    }
    $("#legend-sweep").innerHTML = st.rule ? `<span><i class="key line" style="background:var(--ok)"></i>Retirements that lasted</span><span><i class="key line" style="background:var(--reverse)"></i>Worst retirement's leanest year, % of first-year income</span>` : "";
    const at = (wr) => data.reduce((a, p) => (Math.abs(p.wr - wr) < Math.abs(a.wr - wr) ? p : a));
    const marks = [...new Set([4, 8, st.wr])];
    for (const wr of marks) {
      const p = at(wr);
      if (isNaN(p.rate)) continue;
      const cur = wr === st.wr;
      g += `<line class="${cur ? "crosshair" : "gridline"}" x1="${x(p.wr)}" x2="${x(p.wr)}" y1="${y(p.rate)}" y2="${y(0)}"/>`;
      g += `<circle class="end-dot" cx="${x(p.wr)}" cy="${y(p.rate)}" r="${cur ? 6 : 4.5}" style="fill:var(--ok)"/>`;
      const above = y(p.rate) > m.t + 30;
      g += `<text class="ink strong" x="${x(p.wr) + (p.rate > 0.9 ? 8 : 0)}" y="${above ? y(p.rate) - 12 : y(p.rate) + 20}" text-anchor="${p.rate > 0.9 ? "start" : "middle"}">${p.wr}%: ${pct(p.rate, 0)}${cur && wr !== 4 && wr !== 8 ? " (yours)" : ""}</text>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" aria-label="Success rate by withdrawal rate">${g}<line class="crosshair hov" x1="0" x2="0" y1="${m.t}" y2="${y(0)}" visibility="hidden"/><rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${Ht - m.t - m.b}"/></svg>`;
    const cross = el.querySelector(".hov");
    el.querySelector(".hit").addEventListener("pointermove", (ev) => {
      const b = el.querySelector("svg").getBoundingClientRect();
      const p = at(x.inv(ev.clientX - b.left));
      cross.setAttribute("x1", x(p.wr)); cross.setAttribute("x2", x(p.wr)); cross.setAttribute("visibility", "visible");
      showTip(`<b>${p.wr}% first-year withdrawal</b>` + row("Retirements that lasted", isNaN(p.rate) ? "—" : pct(p.rate, 0)) +
        (st.rule ? row("Worst leanest year", isNaN(p.worst) ? "—" : pct(p.worst, 0) + " of first") : ""), ev);
    });
    el.querySelector(".hit").addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
    $("#sweep-note").innerHTML = `With ${st.stocks}% stocks${st.fee ? `, ${st.fee}% fees` : ""}, ${RULES_INLINE[st.rule]}, and ${st.ret} years to cover, across every finished retirement since ${st.from + st.save}. How much you saved doesn't move this curve: a bigger nest egg buys a bigger income, but it runs out on the same schedule.` +
      (st.rule ? " The orange line is the price of flexibility: how far the unluckiest retiree's income had to fall." : "");
  }

  // ---------- render: table ----------
  function renderTable(st, sim) {
    const head = `<thead><tr><th>Retired</th>${st.save ? "<th>Saved from</th>" : ""}<th>Nest egg</th><th>Income / yr</th><th>Outcome</th><th>Years lasted</th><th>Balance left</th><th>First 10 yrs, real</th><th>All ${st.ret} yrs, real</th>${st.rule ? "<th>Leanest year</th>" : ""}<th>CAPE</th><th>Safe max rate</th>${st.load && st.save ? "<th>Loads paid</th>" : ""}</tr></thead>`;
    const body = sim.cohorts.map((c) => `<tr data-r="${c.r}"${c.r === state.sel ? ' class="sel"' : ""}><td>${c.r}</td>${st.save ? `<td>${c.s0}</td>` : ""}<td>${money(c.nest)}</td><td>${money(c.W)}</td><td>${STATUS[c.status].icon} ${STATUS[c.status].label}</td><td>${c.status === "fail" ? c.lasted.toFixed(1) : c.lasted}</td><td>${money(c.end)}</td><td>${isNaN(c.first10) ? "—" : spct(c.first10)}</td><td>${isNaN(c.full) ? "—" : spct(c.full)}</td>${st.rule ? `<td>${pct(c.minInc, 0)}</td>` : ""}<td>${c.cape == null ? "—" : c.cape.toFixed(1)}</td><td>${isNaN(c.safe) ? "—" : pct(c.safe)}</td>${st.load && st.save ? `<td>${money(c.loads)}</td>` : ""}</tr>`).join("");
    const t = $("#table");
    t.innerHTML = head + "<tbody>" + body + "</tbody>";
    t.querySelectorAll("tr[data-r]").forEach((tr) => tr.addEventListener("click", () => select(+tr.dataset.r, true)));
  }

  // ---------- controls ----------
  const ctl = {
    wr: [$("#wr"), $("#o-wr"), (v) => v + "%"],
    stocks: [$("#stocks"), $("#o-stocks"), (v) => `${v}% / bonds ${100 - v}%`],
    fee: [$("#fee"), $("#o-fee"), (v) => v.toFixed(2) + "%"],
    save: [$("#save"), $("#o-save"), (v) => v + (v === 1 ? " year" : " years")],
    contrib: [$("#contrib"), $("#o-contrib"), (v) => "$" + v.toLocaleString()],
    ret: [$("#ret"), $("#o-ret"), (v) => v + " years"],
    load: [$("#load"), null],
    rule: [$("#rule"), null],
  };
  function syncControls() {
    for (const [k, [inp, out, f]] of Object.entries(ctl)) { inp.value = state[k]; if (out) out.textContent = f(state[k]); }
    document.querySelectorAll("[data-from]").forEach((b) => b.setAttribute("aria-checked", +b.dataset.from === state.from));
    document.querySelectorAll("[data-preset]").forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      b.setAttribute("aria-pressed", Object.entries(p).every(([k, v]) => state[k] === v));
    });
    $("#save-hint").textContent = state.save ? `for example, age ${65 - state.save} to 65` : "start retirement with $1,000,000 instead";
    $("#ctl-contrib").style.opacity = state.save ? 1 : 0.4;
    $("#contrib").disabled = !state.save;
  }

  let sim = null;
  function renderAll() {
    // keep the window feasible
    const maxSave = LAST - state.from;
    if (state.save > maxSave) state.save = maxSave;
    syncControls();
    sim = simulate(state);
    if (!sim.cohorts.some((c) => c.r === state.sel)) {
      const done = sim.cohorts.filter((c) => c.complete);
      const pool = done.length ? done : sim.cohorts;
      state.sel = pool.reduce((a, c) => (c.lasted < a.lasted || (c.lasted === a.lasted && c.end < a.end) ? c : a)).r;
    }
    renderTwelve(state);
    renderSummary(state, sim);
    renderPaths(state, sim);
    renderBars(state, sim);
    renderTable(state, sim);
    renderDetail(state, sim);
    renderScatter(state, sim);
    renderSweep(state, sim);
    renderCape(state, sim);
    restoreFocus();
    writeHash();
  }
  function select(r, scroll) {
    state.sel = r;
    renderBars(state, sim);
    renderDetail(state, sim);
    renderScatter(state, sim);
    renderCape(state, sim);
    restoreFocus();
    writeHash();
    hideTip();
    if (scroll) {
      const d = $(".detail").getBoundingClientRect();
      if (d.top > innerHeight || d.bottom < 0) $(".detail").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  for (const [k, [inp]] of Object.entries(ctl)) inp.addEventListener("input", () => { state[k] = +inp.value; renderAll(); });
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => { Object.assign(state, PRESETS[b.dataset.preset]); renderAll(); }));
  document.querySelectorAll("[data-from]").forEach((b) => b.addEventListener("click", () => { state.from = +b.dataset.from; renderAll(); }));
  document.querySelectorAll("[data-barmode]").forEach((b) => b.addEventListener("click", () => { barMode = b.dataset.barmode; renderBars(state, sim); restoreFocus(); }));
  document.querySelectorAll("#cohort-nav [data-step]").forEach((b) => b.addEventListener("click", () => {
    const i = sim.cohorts.findIndex((c) => c.r === state.sel) + +b.dataset.step;
    if (i >= 0 && i < sim.cohorts.length) select(sim.cohorts[i].r, false);
  }));

  let rz, lastW = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w === lastW) return;
    lastW = w; clearTimeout(rz); rz = setTimeout(renderAll, 80);
  }).observe(document.querySelector("main"));
  renderAll();
})();
