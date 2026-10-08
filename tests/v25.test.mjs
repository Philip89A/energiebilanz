// Synthetische Tests für v0.25: Wasser (Zählergruppe water, l/Tag, l/Person, Kosten, auffällige Intervalle).
// Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc } from '../js/calc.js';

const KEYS = ['ev', 'imp', 'n2h', 's2h', 's2b', 'bch', 'bdis', 'b2h', 'use', 'gen', 'feed', 'pv1', 'pv2', 'pv3', 'pv4'];
function state(over = {}) {
  const n = 40, c = Object.fromEntries(KEYS.map(k => [k, Array(n).fill(0)]));
  for (let i = 0; i < n; i++) { c.gen[i] = 2; c.use[i] = 1.5; c.imp[i] = 1; }
  return {
    anker: { start: '2025-01-01', n, c },
    meters: [{ id: 'a', group: 'as', order: 0 }, { id: 'w', group: 'wp', order: 0 }],
    readings: [{ m: 'a', d: '2025-01-01', v: 0 }, { m: 'a', d: '2025-02-10', v: 400 }, { m: 'w', d: '2025-01-01', v: 0 }, { m: 'w', d: '2025-02-10', v: 800 }],
    events: [{ d: '2025-01-01', group: 'pv', type: 'daten', text: 'Start' }],
    tariffs: [
      { id: 'as1', group: 'as', name: 'AS', from: '2025-01-01', to: '', ap: 30, gp: 365, boni: 0 },
      { id: 'w1', group: 'wp', name: 'WP alt', from: '2025-01-01', to: '2025-01-20', ap: 20, gp: 73, boni: 0 },
      { id: 'w2', group: 'wp', name: 'WP neu', from: '2025-01-21', to: '', ap: 10, gp: 73, boni: 36.5 },
    ],
    abschlaege: [{ group: 'as', from: '2025-01-01', amount: 10 }, { group: 'as', from: '2025-03-15', amount: 5 }],
    payments: [], invest: [{ name: 'X', date: '2025-01-01', cost: 100 }], fuel: [], charges: [], carlog: [],
    battery: { capGross: 2, reserve: 0, fullThresh: 0.3 }, pv: { kwp: 1 },
    amort: { priceInc: 0, degr: 0, years: 1, feedin: 0, feedinFrom: '' },
    cars: { ice: { rate: 0, km: 0, l100: 0, price: 0, priceSrc: 'manual', ins: 0, tax: 0, other: 0 },
            ev: { start: '', rate: 0, km: 10000, kwh100: 20, loss: 10, shHome: 50, shPV: 20, pricePublic: 0.5, ins: 0, tax: 0, thg: 0, transfer: 0 } },
    ...over,
  };
}

import { toDb, stateFromDb } from '../js/calc.js';
const water = (readings, w = {}) => state({
  meters: [{ id: 'a', group: 'as', order: 0 }, { id: 'w', group: 'wp', order: 0 }, { id: 'water', group: 'water', order: 0 }],
  readings: [...state().readings, ...readings.map(([d, v]) => ({ m: 'water', d, v }))], water: w });

test('v0.25: Wasser – m³, l/Tag, l/Person, Kosten mit Abwasser und Grundgebühr anteilig', () => {
  const C = createCalc(water([['2025-01-01', 100], ['2025-01-11', 104], ['2025-01-21', 107]], { persons: 3, priceM3: 2, sewageM3: 3, baseYear: 36.5 }));
  const a = C.waterStats('2025-01-01', '2025-01-20');
  assert.ok(Math.abs(a.m3 - 7) < 1e-9); assert.equal(a.days, 20);
  assert.ok(Math.abs(a.lpd - 350) < 1e-9); assert.ok(Math.abs(a.lpp - 350 / 3) < 1e-9);
  assert.equal(a.priceM3, 5); assert.ok(Math.abs(a.cost - (7 * 5 + 36.5 * 20 / 365)) < 1e-9);
  const b = C.waterStats('2025-01-11', '2025-01-20');                 // nur zweites Intervall
  assert.ok(Math.abs(b.m3 - 3) < 1e-9); assert.ok(Math.abs(b.lpd - 300) < 1e-9);
  assert.equal(C.groupSeries('as').intervals.length, 1, 'Wasser verändert den Allgemeinstrom nicht');
});

test('v0.25: Wasser – ohne Preise keine Kosten, ohne Personen 1 Person', () => {
  const C = createCalc(water([['2025-01-01', 1], ['2025-01-05', 1.4]]));
  const a = C.waterStats('2025-01-01', '2025-01-04');
  assert.equal(a.cost, null); assert.equal(a.persons, 1); assert.ok(Math.abs(a.lpd - 100) < 1e-9);
  assert.equal(createCalc(state()).waterStats('2025-01-01', '2025-01-31').days, 0);
});

test('v0.25: Wasser – auffälliges Intervall über 150 % des Medians (ab 4 Intervallen)', () => {
  const r = [['2025-01-01', 0], ['2025-01-08', 0.7], ['2025-01-15', 1.4], ['2025-01-22', 2.1], ['2025-01-29', 3.5]];
  const a = createCalc(water(r)).waterStats('2025-01-01', '2025-01-31');
  assert.equal(a.high.length, 1); assert.equal(a.high[0].from, '2025-01-22');
  assert.equal(createCalc(water(r.slice(0, 4))).waterStats('2025-01-01', '2025-01-31').high.length, 0);
});

test('v0.25: Wasser – Einstellungen und Zähler werden gespeichert und gelesen', () => {
  const S = { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} }, water: { persons: 3, priceM3: 2.1 } };
  assert.deepEqual(toDb.settings(S).data.water, { persons: 3, priceM3: 2.1 });
  assert.equal(toDb.settings({ ...S, water: {} }).data.water, undefined);
  assert.deepEqual(stateFromDb({ settings: { data: { water: { persons: 3 } } } }).water, { persons: 3 });
  assert.deepEqual(toDb.meter({ id: 'water', name: 'Wasser', group: 'water', order: 0 }), { id: 'water', name: 'Wasser', grp: 'water', sort: 0 });
});
