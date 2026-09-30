// Synthetische Tests für v0.7: Abschlag-Check mit künftigen Beträgen und Zahlungsbuch, Boni-Posten mit Bedingung,
// Gesamtbilanz (Tarifwechsel, Boni), Abrechnungsjahre, Vorschläge, Tarifrechner. Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, toDb, tarifRechner } from '../js/calc.js';

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
            ev: { start: '', rate: 0, km: 10000, kwh100: 20, loss: 10, shHome: 50, shPV: 20, pricePublic: 0, ins: 0, tax: 0, thg: 0, transfer: 0 } },
    ...over,
  };
}

test('Abschlag-Check: künftige Abschläge mit dem Betrag zum Fälligkeitstag, aktueller Betrag zum Kalendertag', () => {
  const r = createCalc(state()).abschlagCheck('as', '2025-03-20');
  assert.equal(r.today, '2025-02-09');
  assert.equal(r.nPaid, 1);                                 // 01.02.
  assert.equal(r.paid, 10);
  // offen: 01.03. (10) und 01.04.–01.01.26 (10 × 5)
  assert.equal(r.payTotal, 10 + 10 + 10 * 5);
  assert.equal(r.cur, 5);
  assert.equal(r.nextDue, '2025-03-01');
  assert.equal(r.paidSource, 'annahme');
});

test('Abschlag-Check: erfasste Zahlungen ersetzen die Annahme', () => {
  const s = state({ payments: [{ group: 'as', d: '2025-01-05', amount: 12, kind: 'abschlag' }, { group: 'as', d: '2025-02-01', amount: 12, kind: 'abschlag' },
    { group: 'as', d: '2025-02-01', amount: 99, kind: 'bonus' }] });
  const r = createCalc(s).abschlagCheck('as');
  assert.equal(r.paidSource, 'buch');
  assert.equal(r.paid, 24); assert.equal(r.nPaid, 2); assert.equal(r.nExpected, 1);
});

test('Boni-Posten: Bedingung nicht erfüllt → Ersatzbetrag; ohne Posten Summe wie bisher', () => {
  const s = state(); s.tariffs[0].boniItems = [{ name: 'Sofortbonus', amount: 10 }, { name: 'Neukundenbonus', amount: 20, minKwh: 100000, amountBelow: 5 }];
  const C = createCalc(s), bi = C.boniInfo(s.tariffs[0]);
  assert.equal(bi.total, 30); assert.equal(bi.effective, 15);
  assert.equal(bi.items[1].met, false);
  assert.equal(C.boniOf(s.tariffs[2]), 36.5);
  const bo = C.costs('as', '2025-01-01', '2025-01-10').per[0].bo;
  assert.ok(Math.abs(bo - 10 * 15 / 365) < 1e-9, 'Kosten nutzen die wirksamen Boni');
  s.tariffs[0].boniItems[1].minKwh = 1;
  assert.equal(createCalc(s).boniOf(s.tariffs[0]), 30, 'Bedingung erfüllt');
});

test('Gesamtbilanz: Tarifwechsel gegen Vorvertrag, Boni tagesanteilig, PV-Ersparnis', () => {
  const C = createCalc(state()), b = C.energyBalance('2025-01-21', '2025-01-30');
  // WP: 20 kWh/Tag, 10 Tage, 10 ct günstiger → 20 €; Grundpreis gleich
  assert.ok(Math.abs(b.switchWp - 20) < 1e-9);
  assert.ok(Math.abs(b.boniWp - 10 * 36.5 / 365) < 1e-9);
  assert.equal(b.switchAs, 0);
  assert.ok(Math.abs(b.pv - 10 * 1.5 * 0.3) < 1e-9);
  assert.ok(Math.abs(b.total - (b.pv + b.switchWp + b.boniWp)) < 1e-9);
});

test('Abrechnungsjahre: Erstattung nach Vertragsende gehört zum beendeten Jahr', () => {
  const s = state({ payments: [
    { group: 'wp', d: '2025-01-10', amount: 50, kind: 'abschlag' },
    { group: 'wp', d: '2025-02-05', amount: 30, kind: 'erstattung' },
  ] });
  const ps = createCalc(s).billingPeriods('wp', '2025-02-09');
  const alt = ps.find(p => p.t.id === 'w1');
  assert.equal(alt.abschlag, 50); assert.equal(alt.erstattung, 30); assert.equal(alt.closed, true); assert.equal(alt.settled, true);
  assert.ok(Math.abs(alt.cost - (20 * 20 * 0.2 + 20 * 73 / 365)) < 1e-9);
  assert.ok(Math.abs(alt.diff - (20 - alt.netCost)) < 1e-9);
});

