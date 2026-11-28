const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(readFileSync(__dirname + '/data.js', 'utf8'), context);
const { months } = context.window.ERCOT_DATA;
const fuels = ['wind', 'solar', 'hydro', 'biomass', 'nuclear', 'gas', 'coal', 'other'];

test('history has consecutive, unique months and no fabricated future records', () => {
  assert.equal(months[0].date, '2007-01');
  assert.equal(months.at(-1).date, '2026-09');
  assert.equal(months.length, 237);
  const start = 2007 * 12;
  months.forEach((r, i) => {
    assert.equal(+r.date.slice(0, 4) * 12 + +r.date.slice(5) - 1, start + i);
    assert.ok(r.total > 0);
    fuels.forEach(f => assert.ok(Number.isFinite(r[f])));
  });
});

test('generation shares exclude storage and reconcile with published totals', () => {
  for (const r of months) {
    assert.ok(Math.abs(fuels.reduce((s, f) => s + r[f], 0) - r.total) < .00001, r.date);
    assert.ok(Math.abs(['wind', 'solar', 'hydro', 'biomass'].reduce((s, f) => s + r[f], 0) - r.renewables) < .00001, r.date);
    if (r.reportedTotal !== undefined) assert.ok(Math.abs(r.total + r.storageNet - r.reportedTotal) < .002, r.date);
    assert.ok(r.renewables >= 0 && r.renewables < r.total);
  }
});

test('published source values survive conversion and category harmonization', () => {
  const jan2025 = months.find(r => r.date === '2025-01');
  assert.ok(Math.abs(jan2025.gas - 17286.335889) < .000001);
  assert.ok(Math.abs(jan2025.solar - 3339.764072) < .000001);
  assert.equal(jan2025.storageNet, -437.746121);
  assert.equal(months.find(r => r.date === '2026-07').settlement, 'Final');
  assert.equal(months.find(r => r.date === '2026-09').settlement, 'Initial');
  const coal2007 = months.filter(r => r.date.startsWith('2007')).reduce((s, r) => s + r.coal, 0);
  assert.ok(Math.abs(coal2007 - 113912.25023) < .01);
});
