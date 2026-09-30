// Synthetische Tests für js/calc.js – erfundene Mini-Daten, keine echten Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, addMonths, shiftYear, monthEnd, gran, carBucket } from '../js/calc.js';

const KEYS = ['ev', 'imp', 'n2h', 's2h', 's2b', 'bch', 'bdis', 'b2h', 'use', 'gen', 'feed', 'pv1', 'pv2', 'pv3', 'pv4'];
// 10 Tage ab 2025-01-01; Smart Meter ab 2025-01-06 (Tag 5)
function state(over = {}) {
  const n = 10, c = Object.fromEntries(KEYS.map(k => [k, Array(n).fill(0)]));
  for (let i = 0; i < n; i++) {
    c.gen[i] = 2; c.use[i] = 1.5; c.bch[i] = 1; c.bdis[i] = 0.8; c.b2h[i] = 0.7; c.s2h[i] = 0.8;
    c.imp[i] = i >= 5 ? 1 : 0; c.feed[i] = i >= 5 ? (i % 2 ? 0.5 : 0.1) : 0;
  }
  return {
    anker: { start: '2025-01-01', n, c },
    meters: [{ id: 'a1', group: 'as', order: 0 }, { id: 'a2', group: 'as', order: 1 }, { id: 'w', group: 'wp', order: 0 }],
    readings: [
      { m: 'a1', d: '2025-01-01', v: 1000 }, { m: 'a1', d: '2025-01-04', v: 1006 },   // 6 kWh / 3 Tage vor Smart Meter
      { m: 'a2', d: '2025-01-04', v: 0 }, { m: 'a2', d: '2025-01-11', v: 9 },          // Zählertausch, 9 kWh / 7 Tage
      { m: 'w', d: '2025-01-01', v: 50 }, { m: 'w', d: '2025-01-11', v: 150 },
    ],
    events: [{ d: '2025-01-06', group: 'pv', type: 'daten', text: 'Smart Meter' }],
    tariffs: [
      { id: 't1', group: 'as', name: 'AS', from: '2025-01-03', to: '', ap: 30, gp: 365, boni: 36.5 },
      { id: 't2', group: 'wp', name: 'WP', from: '2025-01-01', to: '', ap: 20, gp: 73, boni: 0 },
    ],
    abschlaege: [{ group: 'as', from: '2025-01-03', amount: 10 }],
    invest: [{ name: 'Kauf', date: '2025-01-01', cost: 5 }],
    fuel: [], charges: [], carlog: [],
    battery: { capGross: 2, reserve: 0, fullThresh: 0.3 }, pv: { kwp: 1 },
    amort: { priceInc: 0, degr: 0, years: 1, feedin: 0, feedinFrom: '' },
    cars: { ice: { rate: 0, km: 0, l100: 0, price: 0, priceSrc: 'manual', ins: 0, tax: 0, other: 0 },
            ev: { start: '', rate: 0, km: 0, kwh100: 0, loss: 0, shHome: 0, shPV: 0, pricePublic: 0, ins: 0, tax: 0, thg: 0, transfer: 0 } },
    ...over,
  };
}

test('Datumshilfen', () => {
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(shiftYear('2024-02-29'), '2023-02-28');
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(gran('2025-01-01', '2025-03-04'), 'day');
  assert.equal(gran('2025-01-01', '2025-03-05'), 'month');
  assert.equal(carBucket('2025-05-10', 'quarter'), '2025-Q2');
});

test('Zählertausch: Folgezähler mit Offset verkettet', () => {
  const g = createCalc(state()).groupSeries('as');
  assert.deepEqual(g.pts.map(p => [p.d, p.cum]), [['2025-01-01', 1000], ['2025-01-04', 1006], ['2025-01-11', 1015]]);
  assert.equal(g.intervals.length, 2);
});

test('Allgemeinstrom: nach Anker-Netzbezug verteilt, Rest gleichmäßig auf Tage vor dem Smart Meter', () => {
  const d = createCalc(state()).groupSeries('as').daily;
  // Intervall 04.–10.01.: 9 kWh; Smart Meter ab 06.01 mit je 1 kWh (5 Tage) -> 4 kWh auf 04. und 05.
  assert.equal(d['2025-01-06'], 1);
  assert.equal(d['2025-01-04'], 2);
  assert.equal(d['2025-01-05'], 2);
  assert.equal(d['2025-01-01'], 2);   // erstes Intervall gleichmäßig 6/3
  const sum = Object.values(d).reduce((a, b) => a + b, 0);
  assert.equal(sum, 15);
});

test('Wärmepumpe gleichmäßig je Tag', () => {
  const d = createCalc(state()).groupSeries('wp').daily;
  assert.equal(Object.keys(d).length, 10);
  assert.equal(d['2025-01-05'], 10);
});

test('Autarkie und Einspeisung nur, wenn mindestens die Hälfte des Zeitraums nach dem Smart Meter liegt', () => {
  const C = createCalc(state());
  const early = C.metrics('2025-01-01', '2025-01-07');           // 2 von 7 Tagen gemessen
  assert.equal(early.aut, null); assert.equal(early.feed, null); assert.equal(early.full, null);
  const late = C.metrics('2025-01-04', '2025-01-10');            // 5 von 7
  assert.equal(late.aut, 7.5 / (7.5 + 5));                       // Autarkie nur ab Smart Meter
  assert.equal(late.full, 3);                                     // Einspeisung ≥ 0,3 an Tag 5, 7, 9
  assert.equal(late.measured, 5);
  assert.ok(Math.abs(late.eff - 0.8) < 1e-12);
  assert.equal(late.evq, 0.75);
  assert.ok(Math.abs(late.cyc - 7 * 0.8 / 2) < 1e-12);
});

