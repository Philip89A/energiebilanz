// v0.54: Geräte-Anteil über den gewählten Zeitraum statt nur über die eigenen Messtage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
const rd = []; let v = 1000; for (const d of [...days, '2026-11-05']) { rd.push({ meter_id: 'a', day: d, value: v }); v += 9; }   // 9 kWh Netz + 1 kWh Solar = 10 kWh/Tag
const C = createCalc(stateFromDb({
  anker_daily: days.map(day => ({ day, genutzt: 1, erzeugung: 1, netzimport: 9, einspeisung: 0 })),
  meters: [{ id: 'a', name: 'AS', grp: 'as', sort: 0 }], meter_readings: rd,
  device_daily: [...days.map(day => ({ device_id: 'w', day, kwh: 0.5, src: 'day' })), { device_id: 's', day: '2026-11-04', kwh: 0.9, src: 'day' }],
  settings: { data: { devices: [{ id: 'w', name: 'Waschmaschine', from: '' }, { id: 's', name: 'Spüler', from: '' }], cars: { ice: {}, ev: {} } } } }));

test('Anteil im Zeitraum: Gerät ÷ Allgemeinstrom aller Tage; Messtage-Anteil bleibt daneben', () => {
  const L = Object.fromEntries(C.deviceStats('2026-11-01', '2026-11-04').list.map(x => [x.id, x]));
  assert.ok(Math.abs(L.w.share - 2 / 40) < 1e-9); assert.ok(Math.abs(L.s.share - 0.9 / 40) < 1e-9);
  assert.ok(L.w.share > L.s.share, 'Reihenfolge passt zu den kWh');
  assert.ok(Math.abs(L.s.shareMeas - 0.09) < 1e-9); assert.equal(L.s.measN, 1); assert.equal(L.s.hhN, 4); assert.equal(L.w.measN, 4);
});
