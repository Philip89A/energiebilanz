// v0.41: Netz-CO₂ je Stunde – Antwort lesen, Ortszeit (auch Zeitumstellung), Tagesfaktor in der Bilanz, Wärmepumpe nach Stunden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGridCo2, aggregateGridCo2, localDayHour } from '../js/gridco2.js';
import { createCalc, stateFromDb } from '../js/calc.js';

test('Antwortformate: unix_seconds/co2eq, unix_ms/data, ISO-Zeiten; Unsinnswerte fallen weg', () => {
  assert.equal(parseGridCo2({ unix_seconds: [1, 2], co2eq: [300, null] }).length, 1);
  assert.equal(parseGridCo2({ unix_ms: [1e12, 1e12 + 1], data: [200, 5000] }).length, 1);
  assert.equal(parseGridCo2([{ timestamps: ['2026-10-01T00:00:00Z'], co2: [250] }])[0].ms, Date.parse('2026-10-01T00:00:00Z'));
  assert.throws(() => parseGridCo2({ foo: [] }), /Format/);
});

test('Ortszeit: Sommer UTC+2, Winter UTC+1, Zeitumstellung 25.10.2026', () => {
  assert.deepEqual(localDayHour(Date.parse('2026-07-01T22:30:00Z')), { day: '2026-07-02', hour: 0 });
  assert.deepEqual(localDayHour(Date.parse('2026-12-01T23:30:00Z')), { day: '2026-12-02', hour: 0 });
  // 15-Minuten-Werte über den 25.10.: 25 Ortsstunden, trotzdem 24 Stundenwerte
  const pts = []; for (let t = Date.parse('2026-10-24T22:00:00Z'); t < Date.parse('2026-10-25T23:00:00Z'); t += 9e5) pts.push({ ms: t, g: localDayHour(t).hour < 12 ? 200 : 400 });
  const [r] = aggregateGridCo2(pts, '2026-10-25', '2026-10-25');
  assert.equal(r.day, '2026-10-25'); assert.equal(r.hours.length, 24); assert.equal(r.hours[2], 200); assert.equal(r.hours[14], 400);
  assert.ok(r.g_mean > 290 && r.g_mean < 310);
});

test('unvollständige Tage (unter 20 Stunden) werden nicht gespeichert', () => {
  const pts = []; for (let h = 0; h < 10; h++) pts.push({ ms: Date.parse(`2026-11-02T${String(h).padStart(2, '0')}:00:00Z`), g: 300 });
  assert.equal(aggregateGridCo2(pts).length, 0);
});

function calc(co2 = {}) {
  const days = ['2026-01-01', '2026-01-02'], rd = []; let a = 100, w = 200;
  for (const d of [...days, '2026-01-03']) { rd.push({ meter_id: 'a', day: d, value: a }, { meter_id: 'w', day: d, value: w }); a += 10; w += 10; }
  // Wärmepumpe: am 1.1. nur nachts (0–4 Uhr) 10 kWh
  const hp = []; for (let h = 0; h < 24; h++) hp.push({ grain: 'hour', ts: `2026-01-01T${String(h).padStart(2, '0')}:00`, el_hp: h < 5 ? 2 : 0, el_heat: h < 5 ? 2 : 0, heat_heat: h < 5 ? 6 : 0 });
  return createCalc(stateFromDb({ anker_daily: days.map(day => ({ day, genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 })),
    meters: [{ id: 'a', name: 'AS', grp: 'as', sort: 0 }, { id: 'w', name: 'WP', grp: 'wp', sort: 1 }], meter_readings: rd, hp_energy: hp,
    grid_co2: [{ day: '2026-01-01', g_mean: 400, hours: Array.from({ length: 24 }, (_, h) => (h < 6 ? 500 : 368)) }],
    settings: { data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} }, co2 } } }));
}

test('Bilanz: Tagesfaktor statt Jahresfaktor, Wärmepumpe nach ihren Stunden gewichtet, abschaltbar', () => {
  const T = calc().co2Range('2026-01-01', '2026-01-02').T;
  assert.equal(T.netDays, 1);
  assert.ok(Math.abs(T.asKg - (10 * 0.4 + 10 * 0.344)) < 1e-6, 'AS ' + T.asKg);
  assert.ok(Math.abs(T.wpKg - (10 * 0.5 + 10 * 0.344)) < 1e-6, 'WP ' + T.wpKg);       // nachts 500 g
  assert.ok(Math.abs(T.actualYear - 40 * 0.344) < 1e-6);
  const Y = calc({ hourly: false }).co2Range('2026-01-01', '2026-01-02').T;
  assert.equal(Y.netDays, 0); assert.ok(Math.abs(Y.actual - Y.actualYear) < 1e-9);
});

test('Profil: sauberste und schmutzigste Stunden', () => {
  const G = calc().gridProfile('2026-01-01', '2026-01-31');
  assert.equal(G.nd, 1); assert.equal(G.mean, 400);
  assert.ok(G.worst.every(h => h < 6)); assert.ok(G.best.every(h => h >= 6));
  assert.equal(G.spread, 132);
});
