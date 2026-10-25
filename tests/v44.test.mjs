// v0.44: CO₂ je Gerät – Netzanteil des Tages × Netzwert, Kosten mit Arbeitspreis und Einspeisevergütung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

function calc(co2 = {}) {
  const days = ['2026-01-01', '2026-01-02'], rd = []; let a = 100;
  for (const d of [...days, '2026-01-03']) { rd.push({ meter_id: 'a', day: d, value: a }); a += 5; }
  return createCalc(stateFromDb({
    anker_daily: days.map(day => ({ day, genutzt: 2, erzeugung: 2, netzimport: 5, einspeisung: 0 })),
    meters: [{ id: 'a', name: 'AS', grp: 'as', sort: 0 }], meter_readings: rd,
    tariffs: [{ id: 't', grp: 'as', name: 'AS', valid_from: '2025-01-01', valid_to: null, ap_ct: 30, gp_eur_year: 0, boni_eur: 0 }],
    device_daily: [{ device_id: 'w', day: '2026-01-01', kwh: 1.4, src: 'day' }, { device_id: 'w', day: '2026-01-02', kwh: 0.7, src: 'day' }, { device_id: 'g', day: '2026-01-01', kwh: 0.5, src: 'day' }],
    grid_co2: [{ day: '2026-01-01', g_mean: 400, hours: null }],
    settings: { data: { battery: {}, pv: {}, amort: { feedin: 8 }, cars: { ice: {}, ev: {} }, co2,
      devices: [{ id: 'w', name: 'Waschmaschine', from: '' }, { id: 'g', name: 'Gefrierschrank', from: '' }] } } }));
}

test('Netzanteil 5/7, Netzwert je Tag, sonst Strommix; sortiert nach kg', () => {
  const L = calc().co2Devices('2026-01-01', '2026-01-02'), w = L.find(x => x.id === 'w');
  const s = 5 / 7;
  assert.ok(Math.abs(w.kwh - 2.1) < 1e-9 && Math.abs(w.share - s) < 1e-9);
  assert.ok(Math.abs(w.kg - (1.4 * s * 0.4 + 0.7 * s * 0.344)) < 1e-9, 'kg ' + w.kg);
  assert.ok(Math.abs(w.eur - (2.1 * s * 0.3 + 2.1 * (1 - s) * 0.08)) < 1e-9);
  assert.equal(L[0].id, 'w'); assert.equal(w.n, 2);
});

test('Netzwerte abgeschaltet: Strommix des Jahres', () => {
  const w = calc({ hourly: false }).co2Devices('2026-01-01', '2026-01-02').find(x => x.id === 'w');
  assert.ok(Math.abs(w.kg - 2.1 * 5 / 7 * 0.344) < 1e-9);
});
