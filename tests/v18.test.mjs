// Synthetische Tests für v0.18: Erstattungen/Gutschriften als Ersparnis, Prognose §14a und THG-Prämie mit Ersatz durch
// gebuchte Gutschriften, Abschalter. Erfundene Werte.
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



const amort = { priceInc: 0, degr: 0, years: 3, feedin: 0, feedinFrom: '' };
const at = (t, k) => t.cumS[t.labels.indexOf(k)];

test('Erstattung zählt als Ersparnis, nicht als Investition', () => {
  const inv = [{ name: 'PV', date: '2025-01-01', cost: 100 }, { name: 'Förderung', date: '2025-01-20', cost: 30, cat: 'refund' }];
  const a = createCalc(state({ amort })).amortTimeline(), C = createCalc(state({ amort, invest: inv })), b = C.amortTimeline();
  assert.ok(Math.abs((at(b, '2025-01') - at(a, '2025-01')) - 30) < 1e-9);
  assert.equal(b.cumI[0], 100);
  assert.equal(C.investTotal(), 100);
});

test('THG-Prognose ab Übergabe, abschaltbar, gebuchte Prämie ersetzt 12 Monate', () => {
  const s = state({ amort }); s.cars.ev.start = '2025-03-01'; s.cars.ev.thg = 120;
  const t = createCalc(s).amortTimeline();
  const base = createCalc(state({ amort: { ...amort, thg: false } })).amortTimeline();
  assert.equal(t.thgK, '2025-03');
  assert.ok(Math.abs((at(t, '2025-03') - at(t, '2025-02')) - (at(base, '2025-03') - at(base, '2025-02')) - 10) < 1e-9, '120 €/Jahr = 10 €/Monat');
  const s2 = state({ amort, invest: [{ name: 'THG-Prämie 2025', date: '2025-04-10', cost: 120, cat: 'refund' }] }); s2.cars.ev.start = '2025-03-01'; s2.cars.ev.thg = 120;
  assert.equal(createCalc(s2).amortTimeline().thgK, '2026-04', 'Prognose erst 12 Monate nach der gebuchten Prämie');
  const s3 = state({ amort: { ...amort, thg: false } }); s3.cars.ev.start = '2025-03-01'; s3.cars.ev.thg = 120;
  assert.equal(createCalc(s3).amortTimeline().thgK, null);
});

test('§14a-Prognose nur mit Wallbox und eingeschaltetem §14a auf der Ausbau-Seite', () => {
  const inv = [{ name: 'WB', date: '2025-01-05', cost: 50, cat: 'wallbox' }];
  const s = state({ amort, invest: inv, ausbau: { s14a: true, s14aMod: 'manual', s14aEur: 240 } }); s.cars.ev.start = '2025-06-01';
  const t = createCalc(s).amortTimeline();
  assert.equal(t.s14Year, 240); assert.equal(t.s14K, '2025-06');
  assert.equal(createCalc(state({ amort, invest: inv, ausbau: { s14a: false } })).amortTimeline().s14K, null);
  assert.equal(createCalc(state({ amort, ausbau: { s14a: true, s14aEur: 240 } })).amortTimeline().s14K, null, 'ohne Wallbox keine §14a-Prognose');
  const off = state({ amort: { ...amort, s14aFc: false }, invest: inv, ausbau: { s14a: true, s14aEur: 240 } }); off.cars.ev.start = '2025-06-01';
  assert.equal(createCalc(off).amortTimeline().s14K, null);
});
