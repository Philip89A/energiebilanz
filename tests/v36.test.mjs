// v0.36: Waschprogramme je Monat – echte Wäschen, Temperaturklassen, Abgleich mit den Gerätewerten (Beispiel: September).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';
import { monthRows } from '../js/import.js';

const SEP = [['Pflegeleicht', 30, 1200, '', 6, 0.47, 50.8], ['Pflegeleicht', 30, 1400, '', 5, 0.47, 49.2], ['smartFinish', 0, 0, '', 4, 0.17, 3.8],
  ['Baumwolle', 60, 1400, '', 2, 1.46, 76.5], ['Hygiene', 60, 1200, '', 1, 1.03, 59.0], ['Pflegeleicht', 30, 1200, 'Miniload', 1, 0.17, 32.0],
  ['Schleudern/Abpumpen', 0, 1200, '', 1, 0.03, null]];
function calc(total = 9.98) {
  const device_programs = SEP.map(([program, temp, rpm, extra, runs, kwh_run, l_run]) => ({ device_id: 'wasch', month: '2026-09-01', program, temp, rpm, extra, runs, kwh_run, l_run }));
  const device_daily = monthRows('2026-09', { kwh: total, water_l: 810, runs: 20 }).map(r => ({ ...r, device_id: 'wasch' }));
  return createCalc(stateFromDb({ anker_daily: [{ day: '2026-09-01', genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 }],
    meters: [{ id: 'w', name: 'Wasser', grp: 'water', sort: 0 }],
    meter_readings: [{ meter_id: 'w', day: '2026-09-01', value: 100 }, { meter_id: 'w', day: '2026-10-01', value: 106 }],
    device_daily, device_programs,
    settings: { data: { water: { persons: 3 }, battery: {}, pv: {}, amort: {}, cars: {}, devices: [{ id: 'wasch', name: 'Waschmaschine', from: '' }] } } }));
}

test('isWash: smartFinish und Schleudern sind keine Wäschen', () => {
  const C = calc();
  assert.equal(C.isWash({ prog: 'smartFinish', l: 3.8 }), false);
  assert.equal(C.isWash({ prog: 'Schleudern/Abpumpen', l: null }), false);
  assert.equal(C.isWash({ prog: 'Pflegeleicht', l: 32 }), true);
});

test('programSummary: 15 Wäschen, kWh und Liter je Wäsche, 60 °C-Anteil', () => {
  const s = calc().programSummary('wasch', '2026-09-01', '2026-09-30');
  assert.equal(s.runs, 20); assert.equal(s.wash, 15); assert.equal(s.other, 5);
  assert.ok(Math.abs(s.kwh - 10.0) < 0.01);
  assert.ok(Math.abs(s.l - 810) < 0.5);
  assert.ok(Math.abs(s.kwhPerWash - (10.0 - 0.68 - 0.03) / 15) < 0.01);
  assert.ok(Math.abs(s.lPerWash - (810 - 15.2) / 15) < 0.1);
  assert.equal(s.hot, 3); assert.ok(Math.abs(s.hotShareRuns - 0.2) < 1e-9);
  assert.ok(Math.abs(s.hotShareKwh - 3.95 / 10.0) < 0.01);
  assert.equal(s.list[0].label, 'Baumwolle 60 °C, 1400 U/min');            // größter Stromanteil zuerst
  const m = s.months[0]; assert.equal(m.cls['30'].runs, 12); assert.equal(m.cls.other.runs, 5);
  assert.ok(Math.abs(m.kwhDiff) < 0.05);
});

test('programMonths: Abweichung zur Monatssumme wird erkannt', () => {
  const [m] = calc(8).programMonths('wasch', '2026-09-01', '2026-09-30');
  assert.ok(m.kwhDiff > 0.2);
});

test('deviceWater: Wäschen statt App-Gänge, wenn Programme den Monat abdecken', () => {
  const [x] = calc().deviceWater('2026-09-01', '2026-09-30');
  assert.ok(Math.abs(x.runs - 20) < 0.01); assert.equal(x.wash, 15);
  assert.ok(Math.abs(x.lPerWash - 794.8 / 15) < 0.1);
  const [y] = calc().deviceWater('2026-09-05', '2026-09-30');
  assert.equal(y.wash, null);                                            // angebrochener Monat: keine Wäschenzahl
});
