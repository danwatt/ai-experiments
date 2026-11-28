#!/usr/bin/env node
// Every number in the video, computed from the repo's data with the same models as ../half-wrong/.
// Writes facts.json next to this file; the renderer (scene.html) reads it, so no figure is typed in by hand.
//   node compute.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "data.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "explainer-4/funds.js"), "utf8"), ctx);
const H = ctx.window.HIST, F = ctx.window.FUNDS, T = F.funds.map((f) => f.ticker);
const LAST = H.last;
const sp = (y) => H.stocks[y - H.first];
const inf = (y) => H.infl[y - H.first];
const four = (y) => T.reduce((a, t) => a + F.returns[t][y - F.first], 0) / T.length;
const vf = (y) => F.compare.SP[y - F.first];
const SERIES = { sp: { first: 1926, r: sp }, vf: { first: F.first, r: vf }, four: { first: F.first, r: four } };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------- 1. inflation (app.js): compounded CPI
const cagrInf = (a, b) => Math.pow(range(a, b).reduce((p, y) => p * (1 + inf(y)), 1), 1 / (b - a + 1)) - 1;
const inflation = {
  y0: 1926, y1: LAST,
  century: cagrInf(1926, LAST),
  beforeBook: cagrInf(1926, 2002),
  thirtyBefore: cagrInf(1973, 2002),
  sinceBook: cagrInf(2003, LAST),
  yearsAbove4: range(1926, LAST).filter((y) => inf(y) > 0.04).length,
  years: LAST - 1926 + 1,
  series: range(1926, LAST).map((y) => [y, inf(y)]),
};

// ---------- 2. average vs compounded (returns.js)
const toy = [0.30, -0.10, 0.25, 0.03];
const toyBal = toy.reduce((a, r) => (a.push(a[a.length - 1] * (1 + r)), a), [10000]);
const toyAvg = toy.reduce((a, b) => a + b, 0) / toy.length;
const toyCagr = Math.pow(toyBal[4] / 10000, 1 / 4) - 1;
const steady12 = toy.map((_, i) => 10000 * Math.pow(1.12, i + 1));
const stretch = (r, a, b) => {
  const rs = range(a, b).map(r), g = rs.reduce((p, v) => p * (1 + v), 1);
  return { avg: rs.reduce((t, v) => t + v, 0) / rs.length, cagr: Math.pow(g, 1 / rs.length) - 1, grow: g };
};
const sp2602 = stretch(sp, 1926, 2002);
const spSince = stretch(sp, 2003, LAST);
const thirty = (s, from) => {
  const out = [];
  for (let a = Math.max(s.first, from); a + 29 <= LAST; a++) out.push({ a, b: a + 29, ...stretch(s.r, a, a + 29) });
  return out;
};
const sp30 = thirty(SERIES.sp, 1981), four30 = thirty(SERIES.four, 1981), spAll30 = thirty(SERIES.sp, 1926);
const returns = {
  toy, toyBal, toyAvg, toyCagr, steady12,
  sp2602: { ...sp2602, from: 10000, avgGrow: 10000 * Math.pow(1 + sp2602.avg, 77), end: 10000 * sp2602.grow },
  spSince,
  sp30since1981: { hits: sp30.filter((o) => o.cagr >= 0.12).length, n: sp30.length, best: Math.max(...sp30.map((o) => o.cagr)), worst: Math.min(...sp30.map((o) => o.cagr)),
    list: sp30.map((o) => ({ a: o.a, b: o.b, cagr: o.cagr, avg: o.avg })) },
  four30since1981: { hits: four30.filter((o) => o.cagr >= 0.12).length, n: four30.length },
  sp30all: { hits: spAll30.filter((o) => o.cagr >= 0.12).length, n: spAll30.length },
};

// ---------- 3. saving (saving.js): $625 at the start of every month, the year's return spread over its months
const MONTHLY = 625, YEARS = 40, BOOK_SUM = 7588545;
function save(r, st) {
  let B = 0, P = 1;
  const path = [0], realPath = [0];
  for (let y = st; y < st + YEARS; y++) {
    const m = Math.pow(1 + r(y), 1 / 12) - 1;
    for (let j = 0; j < 12; j++) B = (B + MONTHLY) * (1 + m);
    P *= 1 + inf(y);
    path.push(B); realPath.push(B / P);
  }
  return { st, end: st + YEARS - 1, B, real: B / P, path, realPath };
}
const saving = {};
for (const k of ["four", "sp", "vf"]) {
  const s = SERIES[k];
  saving[k] = range(Math.max(s.first, 1981), LAST - YEARS + 1).map((st) => save(s.r, st));
}
const allSave = [...saving.four, ...saving.sp, ...saving.vf];
const steadyYear = (() => { let B = 0; const m = Math.pow(1.12, 1 / 12) - 1, path = [0]; for (let i = 0; i < 480; i++) { B = (B + MONTHLY) * (1 + m); if (i % 12 === 11) path.push(B); } return { B, path }; })();
const steadyMonth = (() => { let B = 0; const path = [0]; for (let i = 0; i < 480; i++) { B = (B + MONTHLY) * 1.01; if (i % 12 === 11) path.push(B); } return { B, path }; })();
const savingOut = {
  monthly: MONTHLY, years: YEARS, put: MONTHLY * 12 * YEARS, book: BOOK_SUM, half: 4e6, sixth: BOOK_SUM / 6,
  starts: saving.four.map((o) => o.st), ends: saving.four.map((o) => o.end),
  runs: Object.fromEntries(Object.entries(saving).map(([k, l]) => [k, l.map((o) => ({ st: o.st, end: o.end, B: o.B, real: o.real, path: o.path, realPath: o.realPath }))])),
  min: Math.min(...allSave.map((o) => o.B)), max: Math.max(...allSave.map((o) => o.B)),
  realMin: Math.min(...allSave.map((o) => o.real)), realMax: Math.max(...allSave.map((o) => o.real)),
  reached4M: Object.fromEntries(Object.entries(saving).map(([k, l]) => [k, l.filter((o) => o.B >= 4e6).length])),
  reachedBook: allSave.filter((o) => o.B >= BOOK_SUM).length,
  steady12: steadyYear.B, steady12path: steadyYear.path,
  onePctMonth: steadyMonth.B, onePctMonthPath: steadyMonth.path, onePctMonthYearly: Math.pow(1.01, 12) - 1,
};

