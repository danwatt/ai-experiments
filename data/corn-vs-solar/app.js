(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const ACRE_M2 = 4046.86;
  const ETH_BTU = 76330;       // AFDC, LHV per gallon
  const E10_BTU = 112114;      // AFDC, LHV per gallon of E10
  const BTU_KWH = 3412.14;
  const EPA_CHG = 0.88;        // charging efficiency already inside an EPA wall-plug rating
  const EV_DRIVE = 0.87;       // battery to wheels (display only)
  const ICE_DRIVE = 0.20;      // fuel to wheels (display only)
  const MODULE_KW_M2 = 0.20;   // ~20% module at 1 kW/m2 (display only: panel area)
  const FIX_RATIO = 0.855;     // fixed-tilt / tracking yield, from PVWatts at IA (0.873) and AZ (0.838)
  const ETH_2025 = { made: 16.49, exported: 2.18 }; // billion gallons

  const FIELDS = {
    fCorn: [
      ["galBu", "Ethanol per bushel", 2.90, 2.5, 3.2, 0.01, "gal", "Dry-grind mills average about 2.9 gal/bu (RFA, USDA ERS)."],
      ["eroiEth", "Ethanol energy out per fossil energy in", 2.1, 1.2, 4.5, 0.1, "×", "USDA 2015 energy balance; used only when subtracting energy inputs."],
    ],
    fSun: [
      ["densTrk", "Tracking plant density", 0.24, 0.12, 0.45, 0.01, "MWdc/acre", "LBNL 2019 median, fenced area including roads and spacing."],
      ["densFix", "Fixed-tilt plant density", 0.32, 0.15, 0.6, 0.01, "MWdc/acre", "LBNL measured 0.35, but its fixed plants made only 13% more energy per acre than tracking (447 vs 394 MWh). 0.32 matches that gap, since this model ignores row-to-row shading."],
      ["degr", "Panel degradation", 0.5, 0, 1.2, 0.05, "%/yr", "Averaged over the plant's life; modern modules lose about 0.5% a year."],
      ["life", "Plant life", 30, 15, 40, 1, "yr", ""],
      ["td", "Transmission and distribution loss", 5, 1, 12, 0.5, "%", "EIA: about 5% of electricity transmitted and distributed."],
      ["storShare", "Share time-shifted through a grid battery", 40, 0, 100, 5, "%", "Overnight home charging needs stored daytime solar."],
      ["storRte", "Grid battery round-trip efficiency", 82, 60, 95, 1, "%", "EIA: utility batteries return about 82% of what they store."],
      ["payback", "Energy payback time", 1.5, 0.3, 4, 0.1, "yr", "Energy to make panels, racking and inverters; used only when subtracting energy inputs."],
    ],
    fCar: [
      ["mpg", "Gasoline car fuel economy (on E10)", 25.5, 12, 55, 0.5, "mpg", "EPA: MY2024 new vehicles without EVs and plug-ins, real-world 25.5 mpg."],
      ["kwh100", "EV consumption at the wall", 31, 18, 55, 1, "kWh/100 mi", "EPA label basis, includes charging loss. 31 ≈ 109 MPGe."],
      ["chg", "Charging efficiency, wall to battery", 88, 70, 96, 1, "%", "EPA ratings assume about 88%. Level 1 is lower, DC fast higher."],
      ["carYear", "Miles a car drives in a year", 12000, 6000, 18000, 500, "mi", "Light-duty U.S. average is roughly 11,000–13,500 (FHWA)."],
    ],
  };
  const DEFAULTS = {};
  Object.values(FIELDS).flat().forEach((f) => (DEFAULTS[f[0]] = f[2]));
  const P = { ...DEFAULTS };

  const state = { ab: "IA", year: "avg", mount: "trk", net: false, sort: "ratio" };
  try {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get("s") && STATES.some((s) => s.ab === q.get("s"))) state.ab = q.get("s");
  } catch (e) {}

  // ---------- formatting
  const nf = (v, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const sig = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return nf(v / 1e6, a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e4) return nf(Math.round(v / 100) * 100);
    if (a >= 100) return nf(Math.round(v));
    if (a >= 10) return nf(v, 1);
    return nf(v, 2);
  };
  const mwh = (kwh) => (kwh >= 1e5 ? nf(kwh / 1000) : kwh >= 1e4 ? nf(kwh / 1000, 1) : nf(kwh / 1000, 2)) + " MWh";
  const pct = (v) => (v >= 0.1 ? nf(v * 100, 0) : v >= 0.01 ? nf(v * 100, 1) : nf(v * 100, 2)) + "%";

  // ---------- model
  function cornYield(s) {
    if (state.year === "avg") return (s.corn["2023"] + s.corn["2024"] + s.corn["2025"]) / 3;
    return s.corn[state.year];
  }
  function degrFactor() {
    const r = P.degr / 100;
    let t = 0;
    for (let i = 0; i < P.life; i++) t += Math.pow(1 - r, i);
    return t / P.life;
  }
  function model(s) {
    const bu = cornYield(s);
    const gal = bu * P.galBu;
    const ethNet = state.net ? 1 - 1 / P.eroiEth : 1;
    const ethKwh = (gal * ETH_BTU) / BTU_KWH;
    const ethNetKwh = ethKwh * ethNet;
    const btuMile = E10_BTU / P.mpg;
    const cornMiles = (gal * ETH_BTU * ethNet) / btuMile;

    const sunKwh = s.ghi * ACRE_M2;
    const dens = state.mount === "trk" ? P.densTrk : P.densFix;
    const yld = state.mount === "trk" ? s.trk : s.trk * FIX_RATIO;
    const panelM2 = (dens * 1000) / MODULE_KW_M2;
    const acKwh = dens * 1000 * yld;
    const steps = [];
    let e = acKwh;
    const step = (name, note, f) => { const before = e; e *= f; steps.push({ name, note, before, after: e }); };
    step("Panel aging", `${nf(P.degr, 2)}%/yr over ${P.life} years, lifetime average`, degrFactor());
    step("Grid transmission & distribution", `${nf(P.td, 1)}% line and transformer loss`, 1 - P.td / 100);
    step("Grid battery time-shift", `${P.storShare}% stored at ${P.storRte}% round trip`, 1 - (P.storShare / 100) * (1 - P.storRte / 100));
    if (state.net) step("Energy to build the plant", `${nf(P.payback, 1)}-yr payback over ${P.life}-yr life`, Math.max(0, 1 - P.payback / P.life));
    const wallKwh = e;
    step("Charger & battery charging", `${P.chg}% wall to battery`, P.chg / 100);
    const battKwh = e;
    step("Motor, inverter, drivetrain", "about 13% to heat, aux and braking", EV_DRIVE);
    const wheelKwh = e;
    const sunMiles = (wallKwh * (P.chg / 100 / EPA_CHG)) / (P.kwh100 / 100);
    return { bu, gal, ethKwh, ethNetKwh, cornMiles, btuMile, sunKwh, dens, yld, panelM2, acKwh, steps, wallKwh, battKwh, wheelKwh, sunMiles };
  }

  // ---------- controls
  const sel = $("#state");
  [...STATES].sort((a, b) => a.name.localeCompare(b.name)).forEach((s) => {
    const o = document.createElement("option");
    o.value = s.ab; o.textContent = s.name; sel.appendChild(o);
  });
  sel.value = state.ab;
  sel.addEventListener("change", () => { state.ab = sel.value; setHash(); render(); });
  $("#year").addEventListener("change", (e) => { state.year = e.target.value; render(); });
  $("#mount").addEventListener("change", (e) => { state.mount = e.target.value; render(); renderArt(); });
  $("#net").addEventListener("change", (e) => { state.net = e.target.checked; render(); });
  function setHash() { try { history.replaceState(null, "", "#s=" + state.ab); } catch (e) {} }

  const outputs = {};
  for (const [box, list] of Object.entries(FIELDS)) {
    const host = document.getElementById(box);
    for (const [k, label, def, min, max, stepv, unit, help] of list) {
      const d = document.createElement("div");
      d.className = "field";
      d.innerHTML = `<label for="p_${k}">${label}</label><output id="o_${k}"></output>
        <input type="range" id="p_${k}" min="${min}" max="${max}" step="${stepv}" value="${def}">
        ${help ? `<div class="h">${help}</div>` : ""}`;
      host.appendChild(d);
      const inp = d.querySelector("input");
      outputs[k] = { inp, out: d.querySelector("output"), unit, stepv };
      inp.addEventListener("input", () => { P[k] = +inp.value; render(); });
    }
  }
  function syncFields() {
    for (const [k, o] of Object.entries(outputs)) {
      o.inp.value = P[k];
      const d = o.stepv < 0.1 ? 2 : o.stepv < 1 ? 1 : 0;
      o.out.textContent = `${nf(P[k], d)} ${o.unit}`;
    }
    document.querySelectorAll("[data-ev]").forEach((b) => b.classList.toggle("on", +b.dataset.ev === P.kwh100));
  }
  document.querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", () => { P.kwh100 = +b.dataset.ev; render(); }));
  $("#reset").addEventListener("click", () => { Object.assign(P, DEFAULTS); render(); });
  document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    state.sort = b.dataset.sort;
    document.querySelectorAll("[data-sort]").forEach((x) => x.classList.toggle("on", x === b));
    renderStates();
  }));

  // theme
  const root = document.documentElement;
  try { const t = localStorage.getItem("acre-theme"); if (t) root.dataset.theme = t; } catch (e) {}
  $("#theme").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("acre-theme", root.dataset.theme); } catch (e) {}
  });

  // ---------- render
  const ICONS = {
    field: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 21V8"/><path d="M12 12c-3 0-5-2-5-5 3 0 5 2 5 5zM12 15c3 0 5-2 5-5-3 0-5 2-5 5zM12 9c0-3 1.5-5 0-7-1.5 2 0 4 0 7z"/><path d="M3 21h18"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 7h12v9H2zM14 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
    mill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 21V11l5 3V11l5 3V5h4v16z"/><path d="M19 21V9h2v12"/><path d="M3 21h18"/></svg>',
    rail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="7" width="18" height="8" rx="4"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/><path d="M2 21h20"/></svg>',
    blend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 4h6v16H4zM14 4h6v16h-6z"/><path d="M4 16h6M14 6h6"/></svg>',
    pump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M4 21V4h9v17M3 21h11M6 7h5v4H6z"/><path d="M13 9l3 2v6a1.5 1.5 0 003 0V8l-2-2"/></svg>',
  };

  function render() {
    syncFields();
    const s = STATES.find((x) => x.ab === state.ab);
    const m = model(s);
    const ratio = m.sunMiles / m.cornMiles;

    $("#cornMiles").textContent = sig(m.cornMiles);
    $("#sunMiles").textContent = sig(m.sunMiles);
    $("#ratio").textContent = (ratio >= 100 ? nf(ratio) : nf(ratio, 0)) + "×";
    const yrLabel = state.year === "avg" ? "2023–25 avg" : state.year;
    $("#cornSub").innerHTML = `<b>${nf(m.bu, 0)} bu</b> of corn (${s.name}, ${yrLabel}) → <b>${nf(m.gal)} gal</b> ethanol → <b>${mwh(state.net ? m.ethNetKwh : m.ethKwh)}</b>${state.net ? " net" : ""} at ${nf(P.mpg, 1)} mpg`;
    $("#sunSub").innerHTML = `<b>${nf(m.dens, 2)} MW</b> of panels × <b>${nf(m.yld)} kWh/kW</b> → <b>${mwh(m.acKwh)}</b> AC → <b>${mwh(m.wallKwh)}</b> at the plug, ${P.kwh100} kWh/100 mi`;

    // cars
    $("#carYearMi").textContent = nf(P.carYear);
    const cc = m.cornMiles / P.carYear, sc = m.sunMiles / P.carYear;
    $("#cornCars").innerHTML = `Corn: <b>${nf(cc, cc < 10 ? 2 : 0)}</b> car${cc === 1 ? "" : "s"}`;
    $("#sunCars").innerHTML = `Solar: <b>${nf(sc, 0)}</b> cars`;
    grid($("#cornGrid"), cc);
    grid($("#sunGrid"), sc);

    const perKw = FIX_RATIO, perAcre = (P.densFix * FIX_RATIO) / P.densTrk;
    $("#mountNote").innerHTML = `Tracking panels follow the sun, so each kW makes about ${nf((1 / perKw - 1) * 100)}% more than a fixed panel. But tracker rows need wide gaps to avoid shading each other when tilted at low sun, so an acre holds ${nf(P.densTrk, 2)} MW of tracking panels versus ${nf(P.densFix, 2)} MW fixed. Per acre, fixed tilt comes out <b>${nf(Math.abs(perAcre - 1) * 100)}% ${perAcre >= 1 ? "ahead" : "behind"}</b>. Most new U.S. plants still track: land is a small share of cost, and trackers make cheaper power and more of it in the late afternoon.`;
    renderCorn(s, m);
    renderSun(s, m);
    renderSankeys(s, m);
    renderStates();
    renderNational();
  }

  function grid(el, n) {
    const cap = 600, whole = Math.floor(Math.min(n, cap)), frac = Math.min(n, cap) - whole;
    let h = "";
    for (let i = 0; i < whole; i++) h += "<i></i>";
    if (frac > 0.005) h += `<i class="part" style="--f:${(frac * 100).toFixed(0)}%"></i>`;
    el.innerHTML = h;
  }

  function renderCorn(s, m) {
    const lbCorn = m.bu * 56;
    const ddgsTons = (m.bu * 15.5) / 2000;
    const e10 = m.gal * 10;
    const tankCar = m.gal / 30000;
    const ethShare = (0.1 * ETH_BTU) / E10_BTU; // ethanol share of E10 energy (~7%)
    $("#cornLede").textContent =
      `An average acre of ${s.name} corn yields ${nf(m.bu)} bushels. That grain is trucked to a dry-grind mill, fermented, and the ethanol rides mostly by rail to fuel terminals, where it becomes one-tenth of the E10 sold at the pump. ` +
      `About ${nf(ethShare * 100, 0)}% of the energy in a gallon of E10 is ethanol, so the acre's fuel blends into ${nf(e10)} gallons of E10 but supplies only the ethanol share of those miles.`;
    const steps = [
      ["field", "Field", `${nf(m.bu)} bu`, `${nf(lbCorn / 2000, 1)} tons of shelled corn from one acre, ${state.year === "avg" ? "2023–25 average" : state.year} NASS yield.`],
      ["truck", "To the mill", `${nf(lbCorn / 2000 / 25, 2)} trucks`, "Semi loads of about 25 tons to the elevator or straight to a nearby ethanol plant."],
      ["mill", "Dry-grind mill", `${nf(m.gal)} gal`, `Ethanol at ${nf(P.galBu, 2)} gal/bu, plus ${nf(ddgsTons, 1)} tons of distillers grains for livestock.`],
      ["rail", "Rail to terminal", `${nf(tankCar * 100, 1)}%`, "of one 30,000-gallon tank car. Unit trains carry most U.S. ethanol to blending terminals."],
      ["blend", "Blended", `${nf(e10)} gal`, "of E10 at the terminal rack: 1 gallon ethanol per 10 gallons of gasoline blend."],
      ["pump", "Driven", `${sig(m.cornMiles)} mi`, `Ethanol's share of the miles at ${nf(P.mpg, 1)} mpg, ${nf(m.btuMile)} BTU a mile${state.net ? ", net of fossil inputs" : ""}.`],
    ];
    $("#cornFlow").innerHTML = steps.map(([ic, t, v, d]) => `<li><div class="ic">${ICONS[ic]}</div><div class="t">${t}</div><div class="v">${v}</div><div class="d">${d}</div></li>`).join("");

    // bushel breakdown (lb per bushel)
    const ethLb = P.galBu * 6.58;
    const parts = [
      ["Ethanol", ethLb, "var(--corn)"],
      ["Distillers grains (feed)", 15.5, "color-mix(in srgb, var(--corn) 55%, var(--bg))"],
      ["CO₂ from fermentation", 17.0, "var(--loss)"],
      ["Distillers corn oil", 0.8, "color-mix(in srgb, var(--corn) 30%, var(--ink))"],
    ];
    const rest = Math.max(0, 56 - parts.reduce((a, p) => a + p[1], 0));
    parts.push(["Water and other losses", rest, "color-mix(in srgb, var(--loss) 45%, var(--bg))"]);
    stack($("#bushel"), $("#bushelLegend"), parts, (v) => `${nf(v, 1)} lb`, 56);

    const exp = ETH_2025.exported / ETH_2025.made;
    const dom = 1 - exp;
    const d = [
      ["Blended into U.S. gasoline", dom * m.gal, "var(--corn)"],
      ["Exported (Canada, EU, Asia…)", exp * m.gal, "color-mix(in srgb, var(--corn) 45%, var(--bg))"],
    ];
    stack($("#dist"), $("#distLegend"), d, (v, t) => `${nf(v)} gal · ${pct(v / t)}`, m.gal);
  }

  function stack(barEl, legEl, parts, fmt, total) {
    barEl.innerHTML = parts.map(([n, v, c]) => `<div title="${n}" style="flex:${v};background:${c}"></div>`).join("");
    legEl.innerHTML = parts.map(([n, v, c]) => `<li><i style="background:${c}"></i><span>${n}</span><b>${fmt(v, total)}</b></li>`).join("");
  }

  function renderSun(s, m) {
    const cover = m.panelM2 / ACRE_M2;
    $("#sunLede").textContent =
      `${s.name} gets about ${nf(s.ghi)} kWh of sunlight per square meter a year, ${mwh(m.sunKwh)} on the whole acre. ` +
      `A ${state.mount === "trk" ? "tracking" : "fixed-tilt"} plant fits ${nf(m.dens * 1000)} kW of panels, covering about ${pct(Math.min(1, cover))} of the ground; the rest is row spacing, roads and setback. ` +
      `Each kW makes ${nf(m.yld)} kWh a year${s.pvw ? " (PVWatts at this location)" : " (fit to PVWatts)"}, so the acre sends ${mwh(m.acKwh)} to the grid: ${pct(m.acKwh / m.sunKwh)} of the sunlight that lands on it.`;
    const base = m.acKwh;
    let h = `<div class="wf head"><div class="n">Electricity leaving the plant<small>AC, first year</small></div><div class="bar"><span class="keep" style="width:100%"></span></div><div class="val">${mwh(base)}</div></div>`;
    for (const st of m.steps) {
      const kw = (st.after / base) * 100, lw = ((st.before - st.after) / base) * 100;
      h += `<div class="wf"><div class="n">${st.name}<small>${st.note}</small></div><div class="bar"><span class="keep" style="width:${kw}%"></span><span class="lost" style="left:${kw}%;width:${lw}%"></span></div><div class="val">${mwh(st.after)}<small>−${mwh(st.before - st.after)}</small></div></div>`;
    }
    h += `<div class="wf result"><div class="n">Miles driven<small>${mwh(m.wallKwh)} at the wall ÷ ${P.kwh100} kWh per 100 mi${P.chg !== 88 ? `, scaled for ${P.chg}% charging` : ""}</small></div><div class="bar"></div><div class="val">${sig(m.sunMiles)} mi</div></div>`;
    $("#waterfall").innerHTML = h;
  }

  // ---------- card art
  const AW = 250, AH = 120, GY = 104;
  function cornArt() {
    let h = `<svg viewBox="0 0 ${AW} ${AH}">`;
    h += `<circle class="sunball" cx="214" cy="20" r="11"/>`;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; h += `<line class="ray" x1="${214 + Math.cos(a) * 15}" y1="${20 + Math.sin(a) * 15}" x2="${214 + Math.cos(a) * 20}" y2="${20 + Math.sin(a) * 20}"/>`; }
    h += `<rect class="gnd" x="0" y="${GY}" width="${AW}" height="${AH - GY}" rx="3"/>`;
    const stalk = (x, base, sc, k) => {
      const ht = 78 * sc, top = base - ht, sway = ((k * 37) % 7 - 3) * 0.6 * sc;
      let g = `<path class="stem" stroke-width="${2.2 * sc}" d="M${x} ${base} Q${x + sway} ${base - ht / 2} ${x + sway * 1.6} ${top}"/>`;
      for (let j = 0; j < 4; j++) {
        const y = base - ht * (0.22 + j * 0.17), dir = j % 2 ? -1 : 1, L = (24 - j * 3) * sc;
        g += `<path class="${j % 2 ? "leaf" : "leaf2"}" d="M${x + sway * (1 - y / base)} ${y} q${dir * L * 0.5} ${-L * 0.45} ${dir * L} ${L * 0.15} q${-dir * L * 0.55} ${-L * 0.15} ${-dir * L} ${-L * 0.15}z"/>`;
      }
      const ex = x + sway * 0.8 + 2 * sc, ey = base - ht * 0.5;
      g += `<ellipse class="ear" cx="${ex + 3 * sc}" cy="${ey}" rx="${2.6 * sc}" ry="${7 * sc}" transform="rotate(18 ${ex + 3 * sc} ${ey})"/>`;
      const tx = x + sway * 1.6;
      g += `<line class="tassel" x1="${tx}" y1="${top}" x2="${tx}" y2="${top - 8 * sc}"/><line class="tassel" x1="${tx}" y1="${top - 2 * sc}" x2="${tx - 5 * sc}" y2="${top - 7 * sc}"/><line class="tassel" x1="${tx}" y1="${top - 2 * sc}" x2="${tx + 5 * sc}" y2="${top - 7 * sc}"/>`;
      return g;
    };
    h += `<g class="back">`;
    for (let i = 0; i < 10; i++) h += stalk(12 + i * 25, GY - 2, 0.62, i + 3);
    h += `</g>`;
    for (let i = 0; i < 7; i++) h += stalk(18 + i * 36, GY + 6, 1, i);
    return h + "</svg>";
  }

  // end-on view of rows; GCR sets row pitch (fixed ~0.46, tracking ~0.35)
  let artRaf = 0;
  function solarArt(mode) {
    const tracking = mode === "trk";
    const w = 40, pitch = w / (tracking ? 0.35 : 0.46), tilt = 25 * Math.PI / 180;
    const rows = (base, sc, step, cls) => {
      const n = Math.floor((AW - 16) / (step * sc)) + 1, x0 = (AW - (n - 1) * step * sc) / 2;
      let g = "";
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step * sc, hw = (w / 2) * sc, t = 5 * sc;
        if (tracking) {
          const py = base - 30 * sc;
          g += `<g class="${cls}"><line class="post" x1="${x}" y1="${base}" x2="${x}" y2="${py}" stroke-width="${2 * sc}"/>` +
            `<g class="pv" data-tx="${x}" data-ty="${py}" transform="translate(${x} ${py})"><rect class="panel" x="${-hw}" y="${-t / 2}" width="${2 * hw}" height="${t}" rx="${sc}"/>` +
            `<line class="glint" x1="${-hw + 3}" y1="${-t / 2 + 1}" x2="${hw - 3}" y2="${-t / 2 + 1}"/></g>` +
            `<circle cx="${x}" cy="${py}" r="${1.8 * sc}" class="post" fill="currentColor"/></g>`;
        } else {
          // south (left) facing: low edge left, high edge right
          const cy = base - 22 * sc, dx = hw * Math.cos(tilt), dy = hw * Math.sin(tilt);
          const lx = x - dx, ly = cy + dy, rx = x + dx, ry = cy - dy;
          g += `<g class="${cls}"><line class="post" x1="${lx + 3 * sc}" y1="${base}" x2="${lx + 3 * sc}" y2="${ly}" stroke-width="${1.8 * sc}"/>` +
            `<line class="post" x1="${rx - 3 * sc}" y1="${base}" x2="${rx - 3 * sc}" y2="${ry}" stroke-width="${1.8 * sc}"/>` +
            `<g transform="translate(${x} ${cy}) rotate(${-25})"><rect class="panel" x="${-hw}" y="${-t / 2}" width="${2 * hw}" height="${t}" rx="${sc}"/>` +
            `<line class="glint" x1="${-hw + 3}" y1="${-t / 2 + 1}" x2="${hw - 3}" y2="${-t / 2 + 1}"/></g></g>`;
        }
      }
      return g;
    };
    let h = `<svg viewBox="0 0 ${AW} ${AH}"><circle class="sunball" cx="${tracking ? 125 : 40}" cy="${tracking ? 20 : 18}" r="11"/>`;
    h += `<rect class="gnd" x="0" y="${GY}" width="${AW}" height="${AH - GY}" rx="3"/>`;
    h += rows(GY - 16, 0.55, pitch, "back");
    h += rows(GY + 6, 1, pitch, "");
    return h + "</svg>";
  }
  function renderArt() {
    $("#cornArt").innerHTML = cornArt();
    const el = $("#sunArt");
    el.innerHTML = solarArt(state.mount);
    cancelAnimationFrame(artRaf);
    const sunEl = el.querySelector(".sunball"), pvs = [...el.querySelectorAll(".pv")];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const place = (t) => {
      // t in [0,1): sun rises left (east), sets right (west)
      const a = Math.PI * (1 - t), cx = AW / 2 + Math.cos(a) * 110, cy = 92 - Math.sin(a) * 78;
      sunEl.setAttribute("cx", cx.toFixed(1)); sunEl.setAttribute("cy", cy.toFixed(1));
      sunEl.style.opacity = Math.min(1, Math.sin(a) * 3).toFixed(2);
      if (state.mount === "trk") {
        const ang = Math.max(-55, Math.min(55, (t - 0.5) * 120));
        pvs.forEach((g) => g.setAttribute("transform", `translate(${g.dataset.tx} ${g.dataset.ty}) rotate(${ang.toFixed(1)})`));
      }
    };
    if (state.mount !== "trk") return;
    if (still) { place(0.62); return; }
    const t0 = performance.now();
    const tick = (now) => { place((((now - t0) / 9000) + 0.15) % 1); artRaf = requestAnimationFrame(tick); };
    artRaf = requestAnimationFrame(tick);
  }

  // ---------- national picture
  const NAT = {
    crops: 311.541e6,       // NASS principal crops planted, 2025
    corn: 98.788e6,         // corn planted, all purposes, 2025
    cornProd: 17.0205e9,    // bu, 2025
    cornYield: 186.5,
    ethBu: 5.6e9,           // WASDE 2025/26 corn for ethanol
    ddgsShare: 15.5 / 56,   // share of each bushel's mass returned as distillers grains
    ethGal: 16.49e9,        // 2025 fuel ethanol production
    solarGWac: 150,         // ~122 GW end-2024 (31 GW = +34%) + 27.7 GW in 2025
    solarTWh: 296,          // EIA, utility-scale 2025
    roofTWh: 93,            // EIA, small-scale (rooftop) 2025
    roofYield: 1250,        // kWh per kWdc per year, typical U.S. rooftop (assumption)
  };
  P.acresMw = 6; DEFAULTS.acresMw = 6;
  const amw = $("#p_acresMw");
  amw.addEventListener("input", () => { P.acresMw = +amw.value; renderNational(); });

  function renderNational() {
    amw.value = P.acresMw;
    $("#o_acresMw").textContent = nf(P.acresMw, 1) + " acres";
    const ethShare = NAT.ethBu / NAT.cornProd;
    const ethAcres = NAT.corn * ethShare, netEth = ethAcres * (1 - NAT.ddgsShare);
    const solarAcres = NAT.solarGWac * 1000 * P.acresMw;
    // miles
    const ethMiles = (NAT.ethGal * ETH_BTU * (state.net ? 1 - 1 / P.eroiEth : 1)) / (E10_BTU / P.mpg);
    const chain = (1 - P.td / 100) * (1 - (P.storShare / 100) * (1 - P.storRte / 100)) * (state.net ? Math.max(0, 1 - P.payback / P.life) : 1);
    const solarMiles = (NAT.solarTWh * 1e9 * chain * (P.chg / 100 / EPA_CHG)) / (P.kwh100 / 100);

    // nested squares, bottom-left anchored, area to scale
    const roofKwdc = (NAT.roofTWh * 1e9) / NAT.roofYield;
    const roofAcres = roofKwdc / MODULE_KW_M2 / ACRE_M2;               // panel area on roofs
    const roofLandEq = (NAT.roofTWh / NAT.solarTWh) * solarAcres;      // land a ground plant would need
    const S = 552, pad = 4, W = S + pad * 2 + 150, H = S + pad * 2;
    const side = (a) => S * Math.sqrt(a / NAT.crops);
    const sq = [
      ["All principal crops", NAT.crops, "color-mix(in srgb, var(--line) 60%, transparent)", "var(--muted)"],
      ["Corn", NAT.corn, "color-mix(in srgb, var(--corn) 22%, var(--surface))", "var(--corn)"],
      ["Corn for ethanol", ethAcres, "color-mix(in srgb, var(--corn) 55%, var(--surface))", "var(--corn)"],
      ["…net of feed returned", netEth, "var(--corn)", "var(--corn)"],
    ];
    let h = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nested squares sized by acreage: principal crops ${sig(NAT.crops)} acres, corn ${sig(NAT.corn)}, corn for ethanol ${sig(ethAcres)}, solar ${sig(solarAcres)}">`;
    sq.forEach(([n, a, fill, stroke], i) => {
      const d = side(a);
      h += `<rect x="${pad}" y="${pad + S - d}" width="${d}" height="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${i === 0 ? 1 : 1.2}" ${i === 0 ? 'stroke-dasharray="4 3"' : ""} rx="2"/>`;
    });
    const labels = [[NAT.crops, "All principal crops planted", NAT.crops], [NAT.corn, "Corn", NAT.corn]];
    labels.forEach(([a, n, v]) => {
      const d = side(a);
      h += `<text x="${pad + d - 8}" y="${pad + S - d + 18}" text-anchor="end">${n}<tspan class="v" x="${pad + d - 8}" dy="14">${nf(v / 1e6, 1)}M acres</tspan></text>`;
    });
    const dn = side(netEth);
    h += `<text x="${pad + 10}" y="${pad + S - dn + 20}" style="fill:var(--surface)">Corn for ethanol<tspan x="${pad + 10}" dy="17" style="font:400 13px var(--mono);fill:var(--surface)">${nf(ethAcres / 1e6, 1)}M acres</tspan><tspan x="${pad + 10}" dy="16" style="font:400 13px var(--mono);fill:var(--surface)">${nf(netEth / 1e6, 1)}M net of feed</tspan></text>`;
    // solar square, placed to the right of the ethanol square
    const ds = side(solarAcres), de = side(ethAcres);
    const sx = pad + de + 26, sy = pad + S - ds;
    h += `<rect x="${sx}" y="${sy}" width="${Math.max(ds, 1)}" height="${Math.max(ds, 1)}" fill="var(--sun)" rx="1"/>`;
    h += `<line x1="${sx + ds / 2}" y1="${sy - 4}" x2="${sx + ds / 2}" y2="${sy - 40}" stroke="var(--sun)"/>`;
    h += `<text x="${sx + ds / 2 + 6}" y="${sy - 30}">Utility-scale solar<tspan class="v" x="${sx + ds / 2 + 6}" dy="14">${nf(solarAcres / 1e6, 2)}M acres</tspan></text>`;
    // rooftop solar, outside the land: panel area, dashed
    const dr = side(roofAcres), rx = pad + S + 24, ry = pad + S - dr;
    h += `<rect x="${rx}" y="${ry}" width="${Math.max(dr, 1)}" height="${Math.max(dr, 1)}" fill="color-mix(in srgb, var(--sun) 25%, transparent)" stroke="var(--sun)" stroke-dasharray="2 2" rx="1"/>`;
    h += `<line x1="${rx + dr / 2}" y1="${ry - 4}" x2="${rx + dr / 2}" y2="${ry - 64}" stroke="var(--sun)" stroke-dasharray="2 2"/>`;
    h += `<text x="${rx}" y="${ry - 124}">Rooftop solar<tspan class="v" x="${rx}" dy="16">${nf(roofAcres / 1e6, 2)}M acres</tspan><tspan class="v" x="${rx}" dy="16">of panels,</tspan><tspan class="v" x="${rx}" dy="16">on roofs</tspan></text>`;
    h += "</svg>";
    $("#natSquares").innerHTML = h;
    $("#natLegend").innerHTML = [
      ["color-mix(in srgb, var(--line) 60%, transparent)", "All principal crops planted, 2025", NAT.crops],
      ["color-mix(in srgb, var(--corn) 22%, var(--surface))", "Corn planted (grain and silage)", NAT.corn],
      ["color-mix(in srgb, var(--corn) 55%, var(--surface))", `Corn for ethanol, ${pct(ethShare)} of the crop`, ethAcres],
      ["var(--corn)", `Same, minus the ${pct(NAT.ddgsShare)} returned as cattle feed`, netEth],
      ["var(--sun)", `Utility-scale solar, ~${NAT.solarGWac} GWac × ${nf(P.acresMw, 1)} acres/MW`, solarAcres],
      ["color-mix(in srgb, var(--sun) 25%, transparent)", `Rooftop solar panel area (on roofs, not cropland); a ground plant making the same ${NAT.roofTWh} TWh would need ${nf(roofLandEq / 1e6, 2)}M acres`, roofAcres],
    ].map(([c, n, v]) => `<li><i style="background:${c}"></i><span>${n}</span><b>${nf(v / 1e6, v < 1e6 ? 2 : 1)}M</b></li>`).join("");

    const maxA = ethAcres, maxM = Math.max(ethMiles, solarMiles), maxD = Math.max(ethMiles / ethAcres, solarMiles / solarAcres);
    const bar = (lab, v, max, col, txt) => `<div class="nb-row"><span>${lab}</span><div class="tr"><span style="width:${Math.max(0.4, (v / max) * 100)}%;background:${col}"></span></div><b>${txt}</b></div>`;
    $("#natBars").innerHTML = `
      <div class="nb"><div class="nb-h"><span>Corn ethanol</span><b>${nf(NAT.ethGal / 1e9, 1)}B gal</b></div>
        ${bar("Land", ethAcres, maxA, "var(--corn)", nf(ethAcres / 1e6, 1) + "M ac")}
        ${bar("Miles", ethMiles, maxM, "var(--corn)", nf(ethMiles / 1e9) + "B mi")}
        ${bar("Per acre", ethMiles / ethAcres, maxD, "var(--corn)", sig(ethMiles / ethAcres) + " mi")}</div>
      <div class="nb"><div class="nb-h"><span>Utility-scale solar</span><b>${NAT.solarTWh} TWh</b></div>
        ${bar("Land", solarAcres, maxA, "var(--sun)", nf(solarAcres / 1e6, 2) + "M ac")}
        ${bar("Miles", solarMiles, maxM, "var(--sun)", nf(solarMiles / 1e9) + "B mi")}
        ${bar("Per acre", solarMiles / solarAcres, maxD, "var(--sun)", sig(solarMiles / solarAcres) + " mi")}</div>
      <div class="nat-call">Solar farms use <b>${pct(solarAcres / ethAcres)}</b> as much land as ethanol corn (${nf(ethAcres / solarAcres)}× less) yet their 2025 output could drive <b>${nf(solarMiles / ethMiles, 1)}×</b> as many EV miles as all U.S. ethanol drove gasoline-car miles.</div>`;
    $("#natNotes").textContent =
      `Corn acreage and production: NASS 2025. Ethanol share: 5.6 billion of 17.0 billion bushels (USDA WASDE 2025/26 projection) applied to planted acres; exported ethanol is included. ` +
      `Solar capacity is estimated (about 122 GWac at the end of 2024 plus 27.7 GW built in 2025) and its land uses the slider; rooftop solar's square is the panel area, from EIA's 93 TWh of small-scale generation at about 1,250 kWh per kW and 20%-efficient panels; it sits on existing roofs and is left out of the miles. ` +
      `Solar miles use 2025 utility-scale generation (EIA, 296 TWh) through the same grid, storage and charging losses as above; plants built late in 2025 contributed only part of a year, so per-acre solar is slightly understated. ` +
      `For scale, the contiguous U.S. covers about 1.9 billion acres.`;
  }

  // ---------- sankeys
  const GRAIN_KWH_BU = (56 * 0.845 * 0.45359 * 16.6) / 3.6; // dry matter x ~16.6 MJ/kg LHV, ~99 kWh/bu
  const C = {
    corn: "var(--corn)", co: "color-mix(in srgb, var(--corn) 50%, var(--bg))", fossil: "#8a7f6c",
    sun: "var(--sun)", stor: "color-mix(in srgb, var(--sun) 55%, var(--bg))", loss: "var(--loss)",
    cw: "color-mix(in srgb, var(--corn) 60%, var(--ink))", sw: "color-mix(in srgb, var(--sun) 60%, var(--ink))",
  };

  function cornGraph(m) {
    const G = m.bu * GRAIN_KWH_BU, E = m.ethKwh, ferm = E * 0.05;
    const D = Math.max(0, G - E - ferm);
    const F = E / P.eroiEth, Ff = F * 0.25, Fm = F * 0.70, Ft = F * 0.05;
    const W = E * ICE_DRIVE;
    return {
      cols: ["Inputs", "Dry mill", "Products", "Car", "Result"],
      nodes: [
        { id: "grain", name: "Energy in the grain", col: 0, c: C.corn },
        { id: "gas", name: "Natural gas & power", col: 0, c: C.fossil },
        { id: "farm", name: "Farm fuel, fertilizer & hauling", col: 0, c: C.fossil },
        { id: "mill", name: "Dry-grind mill", col: 1, c: C.corn },
        { id: "eth", name: "Ethanol", col: 2, c: C.corn },
        { id: "ddgs", name: "Distillers grains & oil (feed)", col: 2, c: C.co },
        { id: "heat", name: "Cooking, distilling & drying heat", col: 2, c: C.loss },
        { id: "spent", name: "Used growing & hauling", col: 2, c: C.loss },
        { id: "engine", name: "Gasoline engine (as E10)", col: 3, c: C.corn },
        { id: "wheels", name: "Energy at the wheels", col: 4, c: C.cw },
        { id: "exh", name: "Exhaust & engine heat", col: 4, c: C.loss },
      ],
      links: [
        ["grain", "mill", G, C.corn], ["gas", "mill", Fm, C.fossil],
        ["farm", "spent", Ff + Ft, C.fossil],
        ["mill", "eth", E, C.corn], ["mill", "ddgs", D, C.co], ["mill", "heat", Fm + ferm, C.loss],
        ["eth", "engine", E, C.corn], ["engine", "wheels", W, C.cw], ["engine", "exh", E - W, C.loss],
      ],
      ref: G + F,
    };
  }

  function sunGraph(m) {
    const st = Object.fromEntries(m.steps.map((x) => [x.name, x]));
    const A = m.acKwh, ag = st["Panel aging"], td = st["Grid transmission & distribution"], sb = st["Grid battery time-shift"];
    const bd = st["Energy to build the plant"], ch = st["Charger & battery charging"], dr = st["Motor, inverter, drivetrain"];
    const onGrid = td.before; // after aging (and nothing else yet)
    const delivered = td.after;
    const share = P.storShare / 100;
    const toBatt = delivered * share, direct = delivered - toBatt, battOut = toBatt * (P.storRte / 100);
    const nodes = [
      { id: "plant", name: "Plant output (year 1)", col: 0, c: C.sun },
      { id: "grid", name: "Onto the grid", col: 1, c: C.sun },
      { id: "aging", name: "Lost to panel aging", col: 1, c: C.loss },
      { id: "direct", name: "Straight to chargers", col: 2, c: C.sun },
      { id: "batt", name: "Grid battery", col: 2, c: C.stor },
      { id: "tdl", name: "Line & transformer loss", col: 2, c: C.loss },
      { id: "wall", name: "At the wall plug", col: 3, c: C.sun },
      { id: "battl", name: "Battery round-trip loss", col: 3, c: C.loss },
      { id: "ev", name: "EV battery", col: 4, c: C.sun },
      { id: "chl", name: "Charging loss", col: 4, c: C.loss },
      { id: "wheels", name: "Energy at the wheels", col: 5, c: C.sw },
      { id: "drl", name: "Motor & drivetrain loss", col: 5, c: C.loss },
    ];
    const links = [
      ["plant", "grid", onGrid, C.sun], ["plant", "aging", A - onGrid, C.loss],
      ["grid", "direct", direct, C.sun], ["grid", "tdl", onGrid - delivered, C.loss],
      ["direct", "wall", direct, C.sun], ["batt", "wall", battOut, C.stor], ["batt", "battl", toBatt - battOut, C.loss],
      ["wall", "ev", ch.after, C.sun], ["wall", "chl", ch.before - ch.after, C.loss],
      ["ev", "wheels", dr.after, C.sw], ["ev", "drl", dr.before - dr.after, C.loss],
    ];
    if (share > 0) links.splice(2, 0, ["grid", "batt", toBatt, C.stor]);
    if (bd) {
      // building energy repaid out of what reaches the wall
      nodes.push({ id: "build", name: "Repays energy to build plant", col: 4, c: C.loss });
      links.push(["wall", "build", bd.before - bd.after, C.loss]);
    }
    return { cols: ["Plant", "Grid", "Delivery", "Charger", "Car", "Result"], nodes, links: links.filter((l) => l[2] > 1e-6), ref: A };
  }

  function drawSankey(el, g) {
    if (!window.d3 || !d3.sankey) { el.innerHTML = '<p class="note">Sankey library did not load.</p>'; return; }
    const W = Math.max(640, el.clientWidth || 900), labelW = W < 760 ? 150 : 190;
    const ncol = g.cols.length;
    const H = 360, top = 22;
    const used = new Set(g.links.flatMap((l) => [l[0], l[1]]));
    const nodes = g.nodes.filter((n) => used.has(n.id)).map((n) => ({ ...n }));
    const links = g.links.map(([source, target, value, c]) => ({ source, target, value, c }));
    const sk = d3.sankey().nodeId((d) => d.id).nodeAlign((n) => n.col).nodeWidth(12).nodePadding(18)
      .nodeSort(null).linkSort(null).extent([[1, top], [W - labelW, H - 2]]);
    const { nodes: N, links: L } = sk({ nodes, links });
    const path = d3.sankeyLinkHorizontal();
    const fmt = (v) => mwh(v);
    let h = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sankey diagram of energy flows">`;
    const colX = {};
    N.forEach((n) => (colX[n.col] = n.x0));
    g.cols.forEach((c, i) => { if (colX[i] != null) h += `<text class="col-h" x="${colX[i]}" y="11">${c}</text>`; });
    for (const l of L) {
      h += `<path class="lnk" d="${path(l)}" stroke="${l.c}" stroke-width="${Math.max(1, l.width)}"><title>${l.source.name} → ${l.target.name}: ${fmt(l.value)} (${pct(l.value / g.ref)})</title></path>`;
    }
    for (const n of N) {
      const hgt = Math.max(1, n.y1 - n.y0);
      const v = Math.max(n.value, 0);
      const ty = Math.min(H - 16, Math.max(top + 10, (n.y0 + n.y1) / 2 - 3));
      h += `<g class="nd"><rect x="${n.x0}" y="${n.y0}" width="${n.x1 - n.x0}" height="${hgt}" fill="${n.c}" rx="2"><title>${n.name}: ${fmt(v)}</title></rect>`;
      h += `<text x="${n.x1 + 6}" y="${ty}">${n.name}<tspan class="v" x="${n.x1 + 6}" dy="14">${fmt(v)} · ${pct(v / g.ref)}</tspan></text></g>`;
    }
    el.innerHTML = h + "</svg>";
  }

  function renderSankeys(s, m) {
    const cg = cornGraph(m), sg = sunGraph(m);
    $("#cornSkNote").textContent =
      `Per acre per year, in MWh. The grain holds ${mwh(m.bu * GRAIN_KWH_BU)} of chemical energy (${pct((m.bu * GRAIN_KWH_BU) / m.sunKwh)} of the sunlight on the acre). ` +
      `About ${mwh(m.ethKwh / P.eroiEth)} of fossil energy goes in alongside it. Percentages are of all energy going in. Ethanol is blended 1:9 with gasoline; the gasoline is not shown.`;
    $("#sunSkNote").textContent =
      `Per acre per year, lifetime average, in MWh. The plant turns ${pct(m.acKwh / m.sunKwh)} of the acre's sunlight into AC power. Percentages are of that output. ` +
      `${P.storShare}% is time-shifted through a grid battery for overnight charging.`;
    drawSankey($("#cornSankey"), cg);
    drawSankey($("#sunSankey"), sg);
  }

  function renderStates() {
    const rows = STATES.map((s) => { const m = model(s); return { s, c: m.cornMiles, u: m.sunMiles, r: m.sunMiles / m.cornMiles }; });
    const k = state.sort;
    rows.sort((a, b) => k === "name" ? a.s.name.localeCompare(b.s.name) : k === "corn" ? b.c - a.c : k === "sun" ? b.u - a.u : b.r - a.r);
    const minV = Math.min(...rows.map((r) => r.c)), maxV = Math.max(...rows.map((r) => r.u));
    const lo = minV / 1.35, hi = maxV * 1.35;
    const ticks = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7].filter((v) => v >= lo && v <= hi);
    const el = $("#states");
    const W = Math.max(160, Math.round(el.clientWidth - (innerWidth <= 720 ? 168 : 220)));
    const x = (v) => 6 + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - 12);
    const tl = (v) => (v >= 1e6 ? v / 1e6 + "M" : v / 1e3 + "k");
    let h = `<div class="hd">State · miles</div><div class="hd"><svg viewBox="0 0 ${W} 16" class="st-axis" style="width:100%;height:auto">`;
    for (const v of ticks) h += `<text x="${x(v)}" y="11" text-anchor="middle">${tl(v)}</text>`;
    h += `</svg></div><div class="hd r">×</div>`;
    for (const r of rows) {
      const grid = ticks.map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="0" y2="16" stroke="var(--line)"/>`);
      h += `<div class="st${r.s.ab === state.ab ? " sel" : ""}" data-ab="${r.s.ab}" title="${r.s.name}: corn ${sig(r.c)} mi, solar ${sig(r.u)} mi">
        <div class="nm">${r.s.name}</div>
        <div><svg viewBox="0 0 ${W} 16">${grid.join("")}
          <line x1="${x(r.c)}" x2="${x(r.u)}" y1="8" y2="8" stroke="var(--line)" stroke-width="3"/>
          <circle cx="${x(r.c)}" cy="8" r="5" fill="var(--corn)"/><circle cx="${x(r.u)}" cy="8" r="5" fill="var(--sun)"/></svg></div>
        <div class="rt">${nf(r.r)}</div></div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll(".st").forEach((d) => d.addEventListener("click", () => {
      state.ab = d.dataset.ab; sel.value = state.ab; setHash(); render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
  }

  renderArt();
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 150); });
  render();
})();
