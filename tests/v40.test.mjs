// v0.40: CO₂-Bilanz – Strommix je Jahr, Vertrag, Vergleich „ohne Technik“, graue Emissionen, Hebel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, CO2_DEFAULTS } from '../js/calc.js';

const days = []; for (let d = new Date('2026-01-01T00:00:00Z'); d <= new Date('2026-01-31T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
function calc(co2 = {}) {
  const rd = []; let a = 1000, w = 2000; for (const d of [...days, '2026-02-01']) { rd.push({ meter_id: 'a', day: d, value: a }, { meter_id: 'w', day: d, value: w }); a += 5; w += 6; }
  return createCalc(stateFromDb({
    anker_daily: days.map(day => ({ day, genutzt: 2, erzeugung: 3, netzimport: 5, einspeisung: 1 })),
    meters: [{ id: 'a', name: 'AS', grp: 'as', sort: 0 }, { id: 'w', name: 'WP', grp: 'wp', sort: 1 }], meter_readings: rd,
    fuel_log: [{ id: 'f', day: '2026-01-10', odometer: 1000, liters: 40, amount: 70, fuel_type: 'Super', full_tank: true }],
    events: [{ id: 'e', day: '2025-12-01', grp: 'pv', type: 'daten', note: '' }],
    settings: { data: { battery: { capGross: 10 }, pv: { kwp: 2 }, amort: { feedin: 8 }, cars: { ice: { l100: 6 }, ev: {} }, water: { persons: 3 }, co2,
      stages: [{ id: 's', kwp: 2, capGross: 10, from: '2025-12-01', status: 'live', name: 'S' }, { id: 'p', kwp: 3, capGross: 10, from: '', status: 'planned', name: 'Plan' }] } } }));
}

test('Strommix: Jahreswert, spätere Jahre mit dem letzten bekannten Wert, änderbar', () => {
  assert.equal(calc().mixAt('2024-06-01'), 353);
  assert.equal(calc().mixAt('2026-06-01'), CO2_DEFAULTS.mix[2025]);
  assert.equal(calc({ mix: { 2026: 300 } }).mixAt('2026-06-01'), 300);
});

test('Ausstoß, Vertrag, ohne Technik und Einsparung im Januar', () => {
  const T = calc().co2Range('2026-01-01', '2026-01-31').T, f = 0.344;
  assert.equal(T.days, 31);
  assert.ok(Math.abs(T.asKg - 31 * 5 * f) < 1e-6 && Math.abs(T.wpKg - 31 * 6 * f) < 1e-6);
  assert.ok(Math.abs(T.carKg - 40 * 2.37) < 1e-9);
  assert.equal(T.contract, T.carKg);                                     // Ökostrom 0 g: nur Benzin bleibt
  assert.ok(Math.abs(T.cfElecKg - 31 * (5 + 2) * f) < 1e-6);            // Haushaltsstrom ohne PV
  assert.ok(Math.abs(T.cfHeatKg - 31 * 6 * 3 * 0.28) < 1e-6);          // Wärme = Strom × Arbeitszahl 3 (keine Exportdaten)
  assert.ok(Math.abs(T.saved - (T.cf - T.actual)) < 1e-9 && T.saved > 0);
  assert.ok(Math.abs(T.feedKg - 31 * f) < 1e-6 && Math.abs(T.net - (T.actual - T.feedKg)) < 1e-9);
  assert.ok(T.heatEst > 0);
});

test('Graue Emissionen und Rückzahlzeit', () => {
  const G = calc().co2Grey('2026-01-31');
  assert.equal(G.grey, 2 * 800 + 10 * 80);
  assert.ok(G.perYear > 0 && Math.abs(G.years - G.grey / G.perYear) < 1e-9);
});

test('Hebel: 1 °C, PV-Ausbau aus geplanter Stufe, Verschieben nur so weit eingespeist wird, sortiert', () => {
  const L = calc().co2Levers('2026-01-31'), by = Object.fromEntries(L.map(x => [x.id, x]));
  assert.ok(by.heat1.kg > 0 && by.pv.kg > 0 && /\+1\.00 kWp/.test(by.pv.title));
  assert.equal(by.shift.kg, 0); assert.ok(by.shift.kwh <= 31 + 1e-9);
  assert.ok(L.every((x, i) => !i || L[i - 1].kg >= x.kg));
});
