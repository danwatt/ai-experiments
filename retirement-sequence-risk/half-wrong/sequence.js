// "Same years, different order" — $100,000 over five made-up years that average 12%, good years first against the
// same years backward, with nothing moving, $8,000 out each January, or $8,000 in. Synthetic numbers only.
(function () {
  "use strict";
  const START = 1e5, FLOW = 8000, GOOD = [0.4, 0.25, 0.1, 0, -0.15];
  const ORDERS = [
    { key: "good", name: "Good years first", color: "series-1", dash: "", r: GOOD },
    { key: "bad", name: "Bad years first", color: "series-2", dash: "8 5", r: [...GOOD].reverse() },
  ];
  const state = { flow: "none" }; // "none", "out" (a retiree) or "in" (a saver)
  const $ = (s) => document.querySelector(s);
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const pct = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v * 100)) + "%";
  const key = (o) => `<svg class="lkey" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" style="stroke:var(--${o.color})" stroke-width="2.5"${o.dash ? ` stroke-dasharray="${o.dash.split(" ").map((n) => n * 0.6).join(" ")}"` : ""}/></svg>`;

  // the balance at the start and at the end of each year; money moves on January 1, then the year's return
  const run = (o) => {
    const d = state.flow === "out" ? -FLOW : state.flow === "in" ? FLOW : 0, bal = [START];
    let B = START;
    o.r.forEach((r) => { B = (B + d) * (1 + r); bal.push(B); });
    return bal;
  };

  $("#seq-legend").innerHTML = ORDERS.map((o) => `<span>${key(o)}${o.name} <span class="muted">(${o.r.map(pct).join(", ")})</span></span>`).join("");
  const NS = "http://www.w3.org/2000/svg", svg = $("#seq"), tip = $("#tip");
  const W = 1040, Hh = 300, L = 64, R = 190, T = 16, B = 34, YEARS = GOOD.length;
  const x = (y) => L + (y / YEARS) * (W - L - R);

  function draw() {
    document.querySelectorAll("[data-seq]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.seq === state.flow)));
    const bals = ORDERS.map(run), [g, b] = bals.map((l) => l[YEARS]), gap = money(Math.abs(g - b));
    $("#seq-note").innerHTML = {
      none: `Both end at <b>${money(g)}</b>. With no money moving in or out, the order changes nothing.`,
      out: `Now <b>$8,000 comes out</b> each January, 8% of the start, as the book describes for a retiree. Good years first ends at <b>${money(g)}</b>; bad years first ends at <b>${money(b)}</b>, ${gap} less, from the very same years.`,
      in: `Now <b>$8,000 goes in</b> each January, like a saver. This time bad years first comes out ahead: <b>${money(b)}</b> against <b>${money(g)}</b>, ${gap} more.`,
    }[state.flow];

    // ---------- table: each year's return and the balance at its end, side by side (the $8,000 is in the note)
    $("#seq-table").innerHTML = `<thead><tr><th scope="col" rowspan="2">Year</th>${ORDERS.map((o) => `<th scope="colgroup" colspan="2" class="seq-group">${key(o)}${o.name}</th>`).join("")}</tr>` +
      `<tr>${ORDERS.map(() => `<th scope="col">Return</th><th scope="col">Balance</th>`).join("")}</tr></thead><tbody>` +
      `<tr><th scope="row">Start</th>${ORDERS.map(() => `<td></td><td>${money(START)}</td>`).join("")}</tr>` +
      GOOD.map((_, i) => `<tr><th scope="row">${i + 1}</th>${ORDERS.map((o, k) => `<td>${pct(o.r[i])}</td><td>${i === YEARS - 1 ? `<b>${money(bals[k][i + 1])}</b>` : money(bals[k][i + 1])}</td>`).join("")}</tr>`).join("") +
      "</tbody>";

    // ---------- chart: one line per order, a dot at each year end
    svg.innerHTML = "";
    const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    const step = 50000, hi = Math.ceil(Math.max(...bals.flat()) / step) * step, yv = (n) => T + (1 - n / hi) * (Hh - T - B);
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    for (let n = 0; n <= hi; n += step) {
      el("line", { x1: L, x2: W - R, y1: yv(n), y2: yv(n), class: n ? "grid" : "axis" });
      el("text", { x: L - 8, y: yv(n) + 4, "text-anchor": "end" }, n ? "$" + n / 1000 + "K" : "$0");
    }
    for (let y = 0; y <= YEARS; y++) el("text", { x: x(y), y: Hh - B + 18, "text-anchor": "middle" }, y ? `Year ${y}` : "Start");
    ORDERS.forEach((o, k) => {
      el("path", { class: "tline", style: `stroke:var(--${o.color})`, ...(o.dash ? { "stroke-dasharray": o.dash } : {}), d: bals[k].map((n, y) => `${y ? "L" : "M"}${x(y).toFixed(1)},${yv(n).toFixed(1)}`).join("") });
      bals[k].forEach((n, y) => el("circle", { cx: x(y), cy: yv(n), r: 4, class: "seq-dot", style: `fill:var(--${o.color})` }));
    });
    // names at the right edge, nudged apart when the two end together
    const right = ORDERS.map((o, k) => ({ o, v: bals[k][YEARS], y: yv(bals[k][YEARS]) + 4 })).sort((a, c) => a.y - c.y);
    if (right[1].y - right[0].y < 15) right[1].y = right[0].y + 15;
    right.forEach((r) => el("text", { x: W - R + 10, y: r.y, class: "tlabel" }, `${r.o.name}, ${money(r.v)}`));

    // ---------- hover: a crosshair per year
    const cross = el("line", { class: "cross", y1: T, y2: Hh - B, x1: -10, x2: -10 });
    const hit = el("rect", { x: L - 20, y: T, width: W - L - R + 40, height: Hh - T - B, class: "hit" });
    hit.addEventListener("pointermove", (e) => {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(svg.getScreenCTM().inverse());
      const y = Math.max(0, Math.min(YEARS, Math.round(((q.x - L) / (W - L - R)) * YEARS)));
      cross.setAttribute("x1", x(y)); cross.setAttribute("x2", x(y));
      const moved = y && state.flow !== "none" ? `<br><span class="muted">${money(FLOW)} ${state.flow === "out" ? "taken out" : "put in"} on January 1, then the year's return</span>` : "";
      tip.innerHTML = `<b>${y ? "End of year " + y : "Start"}</b>${moved}<div class="t-grid"><span></span><span>${y ? "Return" : ""}</span><span>Balance</span>` +
        ORDERS.map((o, k) => `<span>${key(o)}${o.name}</span><span>${y ? pct(o.r[y - 1]) : ""}</span><span>${money(bals[k][y])}</span>`).join("") + "</div>";
      tip.hidden = false;
      const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), ty = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
      tip.style.left = tx + "px"; tip.style.top = ty + "px";
    });
    hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("x1", -10); cross.setAttribute("x2", -10); });
  }
  document.querySelectorAll("[data-seq]").forEach((b) => b.addEventListener("click", () => { state.flow = b.dataset.seq; draw(); }));
  draw();
})();
