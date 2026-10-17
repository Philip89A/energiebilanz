// v0.35: Waschmaschinen-Wasser gegen Wasserzähler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

function calc(devFrom = '2026-05-01') {
  const device_daily = [];
  for (let d = new Date(devFrom + 'T00:00:00Z'); d <= new Date('2026-05-30T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    device_daily.push({ device_id: 'wasch', day: d.toISOString().slice(0, 10), kwh: 0.5, water_l: 40, runs: 1, src: 'day' });
  return createCalc(stateFromDb({
    anker_daily: [{ day: '2026-05-01', genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 }],
    meters: [{ id: 'w', name: 'Wasser', grp: 'water', sort: 0 }],
    meter_readings: [{ meter_id: 'w', day: '2026-05-01', value: 100 }, { meter_id: 'w', day: '2026-05-31', value: 106 }],
    device_daily,
    settings: { data: { water: { persons: 3 }, battery: {}, pv: {}, amort: {}, cars: {}, devices: [{ id: 'wasch', name: 'Waschmaschine', from: '' }] } } }));
}

test('deviceWater: Anteil, Liter je Waschgang, übriger Verbrauch je Person', () => {
  const [x] = calc().deviceWater('2026-05-01', '2026-05-31');
  assert.equal(x.n, 30); assert.equal(x.l, 1200); assert.equal(x.runs, 30); assert.equal(x.perRun, 40);
  assert.ok(Math.abs(x.share - 0.2) < 1e-9);               // 200 l/Tag Zähler, 40 l Waschmaschine
  assert.ok(Math.abs(x.restPerDay - 160) < 1e-9);
  assert.ok(Math.abs(x.restLpp - 160 / 3) < 1e-9);
});

test('deviceWater: nur Tage mit Gerätewerten, ohne Werte keine Kachel', () => {
  const [x] = calc('2026-05-21').deviceWater('2026-05-01', '2026-05-31');
  assert.equal(x.n, 10); assert.equal(x.from, '2026-05-21'); assert.ok(Math.abs(x.share - 0.2) < 1e-9);
  assert.equal(calc().deviceWater('2026-06-01', '2026-06-30').length, 0);
});
