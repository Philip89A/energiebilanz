// v0.45: Rest Allgemeinstrom = Haushalt (Netz + eigener Solarstrom) − gemessene Geräte, je Tag/Monat und als Summe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

function calc() {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03'], rd = []; let a = 100;
  for (const d of [...days, '2026-01-04']) { rd.push({ meter_id: 'a', day: d, value: a }); a += 5; }
  return createCalc(stateFromDb({
    anker_daily: days.map(day => ({ day, genutzt: 2, erzeugung: 2, netzimport: 5, einspeisung: 0 })),
    meters: [{ id: 'a', name: 'AS', grp: 'as', sort: 0 }], meter_readings: rd,
    tariffs: [{ id: 't', grp: 'as', name: 'AS', valid_from: '2025-01-01', valid_to: null, ap_ct: 30, gp_eur_year: 0, boni_eur: 0 }],
    device_daily: days.flatMap(day => [{ device_id: 'g', day, kwh: 0.5, src: 'day' }, { device_id: 'l', day, kwh: 0.5, src: 'day' }]),
    settings: { data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} },
      devices: [{ id: 'g', name: 'Gefrierschrank', from: '' }, { id: 'l', name: 'Lüftung', from: '' }] } } }));
}

test('deviceStats: Haushalt 7 kWh/Tag, Geräte 1, Rest 6, Abdeckung 1/7, Arbeitspreis', () => {
  const st = calc().deviceStats('2026-01-01', '2026-01-03');
  assert.equal(st.hhDays, 3);
  assert.ok(Math.abs(st.hhKwh - 21) < 1e-9 && Math.abs(st.devKwhOnHh - 3) < 1e-9 && Math.abs(st.restKwh - 18) < 1e-9);
  assert.ok(Math.abs(st.coverShare - 1 / 7) < 1e-9); assert.equal(st.ap, 0.3);
});

test('deviceSeries: Rest je Tag, Geräte + Rest = Haushalt', () => {
  const s = calc().deviceSeries('2026-01-01', '2026-01-03', 'day');
  for (const k of s.ks) assert.ok(Math.abs(s.val.g[k] + s.val.l[k] + s.rest[k] - s.hh[k]) < 1e-9 && Math.abs(s.rest[k] - 6) < 1e-9);
});
