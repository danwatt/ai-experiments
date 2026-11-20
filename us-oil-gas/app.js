(() => {
  const D = window.DATA;
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem("wtw-" + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem("wtw-" + k, v); } catch { /* private mode */ } },
  };

  // ---------- months ----------
  const toM = (s) => { const [y, m] = s.split("-").map(Number); return y * 12 + m - 1; };
  const fromM = (m) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = (m) => `${MON[m % 12]} ${Math.floor(m / 12)}`;
  const mDate = (m) => new Date(Math.floor(m / 12), m % 12, 15);
  const at = (s, m) => { if (!s) return null; const i = m - toM(s.start); return i < 0 || i >= s.v.length ? null : s.v[i]; };
  const LAST = toM(D.meta.last);
  const sumAt = (list, m) => { let t = 0, any = false; for (const s of list) { const v = at(s, m); if (v != null) { t += v; any = true; } } return any ? t : null; };

  // ---------- state ----------
  const S = {
    fuel: store.get("fuel") === "gas" ? "gas" : "oil",
    theme: store.get("theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
    m: LAST, sel: null, range: "all", overlay: "none", basinMode: "prod", expKind: null, playing: null,
    show: { exp: true, imp: true }, dir: "exp",
  };
  const FIRST = { oil: toM("1981-01"), gas: toM("1989-01") };

  const RAMPS = {
    dark: { oil: ["#3A2A18", "#5E3D1A", "#8C561C", "#BF7520", "#F2A33A", "#FFD27A"],
            gas: ["#16283A", "#1C3F63", "#245B8F", "#2F7BC4", "#5BA8FF", "#A9D4FF"] },
    light: { oil: ["#F3DDB6", "#EBC27F", "#DD9A45", "#BE741C", "#8F5210", "#5A3208"],
             gas: ["#D7E8F8", "#A9CDEF", "#76ACE2", "#3F86CC", "#1F5E9E", "#0E3A66"] },
  };
  // thresholds: oil kb/d, gas MMcf/d
  const BREAKS = { oil: [1, 20, 100, 300, 800, 2000], gas: [10, 150, 600, 2000, 6000, 16000] };
  const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const NAMES = { AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut",
    DC: "D.C.", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota",
    MO: "Missouri", MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia",
    VT: "Vermont", WA: "Washington", WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
    GOM: "Federal offshore Gulf", PAC: "Federal offshore Pacific" };
  const TILES = [["AK",0,0],["ME",11,0],["VT",10,1],["NH",11,1],
    ["WA",1,2],["ID",2,2],["MT",3,2],["ND",4,2],["MN",5,2],["IL",6,2],["WI",7,2],["MI",8,2],["NY",9,2],["RI",10,2],["MA",11,2],
    ["OR",1,3],["NV",2,3],["WY",3,3],["SD",4,3],["IA",5,3],["IN",6,3],["OH",7,3],["PA",8,3],["NJ",9,3],["CT",10,3],
    ["PAC",0,4],["CA",1,4],["UT",2,4],["CO",3,4],["NE",4,4],["MO",5,4],["KY",6,4],["WV",7,4],["VA",8,4],["MD",9,4],["DE",10,4],
    ["AZ",2,5],["NM",3,5],["KS",4,5],["AR",5,5],["TN",6,5],["NC",7,5],["SC",8,5],["DC",9,5],
    ["OK",4,6],["LA",5,6],["MS",6,6],["AL",7,6],["GA",8,6],
    ["HI",0,7],["TX",4,7],["GOM",6,7],["FL",9,7]];

  // ---------- units ----------
  const U = {
    oil: { big: (v) => v / 1000, bigUnit: "mb/d", small: "kb/d", name: "Crude oil", price: "WTI", priceUnit: "$/bbl" },
    gas: { big: (v) => v / 1000, bigUnit: "Bcf/d", small: "MMcf/d", name: "Natural gas", price: "Henry Hub", priceUnit: "$/MMBtu" },
  };
  const fmtSmall = (v) => v == null ? "—" : v >= 1000 ? d3.format(",.0f")(v) : v >= 10 ? d3.format(".0f")(v) : d3.format(".1f")(v);
  const fmtBig = (v) => v == null ? "—" : (v / 1000).toFixed(v >= 10000 ? 1 : 2);
  const fmtV = (v) => v == null ? "—" : v >= 1000 ? `${fmtBig(v)} ${U[S.fuel].bigUnit}` : `${fmtSmall(v)} ${U[S.fuel].small}`;

  // ---------- tooltip ----------
  const tip = $("#tip");
  const showTip = (html, e) => {
    tip.innerHTML = html; tip.style.opacity = 1;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  };
  const hideTip = () => { tip.style.opacity = 0; };

  // ---------- data accessors by fuel ----------
  const prod = () => D[S.fuel];
  const exportsTotal = (m) => S.fuel === "oil" ? at(D.trade.crudeExp, m) : sumAt([D.trade.lngExp, D.trade.pipelineExp], m);
  const priceS = () => S.fuel === "oil" ? D.prices.wti : D.prices.hh;
  const rigList = () => Object.values(D.basins.rigs);

  // ---------- KPIs ----------
  function kpis() {
    const m = S.m, u = U[S.fuel], us = prod().US;
    const v = at(us, m), y = at(us, m - 12);
    const yoy = v != null && y ? (v / y - 1) * 100 : null;
    const ex = exportsTotal(m);
    const price = at(priceS(), m);
    const rigs = sumAt(rigList(), m);
    let tiles;
    const exNote = S.fuel === "oil" ? "crude only" : (() => { const l = at(D.trade.lngExp, m); return l != null && ex ? `${Math.round(l / ex * 100)}% as LNG` : ""; })();
    let third;
    if (S.fuel === "oil") {
      const te = at(D.trade.totalExp, m), ti = at(D.trade.totalImp, m);
      const net = te != null && ti != null ? te - ti : null;
      third = { cap: "Net petroleum trade", val: net == null ? "—" : (net >= 0 ? "+" : "−") + (Math.abs(net) / 1000).toFixed(2), unit: " mb/d",
        note: net == null ? "" : net >= 0 ? "net exporter" : "net importer", cls: net == null ? "" : net >= 0 ? "up" : "down" };
    } else {
      const gi = sumAt([D.trade.lngImp, D.trade.pipelineImp], m);
      const net = ex != null && gi != null ? ex - gi : null;
      third = { cap: "Net gas trade", val: net == null ? "—" : (net >= 0 ? "+" : "−") + (Math.abs(net) / 1000).toFixed(1), unit: " Bcf/d",
        note: net == null ? "" : net >= 0 ? "net exporter" : "net importer", cls: net == null ? "" : net >= 0 ? "up" : "down" };
    }
    tiles = [
      { cap: `${u.name} output`, val: v == null ? "—" : fmtBig(v), unit: " " + u.bigUnit, fuel: true, note: label(m) },
      { cap: "vs year ago", val: yoy == null ? "—" : (yoy >= 0 ? "+" : "−") + Math.abs(yoy).toFixed(1) + "%", unit: "",
        cls: yoy == null ? "" : yoy >= 0 ? "up" : "down", note: y == null ? "" : fmtV(y) },
      { cap: S.fuel === "oil" ? "Crude exports" : "Gas exports", val: ex == null ? "—" : fmtBig(ex), unit: " " + u.bigUnit, note: exNote },
      third,
      { cap: u.price, val: price == null ? "—" : "$" + price.toFixed(2), unit: "", note: price == null ? "before series" : u.priceUnit },
      { cap: "Shale rigs", val: rigs == null ? "—" : Math.round(rigs), unit: "", note: rigs == null ? "series starts 2013" : "STEO regions" },
    ];
    $("#kpis").innerHTML = tiles.map((t) => `<div class="panel kpi"><p class="cap">${t.cap}</p>
      <div class="val ${t.fuel ? "fuel" : ""} ${t.cls || ""}">${t.val}<span class="unit">${t.unit}</span></div>
      <div class="note">${t.note || ""}</div></div>`).join("");
  }

  // ---------- tile map ----------
  const TW = 48, TH = 44, GAP = 4;
  const tm = d3.select("#tilemap").attr("viewBox", `0 0 ${12 * (TW + GAP)} ${8 * (TH + GAP)}`);
  const tileG = tm.selectAll("g").data(TILES).join("g").attr("transform", (d) => `translate(${d[1] * (TW + GAP)},${d[2] * (TH + GAP)})`);
  tileG.append("rect").attr("class", "tile").attr("width", TW).attr("height", TH).attr("rx", 3)
    .attr("stroke-dasharray", (d) => d[0].length === 3 ? "4 3" : null);
  tileG.append("text").attr("x", TW / 2).attr("y", TH / 2 - 2).attr("text-anchor", "middle").text((d) => d[0] === "GOM" ? "Gulf" : d[0] === "PAC" ? "Pac" : d[0]);
  tileG.append("text").attr("class", "tv").attr("x", TW / 2).attr("y", TH / 2 + 12).attr("text-anchor", "middle").style("font-size", "10px");
  tileG.on("mousemove", (e, d) => {
    const v = at(prod()[d[0]], S.m), us = at(prod().US, S.m);
    showTip(`<b>${NAMES[d[0]]}</b><br>${label(S.m)}: ${v == null ? "no data" : fmtV(v)}${v && us ? `<br>${(v / us * 100).toFixed(1)}% of US` : ""}`, e);
  }).on("mouseleave", hideTip).on("click", (e, d) => { S.sel = S.sel === d[0] ? null : d[0]; mapView(); });

  const colorOf = (v) => {
    const r = RAMPS[S.theme][S.fuel], b = BREAKS[S.fuel];
    if (v == null || v < b[0] * 0.5) return cssv("--none");
    let i = 0; while (i < b.length - 1 && v >= b[i + 1]) i++;
    return r[i];
  };

  function legend() {
    const r = RAMPS[S.theme][S.fuel], b = BREAKS[S.fuel];
    $("#legend").innerHTML = `<i style="background:${cssv("--none")}"></i><span>none</span>` +
      r.map((c, i) => `<i style="background:${c}"></i><span>${i === r.length - 1 ? b[i] + "+" : b[i]}</span>`).join("") +
      `<span>${U[S.fuel].small}</span>`;
  }

  function mapView() {
    const m = S.m, P = prod(), r = RAMPS[S.theme][S.fuel];
    tileG.select("rect").attr("fill", (d) => colorOf(at(P[d[0]], m))).classed("sel", (d) => d[0] === S.sel);
    tileG.selectAll("text").attr("fill", (d) => {
      const c = colorOf(at(P[d[0]], m));
      const dark = S.theme === "dark";
      const bright = r.indexOf(c) >= 4;
      return dark ? (bright ? "#0E0D0B" : cssv("--ink")) : (r.indexOf(c) >= 3 ? "#FBF7EE" : cssv("--ink"));
    });
    tileG.select(".tv").text((d) => { const v = at(P[d[0]], m); return v == null || v < BREAKS[S.fuel][0] * .5 ? "" : v >= 10 ? Math.round(v) : v.toFixed(1); });

    const us = at(P.US, m);
    const rows = Object.keys(P).filter((k) => k !== "US").map((k) => [k, at(P[k], m)]).filter((d) => d[1] != null && d[1] > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = rows.length ? rows[0][1] : 1;
    $("#top-cap").textContent = `Top producers · ${label(m)}`;
    $("#toplist").innerHTML = rows.length ? rows.map(([k, v]) => `<div class="row ${k === S.sel ? "sel" : ""}" data-k="${k}">
      <span class="nm">${NAMES[k].replace("Federal offshore ", "Offshore ")}</span>
      <div><div class="bar" style="width:${(v / max) * 100}%"></div></div>
      <span class="v">${us ? (v / us * 100).toFixed(0) + "%" : ""}</span></div>`).join("") : `<p class="empty">No state data this month.</p>`;
    document.querySelectorAll("#toplist .row").forEach((el) => el.onclick = () => { S.sel = S.sel === el.dataset.k ? null : el.dataset.k; mapView(); });
    $("#map-sub").textContent = S.fuel === "oil"
      ? "Crude field production, thousand barrels a day. Click a tile for its history."
      : "Marketed natural gas production, million cubic feet a day. Click a tile for its history.";
    detail();
  }

  function detail() {
    const k = S.sel || "US", s = prod()[k], el = $("#detail");
    if (!s) { el.innerHTML = `<p class="cap">${NAMES[k] || k}</p><p class="empty">No ${S.fuel} production reported.</p>`; return; }
    const v = at(s, S.m);
    const vals = s.v.filter((x) => x != null), peak = d3.max(vals), pi = s.v.indexOf(peak);
    el.innerHTML = `<p class="cap">${k === "US" ? "United States" : NAMES[k]} · since ${s.start.slice(0, 4)}</p>
      <div class="hd">${fmtV(v)}</div>
      <svg id="spark" viewBox="0 0 300 70" preserveAspectRatio="none"></svg>
      <p class="cap" style="margin-top:4px">Peak ${fmtV(peak)} · ${label(toM(s.start) + pi)}</p>`;
    const x0 = Math.max(toM(s.start), FIRST[S.fuel] - (k === "US" ? 0 : 0));
    const pts = []; for (let m = x0; m <= LAST; m++) pts.push([m, at(s, m)]);
    const x = d3.scaleLinear([x0, LAST], [0, 300]), y = d3.scaleLinear([0, peak || 1], [68, 4]);
    const g = d3.select("#spark");
    g.append("path").attr("d", d3.area().defined((d) => d[1] != null).x((d) => x(d[0])).y0(68).y1((d) => y(d[1]))(pts))
      .attr("fill", "var(--fuel)").attr("opacity", .15);
    g.append("path").attr("d", d3.line().defined((d) => d[1] != null).x((d) => x(d[0])).y((d) => y(d[1]))(pts))
      .attr("fill", "none").attr("stroke", "var(--fuel)").attr("stroke-width", 1.5).attr("vector-effect", "non-scaling-stroke");
    if (S.m >= x0) g.append("line").attr("x1", x(S.m)).attr("x2", x(S.m)).attr("y1", 0).attr("y2", 70)
      .attr("stroke", "var(--flare)").attr("stroke-width", 1).attr("vector-effect", "non-scaling-stroke");
  }

  // ---------- slider / play ----------
  const slider = $("#slider");
  function setupSlider() {
    slider.min = FIRST[S.fuel]; slider.max = LAST;
    if (S.m < FIRST[S.fuel]) S.m = FIRST[S.fuel];
    slider.value = S.m;
    $("#min-label").textContent = Math.floor(FIRST[S.fuel] / 12);
  }
  slider.addEventListener("input", () => { S.m = +slider.value; stop(); monthChanged(); });
  const playIco = $("#play-ico");
  function stop() {
    if (!S.playing) return;
    clearInterval(S.playing); S.playing = null;
    playIco.innerHTML = '<path d="M7 4v16l13-8z"/>'; $("#play").setAttribute("aria-label", "Play");
  }
  $("#play").onclick = () => {
    if (S.playing) return stop();
    if (S.m >= LAST) S.m = FIRST[S.fuel];
    playIco.innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'; $("#play").setAttribute("aria-label", "Pause");
    S.playing = setInterval(() => {
      S.m = Math.min(LAST, S.m + 1); slider.value = S.m; monthChanged();
      if (S.m >= LAST) stop();
    }, 70);
  };

  // ---------- national history ----------
  const H = { w: 1100, h: 360, l: 46, r: 56, t: 34, b: 26 };
  const hist = d3.select("#hist");
  const ANN = {
    oil: [["1970-11", "1970 peak"], ["1975-12", "Export ban"], ["2008-09", "Hurricane Ike"],
      ["2015-12", "Ban lifted"], ["2020-05", "COVID"], [null, "record"]],
    gas: [["1986-09", "1980s glut"], ["2005-09", "Katrina, Rita"], ["2008-07", "Shale boom"], ["2016-02", "First Lower 48 LNG"],
      ["2020-05", "COVID"], [null, "record"]],
  };
  function histView() {
    hist.selectAll("*").remove();
    const u = U[S.fuel], us = prod().US;
    let x0 = toM(us.start);
    if (S.range === "1981") x0 = Math.max(x0, toM("1981-01"));
    if (S.range === "2005") x0 = toM("2005-01");
    const x = d3.scaleTime([mDate(x0), mDate(LAST)], [H.l, H.w - H.r]);
    const series = [{ key: "prod", s: us, color: "var(--fuel)", width: 2.2, name: S.fuel === "oil" ? "Crude production" : "Marketed production" }];
    if (S.fuel === "oil") {
      if (S.show.exp) series.push({ key: "exp", s: D.trade.crudeExp, color: "var(--ink)", width: 1.4, name: "Crude exports" });
      if (S.show.imp) series.push({ key: "imp", s: D.trade.crudeImp, color: "var(--sand)", width: 1.2, dash: "2 2", name: "Crude imports" });
    } else if (S.show.exp) {
      series.push({ key: "exp", fn: (m) => sumAt([D.trade.lngExp, D.trade.pipelineExp], m), start: D.trade.lngExp.start, color: "var(--ink)", width: 1.4, name: "Exports (LNG + pipeline)" });
      series.push({ key: "lng", s: D.trade.lngExp, color: "var(--fuel-hot)", width: 1.2, dash: "2 2", name: "LNG exports" });
    }
    if (S.fuel === "gas" && S.show.imp) {
      series.push({ key: "imp", fn: (m) => sumAt([D.trade.lngImp, D.trade.pipelineImp], m), start: D.trade.lngImp.start, color: "var(--sand)", width: 1.2, dash: "2 2", name: "Imports" });
    }
    const pts = (sr) => { const out = []; const st = toM(sr.s ? sr.s.start : sr.start); for (let m = Math.max(x0, st); m <= LAST; m++) out.push([m, sr.s ? at(sr.s, m) : sr.fn(m)]); return out; };
    series.forEach((sr) => sr.pts = pts(sr));
    const ymax = d3.max(series.flatMap((sr) => sr.pts.map((p) => p[1] || 0)));
    const y = d3.scaleLinear([0, ymax * 1.08], [H.h - H.b, H.t]).nice();
    hist.append("g").attr("class", "grid").attr("transform", `translate(${H.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(H.w - H.l - H.r)).tickFormat((v) => (v / 1000).toString()));
    hist.append("g").attr("transform", `translate(0,${H.h - H.b})`).call(d3.axisBottom(x).ticks(10).tickSizeOuter(0));
    hist.append("text").attr("x", H.l - 6).attr("y", 12).attr("text-anchor", "end").text(u.bigUnit);

    // overlay on right axis
    let ov = null;
    if (S.overlay === "price") ov = { s: priceS(), color: "var(--flare)", unit: u.priceUnit, name: u.price + " price" };
    if (S.overlay === "rigs") ov = { fn: (m) => sumAt(rigList(), m), start: "2013-01", color: "var(--flare)", unit: "rigs", name: "Shale rigs" };
    if (ov) {
      const st = toM(ov.s ? ov.s.start : ov.start); const op = [];
      for (let m = Math.max(x0, st); m <= LAST; m++) op.push([m, ov.s ? at(ov.s, m) : ov.fn(m)]);
      const yr = d3.scaleLinear([0, d3.max(op, (p) => p[1]) * 1.08 || 1], [H.h - H.b, H.t]).nice();
      hist.append("g").attr("transform", `translate(${H.w - H.r},0)`).call(d3.axisRight(yr).ticks(5).tickSize(0).tickPadding(6));
      hist.append("text").attr("x", H.w - H.r + 6).attr("y", 12).text(ov.unit);
      hist.append("path").attr("d", d3.line().defined((d) => d[1] != null).x((d) => x(mDate(d[0]))).y((d) => yr(d[1]))(op))
        .attr("fill", "none").attr("stroke", ov.color).attr("stroke-width", 1).attr("stroke-dasharray", "4 3").attr("opacity", .8);
      ov.pts = op; ov.y = yr;
    }
    const main = series[0];
    hist.append("path").attr("d", d3.area().defined((d) => d[1] != null).x((d) => x(mDate(d[0]))).y0(y(0)).y1((d) => y(d[1]))(main.pts))
      .attr("fill", "var(--fuel)").attr("opacity", .1);
    series.slice().reverse().forEach((sr) => hist.append("path")
      .attr("d", d3.line().defined((d) => d[1] != null).x((d) => x(mDate(d[0]))).y((d) => y(d[1]))(sr.pts))
      .attr("fill", "none").attr("stroke", sr.color).attr("stroke-width", sr.width).attr("stroke-dasharray", sr.dash || null));

    // annotations: labels sit in rows along the top, with a leader down to the line
    const ann = hist.append("g").attr("class", "ann");
    const recM = toM(us.start) + us.v.indexOf(d3.max(us.v));
    const rowEnd = [-1e9, -1e9, -1e9];
    ANN[S.fuel].forEach(([p, txt]) => {
      const m = p ? toM(p) : recM;
      if (m < x0) return;
      const v = at(us, m); if (v == null) return;
      const cx = x(mDate(m)), cy = y(v);
      const text = p ? txt : `${txt} · ${fmtBig(v)}`;
      const w = text.length * 6.6 + 10;
      const anchorEnd = cx + w / 2 > H.w - H.r;
      const left = anchorEnd ? cx - w : cx - w / 2;
      let row = rowEnd.findIndex((e) => left > e);
      if (row < 0) row = 2;
      rowEnd[row] = left + w;
      const ty = H.t + 2 + row * 13;
      ann.append("line").attr("x1", cx).attr("x2", cx).attr("y1", ty + 3).attr("y2", cy - 4)
        .attr("stroke", "var(--pipe-2)").attr("stroke-dasharray", "1 2");
      ann.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 3).attr("fill", p ? "var(--fuel-hot)" : "var(--flare)");
      ann.append("text").attr("x", cx).attr("y", ty).attr("text-anchor", anchorEnd ? "end" : "middle")
        .style("fill", p ? null : "var(--flare)").text(text);
    });

    // selected month marker
    const mk = hist.append("line").attr("y1", H.t).attr("y2", H.h - H.b).attr("stroke", "var(--flare)").attr("stroke-width", 1).attr("opacity", .7);
    const placeMk = () => { const vis = S.m >= x0; mk.attr("x1", x(mDate(S.m))).attr("x2", x(mDate(S.m))).attr("display", vis ? null : "none"); };
    placeMk(); histView.placeMk = placeMk;

    // hover
    const hov = hist.append("line").attr("y1", H.t).attr("y2", H.h - H.b).attr("stroke", "var(--sand)").attr("stroke-dasharray", "2 3").attr("display", "none");
    hist.append("rect").attr("x", H.l).attr("y", H.t).attr("width", H.w - H.l - H.r).attr("height", H.h - H.t - H.b).attr("fill", "transparent")
      .style("cursor", "crosshair")
      .on("mousemove", (e) => {
        const [px] = d3.pointer(e); const d = x.invert(px); const m = d.getFullYear() * 12 + d.getMonth();
        hov.attr("x1", x(mDate(m))).attr("x2", x(mDate(m))).attr("display", null);
        const lines = series.map((sr) => { const v = sr.s ? at(sr.s, m) : sr.fn(m); return v == null ? "" : `<br>${sr.name}: ${fmtBig(v)} ${u.bigUnit}`; }).join("");
        const ovv = ov ? (ov.s ? at(ov.s, m) : ov.fn(m)) : null;
        showTip(`<b>${label(m)}</b>${lines}${ovv != null ? `<br>${ov.name}: ${ov.unit === "rigs" ? Math.round(ovv) : "$" + ovv.toFixed(2)}` : ""}${m >= FIRST[S.fuel] ? "<br><i>click to jump the map here</i>" : ""}`, e);
      })
      .on("mouseleave", () => { hov.attr("display", "none"); hideTip(); })
      .on("click", (e) => { const d = x.invert(d3.pointer(e)[0]); const m = d.getFullYear() * 12 + d.getMonth(); if (m >= FIRST[S.fuel] && m <= LAST) { S.m = m; stop(); slider.value = m; monthChanged(); } });

    // keys
    const chk = (k, on) => `<input type="checkbox" data-k="${k}" ${on ? "checked" : ""}>`;
    const keys = [`<span><span class="sw" style="border-color:var(--fuel);border-top-width:3px"></span> ${main.name}</span>`];
    if (S.fuel === "oil") {
      keys.push(`<label>${chk("exp", S.show.exp)}<span class="sw" style="border-color:var(--ink)"></span> Crude exports</label>`);
      keys.push(`<label>${chk("imp", S.show.imp)}<span class="sw" style="border-color:var(--sand);border-top-style:dotted"></span> Crude imports</label>`);
    } else {
      keys.push(`<label>${chk("exp", S.show.exp)}<span class="sw" style="border-color:var(--ink)"></span> Exports · <span style="color:var(--fuel-hot)">LNG dotted</span></label>`);
      keys.push(`<label>${chk("imp", S.show.imp)}<span class="sw" style="border-color:var(--sand);border-top-style:dotted"></span> Imports (mostly Canada)</label>`);
    }
    if (ov) keys.push(`<span><span class="sw" style="border-color:var(--flare);border-top-style:dashed;border-top-width:1px"></span> ${ov.name} (right axis)</span>`);
    $("#hist-keys").innerHTML = keys.join("");
    document.querySelectorAll("#hist-keys input").forEach((el) => el.onchange = () => { S.show[el.dataset.k] = el.checked; histView(); });
    $("#hist-sub").textContent = S.fuel === "oil"
      ? `Monthly since ${us.start.slice(0, 4)}. Exports were mostly banned from late 1975 to Dec 2015.`
      : `Monthly since ${us.start.slice(0, 4)}. Lower 48 LNG exports began at Sabine Pass in Feb 2016.`;
  }

  // ---------- basins ----------
  const B = { w: 560, h: 300, l: 40, r: 96, t: 24, b: 24 };
  const bas = d3.select("#basins");
  function basinView() {
    bas.selectAll("*").remove();
    const mode = S.basinMode === "rigs" ? "rigs" : S.fuel;
    const src = D.basins[mode], names = D.basins.names;
    const order = Object.keys(src).sort((a, b) => (a === "R48") - (b === "R48") || (src[b].v.at(-1) || 0) - (src[a].v.at(-1) || 0));
    const m0 = d3.min(order, (k) => toM(src[k].start));
    const rows = []; for (let m = m0; m <= LAST; m++) { const r = { m }; order.forEach((k) => r[k] = at(src[k], m) || 0); rows.push(r); }
    const stack = d3.stack().keys(order)(rows);
    const x = d3.scaleTime([mDate(m0), mDate(LAST)], [B.l, B.w - B.r]);
    const y = d3.scaleLinear([0, d3.max(stack.at(-1), (d) => d[1]) * 1.05], [B.h - B.b, B.t]).nice();
    const ramp = RAMPS[S.theme][S.fuel];
    const col = (k, i) => k === "R48" ? cssv("--pipe-2") : ramp[Math.max(0, ramp.length - 1 - i)];
    bas.append("g").attr("class", "grid").attr("transform", `translate(${B.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(B.w - B.l - B.r)).tickFormat((v) => mode === "rigs" ? v : (v / 1000).toString()));
    bas.append("g").attr("transform", `translate(0,${B.h - B.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
    bas.append("text").attr("x", B.l - 6).attr("y", 10).attr("text-anchor", "end").text(mode === "rigs" ? "rigs" : U[S.fuel].bigUnit);
    bas.selectAll(".layer").data(stack).join("path")
      .attr("d", d3.area().x((d) => x(mDate(d.data.m))).y0((d) => y(d[0])).y1((d) => y(d[1])))
      .attr("fill", (d, i) => col(d.key, i)).attr("stroke", cssv("--panel")).attr("stroke-width", .5);
    // end labels
    let prevY = B.h - B.b + 12;
    stack.forEach((layer) => {
      const last = layer.at(-1), mid = y((last[0] + last[1]) / 2);
      const ly = Math.min(mid, prevY - 12); prevY = ly;
      bas.append("text").attr("x", B.w - B.r + 6).attr("y", ly + 4).style("fill", "var(--ink)").text(names[layer.key].replace("Rest of Lower 48", "Rest of L48"));
    });
    const mk = bas.append("line").attr("y1", B.t).attr("y2", B.h - B.b).attr("stroke", "var(--flare)").attr("opacity", .7);
    const placeMk = () => mk.attr("x1", x(mDate(S.m))).attr("x2", x(mDate(S.m))).attr("display", S.m >= m0 ? null : "none");
    placeMk(); basinView.placeMk = placeMk;
    bas.append("rect").attr("x", B.l).attr("y", B.t).attr("width", B.w - B.l - B.r).attr("height", B.h - B.t - B.b).attr("fill", "transparent")
      .on("mousemove", (e) => {
        const d = x.invert(d3.pointer(e)[0]); const m = d.getFullYear() * 12 + d.getMonth(); const r = rows[m - m0]; if (!r) return;
        const tot = d3.sum(order, (k) => r[k]);
        showTip(`<b>${label(m)}</b>` + order.slice().map((k) => `<br>${names[k]}: ${mode === "rigs" ? Math.round(r[k]) : fmtV(r[k])}`).join("") +
          `<br>Total: ${mode === "rigs" ? Math.round(tot) : fmtV(tot)}`, e);
      }).on("mouseleave", hideTip);
    $("#basin-sub").textContent = mode === "rigs" ? "Active rigs by shale region, STEO, 2013 onward." :
      S.fuel === "oil" ? "Crude output by shale region, STEO, Dec 2008 onward." : "Marketed gas by shale region, STEO, Dec 2008 onward.";
    $("#basin-keys").innerHTML = "";
  }

  // ---------- exports map ----------
  const W = { w: 560, h: 300 };
  const world = d3.select("#worldmap");
  const proj = d3.geoNaturalEarth1().rotate([10, 0]).scale(118).translate([W.w / 2, W.h / 2 + 34]);
  const geo = d3.geoPath(proj);
  const ORIGIN = [-94.5, 29.3];
  const REG = {
    "Canada": [-102, 57], "Mexico": [-102, 22], "Latin America": [-60, -14], "Europe": [12, 50],
    "Asia and Pacific": [118, 30], "Middle East and Africa": [32, 12],
  };
  const KINDS = { oil: [["crude", "Crude"], ["products", "Products"]], gas: [["lng", "LNG"], ["pipeline", "Pipeline"]] };
  world.append("defs").html(`<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
    <path d="M0 0L10 5L0 10z" fill="var(--fuel-hot)"/></marker>`);
  const landG = world.append("g"), arcG = world.append("g");
  fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json").then((r) => r.json()).then((t) => {
    landG.append("path").datum(topojson.feature(t, t.objects.land)).attr("class", "land").attr("d", geo);
  }).catch(() => { /* map outline is decoration; flows still render */ });

  function expKinds() {
    if (!S.expKind || !KINDS[S.fuel].some((k) => k[0] === S.expKind)) S.expKind = KINDS[S.fuel][0][0];
    $("#exp-kind").innerHTML = KINDS[S.fuel].map(([k, n]) => `<button data-k="${k}" aria-pressed="${k === S.expKind}">${n}</button>`).join("");
    document.querySelectorAll("#exp-kind button").forEach((b) => b.onclick = () => { S.expKind = b.dataset.k; expKinds(); expView(); });
  }

  function expView() {
    const imp = S.dir === "imp";
    const src = (imp ? D.imports : D.exports)[S.expKind], m = S.m;
    const vals = Object.entries(src).map(([r, s]) => [r, at(s, m)]).filter((d) => d[1] != null && d[1] > 0.5).sort((a, b) => b[1] - a[1]);
    const starts = Object.values(src).map((s) => s.start).sort();
    // same width scale for both directions so exports and imports compare
    const both = [...Object.values(D.exports[S.expKind]), ...Object.values(D.imports[S.expKind])];
    const allMax = d3.max(both.flatMap((s) => s.v.filter((v) => v != null)));
    const wScale = d3.scaleSqrt([0, allMax || 1], [0, 16]);
    const [ox, oy] = proj(ORIGIN);
    arcG.selectAll("*").remove();
    const onMap = vals.filter(([r]) => r !== "Other");
    onMap.forEach(([r, v]) => {
      const [tx, ty] = proj(REG[r]);
      const mx = (ox + tx) / 2, my = Math.min(oy, ty) - Math.abs(tx - ox) * 0.28 - 14;
      const d = imp ? `M${tx},${ty} Q${mx},${my} ${ox},${oy}` : `M${ox},${oy} Q${mx},${my} ${tx},${ty}`;
      arcG.append("path").attr("class", "arc").attr("d", d).attr("stroke-width", Math.max(1, wScale(v)))
        .on("mousemove", (e) => showTip(`<b>${r}</b><br>${label(m)}: ${fmtV(v)}`, e)).on("mouseleave", hideTip);
    });
    onMap.forEach(([r]) => {
      const [tx, ty] = proj(REG[r]);
      arcG.append("circle").attr("class", "node").attr("cx", tx).attr("cy", ty).attr("r", 3);
      arcG.append("text").attr("x", tx).attr("y", ty + (ty < oy ? -8 : 15)).attr("text-anchor", "middle")
        .text(r.replace(" and ", " & ").replace("Asia & Pacific", "Asia-Pacific"));
    });
    onMap.forEach(([r]) => {
      const [tx, ty] = proj(REG[r]);
      const mx = (ox + tx) / 2, my = Math.min(oy, ty) - Math.abs(tx - ox) * 0.28 - 14;
      const d = imp ? `M${tx},${ty} Q${mx},${my} ${ox},${oy}` : `M${ox},${oy} Q${mx},${my} ${tx},${ty}`;
      arcG.append("path").attr("d", d).attr("fill", "none").attr("stroke", "none").attr("marker-end", "url(#arrow)");
    });
    arcG.append("circle").attr("class", "origin").attr("cx", ox).attr("cy", oy).attr("r", 4.5);
    const tot = d3.sum(vals, (d) => d[1]);
    const kindName = { crude: "Crude oil", products: "Refined products", lng: "LNG", pipeline: "Pipeline gas" }[S.expKind];
    $("#exp-sub").textContent = `${kindName} ${imp ? "imports by origin" : "exports by destination"}, ${label(m)}${tot ? ` · ${fmtV(tot)}` : ""}.`;
    if (!vals.length) {
      $("#explist").innerHTML = `<p class="empty">${m < toM(starts[0]) ? `No ${imp ? "origin" : "destination"} data before ${starts[0].slice(0, 4)}.` : `No ${imp ? "imports" : "exports"} reported this month.`}</p>`;
      return;
    }
    $("#explist").innerHTML = vals.map(([r, v]) => `<div class="row"><span class="nm">${r.replace(" and ", " & ")}</span>
      <div><div class="bar" style="width:${(v / vals[0][1]) * 100}%"></div></div><span class="v">${Math.round(v / tot * 100)}%</span></div>`).join("");
  }

  // ---------- wiring ----------
  function monthChanged() {
    $("#month-label").textContent = label(S.m);
    const v = at(prod().US, S.m);
    $("#bar-val").textContent = `${S.fuel === "oil" ? "Oil" : "Gas"} ${v == null ? "" : fmtBig(v) + " " + U[S.fuel].bigUnit}`;
    kpis(); mapView(); expView();
    histView.placeMk && histView.placeMk(); basinView.placeMk && basinView.placeMk();
  }
  const bar = $("#timebar");
  const onScroll = () => bar.classList.toggle("stuck", bar.getBoundingClientRect().top <= 0 && scrollY > 0);
  addEventListener("scroll", onScroll, { passive: true });
  function fuelChanged() {
    document.body.className = "fuel-" + S.fuel;
    document.querySelectorAll("[data-fuel]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.fuel === S.fuel));
    store.set("fuel", S.fuel);
    setupSlider(); legend(); expKinds(); histView(); basinView(); monthChanged();
  }
  function themeChanged() {
    document.documentElement.dataset.theme = S.theme; store.set("theme", S.theme);
    legend(); basinView(); mapView();
  }
  document.querySelectorAll("[data-fuel]").forEach((b) => b.onclick = () => { if (S.fuel !== b.dataset.fuel) { S.fuel = b.dataset.fuel; stop(); fuelChanged(); } });
  $("#theme").onclick = () => { S.theme = S.theme === "dark" ? "light" : "dark"; themeChanged(); };
  const seg = (sel, attr, key, after) => document.querySelectorAll(`${sel} button`).forEach((b) => b.onclick = () => {
    S[key] = b.dataset[attr];
    document.querySelectorAll(`${sel} button`).forEach((x) => x.setAttribute("aria-pressed", x === b));
    after();
  });
  seg("#range", "range", "range", histView);
  seg("#overlay", "ov", "overlay", histView);
  seg("#basin-mode", "bm", "basinMode", basinView);
  seg("#exp-dir", "dir", "dir", expView);

  $("#asof").textContent = `Data through ${label(LAST)}.`;
  $("#retrieved").textContent = `Retrieved ${D.meta.retrieved}.`;
  document.documentElement.dataset.theme = S.theme;
  fuelChanged();
})();
