// Synthetische Tests für v0.9: Investitions-Kategorie, Wallbox-Ersparnis in der Amortisation, E-Auto im
// Allgemeinstrom (Tarifbasis ohne Doppelzählung), Abschlag-Hinweis ab Übergabe. Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, toDb } from '../js/calc.js';

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


test('Ohne Wallbox-Investition bleibt die Amortisation wie bisher', () => {
  const a = createCalc(state()).amortTimeline();
  const b = createCalc(state({ charges: [{ d: '2025-01-10', k: 20, e: 0, o: 'zu Hause' }] })).amortTimeline();
  assert.deepEqual(b.cumS, a.cumS);
  assert.equal(b.wbFrom, null);
});

test('Wallbox: gemessene Ersparnis aus Laden zu Hause ab der Wallbox-Investition', () => {
  const inv = [{ name: 'PV', date: '2025-01-01', cost: 100 }, { name: 'WB', date: '2025-01-05', cost: 50, cat: 'wallbox' }];
  const charges = [{ d: '2025-01-03', k: 10, e: 0, o: 'zu Hause' }, { d: '2025-01-10', k: 20, e: 0, o: 'zu Hause' }, { d: '2025-01-12', k: 30, e: 9, o: 'öffentlich DC' }];
  const a = createCalc(state({ invest: inv.map(({ cat, ...x }) => x) })).amortTimeline();
  const C = createCalc(state({ invest: inv, charges })), b = C.amortTimeline();
  assert.equal(b.wbFrom, '2025-01-05');
  assert.ok(Math.abs((b.cumS[0] - a.cumS[0]) - 20 * (0.5 - 0.3)) < 1e-9, 'nur die Ladung nach der Investition, nur zu Hause');
  assert.ok(Math.abs(C.homeCharging('2025-01-01', '2025-12-31').kwh - 30) < 1e-9);
});

test('Wallbox-Prognose ab Übergabe des E-Autos', () => {
  const s = state({ invest: [{ name: 'WB', date: '2025-01-05', cost: 50, cat: 'wallbox' }], amort: { priceInc: 0, degr: 0, years: 3, feedin: 0, feedinFrom: '' } });
  s.cars.ev.start = '2025-06-01';
  const t = createCalc(s).amortTimeline(), i5 = t.labels.indexOf('2025-05'), i6 = t.labels.indexOf('2025-06');
  const t0 = createCalc(state({ amort: s.amort })).amortTimeline();
  assert.ok(Math.abs((t.cumS[i5] - t0.cumS[i5])) < 1e-9, 'vor Übergabe keine Prognose');
  const evHome = 10000 / 100 * 20 * 1.1 * 0.5;
  assert.ok(Math.abs(t.wbYear - evHome * (0.5 - 0.3)) < 1e-9);
  assert.ok(Math.abs((t.cumS[i6] - t0.cumS[i6]) - t.wbYear / 12) < 1e-9);
});

test('Tarifbasis: Netzanteil des Ladens zu Hause wird aus dem Allgemeinstrom herausgerechnet', () => {
  const a = createCalc(state()).tariffBase();
  const b = createCalc(state({ charges: [{ d: '2025-01-20', k: 50, e: 0, o: 'zu Hause' }] })).tariffBase();
  assert.ok(Math.abs(b.homeGrid - 50 * 0.8) < 1e-9);
  assert.ok(Math.abs(a.asKwh - b.asKwh - 40) < 1e-9);
  assert.equal(b.asMeter, a.asKwh);
});

test('Abschlag-Hinweis ab Übergabe, nicht mehr lange danach', () => {
  const s = state(); s.cars.ev.start = '2025-03-01';
  const h = createCalc(s).evAbschlagHint();
  assert.ok(h && Math.abs(h.kwhMonth - 10000 / 100 * 20 * 1.1 * 0.5 * 0.8 / 12) < 1e-9);
  assert.ok(Math.abs(h.eurMonth - h.kwhMonth * 0.3) < 1e-9);
  s.cars.ev.start = '2024-06-01';
  assert.equal(createCalc(s).evAbschlagHint(), null);
  s.cars.ev.start = '';
  assert.equal(createCalc(s).evAbschlagHint(), null);
});

test('Kategorie: Hin- und Rückweg Supabase, ohne Kategorie keine Spalte', () => {
  const rows = [{ id: 'i1', day: '2025-01-01', name: 'A', cost: 1, category: 'wallbox' }, { id: 'i2', day: null, name: 'B', cost: 2 }];
  const s = stateFromDb({ anker_daily: [], investments: rows });
  assert.equal(s.invest[0].cat, 'wallbox');
  assert.deepEqual(s.invest.map(toDb.investment), rows);
});
