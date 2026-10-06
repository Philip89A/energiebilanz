// Synthetische Tests: gleitende Durchschnitte über Einträge (v0.24) und Tage (v0.23). Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movingAvg, movingAvgN } from '../js/calc.js';

test('v0.24: gleitender Ø über Einträge – gewichtet, Fenster n, Mindestanzahl', () => {
  // €/l mit Litern gewichtet = Kosten ÷ Liter
  const f = [{ y: 2.0, w: 40 }, { y: 1.8, w: 10 }, { y: 2.2, w: 50 }, { y: 1.9, w: 20 }];
  const v = movingAvgN(f, 3, 2);
  assert.equal(v[0], null);                                           // nur 1 Eintrag < minN
  assert.ok(Math.abs(v[1] - (80 + 18) / 50) < 1e-12);
  assert.ok(Math.abs(v[2] - (80 + 18 + 110) / 100) < 1e-12);
  assert.ok(Math.abs(v[3] - (18 + 110 + 38) / 80) < 1e-12);           // ältester fällt heraus
  assert.deepEqual(movingAvgN([{ y: 5, w: 0 }, { y: null, w: 3 }, { y: 7, w: 1 }], 3, 1), [null, null, 7]);
  assert.deepEqual(movingAvgN([], 5), []);
});

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
