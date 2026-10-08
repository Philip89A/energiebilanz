// Synthetische Tests für v0.26: Durchschnitt als Referenz im Tagesprofil Wärmepumpe. Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const base = { anker_daily: [{ day: '2026-10-01', genutzt: 1 }], meters: [], settings: { data: { pv: { kwp: 1 }, battery: {}, amort: {} } } };
// Tag mit 24 Stunden: Ladung um 15 Uhr (el kWh), Speicher sonst 45 °C, Spitze `peak` um 16 Uhr, optional Zuheizer
const day = (d, el, peak = 55, aux = 0, hours = 24) => Array.from({ length: hours }, (_, h) => ({ grain: 'hour', ts: `${d}T${String(h).padStart(2, '0')}:00`,
  el_hp: h === 15 ? el : 0.02, el_dhw: h === 15 ? el : 0, el_heat: 0, el_aux: h === 16 ? aux : 0, el_aux_dhw: h === 16 ? aux : 0,
  heat_dhw: h === 15 ? el * 3 : 0, t_dhw: h === 16 ? peak : 45, t_out: 10 + h / 4 }));

test('v0.26: Ø der letzten 7 vollständigen Tage vor dem Tag, ohne Desinfektionstage und unvollständige Tage', () => {
  const hp = [...day('2026-10-01', 9), ...day('2026-10-02', 1), ...day('2026-10-03', 2), ...day('2026-10-04', 3, 68, 0.5),   // 04.: Desinfektion
    ...day('2026-10-05', 3, 55, 0, 10), ...day('2026-10-06', 4), ...day('2026-10-07', 5), ...day('2026-10-08', 6),            // 05.: unvollständig
    ...day('2026-10-09', 7), ...day('2026-10-10', 8), ...day('2026-10-11', 9), ...day('2026-10-12', 1, 55, 0, 10)];
  const C = createCalc(stateFromDb({ ...base, hp_energy: hp }));
  const r = C.hpDayAverage('2026-10-12');
  assert.equal(r.n, 7);
  assert.deepEqual(r.days, ['2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-03']);
  assert.deepEqual(r.skipped, ['2026-10-04']);
  const elMean = (9 + 8 + 7 + 6 + 5 + 4 + 2) / 7;
  assert.ok(Math.abs(r.el - (elMean + 23 * 0.02)) < 1e-9);
  assert.ok(Math.abs(r.elH[15] - elMean) < 1e-9 && Math.abs(r.elH[3] - 0.02) < 1e-9);
  assert.equal(r.tDhwH[16], 55); assert.equal(r.peak, 55); assert.equal(r.loads, 1); assert.equal(r.aux, 0);
  // gleiche Stunden wie ein unvollständiger Tag (00–09 Uhr): keine Ladung, nur Grundlast
  const q = C.hpDayAverage('2026-10-12', 7, new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.ok(Math.abs(q.el - 10 * 0.02) < 1e-9); assert.equal(q.loads, 0); assert.equal(q.peak, 45);
  assert.equal(q.tOutMin, 10); assert.equal(q.tOutMax, 10 + 9 / 4);           // Außentemperatur nur 00–09 Uhr
  assert.equal(q.elH.length, 24);                                              // Kurve bleibt 24 Stunden
  assert.equal(C.hpDayAverage('2026-10-01'), null);                             // kein Tag davor
});
