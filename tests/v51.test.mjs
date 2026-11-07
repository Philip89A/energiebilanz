// v0.51: Leasing-Kilometer Tavascan – gefahren gegen Budget, Prognose, Mehr-/Minderkilometer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const calc = (ev, log = [], charges = []) => createCalc(stateFromDb({
  anker_daily: [{ day: '2026-01-01', genutzt: 1, erzeugung: 1, netzimport: 0, einspeisung: 0 }],
  car_log: log.map(([day, km, car = 'tavascan']) => ({ day, car, category: 'Kilometerstand', odometer: km, amount: 0 })),
  charge_log: charges.map(([day, km]) => ({ day, kwh: 30, odometer: km, location: 'zu Hause' })),
  settings: { data: { cars: { ice: {}, ev } } } }));

test('Budget = km/Jahr × Monate ÷ 12, Ende nach Laufzeit', () => {
  const L = calc({ start: '2026-12-15', months: 36, km: 10000 }).leaseKm('2026-11-01');
  assert.equal(L.total, 30000); assert.equal(L.end, '2029-12-15'); assert.equal(L.started, false); assert.equal(L.daysToStart, 44); assert.equal(L.last, null);
});

test('Vorsprung, Prognose und Mehrkilometer-Kosten über der Freigrenze', () => {
  const L = calc({ start: '2026-12-15', months: 36, km: 10000, kmStart: 20, kmFree: 2500, ctMore: 8, ctLess: 4 }, [['2027-03-15', 3020]]).leaseKm('2027-03-20');
  assert.equal(L.last.km, 3000); assert.equal(L.used, 90);
  assert.ok(Math.abs(L.budget - 30000 * 90 / 1096) < 1e-9);
  assert.ok(L.diff > 500 && L.diff < 560);
  assert.ok(Math.abs(L.proj - 3000 / 90 * 1096) < 1e-9);
  assert.ok(Math.abs(L.eurEnd - (L.proj - 30000 - 2500) * 0.08) < 1e-9);
});

test('Minderkilometer: Erstattung erst unter der Freigrenze, innerhalb 0 €', () => {
  const low = calc({ start: '2026-12-15', months: 36, km: 10000, kmFree: 2500, ctMore: 8, ctLess: 4 }, [['2027-12-15', 5000]]).leaseKm('2027-12-20');
  assert.ok(low.over < -2500 && low.eurEnd < 0);
  const ok = calc({ start: '2026-12-15', months: 36, km: 10000, kmFree: 2500, ctMore: 8 }, [['2027-12-15', 9500]]).leaseKm('2027-12-20');
  assert.equal(ok.eurEnd, 0);
});

test('Kilometerstände auch aus Ladevorgängen; Stände vor der Übernahme und anderer Autos zählen nicht', () => {
  const L = calc({ start: '2026-12-15', months: 36, kmYear: 12000 }, [['2026-12-01', 5], ['2027-01-10', 900, 'leon']], [['2027-01-14', 1100]]).leaseKm('2027-01-20');
  assert.equal(L.kmYear, 12000); assert.equal(L.total, 36000); assert.equal(L.pts.length, 1); assert.equal(L.last.km, 1100);
  assert.equal(L.used, 30); assert.equal(L.reliable, true);
});
