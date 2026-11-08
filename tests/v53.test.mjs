// v0.53: Sperre nach „gemessen bis“ – gespeicherte Werte danach zählen nicht, Schätzwert übernimmt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const days = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];
const C = createCalc(stateFromDb({
  anker_daily: days.map(day => ({ day, genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 })),
  device_daily: days.map(day => ({ device_id: 'z', day, kwh: day <= '2026-11-08' ? 0.09 : 0.5, src: 'day' })),   // nach dem Umstecken: PC-Werte fälschlich beim Gerät
  settings: { data: { devices: [{ id: 'z', name: 'Zirkulation', from: '2026-10-01', to: '2026-11-08', est: '0.09', estFrom: '2026-11-09' }], cars: { ice: {}, ev: {} } } } }));

test('Werte nach „gemessen bis“ zählen nicht, ab dann Schätzwert', () => {
  const x = C.deviceStats('2026-11-06', '2026-11-10').list[0];
  assert.equal(x.n, 5); assert.equal(x.est, 2);
  assert.ok(Math.abs(x.kwh - 5 * 0.09) < 1e-9);
});
