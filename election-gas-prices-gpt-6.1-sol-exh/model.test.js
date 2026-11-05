import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { electionDate, makeRows, adjustedPrice, metricValue, observation, TANK } from './dist/model.js';
const data = JSON.parse(readFileSync(new URL('./dist/data/observations.json', import.meta.url)));
const rows = makeRows(data);
const base = rows.find(r => r.year === 2024);
test('Election dates follow the Tuesday-after-first-Monday rule, including November 1 Tuesday', () => {
  assert.equal(electionDate(2008),'2008-11-04');
  assert.equal(electionDate(2016),'2016-11-08');
  assert.equal(electionDate(2024),'2024-11-05');
  assert.equal(electionDate(2026),'2026-11-03');
  for(let year=1978;year<=2026;year++){
    const date=new Date(electionDate(year));
    assert.equal(date.getUTCDay(),2);
    assert.ok(date.getUTCDate()>=2&&date.getUTCDate()<=8);
  }
});
test('Historical price and U.S. CPI coverage is complete; DFW CPI gaps are preserved', () => {
  for(const row of rows.filter(r=>r.year<2026)){
    assert.ok(row.price>0,`Missing price ${row.year}`);
    if(row.year>=1998) assert.ok(row.cpiDfw>0,`Missing DFW CPI ${row.year}`);
    else assert.equal(row.cpiDfw,null,`Do not invent November CPI ${row.year}`);
    assert.ok(row.cpiUs>0,`Missing U.S. CPI ${row.year}`);
    assert.equal(row.preliminary,false);
  }
  for(const series of Object.values(data.observations)) assert.ok(Object.keys(series).sort().at(-1)>='2026-01-01');
});
test('Reference-year conversions are identities and known conversions match formulas', () => {
  assert.equal(adjustedPrice(base,'inflation',base,'cpiDfw'),base.price);
  assert.equal(adjustedPrice(base,'wage',base,'cpiUs'),base.price);
  const row=rows.find(r=>r.year===2008);
  assert.equal(adjustedPrice(row,'inflation',base,'cpiDfw'),row.price*base.cpiDfw/row.cpiDfw);
  assert.equal(adjustedPrice(row,'inflation',base,'cpiUs'),row.price*base.cpiUs/row.cpiUs);
  assert.equal(adjustedPrice(row,'wage',base),row.price*base.wage/row.wage);
});
test('Work metrics are reciprocal and independent of display adjustment; fill-up uses 14.5 gallons', () => {
  for(const row of rows.filter(r=>r.wage)){
    const mins=metricValue(row,'minutes','nominal',base,'cpiDfw');
    assert.equal(mins,metricValue(row,'minutes','inflation',base,'cpiUs'));
    assert.ok(Math.abs(mins*metricValue(row,'gallons','wage',base,'cpiDfw')-60)<1e-10);
    assert.ok(Math.abs(metricValue(row,'tankMinutes','wage',base,'cpiDfw')-mins*TANK)<1e-10);
    assert.equal(metricValue(row,'fillup','nominal',base,'cpiDfw'),row.price*TANK);
  }
});
test('Missing historical wages remain missing; estimates never use later observations', () => {
  assert.equal(rows.find(r=>r.year===2006).wage,null);
  assert.equal(metricValue(rows.find(r=>r.year===2006),'minutes','nominal',base,'cpiDfw'),null);
  const latest=rows.at(-1);
  assert.equal(latest.preliminary,true);
  for(const input of Object.values(latest.inputs)){
    assert.ok(input.estimated);
    assert.ok(input.month<'2026-11-01');
  }
  assert.deepEqual(observation({'2020-12-01':5},'2020-11-01',true),{value:null,month:null,estimated:false});
  assert.deepEqual(observation({'2020-10-01':5},'2020-11-01',false),{value:null,month:null,estimated:false});
});
