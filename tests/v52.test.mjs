// v0.52: Schätzwert je Tag für ein Gerät ohne Messung (z. B. Messsteckdose umgesteckt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const calc = dev => createCalc(stateFromDb({
  anker_daily: days.map(day => ({ day, genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 })),
  device_daily: [{ device_id: 'l', day: '2026-11-01', kwh: 0.5, src: 'day' }, { device_id: 'l', day: '2026-11-02', kwh: 0.6, src: 'day' }],
  settings: { data: { devices: [{ id: 'l', name: 'Lüftung', from: '2026-10-01', ...dev }], cars: { ice: {}, ev: {} } } } }));

test('ohne Schätzwert nur gemessene Tage', () => {
  const x = calc({}).deviceStats('2026-11-01', '2026-11-05').list[0];
  assert.equal(x.n, 2); assert.equal(x.est, 0);
});

test('Schätzwert füllt Tage ohne Messung bis zum letzten Anker-Tag, Messung hat Vorrang', () => {
  const x = calc({ est: '0.54', estFrom: '2026-11-02' }).deviceStats('2026-11-01', '2026-11-05').list[0];
  assert.equal(x.n, 5); assert.equal(x.est, 3);
  assert.ok(Math.abs(x.kwh - (0.5 + 0.6 + 3 * 0.54)) < 1e-9);
  const ser = calc({ est: 0.54, estFrom: '2026-11-02' }).deviceSeries('2026-11-01', '2026-11-05', 'day');
  assert.equal(ser.val.l['2026-11-05'], 0.54); assert.equal(ser.val.l['2026-11-02'], 0.6);
});
