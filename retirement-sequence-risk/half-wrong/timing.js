// "When does the 8% come out?" — Ramsey's steady world (12% every year, 4% inflation every year, $40,000 from
// $500,000 raised 4% each January), with the withdrawal taken at different times of year. Synthetic numbers only.
(function () {
  "use strict";
  const START = 5e5, INFL = 0.04, YEARS = 50, LIMIT = 150;
  const m12 = Math.pow(1.12, 1 / 12) - 1; // the monthly rate that makes 12% over a year
  // Drawn monthly, each dollar leaves on average early enough to miss 6.39% of growth by year end:
  // F = (1+m)((1+m)^12 - 1) / (12m). The year-end break-even of 8% then becomes 8% / F = 7.52%.
  const F = ((1 + m12) * (Math.pow(1 + m12, 12) - 1)) / (12 * m12);
  const monthly = (B, W) => { for (let k = 0; k < 12; k++) B = (B - W / 12) * (1 + m12); return B; };
  const CASES = [ // in the order they run out: January 1 first, then monthly at 8%, 7.69% and 7.52%
    { key: "start", color: "start", dash: "", name: "All on January 1, 8%", first: 0.08 * START, sub: "the year's $40,000 out first, then 12% on the rest", step: (B, W) => (B - W) * 1.12 },
    { key: "m12", color: "m", dash: "", name: "Monthly, 8%", first: 0.08 * START, sub: "$3,333 a month, the book's 8% as a paycheck", step: monthly },
    { key: "m769", color: "m", dash: "8 5", name: "Monthly, 7.69%", first: 0.08 / 1.04 * START, sub: "$3,205 a month: 12% ÷ 4% inflation (1.12 ÷ 1.04), the real return", step: monthly },
    { key: "m752", color: "m", dash: "2 4", name: "Monthly, 7.52%", first: (0.08 / F) * START, sub: "$3,133 a month, the most that lasts when drawn monthly", step: monthly },
  ];
  // each case: balance at the end of every year, in plain dollars (and today's), and the year it ran out
  CASES.forEach((c) => {
    let B = START, W = c.first;
    c.bal = [START]; c.real = [START]; c.gone = null;
    for (let y = 1; y <= LIMIT && c.gone == null; y++) {
      B = c.step(B, W);
      if (B <= 0) c.gone = y;
      B = Math.max(0, B);
      c.bal.push(B); c.real.push(B / Math.pow(1 + INFL, y));
      W *= 1 + INFL;
    }
    while (c.bal.length <= YEARS) { c.bal.push(0); c.real.push(0); }
  });
  const $ = (s) => document.querySelector(s);
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const short = (v) => v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1000 ? "$" + Math.round(v / 1000) + "K" : "$0";
  // a short line in the case's color and dash, for the legend, table and tooltip
  const key = (c) => `<svg class="lkey" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" style="stroke:var(--t-${c.color})" stroke-width="2.5"${c.dash ? ` stroke-dasharray="${c.dash.split(" ").map((n) => n * 0.6).join(" ")}"` : ""}/></svg>`;

  const state = { dollars: "plain" }; // "plain" dollars, or "real": today's dollars, 4% inflation taken out
  const NOTE = {
    plain: "The balance in plain dollars. To keep up with prices it has to grow 4% a year, to about $3.5 million after 50 years. Only the 7.52% line does. Hover for each year.",
    real: "The balance after inflation. Keeping up means staying flat at $500,000. Only the 7.52% line does. Hover for each year.",
  };
  $("#timing-legend").innerHTML = CASES.map((c) => `<span>${key(c)}${c.name}</span>`).join("");
  const NS = "http://www.w3.org/2000/svg", svg = $("#timing"), tip = $("#tip");
  const W = 1040, Hh = 340, L = 64, R = 180, T = 16, B = 34;
  const x = (y) => L + (y / YEARS) * (W - L - R);

  function draw() {
    const real = state.dollars === "real", v = (c) => (real ? c.real : c.bal);
    document.querySelectorAll("[data-dollars]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.dollars === state.dollars)));
    $("#timing-note").textContent = NOTE[state.dollars];

    // ---------- table
    $("#timing-table").innerHTML = `<thead><tr><th scope="col">Drawn <small>(balances in ${real ? "today's" : "plain"} dollars)</small></th><th scope="col">First year</th>${[10, 20, 30].map((y) => `<th scope="col">After ${y} years</th>`).join("")}<th scope="col">Money runs out</th></tr></thead><tbody>` +
      CASES.map((c) => `<tr><th scope="row">${key(c)}${c.name}<small>${c.sub}</small></th><td>${money(c.first)}</td>${[10, 20, 30].map((y) => `<td>${v(c)[y] > 0 ? short(v(c)[y]) : "—"}</td>`).join("")}<td>${c.gone ? `<b>Year ${c.gone}</b>` : "Never"}</td></tr>`).join("") + "</tbody>";

    // ---------- chart: one line per case
    svg.innerHTML = "";
    const step = real ? START / 4 : START;
    // today's dollars never rise above the start, so a quarter of it as headroom; plain dollars round up to the next step
    const hi = real ? START * 1.25 : Math.ceil(Math.max(...CASES.map((c) => Math.max(...v(c).slice(0, YEARS + 1)))) / step) * step;
    const yv = (n) => T + (1 - n / hi) * (Hh - T - B);
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    for (let n = 0; n <= hi + 1; n += step) {
      el("line", { x1: L, x2: W - R, y1: yv(n), y2: yv(n), class: n ? "grid" : "axis" });
      el("text", { x: L - 8, y: yv(n) + 4, "text-anchor": "end" }, !n ? "$0" : n >= 1e6 ? "$" + +(n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1000) + "K");
    }
    for (let y = 0; y <= YEARS; y += 10) el("text", { x: x(y), y: Hh - B + 18, "text-anchor": "middle" }, y ? `Year ${y}` : "Start");
    // solid lines first, so the dashed and dotted ones draw on top where they cross
    [...CASES].sort((a, b) => !!a.dash - !!b.dash).forEach((c) => {
      const last = Math.min(c.gone || YEARS, YEARS);
      el("path", { class: "tline", style: `stroke:var(--t-${c.color})`, ...(c.dash ? { "stroke-dasharray": c.dash } : {}), d: v(c).slice(0, last + 1).map((n, y) => `${y ? "L" : "M"}${x(y).toFixed(1)},${yv(n).toFixed(1)}`).join("") });
      if (c.gone && c.gone <= YEARS) {
        el("circle", { cx: x(c.gone), cy: yv(0), r: 4, style: `fill:var(--t-${c.color})`, class: "gone" });
        el("text", { x: x(c.gone), y: yv(0) - 9, "text-anchor": "middle", class: "tlabel" }, `Year ${c.gone}`);
      }
    });
    // the lines still going at year 50 are named at the right edge, nudged apart where they meet
    const right = CASES.filter((c) => !c.gone || c.gone > YEARS).map((c) => ({ c, y: yv(v(c)[YEARS]) + 4 })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < right.length; i++) right[i].y = Math.max(right[i].y, right[i - 1].y + 15);
    right.forEach((r) => el("text", { x: W - R + 8, y: r.y, class: "tlabel" }, r.c.gone ? `${r.c.name}, gone year ${r.c.gone}` : r.c.name));

    // ---------- hover: a crosshair per year
    const cross = el("line", { class: "cross", y1: T, y2: Hh - B, x1: -10, x2: -10 });
    const hit = el("rect", { x: L, y: T, width: W - L - R, height: Hh - T - B, class: "hit" });
    hit.addEventListener("pointermove", (e) => {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(svg.getScreenCTM().inverse());
      const y = Math.max(0, Math.min(YEARS, Math.round(((q.x - L) / (W - L - R)) * YEARS)));
      cross.setAttribute("x1", x(y)); cross.setAttribute("x2", x(y));
      // spending during year y (raised 4% each January), and the balance needed at the end of it to keep up with prices
      const spent = (c) => !y ? "" : c.gone && c.gone < y ? "—" : c.gone === y ? "ran out" : money(real ? c.first : c.first * Math.pow(1 + INFL, y - 1));
      const target = START * Math.pow(1 + INFL, y), rise = y ? target - target / (1 + INFL) : 0;
      tip.innerHTML = `<b>${y ? "End of year " + y : "Start"}</b><br><span class="muted">in ${real ? "today's" : "plain"} dollars</span>` +
        `<div class="t-grid"><span></span><span>Balance</span><span>${y ? "Spent that year" : ""}</span>` +
        CASES.map((c) => `<span>${key(c)}${c.name}</span><span>${v(c)[y] > 0 ? money(v(c)[y]) : "gone"}</span><span>${spent(c)}</span>`).join("") + "</div>" +
        `<div class="t-row"><span>Balance needed to keep up</span><span>${money(real ? START : target)}</span></div>` +
        (y ? (real ? `<div class="t-row"><span>In plain dollars</span><span>${money(target)}</span></div>` : "") +
          `<div class="t-row"><span>Inflation raised it in year ${y}${real ? " (plain $)" : ""}</span><span>+${money(rise)}</span></div>` +
          `<div class="t-row"><span>Raised since the start${real ? " (plain $)" : ""}</span><span>+${money(target - START)}</span></div>` : "");
      tip.hidden = false;
      const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), ty = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
      tip.style.left = tx + "px"; tip.style.top = ty + "px";
    });
    hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("x1", -10); cross.setAttribute("x2", -10); });
  }
  document.querySelectorAll("[data-dollars]").forEach((b) => b.addEventListener("click", () => { state.dollars = b.dataset.dollars; draw(); }));
  draw();
})();
