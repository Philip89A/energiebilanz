// v0.47: Solarstrom direkt und aus dem Speicher mit den Netzwerten ihrer Stunden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

function calc(grid) {
  const days = ['2026-01-01', '2026-01-02'], rd = []; let a = 100;
  for (const d of [...days, '2026-01-03']) { rd.push({ meter_id: 'a', day: d, value: a }); a += 10; }
  return createCalc(stateFromDb({
    // je Tag 4 kWh selbst genutzt, davon 1 kWh aus dem Speicher; 2 kWh eingespeist
    anker_daily: days.map(day => ({ day, genutzt: 4, speicher_zu_haus: 1, speicher_entladung: 1.1, erzeugung: 6, netzimport: 1, einspeisung: 2 })),
    meters: [{ id: 'a', name: 'AS', grp: 'as', sort: 0 }], meter_readings: rd, grid_co2: grid,
    settings: { data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} } } } }));
}
// Netz: 7–16 Uhr sauber (200 g), sonst schmutzig (500 g)
const hours = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 17 ? 200 : 500));

test('Speicher mit Abend-/Nachtwerten, Direktverbrauch und Einspeisung mit Mittagswerten', () => {
  const T = calc([{ day: '2026-01-01', g_mean: 337.5, hours }]).co2Range('2026-01-01', '2026-01-01').T;
  assert.equal(T.pvBatt, 1); assert.equal(T.pvDirect, 3);
  assert.ok(Math.abs(T.pvBattKg - 0.5) < 1e-9, 'Speicher ' + T.pvBattKg);          // 17–7 Uhr nur 500 g
  const fSun = T.pvDirectKg / 3; assert.ok(fSun > 0.2 && fSun < 0.3, 'Sonne ' + fSun); // Sonnenkurve überwiegend 200 g
  assert.ok(Math.abs(T.feedKg - 2 * fSun) < 1e-9);
  assert.ok(Math.abs(T.pvSelfKg - (T.pvDirectKg + T.pvBattKg)) < 1e-9);
  assert.ok(Math.abs(T.cfElecKg - (T.asKg + T.pvSelfKg)) < 1e-9, 'ohne Technik = Netz + Solar');
  assert.ok(T.pvBattKg > T.pvBattDayKg, 'Speicher zählt mehr als im Tagesmittel');
});

test('ohne Netzwerte je Stunde: beide mit Tages- bzw. Jahresfaktor, Summe wie bisher', () => {
  const T = calc([]).co2Range('2026-01-01', '2026-01-02').T, f = T.asKg / T.asKwh;
  assert.ok(Math.abs(T.pvSelfKg - 8 * f) < 1e-9); assert.ok(Math.abs(T.pvBattKg - 2 * f) < 1e-9);
  assert.ok(Math.abs(T.pvBattKg - T.pvBattDayKg) < 1e-12);
});

test('Speicher-Anteil nie größer als der selbst genutzte Solarstrom', () => {
  const C = createCalc(stateFromDb({ anker_daily: [{ day: '2026-01-01', genutzt: 0.5, speicher_zu_haus: 2, erzeugung: 1, netzimport: 0, einspeisung: 0 }],
    meters: [], meter_readings: [], settings: { data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} } } } }));
  const T = C.co2Range('2026-01-01', '2026-01-01').T;
  assert.equal(T.pvBatt, 0.5); assert.equal(T.pvDirect, 0);
});
