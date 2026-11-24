// The simulation behind the explainer: the same rules as the interactive page (../app.js),
// trimmed to what the scenes need. Everything in today's dollars; end-of-year cash flows.
(function (root) {
  "use strict";
  const H = root.HIST;
  const idx = (y) => y - H.first;
  const BREAKPOINTS = [[1e6, 0], [750e3, 0.015], [500e3, 0.02], [250e3, 0.025], [100e3, 0.035], [50e3, 0.045], [25e3, 0.05], [0, 0.0575]];
  const loadRate = (on, acct) => (on ? BREAKPOINTS.find(([m]) => acct >= m)[1] : 0);
  const cagr = (r) => Math.pow(r.reduce((a, x) => a * (1 + x), 1), 1 / r.length) - 1;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  function realReturns(o) {
    const w = o.stocks, fee = o.fee || 0;
    return H.stocks.map((s, i) => ((1 + w * s + (1 - w) * H.bonds[i]) * (1 - fee)) / (1 + H.infl[i]) - 1);
  }
  // pct: withdraw wr x balance each year instead of a fixed real income
  function drawdown(B, wr, rets, N, pct) {
    const W0 = wr * B, path = [B], inc = [];
    let status = "ok", lasted = 0;
    for (let k = 0; k < N; k++) {
      if (k >= rets.length) { status = "running"; break; }
      const pre = B * (1 + rets[k]);
      const W = pct ? wr * pre : W0;
      if (pre < W) { inc.push(pre); lasted = k + pre / W; B = 0; path.push(0); status = "fail"; break; }
      B = pre - W; inc.push(W); path.push(B); lasted = k + 1;
    }
    return { path, inc, W0, status, lasted, end: B, minInc: status === "fail" ? 0 : Math.min(...inc) / W0 };
  }
  function safeMax(rets) { let a = 1, b = 0; for (const r of rets) { a *= 1 + r; b = b * (1 + r) + 1; } return a / b; }

  // o: { wr, stocks, fee, load, save, contrib, ret, from, pct }
  function cohorts(o) {
    const rr = realReturns(o), out = [];
    for (let r = o.from + o.save; r <= H.last; r++) {
      const s0 = r - o.save;
      let B = 0, loads = 0;
      const save = [0];
      for (let k = 0; k < o.save; k++) {
        const f = o.contrib * loadRate(o.load, B + o.contrib);
        loads += f;
        B = B * (1 + rr[idx(s0 + k)]) + o.contrib - f;
        save.push(B);
      }
      const rets = rr.slice(idx(r), Math.min(idx(r) + o.ret, idx(H.last) + 1));
      const d = drawdown(B, o.wr, rets, o.ret, o.pct);
      const complete = rets.length === o.ret;
      out.push({ r, s0, nest: B, save, rets, loads, complete, cape: H.cape[idx(r)], ...d,
        first10: cagr(rets.slice(0, 10)), full: complete ? cagr(rets) : NaN, safe: complete ? safeMax(rets) : NaN });
    }
    return out;
  }
  function summary(cs) {
    const done = cs.filter((c) => c.complete);
    const ok = done.filter((c) => c.status === "ok");
    const fails = cs.filter((c) => c.status === "fail");
    const worst = fails.length ? fails.reduce((a, c) => (c.lasted < a.lasted ? c : a)) : null;
    return { done, ok, fails, worst, recentFails: cs.filter((c) => !c.complete && c.status === "fail") };
  }
  function stockStats(from) {
    const a = idx(from), s = H.stocks.slice(a), i = H.infl.slice(a);
    return { n: s.length, mean: mean(s), cagr: cagr(s), real: cagr(s.map((x, k) => (1 + x) / (1 + i[k]) - 1)),
      near: s.filter((x) => x >= 0.10 && x <= 0.14).length, neg: s.filter((x) => x < 0).length };
  }
  root.Model = { H, idx, realReturns, drawdown, safeMax, cohorts, summary, stockStats, cagr, median, RAMSEY_REAL: 1.12 / 1.04 - 1 };
})(typeof window !== "undefined" ? window : globalThis);
