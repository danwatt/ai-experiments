// The year-by-year matrix below the player: one row per retirement start year, one square per year into it,
// colored by that year's check (8% of what's left) or its balance ($80,000 a year). Reads FUNDS and HIST.
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS, T = F.funds.map((f) => f.ticker), HOR = 30, START = 1e6, WR = 0.08;
  const real = (t, y) => (1 + F.returns[t][y - F.first]) / (1 + H.infl[y - H.first]) - 1, sum = (a) => a.reduce((x, y) => x + y, 0);
  function takeEvenly(bal, amount) {
    let need = amount, open = bal.map((b, i) => i).filter((i) => bal[i] > 0);
    while (need > 1e-6 && open.length) {
      const share = need / open.length;
      for (const i of [...open]) { const x = Math.min(share, bal[i]); bal[i] -= x; need -= x; if (bal[i] <= 1e-9) open = open.filter((j) => j !== i); }
    }
    return amount - need;
  }
  // per start year: each year's check (8% of what's left, January) and each year-end balance ($80,000 at year end)
  const ROWS = [];
  for (let y0 = F.first; y0 <= F.last; y0++) {
    const n = Math.min(HOR, F.last - y0 + 1), a = T.map(() => START / 4), b = T.map(() => START / 4), checks = [], bals = [];
    let out = false;
    for (let k = 0; k < n; k++) {
      const y = y0 + k;
      checks.push(takeEvenly(a, WR * sum(a))); T.forEach((t, i) => (a[i] *= 1 + real(t, y)));
      if (out) { bals.push(null); continue; }
      T.forEach((t, i) => (b[i] *= 1 + real(t, y)));
      if (sum(b) < WR * START) { out = true; bals.push(0); b.fill(0); continue; }
      takeEvenly(b, WR * START); bals.push(sum(b));
    }
    ROWS.push({ y0, n, checks, bals });
  }

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (c1, c2, u) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`; };
  const money = (v) => (v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : "$" + Math.round(v / 1e3) + "K");
  const dollars = (v) => "$" + Math.round(v).toLocaleString("en-US");
  // diverging around the plan: below it warm (danger), above it cool (bluebonnet), on it the neutral surface
  const MODES = {
    pct: { mid: 80e3, lo: 30e3, hi: 200e3, val: (r, k) => r.checks[k], label: "Check that year", loText: "$30K", midText: "$80K (the plan)", hiText: "$200K" },
    fixed: { mid: 1e6, lo: 0, hi: 2.5e6, val: (r, k) => r.bals[k], label: "Balance at year end", loText: "$0", midText: "$1M (the start)", hiText: "$2.5M" },
  };
  let mode = "pct";
  function color(m, v) {
    const neutral = css("surface-raised");
    if (v == null) return "transparent";
    if (m === MODES.fixed && v === 0) return css("danger");
    if (v < m.mid) { const u = Math.min(1, (m.mid - v) / (m.mid - m.lo)); return mix(neutral, css("danger"), 0.15 + 0.85 * u); }
    const u = Math.min(1, Math.log(v / m.mid) / Math.log(m.hi / m.mid)); return mix(neutral, css("bluebonnet"), 0.15 + 0.85 * u);
  }
  const svg = document.getElementById("matrix"), tip = document.getElementById("matrixTip"), legend = document.getElementById("matrixLegend");
  const CW = 30, CH = 15, L = 70, TOP = 40, W = L + HOR * CW + 20, Hh = TOP + ROWS.length * CH + 50;
  function draw() {
    const m = MODES[mode];
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    let s = `<text class="title" x="${L}" y="16">Years into retirement</text>`;
    for (let k = 0; k < HOR; k++) if (k === 0 || (k + 1) % 5 === 0) s += `<text x="${L + k * CW + CW / 2}" y="${TOP - 8}" text-anchor="middle">${k + 1}</text>`;
    s += `<text class="title" x="${L - 8}" y="16" text-anchor="end">Start</text>`;
    ROWS.forEach((r, i) => {
      const y = TOP + i * CH;
      if (r.y0 % 5 === 0 || r.y0 === F.first || r.y0 === 2003) s += `<text x="${L - 8}" y="${y + CH - 4}" text-anchor="end"${r.y0 === 2003 ? ' style="fill:var(--ink);font-weight:600"' : ""}>${r.y0}</text>`;
      for (let k = 0; k < r.n; k++) {
        const v = m.val(r, k);
        if (v == null) continue;
        s += `<rect x="${L + k * CW + 1}" y="${y + 1}" width="${CW - 2}" height="${CH - 2}" rx="2" fill="${color(m, v)}" data-i="${i}" data-k="${k}"/>`;
      }
    });
    // the book's year, outlined
    const bi = 2003 - F.first;
    s += `<rect x="${L}" y="${TOP + bi * CH}" width="${ROWS[bi].n * CW}" height="${CH}" fill="none" stroke="var(--ink)" stroke-width="1.5" rx="3"/>`;
    s += `<text x="${L + ROWS[bi].n * CW + 8}" y="${TOP + bi * CH + CH - 4}" style="fill:var(--ink)">The Total Money Makeover, Sept 2003</text>`;
    svg.innerHTML = s;
    legend.innerHTML = `<span>${m.loText}</span><span class="ramp" style="background:linear-gradient(90deg, ${color(m, m.lo)}, ${color(m, m.mid)}, ${color(m, m.hi)})"></span><span>${m.hiText}</span><span>· middle: ${m.midText}${mode === "fixed" ? " · red: ran out" : ""}</span>`;
  }
  svg.addEventListener("mousemove", (e) => {
    const el = e.target.closest("rect[data-i]");
    if (!el) { tip.hidden = true; return; }
    const r = ROWS[+el.dataset.i], k = +el.dataset.k, y = r.y0 + k, m = MODES[mode], v = m.val(r, k);
    tip.innerHTML = `<b>Retired ${r.y0}, year ${k + 1} (${y})</b><span>${m.label}:</span> ${mode === "fixed" && v === 0 ? "ran out" : dollars(v)}`;
    const box = svg.parentNode.getBoundingClientRect();
    tip.hidden = false; tip.style.left = Math.min(e.clientX - box.left + 14, box.width - tip.offsetWidth) + "px"; tip.style.top = e.clientY - box.top + 14 + "px";
  });
  svg.addEventListener("mouseleave", () => (tip.hidden = true));
  document.querySelectorAll("[data-matrix]").forEach((b) => b.addEventListener("click", () => {
    mode = b.dataset.matrix; document.querySelectorAll("[data-matrix]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw();
  }));
  draw();
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
