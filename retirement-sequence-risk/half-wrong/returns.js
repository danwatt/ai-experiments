// "Do stocks make 12 percent?" — the S&P 500 since 1926, an S&P 500 index fund (VFINX) and Ramsey's four
// funds since 1981, in every 10, 20 and 30-year window, from the same data as ../twelve/.
// Reads HIST (../data.js) and FUNDS (../explainer-4/funds.js).
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS;
  const GOAL = 0.12, Y0 = 1926, BOOK = 2003 + 8.5 / 12, WINDOWS = [10, 20, 30];
  // windows that begin before 1981 (the S&P 500 index only) are hidden unless asked for: the funds start in 1981
  // the four funds one by one are hidden unless asked for; the blend (25% each) always shows
  const state = { measure: "avg", early: false, funds: false }, FROM = 1981;
  const $ = (s) => document.querySelector(s);
  const pct = (v, d = 1) => (v < 0 ? "−" : "") + Math.abs(100 * v).toFixed(d) + "%";
  const spct = (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";

  const T = F.funds.map((f) => f.ticker);
  const SERIES = [
    { name: "S&P 500 index", sub: "dividends reinvested, no costs", first: Y0, r: H.stocks.slice(Y0 - H.first) },
    { name: "VFINX", sub: "Vanguard 500 Index Fund, after its costs", first: F.first, r: F.compare.SP },
    { name: "Four funds", sub: "Ramsey's four American Funds, 25% each", first: F.first, r: F.returns[T[0]].map((_, i) => T.reduce((a, t) => a + F.returns[t][i], 0) / T.length) },
    // each fund on its own, indented under the blend. Capital World Growth and Income began in March 1993, so its
    // row starts with 1994, its first full year (the blend uses New Perspective in its place before that)
    ...F.funds.map((f) => ({ name: f.ticker, long: `${f.ticker}, ${f.name}`, sub: `${f.name}, ${f.role}`, fund: true, first: f.firstYear, r: F.returns[f.ticker].slice(f.firstYear - F.first) })),
  ];
  const stretch = (s, a, b) => {
    const r = s.r.slice(a - s.first, b - s.first + 1), g = r.reduce((p, v) => p * (1 + v), 1);
    return { y0: a, y1: b, w: r.length, r, avg: r.reduce((t, v) => t + v, 0) / r.length, cagr: Math.pow(g, 1 / r.length) - 1, grow: g };
  };
  const value = (o) => (state.measure === "avg" ? o.avg : o.cagr);

  // ---------- tiles: the simple average (how Ramsey states it) with the compound rate under it
  const tile = (label, o) => `<div class="tile"><div class="label">${label}</div><div class="value">${pct(o.avg)}</div><div class="sub">simple average; ${pct(o.cagr)} compounded</div></div>`;
  const last = H.last;
  $("#ret-tiles").innerHTML =
    tile(`S&amp;P 500, ${Y0}–2002`, stretch(SERIES[0], Y0, 2002)) +
    tile(`Four funds, ${F.first}–2002`, stretch(SERIES[2], F.first, 2002)) +
    tile(`S&amp;P 500 since the book, 2003–${last}`, stretch(SERIES[0], 2003, last)) +
    tile(`Four funds since the book, 2003–${last}`, stretch(SERIES[2], 2003, last));

  // ---------- color: short of 12% toward danger, at or above toward bluebonnet, both from the card surface
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (c1, c2, u) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`; };
  let PAL;
  const color = (v) => v >= GOAL
    ? mix(PAL.surface, PAL.hit, 0.4 + 0.6 * Math.min(1, (v - GOAL) / 0.12))
    : mix(PAL.surface, PAL.miss, 0.4 + 0.6 * Math.min(1, (GOAL - v) / 0.12));

  // ---------- tooltip
  const tip = $("#tip");
  function showTip(e, s, o) {
    const hit = value(o) >= GOAL;
    const row = (k, v, b) => `<div class="t-row"><span>${k}</span><span>${b ? `<b>${v}</b>` : v}</span></div>`;
    tip.innerHTML = `<b>${s.long || s.name}, ${o.y0}–${o.y1}</b> (${o.w} years)<br><span style="color:var(${hit ? "--bluebonnet" : "--danger"});font-weight:600">${hit ? "Reached 12%" : "Short of 12%"}</span>` +
      row("Average year", pct(o.avg), state.measure === "avg") + row("Compounded", pct(o.cagr), state.measure === "cagr") +
      row("$10,000 became", "$" + Math.round(10000 * o.grow).toLocaleString("en-US")) +
      row("Best year", `${spct(Math.max(...o.r))} (${o.y0 + o.r.indexOf(Math.max(...o.r))})`) +
      row("Worst year", `${spct(Math.min(...o.r))} (${o.y0 + o.r.indexOf(Math.min(...o.r))})`);
    tip.hidden = false;
    const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), ty = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
    tip.style.left = tx + "px"; tip.style.top = ty + "px";
  }

  // ---------- the grid: a block per window length, a row per series, a square per window at its last year
  const NS = "http://www.w3.org/2000/svg";
  function draw() {
    PAL = { surface: css("surface-raised"), hit: css("series-1"), miss: css("danger") };
    document.querySelectorAll("[data-measure]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.measure === state.measure)));
    $("#ret-measure-note").innerHTML = state.measure === "avg"
      ? "Showing the <b>simple average</b>, the way Ramsey quotes the 12%."
      : "Showing the <b>compounded</b> rate, what the money actually grew at.";
    const svg = $("#ret"); svg.innerHTML = "";
    const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    const from = state.early ? Y0 : FROM, X0 = from + WINDOWS[0] - 1, n = last - X0 + 1; // first year any window ends
    const tick0 = Math.ceil((X0 + 1) / 10) * 10;
    const W = 1040, L = 118, R = 104, cw = (W - L - R) / n, h = 16, rowH = h + 4;
    const x = (y) => L + (y - X0) * cw;
    let y = 30;
    const axis = (yy) => { for (let yr = tick0; yr <= last; yr += 10) el("text", { x: x(yr) + cw / 2, y: yy, "text-anchor": "middle" }, String(yr)); };
    axis(y); y += 10;
    const top = y;
    WINDOWS.forEach((w) => {
      el("text", { class: "group", x: 0, y: y + 14 }, `${w}-year windows`);
      el("text", { x: W - R + 10, y: y + 14 }, "reached 12%");
      y += 20;
      SERIES.filter((s) => state.funds || !s.fund).forEach((s) => {
        el("text", { class: s.fund ? "series fund" : "series", x: s.fund ? 12 : 0, y: y + h - 4 }, s.name).appendChild(document.createElementNS(NS, "title")).textContent = s.sub;
        let hits = 0, cnt = 0;
        for (let a = Math.max(s.first, from); a + w - 1 <= last; a++) {
          const o = stretch(s, a, a + w - 1), v = value(o), xx = x(o.y1);
          const r = el("rect", { class: "cell", x: xx + 0.5, y, width: Math.max(1, cw - 1), height: h, rx: 1.5, fill: color(v) });
          r.addEventListener("mousemove", (e) => { r.classList.add("on"); showTip(e, s, o); });
          r.addEventListener("mouseleave", () => { r.classList.remove("on"); tip.hidden = true; });
          if (v >= GOAL) { hits++; el("circle", { cx: xx + cw / 2, cy: y + h / 2, r: 1.6, fill: PAL.surface, "pointer-events": "none" }); }
          cnt++;
        }
        el("text", { class: "hits", x: W - R + 10, y: y + h - 4 }, `${hits} of ${cnt}`);
        y += rowH;
      });
      y += 10;
    });
    // the verdict quotes the 30-year windows on view, compounded, whatever the measure shown
    const hit30 = (s) => { let k = 0, n = 0; for (let a = Math.max(s.first, from); a + 29 <= last; a++) { n++; if (stretch(s, a, a + 29).cagr >= GOAL) k++; } return `${k} of ${n}`; };
    $("#ret-verdict-n").textContent = `${hit30(SERIES[0])} thirty-year stretches of the S&P 500${state.early ? "" : " since 1981"}, and ${hit30(SERIES[2])} for Ramsey's four funds,`;
    const bx = x(Math.floor(BOOK)) + (BOOK % 1) * cw;
    el("line", { x1: bx, x2: bx, y1: top - 4, y2: y - 8, class: "book" });
    el("text", { x: bx - 6, y: 12, "text-anchor": "end", class: "book-label" }, "The Total Money Makeover, Sept 2003");
    axis(y + 6);
    el("text", { x: L, y: y + 24 }, "Last year of the window");
    svg.setAttribute("viewBox", `0 0 ${W} ${y + 30}`);
    // legend swatches follow the theme
    $("#ret-legend").innerHTML = `<span><i style="background:${color(GOAL - 0.06)}"></i>Short of 12%</span><span><i style="background:${color(GOAL + 0.06)}"></i>12% or more (dotted)</span><span><i class="book"></i><span><cite>The Total Money Makeover</cite>, Sept 2003</span></span>`;
  }
  document.querySelectorAll("[data-measure]").forEach((b) => b.addEventListener("click", () => { state.measure = b.dataset.measure; draw(); }));
  $("#ret-early").addEventListener("change", (e) => { state.early = e.target.checked; draw(); });
  $("#ret-funds").addEventListener("change", (e) => { state.funds = e.target.checked; draw(); });
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  draw();
})();
