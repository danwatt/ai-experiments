/* Texas public hospitals: renders tiles, big-six small multiples, a per-hospital detail view
   and a sortable table from window.HOSP (data.js). */
(function () {
  const D = window.HOSP;
  const H = D.hospitals;
  const YEARS = [];
  for (let y = D.first; y <= D.last; y++) YEARS.push(y);
  const BIG6 = ["450015", "450289", "450213", "450039", "450686", "450024"];
  const byId = Object.fromEntries(H.map(h => [h.id, h]));
  const yearOf = (h, fy) => h.years.find(y => y.fy === fy) || null;
  const latest = h => h.years[h.years.length - 1];

  // ---------- formatting ----------
  function money(v, digits) {
    if (v == null) return "–";
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(digits ?? (a >= 1e10 ? 1 : 2)) + "B";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(digits ?? (a >= 1e8 ? 0 : 1)) + "M";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(0) + "K";
    return s + "$" + a.toFixed(0);
  }
  const mil = v => v == null ? "–" : (v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).replace("-", "−");
  const pct = v => v == null || !isFinite(v) ? "–" : (v * 100).toFixed(1).replace("-", "−") + "%";
  const margin = y => y && y.rev ? y.net / y.rev : null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const partial = y => y && y.months < 11;
  // Other income with the district's property tax levy taken out. Null when there is no levy to subtract.
  const otherEx = y => y.tax == null ? null : (y.oinc || 0) - y.tax;
  const taxYearOf = (h, y) => {
    const a = new Date(y.start + "T12:00"), b = new Date(y.end + "T12:00");
    for (let z = a.getFullYear(); z <= b.getFullYear(); z++) { const d = new Date(z, 0, 31, 12); if (d >= a && d <= b) return z - 1; }
    return null;
  };
  const auditYear = (h, fy) => h.audit && h.audit.years[String(fy)] || null;
  const auditOther = a => (a.interest || 0) + (a.relief || 0) + (a.otherNonop || 0) + (a.cap || 0) + (a.transfer || 0);
  const taxShare = y => y && y.tax != null && y.rev ? y.tax / y.rev : null;
  // Small districts whose books carry nursing-home supplemental programs.
  const nursingFlag = h => {
    const y = latest(h), mx = h.years.reduce((m, y) => Math.max(m, (y.oinc || 0) / Math.max(y.npr || 1, 1)), 0);
    return !h.major && mx > 1.5 && (y.beds || 0) < 150;
  };

  // ---------- theme ----------
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let C = {};
  function readColors() {
    C = { c1: css("--c-1"), c2: css("--c-2"), c3: css("--c-3"), ink: css("--ink"), muted: css("--ink-muted"),
      line: css("--line"), strong: css("--line-strong"), neutral: css("--c-n"), raised: css("--surface-raised"), font: css("--font-body") };
  }
  const themeBtn = document.getElementById("themeBtn");
  const order = ["auto", "light", "dark"];
  let theme = "auto";
  try { theme = localStorage.getItem("txhosp-theme") || "auto"; } catch (e) {}
  themeBtn.textContent = "Theme: " + theme;
  themeBtn.addEventListener("click", () => {
    theme = order[(order.indexOf(theme) + 1) % 3];
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("txhosp-theme", theme); } catch (e) {}
    themeBtn.textContent = "Theme: " + theme;
    renderAllCharts();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (theme === "auto") renderAllCharts(); });

  // ---------- chart helpers ----------
  const charts = {};
  function mk(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); return charts[id]; }
  function baseOpts(extra) {
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.raised, titleColor: C.ink, bodyColor: C.ink, borderColor: C.strong, borderWidth: 1,
          padding: 10, boxPadding: 4, usePointStyle: true, filter: item => item.parsed.y != null, titleFont: { family: C.font, weight: "600" }, bodyFont: { family: C.font },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: C.strong }, ticks: { color: C.muted, font: { family: C.font, size: 12 }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: C.line }, border: { display: false }, ticks: { color: C.muted, font: { family: C.font, size: 12 }, callback: v => money(v), maxTicksLimit: 6 }, beginAtZero: true },
      },
    }, extra || {});
  }
  const fyLabels = YEARS.map(y => "FY" + y);
  const shortLabels = YEARS.map(y => "'" + String(y).slice(2));
  const series = (h, f) => YEARS.map(fy => { const y = yearOf(h, fy); return y ? f(y) : null; });
  function titleCb(h) {
    return items => {
      const fy = YEARS[items[0].dataIndex], y = yearOf(h, fy);
      if (!y) return "FY" + fy;
      const s = new Date(y.start + "T12:00"), e = new Date(y.end + "T12:00");
      const f = d => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      return "FY" + fy + " (" + f(s) + "–" + f(e) + (partial(y) ? ", " + y.months + " months" : "") + ")";
    };
  }

  // ---------- tiles ----------
  function tiles() {
    const now = H.filter(h => yearOf(h, D.last));
    const sum = (arr, k) => arr.reduce((t, h) => t + (yearOf(h, D.last)[k] || 0), 0);
    const rev = sum(now, "rev"), net = sum(now, "net");
    const big = now.filter(h => BIG6.includes(h.id));
    const bigRev = sum(big, "rev");
    const first = H.filter(h => BIG6.includes(h.id)).reduce((t, h) => t + (yearOf(h, D.first)?.rev || 0), 0);
    const unc = sum(now, "uncomp");
    const tax = sum(now, "tax"), bigTax = sum(big, "tax");
    const ty = String(D.last - 1), allLevy = D.districts.reduce((t, d) => t + (d.levy[ty] || 0), 0);
    document.getElementById("tiles").innerHTML = [
      ["Public hospitals filing", now.length, "Owned by a county, city or hospital district in FY" + D.last],
      ["Combined revenue, FY" + D.last, money(rev, 1), "The big six took " + pct(bigRev / rev) + ", up from " + money(first, 1) + " in FY" + D.first + " to " + money(bigRev, 1)],
      ["Property tax, FY" + D.last, money(tax, 2), "Equal to " + pct(tax / rev) + " of their revenue. The big six levied " + money(bigTax, 2) + " of it"],
      ["Uncompensated care, FY" + D.last, money(unc, 1), "Charity care and bad debt, at cost. Net income was " + money(net, 2)],
    ].map(([l, v, d]) => `<div class="tile"><div class="text-label" style="color:var(--ink-muted)">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");
  }

  // ---------- big six ----------
  function grid6() {
    const el = document.getElementById("grid6");
    el.innerHTML = BIG6.map(id => {
      const h = byId[id], y = latest(h), y0 = yearOf(h, D.first);
      const grow = y0 ? y.rev / y0.rev - 1 : null;
      return `<div class="panel">
        <h3 class="text-h3">${esc(h.name)}</h3>
        <div class="meta">${esc(h.owner)}</div>
        <div class="mini"><canvas id="m${id}" role="img" aria-label="${esc(h.name)} revenue and expenses, FY${D.first} to FY${D.last}"></canvas></div>
        <div class="mini-stats">
          <span>FY${y.fy} revenue <b>${money(y.rev)}</b></span>
          <span>Margin <b>${pct(margin(y))}</b></span>
          <span>10-yr growth <b>${pct(grow)}</b></span>
          <span>Tax share <b>${pct(taxShare(y))}</b></span>
          ${auditYear(h, D.last) ? `<span>Audited operating result <b class="${auditYear(h, D.last).opInc < 0 ? "neg" : ""}">${money(auditYear(h, D.last).opInc)}</b></span>` : ""}
        </div>
        <p style="margin:var(--space-3) 0 0"><button class="linkish" data-open="${id}">See year by year</button></p>
      </div>`;
    }).join("");
    el.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openDetail(b.dataset.open, true)));
  }
  function drawGrid6() {
    BIG6.forEach(id => {
      const h = byId[id];
      const o = baseOpts();
      o.plugins.tooltip.callbacks = { title: titleCb(h), label: c => " " + c.dataset.label + ": " + money(c.parsed.y) };
      o.scales.y.beginAtZero = true;
      o.scales.y.ticks.maxTicksLimit = 4;
      o.scales.x.ticks.autoSkip = false;
      // Short (transition) years would read as a collapse; leave them out and dash across the gap.
      const line = (label, f, color) => ({
        label, data: series(h, y => partial(y) ? null : f(y)), borderColor: color, backgroundColor: color, borderWidth: 2,
        pointRadius: 0, pointHoverRadius: 5, pointBorderColor: C.raised, pointBorderWidth: 2, tension: 0, spanGaps: true,
        segment: { borderDash: ctx => ctx.p1DataIndex - ctx.p0DataIndex > 1 ? [4, 4] : undefined },
      });
      mk("m" + id, {
        type: "line",
        data: {
          labels: shortLabels,
          datasets: [
            line("Total revenue", y => y.rev, C.c1),
            line("Total expenses", y => y.exp, C.c2),
            line("Property tax levy", y => y.tax, C.c3),
          ],
        },
        options: o,
      });
    });
  }

  // ---------- detail ----------
  const ICON = {
    info: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM11.2 14H8.8v-1.4h.6V10h-.6V8.8h1.8v3.8h.6Z",
    warning: "M10 2.2 1.6 17h16.8ZM10.9 14.6H9.1v-1.8h1.8Zm0-3H9.1V7.4h1.8Z",
  };
  const alertBox = (tone, title, body) => `<div class="bb-alert bb-alert--${tone} flag" role="note"><svg class="bb-alert__icon" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="${ICON[tone]}"/></svg><div><p class="bb-alert__title">${title}</p><div class="bb-alert__body">${body}</div></div></div>`;
  const pick = document.getElementById("pick");
  let current = "450039";
  function fillPicker() {
    const major = H.filter(h => h.major), rest = H.filter(h => !h.major).sort((a, b) => a.name.localeCompare(b.name));
    const opt = h => `<option value="${h.id}">${esc(h.name)} · ${esc(h.city)}${yearOf(h, D.last) ? "" : " (closed or converted)"}</option>`;
    pick.innerHTML = `<optgroup label="Larger systems">${major.map(opt).join("")}</optgroup><optgroup label="Other public hospitals, A–Z">${rest.map(opt).join("")}</optgroup>`;
    pick.addEventListener("change", () => openDetail(pick.value, false));
  }
  function openDetail(id, scroll) {
    current = id;
    pick.value = id;
    try { history.replaceState(null, "", "#h=" + id); } catch (e) {}
    renderDetail();
    if (scroll) document.getElementById("detail").scrollIntoView({ block: "start" });
  }
  function renderDetail() {
    const h = byId[current], y = latest(h);
    document.getElementById("dName").textContent = h.name;
    const parts = [h.owner, h.city + (h.county ? ", " + h.county + " County" : ""), "CMS control: " + h.control, "CCN " + h.id];
    if (y.beds) parts.push(y.beds + " beds in FY" + y.fy);
    document.getElementById("dMeta").textContent = parts.filter(Boolean).join(" · ");
    const flags = [];
    if (nursingFlag(h)) flags.push(alertBox("info", "Nursing home programs", `Other income here is far larger than patient revenue, which usually means this district runs nursing homes through Texas Medicaid's supplemental payment programs. Most of that money passes through to the nursing homes and their operators, so revenue and expenses look much larger than the hospital itself.`));
    if (h.years.some(partial)) flags.push(alertBox("warning", "Short year", `${h.years.filter(partial).map(y => "FY" + y.fy + " covers " + y.months + " months").join("; ")}, usually a change of fiscal year or ownership. Those points are marked in the charts.`));
    const missing = YEARS.filter(fy => !yearOf(h, fy));
    if (missing.length) flags.push(alertBox("warning", "Missing years", `No cost report for ${missing.map(f => "FY" + f).join(", ")}.`));
    document.getElementById("dFlag").innerHTML = flags.join("");
    drawDetail();
    detailTable(h);
    auditDetail(h);
    drawAudit();
    drawSankey();
  }
  function drawDetail() {
    const h = byId[current];
    const tt = { title: titleCb(h), label: c => " " + c.dataset.label + ": " + money(c.parsed.y) };
    let o = baseOpts();
    o.plugins.tooltip.callbacks = Object.assign({}, tt, {
      footer: items => {
        const y = yearOf(h, YEARS[items[0].dataIndex]);
        if (!y) return "";
        const lines = ["Net income " + money(y.net) + " · margin " + pct(margin(y))];
        if (y.tax != null) lines.push("Tax year " + (y.tax != null ? taxYearOf(h, y) : "") + " levy, " + pct(taxShare(y)) + " of revenue");
        if (y.tax != null && otherEx(y) < 0) lines.push("Levy exceeds reported other income; part of the tax is booked elsewhere");
        return lines;
      },
    });
    o.plugins.tooltip.footerColor = C.muted;
    o.plugins.tooltip.footerFont = { family: C.font, weight: "400" };
    o.scales.x.stacked = true; o.scales.y.stacked = false;
    o.scales.y.stacked = true;
    const bar = (label, f, color) => ({
      type: "bar", label, data: series(h, f), backgroundColor: color, borderColor: C.raised, borderWidth: { top: 2 },
      borderRadius: 0, borderSkipped: false, stack: "rev", maxBarThickness: 44, order: 2,
    });
    const npr = bar("Patient revenue", y => Math.max(y.npr || 0, 0), C.c1);
    // Split other income into the district's tax levy and the rest. When the levy is larger than the
    // reported other income, the hospital books tax somewhere else: show the levy and no "rest".
    const tax = bar("Property tax levy", y => y.tax, C.c3);
    const oth = bar("Other income", y => y.tax == null ? (y.oinc || 0) : Math.max(otherEx(y), 0), C.neutral);
    oth.borderRadius = { topLeft: 4, topRight: 4 };
    mk("cMain", {
      data: {
        labels: fyLabels,
        datasets: [npr, tax, oth, {
          type: "line", label: "Total expenses", data: series(h, y => y.exp), borderColor: C.c2, backgroundColor: C.c2,
          borderWidth: 2, pointRadius: YEARS.map(fy => partial(yearOf(h, fy)) ? 5 : 3), pointHoverRadius: 5,
          pointBackgroundColor: C.c2, pointBorderColor: C.raised, pointBorderWidth: 2, stack: "exp", order: 1, tension: 0,
        }],
      },
      options: o,
    });
    // Separate expense line from bar stack: a line in its own stack is still drawn on the shared (stacked) y axis.
    charts.cMain.options.scales.y.stacked = true;

    o = baseOpts();
    o.plugins.tooltip.callbacks = { title: titleCb(h), label: c => " Net income: " + money(c.parsed.y) + " (" + pct(margin(yearOf(h, YEARS[c.dataIndex]))) + ")" };
    o.scales.y.beginAtZero = true;
    o.scales.y.grid.color = ctx => ctx.tick.value === 0 ? C.strong : C.line;
    const net = series(h, y => y.net);
    mk("cNet", {
      type: "bar",
      data: { labels: shortLabels, datasets: [{ label: "Net income", data: net, backgroundColor: net.map(v => v < 0 ? C.c2 : C.c1), borderRadius: 4, borderSkipped: "start", maxBarThickness: 32 }] },
      options: o,
    });

    o = baseOpts();
    o.plugins.tooltip.callbacks = {
      title: titleCb(h),
      label: c => {
        const y = yearOf(h, YEARS[c.dataIndex]);
        return [" Uncompensated care: " + money(c.parsed.y), y && y.exp ? " " + pct(y.uncomp / y.exp) + " of expenses" : ""];
      },
    };
    mk("cUnc", {
      type: "bar",
      data: { labels: shortLabels, datasets: [{ label: "Uncompensated care", data: series(h, y => y.uncomp), backgroundColor: C.c1, borderRadius: 4, borderSkipped: "start", maxBarThickness: 32 }] },
      options: o,
    });
  }
  function detailTable(h) {
    const rows = [
      ["Patient revenue", y => mil(y.npr)],
      ["Other income", y => mil(y.oinc)],
      ["  of which property tax levy", y => mil(y.tax)],
      ["  tax year of that levy", y => y.tax != null ? taxYearOf(h, y) : "–"],
      ["Total revenue", y => "<b>" + mil(y.rev) + "</b>"],
      ["Operating expenses", y => mil(y.opex)],
      ["Other expenses", y => mil(y.oexp)],
      ["Total expenses", y => "<b>" + mil(y.exp) + "</b>"],
      ["Net income", y => `<b class="${y.net < 0 ? "neg" : ""}">${mil(y.net)}</b>`],
      ["Margin", y => `<span class="${y.net < 0 ? "neg" : ""}">${pct(margin(y))}</span>`],
      ["Gross charges", y => mil(y.gross)],
      ["Medicaid net revenue", y => mil(y.medicaid)],
      ["Uncompensated care (cost)", y => mil(y.uncomp)],
      ["Wages (cost report)", y => mil(y.salaries)],
      ["Benefits (cost report)", y => mil(y.benefits)],
      ["Wages and benefits", y => y.salaries == null ? "–" : "<b>" + mil((y.salaries || 0) + (y.benefits || 0)) + "</b>"],
      ["Beds", y => y.beds ?? "–"],
      ["FTE", y => y.fte != null ? Math.round(y.fte).toLocaleString() : "–"],
      ["Discharges", y => y.dis != null ? y.dis.toLocaleString() : "–"],
    ];
    const ys = YEARS.map(fy => yearOf(h, fy));
    const head = `<tr><th scope="col">$ millions</th>${YEARS.map((fy, i) => `<th scope="col" class="n">FY${fy}${partial(ys[i]) ? "*" : ""}</th>`).join("")}</tr>`;
    const body = rows.filter(([l]) => !l.startsWith("  ") || ys.some(y => y && y.tax != null)).map(([l, f]) => `<tr><th scope="row" style="white-space:nowrap;${l.startsWith("  ") ? "padding-left:28px;font-weight:400;color:var(--ink-muted)" : ""}">${l.trim()}</th>${ys.map(y => `<td class="n">${y ? f(y) : "–"}</td>`).join("")}</tr>`).join("");
    document.getElementById("dTable").innerHTML = `<table class="bb-table"><thead>${head}</thead><tbody>${body}</tbody></table>` +
      (ys.some(partial) ? `<p class="note">* Short reporting period, see the note above.</p>` : "");
    document.querySelectorAll("#dTable tbody tr").forEach(tr => tr.style.cursor = "default");
  }

  // ---------- audited statements ----------
  function auditDetail(h) {
    const panel = document.getElementById("auditPanel");
    panel.hidden = !h.audit;
    if (!h.audit) return;
    const A = h.audit;
    document.getElementById("auditMeta").textContent = A.entity + ". " + A.scope;
    const ys = YEARS.map(fy => auditYear(h, fy));
    const cr = YEARS.map(fy => yearOf(h, fy));
    const rows = [
      ["Net patient revenue", a => mil(a.npsr)],
      ["Supplemental Medicaid", a => a.supp == null ? "in patient rev." : mil(a.supp)],
      ["Other operating revenue", a => mil(a.oopOther)],
      ["Operating revenue", a => "<b>" + mil(a.opRev) + "</b>"],
      ["Operating expenses", a => "<b>" + mil(a.opExp) + "</b>"],
      ["Operating result", a => `<b class="${a.opInc < 0 ? "neg" : ""}">${mil(a.opInc)}</b>`],
      ["Property tax", a => mil(a.tax)],
      ["Investment return", a => mil(a.invest)],
      ["Interest expense", a => mil(a.interest)],
      ["COVID relief", a => mil(a.relief)],
      ["Other nonoperating, capital gifts, transfers", a => mil((a.otherNonop || 0) + (a.cap || 0) + (a.transfer || 0))],
      ["Change in net position", a => `<b class="${a.chg < 0 ? "neg" : ""}">${mil(a.chg)}</b>`],
      ["Capital spending (cash)", a => mil(a.capex)],
    ];
    const head = `<tr><th scope="col">$ millions</th>${YEARS.map((fy, i) => `<th scope="col" class="n">FY${fy}${ys[i] && ys[i].months ? "*" : ""}</th>`).join("")}</tr>`;
    const body = rows.map(([l, f]) => `<tr><th scope="row" style="white-space:nowrap">${l}</th>${ys.map(a => `<td class="n">${a ? f(a) : "–"}</td>`).join("")}</tr>`).join("") +
      `<tr><th scope="row" style="white-space:nowrap;font-weight:400;color:var(--ink-muted)">Cost report net income, for comparison</th>${cr.map(y => `<td class="n" style="color:var(--ink-muted)">${y ? mil(y.net) : "–"}</td>`).join("")}</tr>`;
    document.getElementById("auditTable").innerHTML = `<table class="bb-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    const src = Object.entries(A.sources).map(([k, u]) => `<a href="${esc(u)}">${esc(k)}</a>`).join(", ");
    document.getElementById("auditNote").innerHTML = esc(A.notes) + (ys.some(a => a && a.months) ? " * Short period." : "") + " Audited statements: " + src + ".";
  }
  function drawAudit() {
    const h = byId[current];
    if (!h.audit) { if (charts.cAudit) { charts.cAudit.destroy(); delete charts.cAudit; } return; }
    const o = baseOpts();
    o.scales.x.stacked = true; o.scales.y.stacked = true;
    o.scales.y.beginAtZero = true;
    o.scales.y.grid.color = ctx => ctx.tick.value === 0 ? C.strong : C.line;
    o.plugins.tooltip.callbacks = {
      title: items => { const fy = YEARS[items[0].dataIndex], a = auditYear(h, fy); return "FY" + fy + (a && a.months ? " (" + a.months + " months)" : "") + ", audited"; },
      label: c => " " + c.dataset.label + ": " + money(c.parsed.y),
      footer: items => { const a = auditYear(h, YEARS[items[0].dataIndex]); return a && a.capex != null ? "Capital spending " + money(a.capex) : ""; },
    };
    o.plugins.tooltip.footerColor = C.muted;
    const ser = f => YEARS.map(fy => { const a = auditYear(h, fy); return a ? f(a) : null; });
    const bar = (label, f, color) => ({ type: "bar", label, data: ser(f), backgroundColor: color, borderColor: C.raised, borderWidth: 1, stack: "a", maxBarThickness: 44, order: 2 });
    mk("cAudit", {
      data: {
        labels: fyLabels,
        datasets: [
          bar("Operating result", a => a.opInc, C.c2),
          bar("Property tax", a => a.tax, C.c3),
          bar("Investment return", a => a.invest, C.c1),
          bar("Everything else", auditOther, C.neutral),
          { type: "line", label: "Change in net position", data: ser(a => a.chg), borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2,
            pointRadius: 4, pointHoverRadius: 6, pointBorderColor: C.raised, pointBorderWidth: 2, stack: "chg", order: 1, tension: 0, spanGaps: false },
        ],
      },
      options: o,
    });
  }
  // ---------- Sankey: one audited year, sources -> system -> uses ----------
  const SVGNS = "http://www.w3.org/2000/svg";
  const yearSel = document.getElementById("sankeyYear");
  let sankeyFy = null;
  yearSel.addEventListener("change", () => { sankeyFy = yearSel.value; drawSankey(); });
  function sankeyFlows(a) {
    const pos = v => Math.max(v || 0, 0), neg = v => Math.max(-(v || 0), 0);
    const otherIn = pos(a.otherNonop) + pos(a.cap) + pos(a.transfer);
    const ins = [
      ["Patient revenue", a.npsr, "var(--c-1)", "What insurers, Medicare, Medicaid and patients paid"],
      ["Supplemental Medicaid", a.supp, "var(--c-1)", "Extra state and federal Medicaid payments for safety-net hospitals", 0.6],
      ["Other operating revenue", a.oopOther, "var(--c-1)", "Pharmacy programs, contracts, cafeteria, rent and similar", 0.35],
      ["Property tax", a.tax, "var(--c-3)", "The hospital district's own tax levy"],
      ["Investment income", pos(a.invest), "var(--c-n)", "Interest and gains on cash and investments"],
      ["COVID relief", a.relief, "var(--c-n)", "Federal Provider Relief Funds and other pandemic aid"],
      ["Grants, gifts and other", otherIn, "var(--c-n)", "Grants, tobacco settlement, capital gifts, transfers from affiliates and other items"],
      ["Drawn from savings", neg(a.chg), "var(--c-2)", "Spending beyond income this year, covered from reserves"],
    ].filter(f => f[1] > 0);
    const otherOut = neg(a.otherNonop) + neg(a.cap) + neg(a.transfer) + neg(a.invest) + neg(a.interest);
    const outs = [
      ["Salaries and benefits", a.expSal, "var(--c-n)", "Pay, pensions and health benefits for employees"],
      ["Supplies, services and other", a.expRest, "var(--c-n)", "Drugs, supplies, contracted services, physician fees, utilities and other operating costs"],
      ["Payments to the state", a.expIgt, "var(--c-n)", "Intergovernmental transfers that put up the state's share of supplemental Medicaid"],
      ["Depreciation", a.expDep, "var(--c-n)", "This year's share of what buildings and equipment cost"],
      ["Interest and other", otherOut, "var(--c-n)", "Interest on debt, investment losses and other nonoperating costs"],
      ["Added to savings", pos(a.chg), "var(--ink)", "Income beyond spending this year (change in net position)"],
    ].filter(f => f[1] > 0);
    return { ins, outs };
  }
  function drawSankey() {
    const h = byId[current], svg = document.getElementById("sankey");
    if (!h.audit) return;
    const fys = Object.keys(h.audit.years).sort();
    if (!sankeyFy || !h.audit.years[sankeyFy]) sankeyFy = fys[fys.length - 1];
    yearSel.innerHTML = fys.slice().reverse().map(fy => `<option value="${fy}">FY${fy}${h.audit.years[fy].months ? " (" + h.audit.years[fy].months + " mo.)" : ""}</option>`).join("");
    yearSel.value = sankeyFy;
    const a = h.audit.years[sankeyFy], { ins, outs } = sankeyFlows(a);
    const total = ins.reduce((t, f) => t + f[1], 0), totalOut = outs.reduce((t, f) => t + f[1], 0);
    const W = 900, top = 34, H = 430, nodeW = 14, gap = 12, xL = 210, xC = 443, xR = 676;
    // Every node gets a slot at least MIN tall so its two-line label sits beside it; shrink the scale until both sides fit.
    const MIN = 24, avail = H - top - 10;
    const need = (flows, kk) => flows.reduce((t, f) => t + Math.max(f[1] * kk, MIN), 0) + gap * (flows.length - 1);
    let k = (avail - gap * (Math.max(ins.length, outs.length) - 1)) / total;
    while (k > 0 && Math.max(need(ins, k), need(outs, k)) > avail) k *= 0.97;
    const ch = total * k, cy = top + (H - top - 10 - ch) / 2;
    const el = (tag, attrs, text) => { const e = document.createElementNS(SVGNS, tag); for (const [kk, v] of Object.entries(attrs)) e.setAttribute(kk, v); if (text != null) e.textContent = text; return e; };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    [...svg.querySelectorAll(":scope > :not(title)")].forEach(e => e.remove());
    document.getElementById("sankeyTitle").textContent = `${h.name}, FY${sankeyFy}: ${money(total)} came in and went out. ` +
      ins.map(f => f[0] + " " + money(f[1])).join(", ") + ". Uses: " + outs.map(f => f[0] + " " + money(f[1])).join(", ") + ".";
    const ribbon = (x0, y0a, y0b, x1, y1a, y1b, fill, op, tip) => {
      const m = (x0 + x1) / 2;
      const p = el("path", { class: "flow", d: `M${x0},${y0a}C${m},${y0a} ${m},${y1a} ${x1},${y1a}L${x1},${y1b}C${m},${y1b} ${m},${y0b} ${x0},${y0b}Z`, style: `fill:${fill}` });
      if (op) p.style.fillOpacity = (0.42 * op).toFixed(2);
      p.appendChild(el("title", {}, tip)); svg.appendChild(p);
    };
    const side = (flows, x, isIn) => {
      // slot = max(height, MIN); the bar sits in the middle of its slot, the label at the slot's center
      const extra = Math.max(0, Math.min(36, (avail - need(flows, k)) / Math.max(flows.length - 1, 1)));
      let y = top, cyRun = cy;
      const nodes = flows.map(f => {
        const hh = Math.max(f[1] * k, 1.5), slot = Math.max(f[1] * k, MIN);
        const nd = { f, y: y + (slot - hh) / 2, h: hh, mid: y + slot / 2, cy: cyRun };
        y += slot + gap + extra; cyRun += f[1] * k; return nd;
      });
      const shift = (top + avail - (y - gap - extra)) / 2;
      nodes.forEach(nd => { nd.y += shift; nd.mid += shift; });
      nodes.forEach(nd => {
        const [name, v, color, tip, op] = nd.f;
        const t = `${name}: ${money(v)} (${pct(v / total)}). ${tip}.`;
        if (isIn) ribbon(x + nodeW, nd.y, nd.y + nd.h, xC, nd.cy, nd.cy + v * k, color, op, t);
        else ribbon(xC + nodeW, nd.cy, nd.cy + v * k, x, nd.y, nd.y + nd.h, color, op, t);
        const r = el("rect", { x, y: nd.y, width: nodeW, height: nd.h, rx: 2, style: `fill:${color}` + (op ? `;fill-opacity:${op}` : "") });
        r.appendChild(el("title", {}, t)); svg.appendChild(r);
      });
      const ly = nodes.map(nd => nd.mid);
      nodes.forEach((nd, i) => {
        const [name, v] = nd.f, tx = isIn ? x - 8 : x + nodeW + 8, anchor = isIn ? "end" : "start";
        svg.appendChild(el("text", { x: tx, y: ly[i] - 2, "text-anchor": anchor, class: "lbl" }, name));
        svg.appendChild(el("text", { x: tx, y: ly[i] + 13, "text-anchor": anchor, class: "amt" }, `${money(v)} · ${pct(v / total)}`));
      });
    };
    side(ins, xL, true);
    side(outs, xR, false);
    svg.appendChild(el("rect", { x: xC, y: cy, width: nodeW, height: ch, rx: 2, style: "fill:var(--ink-muted)" }));
    svg.appendChild(el("text", { x: xC + nodeW / 2, y: 16, "text-anchor": "middle", class: "ctr" }, money(total) + " in · " + money(totalOut) + " out"));
    const sal = a.expSal / a.opExp;
    const lumped = { "450289": +sankeyFy < 2022, "450213": true, "450686": true }[h.id];
    document.getElementById("sankeyNote").textContent =
      `Audited figures, district hospitals only. Salaries and benefits were ${pct(sal)} of operating costs; that covers the whole district, including any physician group it owns, so it is higher than the cost report's wages and benefits in the table below. ` +
      (a.chg >= 0 ? `Income beat spending by ${money(a.chg)}, which went to savings (net position). ` : `Spending beat income by ${money(-a.chg)}, covered from savings. `) +
      (a.capex != null ? `Separately, the district spent ${money(a.capex)} in cash on buildings and equipment; only depreciation appears above. ` : "") +
      (lumped ? "This system reports supplies, purchased services and other costs as one line. " : "") +
      (a.months ? `This is a ${a.months}-month transition period. Property tax is booked in the fiscal year it is levied for, so almost none lands here and the period shows a loss. ` : "") +
      "Hover a band for detail.";
  }

  function auditSummary() {
    const sys = BIG6.map(id => byId[id]).filter(h => h.audit);
    const sum = (h, k) => Object.values(h.audit.years).reduce((t, a) => t + (a[k] || 0), 0);
    const yrs = h => Object.keys(h.audit.years).sort();
    const cell = v => `<td class="n"><span class="${v < 0 ? "neg" : ""}">${money(v)}</span></td>`;
    const head = `<tr><th scope="col">System</th><th scope="col" class="n">Operating result</th><th scope="col" class="n">Property tax</th><th scope="col" class="n">Investment return</th><th scope="col" class="n">Change in net position</th><th scope="col" class="n">Capital spending</th><th scope="col" class="n">Years</th><th scope="col" class="n">Total operating result</th><th scope="col" class="n">Total property tax</th><th scope="col" class="n">Total change in net position</th></tr>`;
    const body = sys.map(h => {
      const a = auditYear(h, D.last) || {}, y = yrs(h);
      return `<tr data-id="${h.id}" tabindex="0"><td><b>${esc(h.name)}</b><span class="sub">${esc(h.audit.entity.split(" d/b/a")[0])}</span></td>${cell(a.opInc)}${cell(a.tax)}${cell(a.invest)}${cell(a.chg)}${cell(a.capex)}<td class="n">FY${y[0].slice(2)}–${y[y.length - 1].slice(2)}</td>${cell(sum(h, "opInc"))}${cell(sum(h, "tax"))}${cell(sum(h, "chg"))}</tr>`;
    }).join("");
    const el = document.getElementById("auditSummary");
    el.innerHTML = `<table class="bb-table"><thead><tr><th></th><th colspan="5" scope="colgroup" class="n">FY${D.last}</th><th colspan="4" scope="colgroup" class="n">All audited years</th></tr>${head}</thead><tbody>${body}</tbody></table>`;
    el.querySelectorAll("tbody tr").forEach(tr => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => openDetail(tr.dataset.id, true));
      tr.addEventListener("keydown", e => { if (e.key === "Enter") openDetail(tr.dataset.id, true); });
    });
    document.querySelectorAll(".auditLast").forEach(e => e.textContent = D.last);
  }

  // ---------- all hospitals table ----------
  const COLS = [
    { k: "name", l: "Hospital", s: h => h.name.toLowerCase() },
    { k: "beds", l: "Beds", n: 1, s: h => latest(h).beds || 0, f: h => latest(h).beds ?? "–" },
    { k: "rev", l: "Revenue", n: 1, s: h => latest(h).rev, f: h => money(latest(h).rev) },
    { k: "exp", l: "Expenses", n: 1, s: h => latest(h).exp, f: h => money(latest(h).exp) },
    { k: "net", l: "Net income", n: 1, s: h => latest(h).net, f: h => `<span class="${latest(h).net < 0 ? "neg" : ""}">${money(latest(h).net)}</span>` },
    { k: "mar", l: "Margin", n: 1, s: h => margin(latest(h)) ?? -9, f: h => `<span class="${latest(h).net < 0 ? "neg" : ""}">${pct(margin(latest(h)))}</span>` },
    { k: "tax", l: "Property tax", n: 1, s: h => latest(h).tax ?? -1, f: h => money(latest(h).tax) },
    { k: "tsh", l: "Tax share", n: 1, s: h => taxShare(latest(h)) ?? -1, f: h => pct(taxShare(latest(h))) },
    { k: "trend", l: "Revenue, FY" + D.first + "–" + D.last, n: 1, s: h => { const a = h.years[0], b = latest(h); return a.rev ? b.rev / a.rev : 0; }, f: h => spark(h) },
  ];
  let sortK = "rev", sortDir = -1;
  function spark(h) {
    const vals = YEARS.map(fy => { const y = yearOf(h, fy); return y && !partial(y) ? y.rev : null; }), w = 96, ht = 24;
    const xs = vals.map((v, i) => 2 + i * (w - 4) / (YEARS.length - 1));
    const nn = vals.filter(v => v != null), mn = Math.min(...nn), mx = Math.max(...nn);
    const yv = v => ht - 3 - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * (ht - 6);
    let d = "", pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + xs[i].toFixed(1) + " " + yv(v).toFixed(1); pen = true; });
    const a = h.years[0], b = latest(h), g = a.rev ? b.rev / a.rev - 1 : null;
    return `<span style="display:inline-flex;align-items:center;gap:8px"><svg class="spark" width="${w}" height="${ht}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--c-1)" stroke-width="2" stroke-linejoin="round"/></svg><span style="min-width:52px">${g == null ? "–" : (g >= 0 ? "+" : "") + pct(g)}</span></span>`;
  }
  function table() {
    const q = document.getElementById("q").value.trim().toLowerCase();
    const onlyNow = document.getElementById("onlyNow").checked;
    let rows = H.filter(h => (!onlyNow || yearOf(h, D.last)) && (!q || (h.name + " " + h.cmsName + " " + h.city + " " + (h.county || "")).toLowerCase().includes(q)));
    const col = COLS.find(c => c.k === sortK);
    rows.sort((a, b) => { const x = col.s(a), y = col.s(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    const th = COLS.map(c => `<th scope="col" class="${c.n ? "n" : ""}" aria-sort="${c.k === sortK ? (sortDir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${c.k}">${c.l}</button></th>`).join("");
    const tb = rows.map(h => {
      const y = latest(h);
      const sub = [h.city, h.county ? h.county + " County" : "", y.fy !== D.last ? "last filed FY" + y.fy : "", nursingFlag(h) ? "nursing home programs" : ""].filter(Boolean).join(" · ");
      return `<tr data-id="${h.id}" tabindex="0"><td><b>${esc(h.name)}</b><span class="sub">${esc(sub)}</span></td>${COLS.slice(1).map(c => `<td class="n">${c.f(h)}</td>`).join("")}</tr>`;
    }).join("");
    const t = document.getElementById("allTable");
    t.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${tb}</tbody>`;
    t.querySelectorAll("th button").forEach(b => b.addEventListener("click", () => {
      if (sortK === b.dataset.k) sortDir = -sortDir; else { sortK = b.dataset.k; sortDir = b.dataset.k === "name" ? 1 : -1; }
      table();
    }));
    t.querySelectorAll("tbody tr").forEach(tr => {
      tr.addEventListener("click", () => openDetail(tr.dataset.id, true));
      tr.addEventListener("keydown", e => { if (e.key === "Enter") openDetail(tr.dataset.id, true); });
    });
    document.getElementById("allNote").textContent = rows.length + " hospitals shown. Property tax is the district's levy for the tax year due during that fiscal year. A dash means no hospital district levies a tax for it: county- and city-owned hospitals are funded from the county or city budget instead.";
  }
  document.getElementById("q").addEventListener("input", table);
  document.getElementById("onlyNow").addEventListener("change", table);

  // ---------- county map ----------
  const MAPM = {
    margin: { label: "Margin", kind: "div", bins: [-0.10, -0.03, -0.01, 0.01, 0.03, 0.10], fmt: v => pct(v),
      val: g => g.rev ? g.net / g.rev : null, low: true, note: "Margin is net income divided by total revenue (patient revenue plus other income) on the Medicare cost report." },
    net: { label: "Net income", kind: "div", bins: [-25e6, -5e6, -0.5e6, 0.5e6, 5e6, 25e6], fmt: v => money(v), val: g => g.net, low: true },
    rev: { label: "Total revenue", kind: "seq", bins: [10e6, 30e6, 100e6, 300e6, 1e9], fmt: v => money(v), val: g => g.rev },
    tax: { label: "Property tax levy", kind: "seq", bins: [1e6, 3e6, 10e6, 30e6, 100e6], fmt: v => money(v), val: g => g.taxN ? g.tax : null,
      note: "The levy of each hospital district matched to a hospital here. Counties whose district runs no hospital of its own (Travis, Nueces, Montgomery and others) are in the districts chart below, not on this map." },
    taxShare: { label: "Tax share of revenue", kind: "seq", bins: [0.05, 0.10, 0.20, 0.30, 0.40], fmt: v => pct(v), val: g => g.taxN && g.rev ? g.tax / g.rev : null },
    uncomp: { label: "Uncompensated care", kind: "seq", bins: [1e6, 3e6, 10e6, 30e6, 100e6], fmt: v => money(v), val: g => g.uncompN ? g.uncomp : null },
    uncompShare: { label: "Uncompensated care share of expenses", kind: "seq", bins: [0.02, 0.05, 0.10, 0.15, 0.20], fmt: v => pct(v), val: g => g.uncompN && g.exp ? g.uncomp / g.exp : null },
  };
  const mapMetric = document.getElementById("mapMetric"), mapYear = document.getElementById("mapYear");
  const tip = document.createElement("div"); tip.className = "map-tip"; tip.hidden = true; document.body.appendChild(tip);
  let mapSel = null;
  mapYear.innerHTML = YEARS.slice().reverse().map(y => `<option value="${y}">FY${y}</option>`).join("");
  function countyGroups(fy) {
    const G = {};
    H.forEach(h => {
      const y = yearOf(h, fy);
      if (!y || !h.fips) return;
      const g = G[h.fips] || (G[h.fips] = { hosp: [], rev: 0, exp: 0, net: 0, tax: 0, taxN: 0, uncomp: 0, uncompN: 0, partial: false });
      g.hosp.push({ h, y }); g.rev += y.rev || 0; g.exp += y.exp || 0; g.net += y.net || 0;
      if (y.tax != null) { g.tax += y.tax; g.taxN++; }
      if (y.uncomp != null) { g.uncomp += y.uncomp; g.uncompN++; }
      if (partial(y)) g.partial = true;
    });
    Object.values(G).forEach(g => g.hosp.sort((a, b) => (b.y.rev || 0) - (a.y.rev || 0)));
    return G;
  }
  function binOf(m, v) { let i = 0; while (i < m.bins.length && v >= m.bins[i]) i++; return i; }
  function binColor(m, i) { return m.kind === "div" ? `var(--dv-${i})` : `var(--sq-${i})`; }
  function mapLegend(m) {
    const b = m.bins, f = m.fmt, items = [];
    for (let i = 0; i <= b.length; i++) {
      const lab = i === 0 ? "< " + f(b[0]) : i === b.length ? f(b[b.length - 1]) + "+" : (m.kind === "div" && i === b.length / 2 ? "about 0" : f(b[i - 1]) + " to " + f(b[i]));
      items.push(`<span class="k"><i style="background:${binColor(m, i)}"></i>${lab}</span>`);
    }
    items.push(`<span class="k none"><i></i>No public hospital${m.val === MAPM.tax.val ? " or levy" : ""}</span>`);
    document.getElementById("mapLegend").innerHTML = items.join("");
  }
  function drawMap() {
    const m = MAPM[mapMetric.value], fy = +mapYear.value, G = countyGroups(fy), svg = document.getElementById("txmap");
    svg.setAttribute("viewBox", TX_COUNTIES.viewBox);
    if (!svg.querySelector("path")) {
      Object.entries(TX_COUNTIES.counties).forEach(([f, c]) => {
        const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", c.d); p.dataset.fips = f; svg.appendChild(p);
      });
      svg.addEventListener("mousemove", e => {
        const f = e.target.dataset && e.target.dataset.fips; if (!f) { tip.hidden = true; return; }
        tip.innerHTML = countyTip(f); tip.hidden = false;
        const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8);
        tip.style.left = x + "px"; tip.style.top = y + "px";
      });
      svg.addEventListener("mouseleave", () => tip.hidden = true);
      svg.addEventListener("click", e => { const f = e.target.dataset && e.target.dataset.fips; if (f) { mapSel = f; mapSide(); svg.querySelectorAll("path").forEach(p => p.classList.toggle("sel", p.dataset.fips === mapSel)); } });
    }
    svg.querySelectorAll("path").forEach(p => {
      const g = G[p.dataset.fips], v = g ? m.val(g) : null;
      p.classList.toggle("nodata", v == null); p.classList.toggle("has", !!g); p.classList.toggle("sel", p.dataset.fips === mapSel);
      p.style.fill = v == null ? "" : binColor(m, binOf(m, v));
    });
    mapLegend(m);
    mapState = { m, fy, G };
    mapSide();
    const n = Object.values(G).filter(g => m.val(g) != null).length;
    document.getElementById("mapTitle").textContent = `Texas counties shaded by ${m.label.toLowerCase()}, FY${fy}. ${n} counties have data.`;
    document.getElementById("mapNote").textContent = (m.note ? m.note + " " : "") + `FY${fy}: ${n} counties with a public hospital reporting. ` +
      "Margins at small hospitals that run nursing homes through Medicaid programs, and at hospitals with short reporting years, can swing widely.";
  }
  let mapState = null;
  function countyTip(f) {
    const { m, fy, G } = mapState, g = G[f], name = TX_COUNTIES.counties[f].name + " County";
    if (!g) return `<b>${esc(name)}</b>No public hospital filing in FY${fy}`;
    const v = m.val(g);
    return `<b>${esc(name)}</b>${m.label}: ${v == null ? "–" : m.fmt(v)}<br>` + g.hosp.map(({ h, y }) => `${esc(h.name)}: ${money(y.rev)} revenue, ${pct(margin(y))} margin`).join("<br>");
  }
  function mapSide() {
    const { m, fy, G } = mapState;
    const T = document.getElementById("mapSideTitle"), M = document.getElementById("mapSideMeta"), L = document.getElementById("mapSideList");
    const hospBtn = (h, right) => `<li><span><button class="linkish" data-open="${h.id}">${esc(h.name)}</button></span><span>${right}</span></li>`;
    if (mapSel && G[mapSel]) {
      const g = G[mapSel], v = m.val(g);
      T.textContent = TX_COUNTIES.counties[mapSel].name + " County";
      M.textContent = `FY${fy} · ${m.label}: ${v == null ? "–" : m.fmt(v)} · revenue ${money(g.rev)} · net ${money(g.net)}`;
      L.innerHTML = g.hosp.map(({ h, y }) => hospBtn(h, `<span class="${y.net < 0 ? "neg" : ""}">${pct(margin(y))}</span>`)).join("") +
        `<li><span style="color:var(--ink-muted)">Select a hospital to open it below.</span><span></span></li>` +
        `<li><span><button class="linkish" data-clear="1">Back to the county ranking</button></span><span></span></li>`;
    } else {
      const rows = Object.entries(G).map(([f, g]) => [f, g, m.val(g)]).filter(r => r[2] != null).sort((a, b) => m.low ? a[2] - b[2] : b[2] - a[2]).slice(0, 10);
      T.textContent = (m.low ? "Lowest " : "Highest ") + m.label.toLowerCase();
      M.textContent = `FY${fy}, by county. Select a county on the map for its hospitals.`;
      L.innerHTML = rows.map(([f, g, v]) => `<li><span><button class="linkish" data-county="${f}">${esc(TX_COUNTIES.counties[f].name)} County</button><span class="hn">${esc(g.hosp[0].h.name)}${g.hosp.length > 1 ? " and " + (g.hosp.length - 1) + " more" : ""}</span></span><span class="${m.kind === "div" && v < 0 ? "neg" : ""}">${m.fmt(v)}</span></li>`).join("");
    }
    L.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openDetail(b.dataset.open, true)));
    L.querySelectorAll("[data-clear]").forEach(b => b.addEventListener("click", () => { mapSel = null; drawMap(); }));
    L.querySelectorAll("[data-county]").forEach(b => b.addEventListener("click", () => { mapSel = b.dataset.county; drawMap(); }));
  }
  mapMetric.addEventListener("change", drawMap);
  mapYear.addEventListener("change", drawMap);

  // ---------- hospital districts by levy ----------
  const TY = String(D.last - 1), TY0 = String(D.first - 1);
  function drawDistricts() {
    const top = D.districts.filter(d => d.levy[TY]).sort((a, b) => b.levy[TY] - a.levy[TY]).slice(0, 15);
    const o = baseOpts({ indexAxis: "y" });
    o.interaction = { mode: "nearest", axis: "y", intersect: false };
    o.scales.x = Object.assign({}, o.scales.y, { grid: { color: C.line }, border: { display: false } });
    o.scales.y = { grid: { display: false }, border: { color: C.strong }, ticks: { color: C.ink, font: { family: C.font, size: 12 }, autoSkip: false } };
    o.plugins.tooltip.callbacks = {
      title: items => top[items[0].dataIndex].name,
      label: c => {
        const d = top[c.dataIndex], r = d.rate[TY], old = d.levy[TY0];
        return [" Tax year " + TY + " levy: " + money(d.levy[TY]), r ? " Rate: " + (r * 100).toFixed(2) + "¢ per $100" : "", old ? " Tax year " + TY0 + ": " + money(old) : "",
          d.hospital ? " Runs a hospital in this list" : " Runs no hospital of its own"].filter(Boolean);
      },
    };
    mk("cDist", {
      type: "bar",
      data: { labels: top.map(d => d.name.replace(/ Hospital District$| HD$/, "").replace("R. E. Thomason General", "El Paso County (Thomason)").replace("University Health System", "Bexar County (University Health)").replace("Travis County Healthcare District", "Travis County (Central Health)")),
        datasets: [{ label: "Levy", data: top.map(d => d.levy[TY]), backgroundColor: top.map(d => d.hospital ? C.c1 : C.neutral), borderRadius: 4, borderSkipped: "start", barPercentage: 0.75, maxBarThickness: 22 }] },
      options: o,
    });
    const all = D.districts.reduce((t, d) => t + (d.levy[TY] || 0), 0);
    const noHosp = D.districts.filter(d => !d.hospital && d.levy[TY]);
    const nh = noHosp.reduce((t, d) => t + d.levy[TY], 0);
    document.getElementById("distNote").textContent = D.districts.filter(d => d.levy[TY]).length + " hospital districts levied " + money(all, 2) +
      " in tax year " + TY + ". " + noHosp.length + " of them, levying " + money(nh) + ", don't show up as a hospital owner in the cost reports. Some fund care at private or nonprofit hospitals, like Central Health in Travis County and Nueces County's district. Others own a hospital that a private operator runs or that files its cost report under another owner type.";
  }

  function renderAllCharts() { readColors(); drawGrid6(); drawDetail(); drawAudit(); drawDistricts(); }

  // ---------- go ----------
  readColors();
  tiles();
  grid6();
  fillPicker();
  const m = location.hash.match(/h=(\d+)/);
  if (m && byId[m[1]]) current = m[1];
  pick.value = current;
  drawGrid6();
  drawMap();
  auditSummary();
  drawDistricts();
  renderDetail();
  table();
  document.getElementById("tyLabel").textContent = TY;
  document.getElementById("exList").textContent = "Also left out: " + Object.values(D.excluded).join("; ") + ".";
})();