test('Stromkosten: Arbeitspreis + Grundpreis/365, Tage ohne Tarif getrennt, Boni im ersten Jahr', () => {
  const c = createCalc(state()).costs('as', '2025-01-01', '2025-01-10');
  assert.equal(c.unpricedDays, 2);                                // 01. und 02.01. vor Lieferbeginn
  assert.equal(c.unpricedKwh, 4);
  const p = c.per[0];
  assert.equal(p.days, 8);
  assert.ok(Math.abs(p.gpE - 8) < 1e-12);                         // 365 €/Jahr -> 1 €/Tag
  assert.ok(Math.abs(p.apE - p.kwh * 0.3) < 1e-12);
  assert.ok(Math.abs(p.bo - 0.8) < 1e-12);                        // 36,50 €/365 je Tag
});

test('Vermiedene Netzkosten: genutzt × Arbeitspreis ohne Grundpreis; Wert des Speichers: Speicher zu Haus × AP', () => {
  const C = createCalc(state());
  const m = C.metrics('2025-01-03', '2025-01-10');
  assert.ok(Math.abs(m.sav - 8 * 1.5 * 0.3) < 1e-12);
  assert.ok(Math.abs(m.battVal - 8 * 0.7 * 0.3) < 1e-12);
});

test('sumRange rechnet exakt (keine Fließkomma-Rundungsfehler)', () => {
  const s = state(); s.anker.c.s2h = [0.1, 0.2, 0.15, 0.05, 0, 0, 0, 0, 0, 0];
  assert.equal(createCalc(s).sumRange('s2h', '2025-01-01', '2025-01-10'), 0.5);
});

test('Abschlag-Check: gezahlt, Stand, passender Abschlag ab jetzt', () => {
  const r = createCalc(state()).abschlagCheck('as');
  assert.equal(r.today, '2025-01-10');
  assert.equal(r.nPaid, 0);                                       // erster Abschlag einen Monat nach Lieferbeginn
  assert.equal(r.cur, 10);
  assert.ok(r.recNow > 0);
  assert.ok(Math.abs(r.recNow - r.costTotal / 12) < 1e-9);
});

test('Kilometer zwischen zwei Ständen gleichmäßig; Verbrauch aus Volltank-Intervallen', () => {
  const s = state({
    fuel: [
      { d: '2025-01-01', km: 1000, l: 40, e: 70, full: true },
      { d: '2025-01-11', km: 1500, l: 30, e: 54, full: true },
    ],
  });
  const C = createCalc(s);
  const kd = C.kmDaily('leon');
  assert.equal(Object.keys(kd).length, 10);
  assert.equal(kd['2025-01-05'], 50);
  const fs = C.fuelStats();
  assert.equal(fs.l100, 6);
  assert.equal(C.fuelPrice(0).price, 124 / 70);
});

test('Amortisation: Investitionslinie stufig, Break-even', () => {
  const t = createCalc(state()).amortTimeline();
  assert.equal(t.labels.length, 12);
  assert.equal(t.cumI[0], 5);
  assert.equal(t.lastK, '2025-01');
  assert.ok(t.be === null || t.be >= '2025-01');
});

test('stateFromDb: Supabase-Zeilen ergeben dieselben Kennzahlen', () => {
  const s = state();
  const days = Array.from({ length: 10 }, (_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`);
  const col = { ev: 'eigenverbrauch', imp: 'netzimport', n2h: 'netz_zu_haus', s2h: 'solar_zu_haus', s2b: 'solar_zu_speicher',
    bch: 'speicher_ladung', bdis: 'speicher_entladung', b2h: 'speicher_zu_haus', use: 'genutzt', gen: 'erzeugung', feed: 'einspeisung',
    pv1: 'pv1', pv2: 'pv2', pv3: 'pv3', pv4: 'pv4' };
  const db = {
    anker_daily: days.map((day, i) => Object.fromEntries([['day', day], ...Object.entries(col).map(([k, c]) => [c, s.anker.c[k][i]])])).reverse(),
    meters: s.meters.map(m => ({ id: m.id, name: m.id, grp: m.group, sort: m.order })),
    meter_readings: s.readings.map(r => ({ meter_id: r.m, day: r.d, value: String(r.v) })),   // numeric kommt ggf. als Text
    events: s.events.map(e => ({ day: e.d, grp: e.group, type: e.type, note: e.text })),
    tariffs: s.tariffs.map(t => ({ id: t.id, grp: t.group, name: t.name, valid_from: t.from, valid_to: null, ap_ct: t.ap, gp_eur_year: t.gp, boni_eur: t.boni })),
    installments: s.abschlaege.map(a => ({ grp: a.group, valid_from: a.from, amount: a.amount })),
    investments: s.invest.map(x => ({ name: x.name, day: x.date, cost: x.cost })),
    settings: { data: { battery: s.battery, pv: s.pv, amort: s.amort, cars: s.cars } },
  };
  const a = createCalc(s), b = createCalc(stateFromDb(db));
  assert.deepEqual(b.metrics('2025-01-01', '2025-01-10'), a.metrics('2025-01-01', '2025-01-10'));
  const { t: tb, ...rb } = b.abschlagCheck('as'), { t: ta, ...ra } = a.abschlagCheck('as');
  assert.deepEqual(rb, ra);
  assert.equal(tb.name, ta.name);
});
