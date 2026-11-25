// The collapsed data table at the bottom of the page: every year's return for each fund, the S&P 500 fund and
// inflation, with a link to where each number came from. Reads window.FUNDS (funds.js) and window.HIST (data.js).
(function () {
  "use strict";
  const F = window.FUNDS, H = window.HIST, root = document.getElementById("dataTable");
  if (!F || !H || !root) return;
  const COLS = [
    ["AIVSX", "Investment Company of America"], ["AGTHX", "Growth Fund of America"], ["CWGIX", "Capital World Growth and Income"],
    ["ANWPX", "New Perspective"], ["VFINX", "S&P 500 index fund"],
  ];
  const ret = (t, i) => (t === "VFINX" ? F.compare.SP : F.returns[t])[i];
  const pct = (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  // a short letter for each source, in the order they first appear
  const letter = {}, order = [];
  for (let i = 0; i <= F.last - F.first; i++) for (const [t] of COLS) {
    const s = F.yearSource[t][i];
    if (s && !(s in letter)) { letter[s] = String.fromCharCode(97 + order.length); order.push(s); }
  }
  const link = (id) => `<a class="src" href="${esc(F.sources[id].url)}" title="${esc(F.sources[id].label)}" target="_blank" rel="noopener">${letter[id]}</a>`;
  const stand = F.standIn.CWGIX;

  let rows = "";
  for (let y = F.first; y <= F.last; y++) {
    const i = y - F.first;
    const cells = COLS.map(([t]) => {
      const v = ret(t, i), standIn = t === "CWGIX" && stand.years.includes(y);
      return `<td${standIn ? ' class="stand" title="New Perspective stands in"' : ""}>${pct(v)}${link(F.yearSource[t][i])}</td>`;
    }).join("");
    rows += `<tr><th scope="row">${y}</th>${cells}<td>${pct(H.infl[y - H.first])}</td></tr>`;
  }
  const heads = COLS.map(([t, n]) => `<th scope="col">${n}<span>${t}</span></th>`).join("");
  const legend = order.map((id) => `<li><b>${letter[id]}</b> <a href="${esc(F.sources[id].url)}" target="_blank" rel="noopener">${esc(F.sources[id].label)}</a></li>`).join("");
  const cg = Object.entries(F.capitalGroup).map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>`).join(", ");
  root.innerHTML = `
    <p>Calendar-year total returns at NAV, before inflation, with every dividend and capital gain reinvested. The explainer turns each into a return after inflation with the last column. The letter beside each number links to its source. <i>Italic</i> Capital World Growth and Income years, 1981–${stand.years[stand.years.length - 1]}, are New Perspective's returns standing in. Yahoo's years were also checked against Capital Group's published 1- to 20-year returns (${cg}).</p>
    <ol class="sources">${legend}<li><b>CPI</b> <a href="https://pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls" target="_blank" rel="noopener">Inflation: Damodaran, NYU Stern, historical returns (CPI)</a>, as used across this project</li></ol>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Year</th>${heads}<th scope="col">Inflation<span>CPI</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  // a link to #data opens the table
  const box = document.getElementById("data");
  document.querySelectorAll('a[href="#data"]').forEach((a) => a.addEventListener("click", () => { box.open = true; }));
  if (location.hash === "#data") box.open = true;
})();
