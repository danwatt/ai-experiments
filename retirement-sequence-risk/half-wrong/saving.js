// "What if I'm half wrong?" — the book's couple saving $625 a month for 40 years (age 30 to 70), through every
// real 40-year stretch, against the book's $7,588,545, its "half wrong" $4 million and "six times wrong" (a sixth).
// Reads HIST (../data.js) and FUNDS (../explainer-4/funds.js).
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS, T = F.funds.map((f) => f.ticker);
  const MONTHLY = 625, YEARS = 40, BOOK_SUM = 7588545, FROM = 1981, Y0 = 1926, LAST = H.last;
  const GOALS = [
    { v: BOOK_SUM, label: "$7.59M, the book" },
    { v: 4e6, label: "$4M, “half wrong”" },
    { v: BOOK_SUM / 6, label: "$1.26M, “six times wrong”" },
  ];
  const SERIES = [
    { key: "four", name: "Four funds", long: "Ramsey's four funds, 25% each", first: F.first, r: (y) => T.reduce((a, t) => a + F.returns[t][y - F.first], 0) / T.length },
    { key: "sp", name: "S&P 500 index", long: "the S&P 500 index (no costs)", first: Y0, r: (y) => H.stocks[y - H.first] },
    { key: "vf", name: "VFINX", long: "VFINX, Vanguard 500 Index Fund", first: F.first, r: (y) => F.compare.SP[y - F.first] },
  ];
  // raise: the deposit grows 4% each January, keeping up with the book's inflation
  const state = { early: false, raise: false };
  const $ = (s) => document.querySelector(s);
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const mill = (v) => "$" + (v / 1e6).toFixed(2) + "M";

  // one saver: $625 at the start of every month, each year's return spread evenly over its months
  function save(s, st) {
    let B = 0, P = 1, D = MONTHLY, put = 0;
    const deposits = [];
    for (let y = st; y < st + YEARS; y++) {
      const m = Math.pow(1 + s.r(y), 1 / 12) - 1;
      for (let j = 0; j < 12; j++) { B = (B + D) * (1 + m); put += D; }
      deposits.push(D);
      P *= 1 + H.infl[y - H.first];
      if (state.raise) D *= 1.04;
    }
    // the steady yearly rate that would have turned the same deposits into the same balance
    let lo = -0.2, hi = 0.4;
    for (let k = 0; k < 60; k++) { const x = (lo + hi) / 2, mm = Math.pow(1 + x, 1 / 12) - 1; let v = 0; for (let i = 0; i < YEARS * 12; i++) v = (v + deposits[Math.floor(i / 12)]) * (1 + mm); v > B ? (hi = x) : (lo = x); }
    return { s, st, end: st + YEARS - 1, B, real: B / P, rate: (lo + hi) / 2, put, lastD: deposits[YEARS - 1] };
  }
  const reached = (o) => GOALS.filter((g) => o.B >= g.v).length; // 3 = the book's figure, 2 = half, 1 = a sixth

  const tip = $("#tip");
  function showTip(e, o) {
    const row = (k, v) => `<div class="t-row"><span>${k}</span><span>${v}</span></div>`;
    const n = reached(o);
    tip.innerHTML = `<b>${o.s.name}, saving ${o.st}–${o.end}</b><br><span class="muted">${state.raise ? `${money(MONTHLY)} a month, raised 4% a year to ${money(o.lastD)}; ${money(o.put)} in all` : `${money(MONTHLY)} a month for 40 years, ${money(o.put)} in all`}</span><br>` +
      `<span style="font-weight:600;color:var(${n >= 2 ? "--bluebonnet" : "--danger"})">${n === 3 ? "Reached the book's $7.59 million" : n === 2 ? "Reached “half wrong”, $4 million" : n === 1 ? "Reached only “six times wrong”" : "Short of even “six times wrong”"}</span>` +
      row(`At the end of ${o.end}`, money(o.B)) + row(`In ${o.st} dollars`, money(o.real)) + row("Grew at, a year", (100 * o.rate).toFixed(1) + "%");
    tip.hidden = false;
    const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), ty = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
    tip.style.left = tx + "px"; tip.style.top = ty + "px";
  }

  const NS = "http://www.w3.org/2000/svg";
  function draw() {
    const from = state.early ? Y0 : FROM, lastStart = LAST - YEARS + 1;
    document.querySelectorAll("[data-deposit]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.deposit === "raise") === state.raise)));
    $("#sv-note-flat").hidden = $("#sv-verdict-flat").hidden = state.raise;
    $("#sv-note-raise").hidden = $("#sv-verdict-raise").hidden = !state.raise;
    const runs = {};
    SERIES.forEach((s) => { runs[s.key] = []; for (let st = Math.max(s.first, from); st <= lastStart; st++) runs[s.key].push(save(s, st)); });

    // ---------- tiles
    const count = (l, i) => l.filter((o) => o.B >= GOALS[i].v).length;
    $("#sv-tiles").innerHTML = SERIES.map((s) => {
      const l = runs[s.key];
      return `<div class="tile"><div class="label">${s.name}: reached $4 million</div><div class="value">${count(l, 1)} of ${l.length}</div><div class="sub">${count(l, 0)} reached the book's $7.59 million; ${count(l, 2)} beat $1.26 million. Saving from ${l[0].st}–${l[l.length - 1].st}.</div></div>`;
    }).join("");
    $("#sv-legend").innerHTML = SERIES.map((s) => `<span><i style="background:var(--sv-${s.key})"></i>${s.name}</span>`).join("") +
      `<span><i class="dash" style="border-top-color:var(--text-secondary)"></i>The book's goals</span>`;

    // ---------- chart: one group of bars per start year, against the three goals
    const svg = $("#sv"); svg.innerHTML = "";
    const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    const years = Array.from({ length: lastStart - from + 1 }, (_, i) => from + i);
    const W = 1040, Hh = 320, L = 64, R = 200, Tp = 14, B = 34;
    const hi = Math.ceil(Math.max(BOOK_SUM, ...Object.values(runs).flat().map((o) => o.B)) / 1e6) * 1e6;
    const slot = (W - L - R) / years.length, x = (y) => L + (y - from) * slot, yv = (v) => Tp + (1 - v / hi) * (Hh - Tp - B);
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    for (let n = 0; n <= hi; n += hi > 8e6 ? 2e6 : 1e6) {
      el("line", { x1: L, x2: W - R, y1: yv(n), y2: yv(n), class: n ? "grid" : "axis" });
      el("text", { x: L - 8, y: yv(n) + 4, "text-anchor": "end" }, n ? "$" + n / 1e6 + "M" : "$0");
    }
    const every = years.length > 20 ? 10 : 1;
    years.forEach((y) => { if (y % every === 0 || every === 1) el("text", { x: x(y) + slot / 2, y: Hh - B + 18, "text-anchor": "middle" }, every === 1 ? `${y}–${y + YEARS - 1}` : String(y)); });
    years.forEach((y) => {
      const here = SERIES.filter((s) => runs[s.key].some((o) => o.st === y));
      const pad = Math.min(6, slot * 0.15), bw = (slot - 2 * pad) / here.length;
      here.forEach((s, i) => {
        const o = runs[s.key].find((r) => r.st === y), bx = x(y) + pad + i * bw, top = yv(o.B), h = yv(0) - top, rr = Math.min(3, bw / 2 - 0.5, h);
        const g = Math.min(1, bw * 0.15);
        const b = el("path", { class: "svbar", style: `fill:var(--sv-${s.key})`, d: `M${bx + g},${yv(0)}V${top + rr}Q${bx + g},${top} ${bx + g + rr},${top}H${bx + bw - g - rr}Q${bx + bw - g},${top} ${bx + bw - g},${top + rr}V${yv(0)}Z` });
        b.addEventListener("mousemove", (e) => { b.classList.add("on"); showTip(e, o); });
        b.addEventListener("mouseleave", () => { b.classList.remove("on"); tip.hidden = true; });
      });
    });
    GOALS.forEach((g, i) => {
      el("line", { x1: L, x2: W - R, y1: yv(g.v), y2: yv(g.v), class: "goal" + (i ? "" : " goal--book") });
      el("text", { x: W - R + 8, y: yv(g.v) + 4, class: "tlabel" }, g.label);
    });
    el("text", { x: L, y: Hh - 2 }, every === 1 ? "Years saving" : "First year saving");
  }
  $("#sv-early").addEventListener("change", (e) => { state.early = e.target.checked; draw(); });
  document.querySelectorAll("[data-deposit]").forEach((b) => b.addEventListener("click", () => { state.raise = b.dataset.deposit === "raise"; draw(); }));
  draw();
})();