// ---------- 4. spending 8% (timing.js): perfect 12% and 4%, $40,000 from $500,000 raised 4% a year
const START = 5e5, m12 = Math.pow(1.12, 1 / 12) - 1;
const FAC = ((1 + m12) * (Math.pow(1 + m12, 12) - 1)) / (12 * m12);
const monthlyStep = (B, W) => { for (let k = 0; k < 12; k++) B = (B - W / 12) * (1 + m12); return B; };
function run(step, first, limit = 150) {
  let B = START, W = first, gone = null;
  const bal = [START];
  for (let y = 1; y <= limit && gone == null; y++) { B = step(B, W); if (B <= 0) gone = y; B = Math.max(0, B); bal.push(B); W *= 1.04; }
  return { gone, bal };
}
const mon8 = run(monthlyStep, 0.08 * START), jan8 = run((B, W) => (B - W) * 1.12, 0.08 * START), mon752 = run(monthlyStep, (0.08 / FAC) * START, 60);
const spending = {
  start: START, draw: 40000, perMonth: 40000 / 12,
  monthly8Gone: mon8.gone, jan1Gone: jan8.gone, breakEven: 0.08 / FAC, breakEvenDraw: (0.08 / FAC) * START,
  needFor40k: 40000 / (0.08 / FAC), factor: FAC,
  afterYear1Need: START * 1.04, afterYear1Monthly: mon8.bal[1], growthYear1: mon8.bal[1] / START - 1 + 0.08, // growth before the raise
  paths: { monthly8: mon8.bal, jan1: jan8.bal, monthly752: mon752.bal.slice(0, 51) },
  // the same balances in today's dollars (4% a year taken out): keeping up means staying at $500,000
  real: { monthly8: mon8.bal.map((b, y) => b / Math.pow(1.04, y)), jan1: jan8.bal.map((b, y) => b / Math.pow(1.04, y)), monthly752: mon752.bal.slice(0, 51).map((b, y) => b / Math.pow(1.04, y)) },
  keepUp: range(0, 50).map((y) => START * Math.pow(1.04, y)),
};

// ---------- 5. real retirements (realworld.js)
function retire(r, st, len, W0) {
  let B = START, W = W0, P = 1, gone = null;
  const partial = st + len - 1 > LAST, run = Math.min(len, LAST - st + 1), path = [START], need = [START];
  for (let k = 0; k < run; k++) {
    const y = st + k, m = Math.pow(1 + r(y), 1 / 12) - 1;
    for (let j = 0; j < 12; j++) { if (B < W / 12) { B = 0; gone = y; break; } B -= W / 12; B *= 1 + m; }
    path.push(B); need.push(START * P * (1 + inf(y)));
    if (gone) break;
    P *= 1 + inf(y); W *= 1 + inf(y);
  }
  const real = B / P;
  return { st, partial, gone, real, path, need, outcome: gone ? "out" : real >= START ? "kept" : "shrank" };
}
const ret = (k, from, to = 2013, len = 30) => range(Math.max(SERIES[k].first, from), to).map((st) => retire(SERIES[k].r, st, len, 40000));
const done = (l) => l.filter((o) => !o.partial);
const cnt = (l, k) => l.filter((o) => o.outcome === k).length;
const sp81 = ret("sp", 1981), sp26 = ret("sp", 1926), four81 = ret("four", 1981), vf81 = ret("vf", 1981);
const lens = [20, 25, 30];
const after = range(2004, 2008).flatMap((st) => lens.flatMap((len) => ["sp", "vf", "four"].map((k) => ({ k, len, ...retire(SERIES[k].r, st, len, 40000) }))));
const realworld = {
  sp81: { kept: cnt(done(sp81), "kept"), out: cnt(done(sp81), "out"), n: done(sp81).length },
  sp26: { kept: cnt(done(sp26), "kept"), out: cnt(done(sp26), "out"), shrank: cnt(done(sp26), "shrank"), n: done(sp26).length },
  four81: { kept: cnt(done(four81), "kept"), out: cnt(done(four81), "out"), n: done(four81).length },
  vf81: { kept: cnt(done(vf81), "kept"), out: cnt(done(vf81), "out"), n: done(vf81).length },
  // every 30-year S&P 500 retirement from 1926, finished ones plus those still underway (through 2013)
  grid: sp26.map((o) => ({ st: o.st, outcome: o.outcome, partial: o.partial, gone: o.gone })),
  after2004to2008: { n: after.length, kept: after.filter((o) => o.outcome === "kept").length, out: after.filter((o) => o.outcome === "out").length,
    shrank: after.filter((o) => o.outcome === "shrank").map((o) => `${o.k} ${o.len}y ${o.st}`) },
  // two example paths for the chart: a lucky start and an unlucky one
  example: Object.fromEntries([1982, 1966, 2000].map((st) => { const o = retire(sp, st, 30, 40000); return [st, { path: o.path, need: o.need, gone: o.gone, outcome: o.outcome, real: o.real }]; })),
};

