// Synthetische Tests für v0.22: Trendlinie (lineare Regression, gewichtet). Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linTrend } from '../js/calc.js';

test('v0.22: Trend – Gerade durch exakte Punkte, Steigung je Tag und Monat', () => {
  const t = linTrend([{ d: '2026-01-01', y: 1 }, { d: '2026-01-11', y: 2 }, { d: '2026-01-21', y: 3 }]);
  assert.equal(t.n, 3);
  assert.ok(Math.abs(t.perDay - 0.1) < 1e-12);
  assert.ok(Math.abs(t.perMonth - 3.044) < 1e-9);
  assert.ok(Math.abs(t.at('2026-01-31') - 4) < 1e-9);
});

test('v0.22: Trend – Gewichte ziehen die Gerade, Gewicht 0 und ungültige Werte zählen nicht', () => {
  const a = linTrend([{ d: '2026-01-01', y: 0 }, { d: '2026-01-02', y: 0 }, { d: '2026-01-03', y: 10, w: 0 }, { d: '2026-01-04', y: null }]);
  assert.equal(a.perDay, 0); assert.equal(a.n, 2);
  const flat = linTrend([{ d: '2026-01-01', y: 5, w: 10 }, { d: '2026-01-10', y: 5, w: 1 }]);
  assert.equal(flat.perDay, 0); assert.equal(flat.at('2026-03-01'), 5);
});

test('v0.22: Trend – weniger als zwei verschiedene Tage ergibt keinen Trend', () => {
  assert.equal(linTrend([]), null);
  assert.equal(linTrend([{ d: '2026-01-01', y: 1 }, { d: '2026-01-01', y: 3 }]), null);
});

import { movingAvg } from '../js/calc.js';
test('v0.23: gleitender Durchschnitt – letzte N Tage einschließlich, Lücken übersprungen, Mindestanzahl', () => {
  const daily = {}; for (let i = 1; i <= 40; i++) daily[`2026-01-${String(i).padStart(2, '0')}`] = i;   // Tage 01–31 gültig
  const v = movingAvg(daily, ['2026-01-31', '2026-01-10', '2026-01-05'], 30, 5);
  assert.equal(v[0], (2 + 31) / 2);          // 02.–31.01.
  assert.equal(v[1], 5.5);                    // 01.–10.01., nur 10 Tage mit Wert
  assert.equal(v[2], 3);                      // 5 Tage = Mindestanzahl
  assert.equal(movingAvg(daily, ['2026-01-04'], 30, 5)[0], null);
  assert.equal(movingAvg({ '2026-02-01': 2, '2026-02-03': 4 }, ['2026-02-03'], 3, 2)[0], 3);
  assert.equal(movingAvg({ '2026-02-01': 0 }, ['2026-02-01'], 30, 1)[0], 0);
});
