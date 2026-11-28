// "What actually happened" — the book's $500,000 and $40,000, drawn monthly, raised each January by the actual
// inflation of the year before, through every real 20, 25 and 30-year retirement in the record.
// Reads HIST (../data.js) and FUNDS (../explainer-4/funds.js).
(function () {
  "use strict";
  const H = window.HIST, F = window.FUNDS, T = F.funds.map((f) => f.ticker);
  const START = 5e5, LENGTHS = [20, 25, 30], BOOK = 2003 + 8.5 / 12, Y0 = 1926, LAST = H.last;
  const LAST_START = 2013; // ten years after the book; retirements that began after 2006 are all still underway
  const m12 = Math.pow(1.12, 1 / 12) - 1, FAC = ((1 + m12) * (Math.pow(1 + m12, 12) - 1)) / (12 * m12);
  const DRAWS = { book: 0.08 * START, steel: (0.08 / FAC) * START }; // $40,000, or 7.52%: $37,598
  // retirements that begin before 1981 (the S&P 500 index only) are hidden unless asked for: the funds start in 1981
  const state = { draw: "book", early: false }, FROM = 1981;
  const infl = (y) => H.infl[y - H.first];
  const SERIES = [
    { name: "S&P 500 index", long: "the S&P 500 index (no costs)", first: Y0, r: (y) => H.stocks[y - H.first] },
    { name: "VFINX", long: "VFINX, Vanguard 500 Index Fund", first: F.first, r: (y) => F.compare.SP[y - F.first] },
    { name: "Four funds", long: "Ramsey's four funds, 25% each", first: F.first, r: (y) => T.reduce((a, t) => a + F.returns[t][y - F.first], 0) / T.length },
  ];
  const $ = (s) => document.querySelector(s);
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const pct = (v, d = 1) => (v < 0 ? "−" : "") + Math.abs(100 * v).toFixed(d) + "%";

  // one retirement: $W a year in twelve payments at the start of each month, the rest growing at that year's
  // return spread evenly over its months; each January the check is raised by the past year's inflation.
  // One that hasn't finished yet (partial) runs through the last year of data and is judged as it stands.
  function retire(s, st, len, W0) {
    let B = START, W = W0, P = 1, paid = 0, g = 1, gone = null;
    const partial = st + len - 1 > LAST, run = Math.min(len, LAST - st + 1), path = [];
    for (let k = 0; k < run; k++) {
      const y = st + k, m = Math.pow(1 + s.r(y), 1 / 12) - 1, before = paid;
      for (let j = 0; j < 12; j++) {
        if (B < W / 12) { paid += B; B = 0; gone = y; break; }
        B -= W / 12; paid += W / 12; B *= 1 + m;
      }
      // year by year, for the detail view: that year's return and inflation, what was paid, and where it ended
      path.push({ y, r: s.r(y), i: infl(y), check: W, paid: paid - before, B, need: START * P * (1 + infl(y)), real: B / (P * (1 + infl(y))) });
      if (gone) break;
      g *= 1 + s.r(y); P *= 1 + infl(y); W *= 1 + infl(y);
    }
    // rates over the full years lived: all of them, or those before the year the money ran out
    const end = partial ? LAST : st + len - 1, real = B / P, yrs = gone ? gone - st : run;
    return { s, st, end, len, partial, gone, B, real, P, paid, yrs, path, lastCheck: gone ? null : W / (1 + infl(end)), cagr: yrs ? Math.pow(g, 1 / yrs) - 1 : null, inflRate: yrs ? Math.pow(P, 1 / yrs) - 1 : null,
      outcome: gone ? "out" : real >= START ? "kept" : "shrank" };
  }

  // ---------- color: the page's blue for kept pace; red for ran out, pale red for lasted but shrank
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (c1, c2, u) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`; };
  let PAL;
  const fill = (o) => (o === "kept" ? PAL.kept : o === "shrank" ? PAL.shrank : PAL.out);
  const LABEL = { kept: "Kept up with inflation", shrank: "Lasted, but shrank", out: "Ran out of money" };
  const SO_FAR = { kept: "On track so far", shrank: "Falling behind so far" };

  const tip = $("#tip");
  function showTip(e, o) {
    const row = (k, v) => `<div class="t-row"><span>${k}</span><span>${v}</span></div>`;
    tip.innerHTML = `<b>${o.s.name}, retired January ${o.st}</b><br><span class="muted">${o.len} years, through ${o.st + o.len - 1}${o.partial && !o.gone ? `; still underway, year ${o.yrs} of ${o.len} at the end of ${LAST}` : ""}</span><br>` +
      `<span style="font-weight:600;color:${o.outcome === "kept" ? "var(--bluebonnet)" : "var(--danger)"}">${o.outcome === "out" ? `Ran out in ${o.gone}, year ${o.gone - o.st + 1}` : o.partial ? SO_FAR[o.outcome] : LABEL[o.outcome]}</span>` +
      row("First year", `${money(DRAWS[state.draw])} (${money(DRAWS[state.draw] / 12)} a month)`) +
      (o.gone ? "" : row(`Year ${o.yrs} (${o.end})`, money(o.lastCheck))) +
      (o.yrs ? row(o.gone ? `Prices rose, ${o.st}–${o.gone - 1}` : "Prices rose", `${pct(o.inflRate)} a year`) +
        row(o.gone ? `Returns, ${o.st}–${o.gone - 1}` : "Returns, compounded", `${pct(o.cagr)} a year`) : "") +
      row("Paid out in all", money(o.paid)) +
      (o.gone ? "" : row(`Left at the end of ${o.end}`, money(o.B)) + row(`In ${o.st} dollars`, `${money(o.real)} of ${money(START)}`)) +
      `<span class="muted">Click for year by year</span>`;
    tip.hidden = false;
    const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), ty = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
    tip.style.left = tx + "px"; tip.style.top = ty + "px";
  }

  const NS = "http://www.w3.org/2000/svg";
  // ---------- detail: one retirement year by year, in a dialog
  const dlg = $("#rw-detail");
  function openDetail(o) {
    const planned = o.st + o.len - 1, lastY = o.path[o.path.length - 1].y;
    $("#rw-d-title").textContent = `${o.s.name}: retired January ${o.st}, ${o.len} years`;
    $("#rw-d-status").innerHTML = `<span style="font-weight:600;color:${o.outcome === "kept" ? "var(--bluebonnet)" : "var(--danger)"}">${o.gone ? `Ran out in ${o.gone}, year ${o.gone - o.st + 1} of ${o.len}` : o.partial ? `${SO_FAR[o.outcome]}: year ${o.yrs} of ${o.len} at the end of ${LAST}` : LABEL[o.outcome]}</span>` +
      ` <span class="muted">· ${money(DRAWS[state.draw])} the first year from ${money(START)}, ${o.s.long}</span>`;
    $("#rw-d-legend").innerHTML = `<span><i class="line" style="border-top-color:var(${o.outcome === "kept" ? "--bluebonnet" : "--danger"})"></i>Balance, plain dollars</span><span><i class="dash"></i>Needed to keep pace: ${money(START)} raised with prices</span>`;
    // chart: the balance against what it needed to keep pace with prices, plain dollars, over the planned years
    const svg = $("#rw-d-chart"); svg.innerHTML = "";
    const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    const W = 760, Hh = 280, L = 64, R = 130, T = 14, B = 30;
    const pts = [{ y: o.st - 1, B: START, need: START }, ...o.path];
    const max = Math.max(...pts.map((p) => Math.max(p.B, p.need)));
    const step = [1e5, 2.5e5, 5e5, 1e6, 2.5e6].find((s) => max / s <= 6) || 5e6, hi = Math.ceil(max / step) * step;
    const x = (y) => L + ((y - (o.st - 1)) / o.len) * (W - L - R), yv = (v) => T + (1 - v / hi) * (Hh - T - B);
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    for (let n = 0; n <= hi + 1; n += step) {
      el("line", { x1: L, x2: W - R, y1: yv(n), y2: yv(n), class: n ? "grid" : "axis" });
      el("text", { x: L - 8, y: yv(n) + 4, "text-anchor": "end" }, !n ? "$0" : n >= 1e6 ? "$" + +(n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1000) + "K");
    }
    const tick = o.len > 25 ? 5 : o.len > 12 ? 4 : 2;
    for (let y = o.st - 1; y <= planned; y += tick) el("text", { x: x(y), y: Hh - B + 18, "text-anchor": "middle" }, y === o.st - 1 ? `Start ${o.st}` : String(y));
    if (o.partial && lastY < planned) {
      el("rect", { x: x(lastY), y: T, width: x(planned) - x(lastY), height: Hh - T - B, class: "future" });
      el("text", { x: (x(lastY) + x(planned)) / 2, y: T + 16, "text-anchor": "middle" }, "still to come");
    }
    const line = (key, cls) => el("path", { class: cls, d: pts.map((p, i) => `${i ? "L" : "M"}${x(p.y).toFixed(1)},${yv(p[key]).toFixed(1)}`).join("") });
    line("need", "need");
    line("B", "bal " + (o.outcome === "kept" ? "bal--ok" : "bal--short"));
    const lp = pts[pts.length - 1];
    if (o.gone) el("circle", { cx: x(lp.y), cy: yv(0), r: 4.5, class: "gone-dot" });
    // labels at the line ends, nudged apart
    const ends = [{ t: "Needed to keep pace", v: lp.need }, { t: o.gone ? `Ran out, ${o.gone}` : "Balance", v: lp.B }].map((e) => ({ ...e, yy: yv(e.v) + 4 })).sort((a, b) => a.yy - b.yy);
    if (ends[1].yy - ends[0].yy < 14) ends[1].yy = ends[0].yy + 14;
    ends.forEach((e) => el("text", { x: x(lp.y) + 8, y: e.yy, class: "tlabel" }, e.t));
    // table
    const sp = (v) => (v < 0 ? "−" : "+") + Math.abs(100 * v).toFixed(1) + "%";
    $("#rw-d-table").innerHTML = `<thead><tr><th scope="col">Year</th><th scope="col">Return</th><th scope="col">Inflation</th><th scope="col">Paid out</th><th scope="col">Balance at year end</th><th scope="col">Needed to keep pace</th><th scope="col">Balance in ${o.st} dollars</th></tr></thead><tbody>` +
      o.path.map((p) => `<tr class="${p.B < p.need ? "behind" : ""}"><td>${p.y}</td><td>${sp(p.r)}</td><td>${sp(p.i)}</td><td>${money(p.paid)}</td><td>${p.B > 0 ? money(p.B) : "<b>ran out</b>"}</td><td>${money(p.need)}</td><td>${money(p.real)}</td></tr>`).join("") + "</tbody>";
    if (!dlg.open) dlg.showModal();
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // a click on the backdrop closes it

  function draw() {
    PAL = { kept: css("series-1"), out: css("danger"), shrank: mix(css("surface-raised"), css("danger"), 0.3), surface: css("surface-raised") };
    const W0 = DRAWS[state.draw];
    document.querySelectorAll("[data-draw]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.draw === state.draw)));
    $("#rw-legend").innerHTML = ["kept", "shrank", "out"].map((k) => `<span><i style="background:${fill(k)}"></i>${LABEL[k]}${k === "kept" ? " (dotted)" : k === "out" ? " (crossed)" : ""}</span>`).join("") +
      `<span><i class="partial" style="background:${fill("shrank")}"></i>Still underway (faded)</span>` +
      `<span><i class="book"></i><span>Book published, 2003</span></span>`;

    // every retirement, every series and length
    const all = {};
    LENGTHS.forEach((len) => SERIES.forEach((s) => {
      const list = [];
      // every start year through ten years after the book, finished or still underway
      for (let st = Math.max(s.first, state.early ? Y0 : FROM); st <= LAST_START; st++) list.push(retire(s, st, len, W0));
      all[len + s.name] = list;
    }));
    const count = (list, k) => list.filter((o) => o.outcome === k).length;
    const done = (list) => list.filter((o) => !o.partial), open = (list) => list.filter((o) => o.partial);

    // ---------- tiles: 30-year retirements
    $("#rw-tiles").innerHTML = SERIES.map((s) => {
      const l = done(all[30 + s.name]), u = open(all[30 + s.name]), k = count(l, "kept"), out = count(l, "out");
      return `<div class="tile"><div class="label">${s.name}: 30-year retirements that kept up</div><div class="value">${k} of ${l.length}</div><div class="sub">${out} ran out of money.` +
        (u.length ? ` Of ${u.length} still underway, ${count(u, "out")} already have.` : "") + `</div></div>`;
    }).join("");

    // ---------- grid: a block per length, a row per series, a square per retirement at its first year
    const svg = $("#rw"); svg.innerHTML = "";
    const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    const from = state.early ? Y0 : FROM, lastStart = LAST_START, n = lastStart - from + 1;
    const W = 1040, L = 118, R = 150, cw = (W - L - R) / n, h = 16, rowH = h + 4;
    const x = (y) => L + (y - from) * cw;
    let y = 30;
    const axis = (yy) => { for (let yr = Math.ceil(from / 10) * 10; yr <= lastStart; yr += 10) el("text", { x: x(yr) + cw / 2, y: yy, "text-anchor": "middle" }, String(yr)); };
    axis(y); y += 10;
    const top = y;
    LENGTHS.forEach((len) => {
      el("text", { class: "group", x: 0, y: y + 14 }, `${len}-year retirements`);
      el("text", { x: W - R + 10, y: y + 14 }, "kept pace · ran out");
      y += 20;
      SERIES.forEach((s) => {
        el("text", { class: "series", x: 0, y: y + h - 4 }, s.name);
        const list = all[len + s.name];
        list.forEach((o) => {
          const xx = x(o.st), r = el("rect", { class: o.partial ? "cell partial" : "cell", x: xx + 0.5, y, width: Math.max(1, cw - 1), height: h, rx: 1.5, fill: fill(o.outcome) });
          r.addEventListener("mousemove", (e) => { r.classList.add("on"); showTip(e, o); });
          r.setAttribute("tabindex", "0"); r.setAttribute("role", "button");
          r.setAttribute("aria-label", `${o.s.name}, ${o.len}-year retirement from ${o.st}: ${o.gone ? "ran out in " + o.gone : (o.partial ? SO_FAR : LABEL)[o.outcome]}. Open year by year`);
          r.addEventListener("click", () => { tip.hidden = true; openDetail(o); });
          r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(o); } });
          r.addEventListener("mouseleave", () => { r.classList.remove("on"); tip.hidden = true; });
          const cx = xx + cw / 2, cy = y + h / 2;
          if (o.outcome === "kept") el("circle", { cx, cy, r: 1.6, fill: PAL.surface, "pointer-events": "none" });
          if (o.outcome === "out") el("path", { d: `M${cx - 2},${cy - 2}L${cx + 2},${cy + 2}M${cx + 2},${cy - 2}L${cx - 2},${cy + 2}`, stroke: PAL.surface, "stroke-width": 1.2, "pointer-events": "none" });
        });
        const d = done(list), u = open(list);
        el("text", { class: "hits", x: W - R + 10, y: y + h - 4 }, `${count(d, "kept")} · ${count(d, "out")} of ${d.length}${u.length ? ` (+${u.length})` : ""}`);
        y += rowH;
      });
      y += 10;
    });
    const bx = x(Math.floor(BOOK)) + (BOOK % 1) * cw;
    el("line", { x1: bx, x2: bx, y1: top - 4, y2: y - 8, class: "book" });
    el("text", { x: bx - 6, y: 12, "text-anchor": "end", class: "book-label" }, "The Total Money Makeover, Sept 2003");
    axis(y + 6);
    el("text", { x: L, y: y + 24 }, "Year retired");
    svg.setAttribute("viewBox", `0 0 ${W} ${y + 30}`);
  }
  document.querySelectorAll("[data-draw]").forEach((b) => b.addEventListener("click", () => { state.draw = b.dataset.draw; draw(); }));
  $("#rw-early").addEventListener("change", (e) => { state.early = e.target.checked; draw(); });
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  draw();
})();
