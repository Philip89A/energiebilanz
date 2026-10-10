// Synthetische Tests für v0.27: PV-Prognose (Ertragsfaktor je Monat, letzte 30 Tage, Band, Trefferquote). Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pvFactors, pvForecastDays, pvAccuracy, addDays } from '../js/calc.js';

// Juni: Faktor 1,2 (Tagesfaktoren abwechselnd 1,0 und 1,4), Juli: 1,5 konstant
const hist = [];
for (let i = 0; i < 30; i++) hist.push({ d: addDays('2025-06-01', i), rad: 5, gen: 5 * (i % 2 ? 1.4 : 1.0) });
for (let i = 0; i < 31; i++) hist.push({ d: addDays('2025-07-01', i), rad: 4, gen: 6 });
hist.push({ d: '2025-07-15', rad: 0.2, gen: 1 });                                   // zu wenig Strahlung: zählt nicht

test('v0.27: Ertragsfaktor je Monat (Summe ÷ Summe), Streuung, letzte 30 Tage', () => {
  const F = pvFactors(hist, '2025-08-01');
  assert.ok(Math.abs(F.month['06'].f - 1.2) < 1e-9); assert.ok(Math.abs(F.month['06'].cv - 0.2 / 1.2) < 1e-9);
  assert.ok(Math.abs(F.month['07'].f - 1.5) < 1e-9); assert.equal(F.month['07'].cv, 0); assert.equal(F.month['07'].n, 31);
  assert.equal(F.month['08'], undefined);
  assert.ok(Math.abs(F.f30.f - 1.5) < 1e-9);                                         // 02.–31.07.
  // nahe Tage: Ø aus Monat und letzten 30 Tagen; Monat ohne Daten: letzte 30 Tage; Ausblick (near=false): nur Monat bzw. gesamt
  assert.ok(Math.abs(F.factorFor('2025-07-20') - 1.5) < 1e-9);
  assert.ok(Math.abs(F.factorFor('2025-06-20') - (1.2 + 1.5) / 2) < 1e-9);
  assert.ok(Math.abs(F.factorFor('2025-08-05') - 1.5) < 1e-9);
  const all = (180 + 186) / (150 + 124); assert.ok(Math.abs(F.factorFor('2025-09-15', false) - all) < 1e-9);
  // keine Messung ab „heute“
  assert.equal(pvFactors(hist, '2025-06-05').overall, null);
});

test('v0.27: Prognose je Tag mit Band aus der Monatsstreuung, nie unter 0', () => {
  const F = pvFactors(hist, '2025-08-01');
  const d = pvForecastDays([{ day: '2025-07-20', rad_kwh: 2 }, { day: '2025-06-20', rad_kwh: 3 }, { day: '2025-07-21', rad_kwh: null }], F);
  assert.equal(d.length, 2);
  assert.ok(Math.abs(d[0].kwh - 3) < 1e-9); assert.equal(d[0].lo, 3); assert.equal(d[0].hi, 3);
  const k = 3 * 1.35, cv = 0.2 / 1.2;
  assert.ok(Math.abs(d[1].kwh - k) < 1e-9 && Math.abs(d[1].lo - k * (1 - cv)) < 1e-9 && Math.abs(d[1].hi - k * (1 + cv)) < 1e-9);
});

test('v0.27: Trefferquote – jüngste Prognose vor dem Tag, kleine Tage ausgenommen', () => {
  const stored = [
    { d: '2025-07-10', made: '2025-07-05', kwh: 10 }, { d: '2025-07-10', made: '2025-07-09', kwh: 6 }, { d: '2025-07-10', made: '2025-07-10', kwh: 99 },
    { d: '2025-07-11', made: '2025-07-10', kwh: 3 }, { d: '2025-07-12', made: '2025-07-11', kwh: 1 }, { d: '2025-07-13', made: '2025-07-12', kwh: 5 }];
  const actual = { '2025-07-10': 5, '2025-07-11': 4, '2025-07-12': 0.2 };
  const a = pvAccuracy(stored, actual, '2025-07-01', '2025-07-31');
  assert.deepEqual(a.pairs.map(p => [p.d, p.fc, p.lead]), [['2025-07-10', 6, 1], ['2025-07-11', 3, 1], ['2025-07-12', 1, 1]]);
  assert.equal(a.n, 2);
  assert.ok(Math.abs(a.mape - (0.2 + 0.25) / 2) < 1e-9);
  assert.ok(Math.abs(a.bias - (9 / 9 - 1)) < 1e-9);
  assert.equal(pvAccuracy([], actual, '2025-07-01', '2025-07-31').mape, null);
});

import { pvBacktest } from '../js/calc.js';
test('v0.28: Rückblick – Faktor je Tag nur aus Tagen davor, Fehlermaße', () => {
  const h = [];
  for (let i = 0; i < 40; i++) h.push({ d: addDays('2025-07-01', i), rad: 4, gen: i < 30 ? 6 : 8 });   // ab 31.07. besser (f 2,0)
  const b = pvBacktest(h, '2025-07-31', '2025-08-09');
  assert.equal(b.pairs.length, 10);
  assert.ok(Math.abs(b.pairs[0].model - 6) < 1e-9 && b.pairs[0].act === 8);            // am 31.07. kennt das Modell nur f 1,5
  assert.ok(b.pairs[9].model > b.pairs[0].model && b.pairs[9].model < 8);              // passt sich an, ohne die Messung des Tages zu kennen
  assert.ok(b.mape > 0 && b.bias < 0);
  assert.equal(pvBacktest(h, '2025-07-01', '2025-07-05').pairs.length, 0);           // zu wenige Tage davor: kein Faktor
});