test('Zahlungsvorschläge aus dem Abschlagsplan, vorhandene Zahlungen (±12 Tage) ausgenommen', () => {
  const s = state({ payments: [{ group: 'as', d: '2025-02-03', amount: 10, kind: 'abschlag' }] });
  const v = createCalc(s).paymentSuggestions('2025-04-10');
  assert.deepEqual(v.map(x => [x.d, x.amount]), [['2025-03-01', 10], ['2025-04-01', 5]]);
});

test('Tarifrechner: Jahreskosten, Angebote, Wallbox-Module', () => {
  const base = { asKwh: 1000, wpKwh: 3000, evGrid: 800 };
  const cur = { as: { name: 'AS', ap: 30, gp: 120, boni: 0 }, wp: { name: 'WP', ap: 20, gp: 90, boni: 0 } };
  const r = tarifRechner(base, cur, { withEv: true, offers: [{ name: 'Neu', grp: 'as', ap: 28, gp: 150, boni: 100 }],
    m1Eur: 100, neAp: 8, neHt: 12, neSt: 8, neNt: 2, shNt: 70, shHt: 10, m2MeterEur: 60, imsysNew: 50, imsysOld: 20 });
  assert.equal(r.groups.as.kwh, 1800);
  assert.equal(r.groups.as.current.y2, 1800 * 0.30 + 120);
  const o = r.groups.as.offers[0];
  assert.ok(Math.abs(o.y1 - (1800 * 0.28 + 150 - 100)) < 1e-9);
  assert.ok(Math.abs(o.diffY2 - ((1800 * 0.28 + 150) - (1800 * 0.30 + 120))) < 1e-9);
  const w = Object.fromEntries(r.wallbox.map(x => [x.key, x.eur]));
  assert.equal(w.none, 800 * 0.30);
  assert.equal(w.m1, 240 - 100);
  assert.ok(Math.abs(w.m2 - (800 * (30 - 4.8) / 100 + 60)) < 1e-9);
  const shift = 800 * (0.7 * 6 - 0.1 * 4) / 100;               // 30,40 €
  assert.ok(Math.abs(w.m3 - (240 - 100 - shift + 30)) < 1e-9);
  assert.equal(r.best.key, 'm3');                               // 139,60 € knapp vor Modul 1 mit 140 €
});

test('Rundlauf Supabase-Format: Zahlungen und Boni-Posten', () => {
  const db = { anker_daily: [{ day: '2025-01-01', erzeugung: 1 }],
    payments: [{ id: 'p', grp: 'as', day: '2025-01-05', amount: 12, kind: 'abschlag', note: null }],
    tariffs: [{ id: 't', grp: 'as', name: 'T', valid_from: '2025-01-01', valid_to: null, ap_ct: 30, gp_eur_year: 100, boni_eur: 30, boni_note: null, estimate_note: null,
      boni_items: [{ name: 'A', amount: 30 }] }] };
  const s = stateFromDb(db);
  assert.deepEqual(s.payments.map(toDb.payment), db.payments);
  assert.deepEqual(toDb.tariff(s.tariffs[0]), db.tariffs[0]);
  const noItems = toDb.tariff({ ...s.tariffs[0], boniItems: undefined });
  assert.ok(!('boni_items' in noItems), 'ohne Posten wird die neue Spalte nicht gesendet');
});

test('parseBoniNote: Posten, Kommabeträge, Mengenbedingung', async () => {
  const { parseBoniNote } = await import('../js/calc.js');
  assert.deepEqual(parseBoniNote('Sofortbonus 99,32 € + Neukundenbonus 150 €'), [{ name: 'Sofortbonus', amount: 99.32 }, { name: 'Neukundenbonus', amount: 150 }]);
  assert.deepEqual(parseBoniNote('Sofort 10 € + Neukunde 80 € (bei unter 2.000 kWh evtl. nur 50 €)')[1], { name: 'Neukunde', amount: 80, minKwh: 2000, amountBelow: 50 });
  assert.deepEqual(parseBoniNote(''), []);
});
