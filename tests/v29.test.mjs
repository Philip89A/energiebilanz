// Synthetische Tests für v0.29: unausgefüllte Abschläge (0 € ohne Notiz) und Tarife (0 ct/kWh) zählen nicht. Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, abschlagEmpty, tariffEmpty } from '../js/calc.js';

const KEYS = ['ev', 'imp', 'n2h', 's2h', 's2b', 'bch', 'bdis', 'b2h', 'use', 'gen', 'feed', 'pv1', 'pv2', 'pv3', 'pv4'];
const state = over => { const n = 20, c = Object.fromEntries(KEYS.map(k => [k, Array(n).fill(1)]));
  return { anker: { start: '2026-01-01', n, c }, meters: [], readings: [], events: [], payments: [], invest: [], fuel: [], charges: [], carlog: [],
    tariffs: [{ id: 't1', group: 'as', name: 'Alt', from: '2025-01-01', to: '', ap: 30, gp: 120, boni: 0 }],
    abschlaege: [{ group: 'as', from: '2026-01-01', amount: 62, note: '' }],
    battery: {}, pv: { kwp: 1 }, amort: {}, cars: { ice: {}, ev: {} }, ...over }; };

test('v0.29: Abschlag 0 € ohne Notiz zählt nicht, mit Notiz schon', () => {
  assert.equal(abschlagEmpty({ amount: 0, note: '' }), true); assert.equal(abschlagEmpty({ amount: 0, note: 'kein Abschlag mehr' }), false);
  assert.equal(abschlagEmpty({ amount: 62 }), false);
  const A = s => createCalc(state({ abschlaege: [{ group: 'as', from: '2026-01-01', amount: 62, note: '' }, s] })).abschlagAt('as', '2026-02-01');
  assert.equal(A({ group: 'as', from: '2026-01-15', amount: 0, note: '' }), 62);
  assert.equal(A({ group: 'as', from: '2026-01-15', amount: 0, note: 'Vertrag beendet' }), 0);
  assert.equal(A({ group: 'as', from: '2026-01-15', amount: 59, note: '' }), 59);
});

test('v0.29: Tarif ohne Arbeitspreis zählt nicht', () => {
  assert.equal(tariffEmpty({ ap: 0 }), true); assert.equal(tariffEmpty({ ap: '' }), true); assert.equal(tariffEmpty({ ap: 33.1 }), false);
  const C = createCalc(state({ tariffs: [{ id: 't1', group: 'as', name: 'Alt', from: '2025-01-01', to: '', ap: 30, gp: 120, boni: 0 },
    { id: 't2', group: 'as', name: 'Neuer Tarif', from: '2026-01-10', to: '', ap: 0, gp: 0, boni: 0 }] }));
  assert.equal(C.tariffAt('as', '2026-01-15').id, 't1'); assert.equal(C.currentTariff('as').id, 't1');
});
