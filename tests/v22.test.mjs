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
