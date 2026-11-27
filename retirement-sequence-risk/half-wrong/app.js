// "What if I'm half wrong?" — the book's round numbers against the record.
// Inflation: US consumer prices, December to December, from ../data.js
// (Shiller's monthly CPI to 1927, Damodaran's CPI series from 1928).
(function () {
  const H = window.HIST;
  const BOOK = 2003 + 8.5 / 12; // The Total Money Makeover, September 2003
  const CLAIM = 0.04;
  const Y0 = 1926, Y1 = H.last; // the last hundred years
  const inf = (y) => H.infl[y - H.first];
  const years = Array.from({ length: Y1 - Y0 + 1 }, (_, i) => Y0 + i);
  const pct = (v, d = 1) => (v < 0 ? "−" : "") + Math.abs(100 * v).toFixed(d) + "%";
  const cagr = (a, b) => { let p = 1; for (let y = a; y <= b; y++) p *= 1 + inf(y); return Math.pow(p, 1 / (b - a + 1)) - 1; };
  const $ = (s) => document.querySelector(s);

  // ---------- summary tiles
  const tile = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const above = years.filter((y) => inf(y) > CLAIM);
  $("#infl-tiles").innerHTML =
    tile(`The last 100 years, ${Y0}–${Y1}`, pct(cagr(Y0, Y1)), "a year, compounded") +
    tile(`Before the book, ${Y0}–2002`, pct(cagr(Y0, 2002)), "the record a 2003 reader had") +
    tile("The 30 years before it, 1973–2002", pct(cagr(1973, 2002)), "the 1970s and early '80s were the outlier") +
    tile(`Since the book, 2003–${Y1}`, pct(cagr(2003, Y1)), `${years.filter((y) => y >= 2003 && inf(y) > CLAIM).length} of ${Y1 - 2002} years above 4%`);
  $("#infl-count").textContent = `${above.length} of the ${years.length} years`;

  // ---------- chart: one bar per year, 10-year compound line, 4% line, book marker
  const svg = $("#infl"), NS = "http://www.w3.org/2000/svg";
  const W = 1040, Hh = 330, L = 44, R = 92, T = 30, B = 34;
  const lo = -0.12, hi = 0.2;
  const step = (W - L - R) / years.length, bw = Math.max(2, step - 2);
  const x = (y) => L + (y - Y0) * step; // left edge of a year's slot
  const yv = (v) => T + ((hi - v) / (hi - lo)) * (Hh - T - B);
  svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };

  for (let v = -0.12; v <= hi + 1e-9; v += 0.04) {
    el("line", { x1: L, x2: W - R, y1: yv(v), y2: yv(v), class: Math.abs(v) < 1e-9 ? "axis" : "grid" });
    el("text", { x: L - 8, y: yv(v) + 4, "text-anchor": "end" }, pct(v, 0));
  }
  for (let y = 1930; y <= Y1; y += 10) el("text", { x: x(y) + step / 2, y: Hh - B + 18, "text-anchor": "middle" }, y);

  const zero = yv(0), r = Math.min(4, bw / 2);
  // bars, rounded at the data end and square at the zero line
  const bar = (y) => {
    const v = inf(y), x0 = x(y) + (step - bw) / 2, y1 = yv(v), h = Math.abs(y1 - zero), rr = Math.min(r, h);
    const d = v >= 0
      ? `M${x0},${zero}V${y1 + rr}Q${x0},${y1} ${x0 + rr},${y1}H${x0 + bw - rr}Q${x0 + bw},${y1} ${x0 + bw},${y1 + rr}V${zero}Z`
      : `M${x0},${zero}V${y1 - rr}Q${x0},${y1} ${x0 + rr},${y1}H${x0 + bw - rr}Q${x0 + bw},${y1} ${x0 + bw},${y1 - rr}V${zero}Z`;
    return el("path", { d, class: "bar " + (v > CLAIM ? "high" : "low") });
  };
  const bars = years.map(bar);

  // trailing 10-year compound rate
  const roll = years.filter((y) => y - 9 >= Y0).map((y) => [y, cagr(y - 9, y)]);
  el("path", { class: "roll", d: roll.map(([y, v], i) => `${i ? "L" : "M"}${(x(y) + step / 2).toFixed(1)},${yv(v).toFixed(1)}`).join("") });

  // Ramsey's 4%
  el("line", { x1: L, x2: W - R, y1: yv(CLAIM), y2: yv(CLAIM), class: "claim" });
  el("text", { x: W - R + 6, y: yv(CLAIM) + 4, class: "claim-label" }, "Ramsey’s 4%");

  // the book
  const bx = x(Math.floor(BOOK)) + (BOOK % 1) * step;
  el("line", { x1: bx, x2: bx, y1: T - 8, y2: Hh - B, class: "book" });
  el("text", { x: bx - 6, y: T - 12, "text-anchor": "end", class: "book-label" }, "The Total Money Makeover, Sept 2003");

  // ---------- hover: a full-height hit column per year
  const tip = $("#tip");
  const show = (y, e) => {
    const v = inf(y), r10 = y - 9 >= Y0 ? cagr(y - 9, y) : null;
    tip.innerHTML = `<b>${y}</b><br><span style="font-weight:600;color:var(${v > CLAIM ? "--infl-high" : "--infl-low"})">${v > CLAIM ? "Above" : "At or below"} Ramsey’s 4%</span>` +
      `<div class="t-row"><span>Prices that year</span><span>${pct(v)}</span></div>` +
      (r10 != null ? `<div class="t-row"><span>10 years to ${y}, a year</span><span>${pct(r10)}</span></div>` : "") +
      (y <= 2002 ? `<div class="t-row"><span>${Y0}–${y}, a year</span><span>${pct(cagr(Y0, y))}</span></div>` : `<div class="t-row"><span>2003–${y}, a year</span><span>${pct(cagr(2003, y))}</span></div>`);
    tip.hidden = false;
    const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), ty = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
    tip.style.left = tx + "px"; tip.style.top = ty + "px";
  };
  years.forEach((y, i) => {
    const hit = el("rect", { x: x(y), y: T, width: step, height: Hh - T - B, class: "hit" });
    hit.addEventListener("pointermove", (e) => { bars.forEach((b, j) => b.classList.toggle("on", j === i)); show(y, e); });
    hit.addEventListener("pointerleave", () => { bars[i].classList.remove("on"); tip.hidden = true; });
  });

  // ---------- table view: one row per decade
  const rows = [];
  for (let d = Math.floor(Y0 / 10) * 10; d <= Y1; d += 10) {
    const cells = Array.from({ length: 10 }, (_, k) => { const y = d + k; return y < Y0 || y > Y1 ? "<td></td>" : `<td class="${inf(y) > CLAIM ? "high" : ""}">${pct(inf(y))}</td>`; });
    rows.push(`<tr><th scope="row">${d}s</th>${cells.join("")}</tr>`);
  }
  $("#infl-table").innerHTML = `<thead><tr><th></th>${Array.from({ length: 10 }, (_, k) => `<th scope="col">…${k}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
})();