const facts = { generated: "compute.js", last: LAST, inflation, returns, saving: savingOut, spending, realworld };
fs.writeFileSync(path.join(__dirname, "facts.json"), JSON.stringify(facts, (k, v) => (typeof v === "number" ? +v.toPrecision(10) : v)));

// ---------- a readable summary for checking against the script
const pct = (v, d = 1) => (100 * v).toFixed(d) + "%", money = (v) => "$" + Math.round(v).toLocaleString("en-US"), M = (v) => "$" + (v / 1e6).toFixed(2) + "M";
console.log(`inflation ${inflation.y0}-${LAST}: ${pct(inflation.century)}; 1926-2002 ${pct(inflation.beforeBook)}; 1973-2002 ${pct(inflation.thirtyBefore)}; 2003-${LAST} ${pct(inflation.sinceBook)}; years above 4%: ${inflation.yearsAbove4}/${inflation.years}`);
console.log(`toy: ${toyBal.map(money).join(" → ")}; avg ${pct(toyAvg)} cagr ${pct(toyCagr)}; steady 12% → ${money(steady12[3])}`);
console.log(`S&P 1926-2002: avg ${pct(sp2602.avg)} cagr ${pct(sp2602.cagr)}; $10k → ${money(returns.sp2602.end)} (at avg: ${money(returns.sp2602.avgGrow)})`);
console.log(`S&P 2003-${LAST}: avg ${pct(spSince.avg)} cagr ${pct(spSince.cagr)}`);
console.log(`30-yr S&P since 1981 at 12%+ compounded: ${returns.sp30since1981.hits}/${returns.sp30since1981.n} (best ${pct(returns.sp30since1981.best)}, worst ${pct(returns.sp30since1981.worst)}); four funds ${returns.four30since1981.hits}/${returns.four30since1981.n}; S&P from 1926 ${returns.sp30all.hits}/${returns.sp30all.n}`);
console.log(`saving starts ${savingOut.starts.join(",")}: range ${M(savingOut.min)}–${M(savingOut.max)}; real ${M(savingOut.realMin)}–${M(savingOut.realMax)}; reached $4M ${JSON.stringify(savingOut.reached4M)}; reached book ${savingOut.reachedBook}`);
for (const k of ["four", "sp", "vf"]) console.log(`  ${k}: ` + saving[k].map((o) => `${o.st}-${o.end} ${M(o.B)} (real ${M(o.real)})`).join("; "));
console.log(`steady 12%/yr: ${money(savingOut.steady12)}; 1%/month: ${money(savingOut.onePctMonth)} (= ${pct(savingOut.onePctMonthYearly, 2)}/yr)`);
console.log(`spending: monthly 8% gone year ${spending.monthly8Gone}; Jan 1 gone year ${spending.jan1Gone}; break-even ${pct(spending.breakEven, 2)} = ${money(spending.breakEvenDraw)}; $40k needs ${money(spending.needFor40k)}; factor ${spending.factor.toFixed(4)}`);
console.log(`real 30-yr, $40k: S&P since 1981 kept ${realworld.sp81.kept}/${realworld.sp81.n} out ${realworld.sp81.out}; S&P since 1926 kept ${realworld.sp26.kept}/${realworld.sp26.n} out ${realworld.sp26.out} shrank ${realworld.sp26.shrank}; four funds kept ${realworld.four81.kept}/${realworld.four81.n}; VFINX kept ${realworld.vf81.kept}/${realworld.vf81.n}`);
console.log(`retired 2004-2008 (20/25/30y x 3 series = ${after.length}): kept ${realworld.after2004to2008.kept}, out ${realworld.after2004to2008.out}, shrank: ${realworld.after2004to2008.shrank.join("; ")}`);
console.log(`examples: ` + Object.entries(realworld.example).map(([k, o]) => `${k} ${o.outcome}${o.gone ? " " + o.gone : ""} real ${money(o.real)}`).join("; "));
