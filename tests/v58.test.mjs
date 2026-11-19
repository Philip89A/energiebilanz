// v0.58: Vergleich öffentliches Laden (Tarife mit „gültig ab“, Grundgebühr, Blockiergebühr, automatisch günstigster),
// „Was wäre, wenn“ und Fremdladungen an der Wallbox. Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, toDb } from '../js/calc.js';

const KEYS = ['ev', 'imp', 'n2h', 's2h', 's2b', 'bch', 'bdis', 'b2h', 'use', 'gen', 'feed', 'pv1', 'pv2', 'pv3', 'pv4'];
const T = (name, ap, fee, from = '2025-01-01') => ({ name, from, ap, fee, blockMin: 240, blockEur: 0.1, blockMax: 12, kw: 10 });
function state(ev = {}, over = {}) {
  const n = 60, c = Object.fromEntries(KEYS.map(k => [k, Array(n).fill(0)]));
  for (let i = 0; i < n; i++) { c.gen[i] = 2; c.use[i] = 1; }
  return {
    anker: { start: '2025-01-01', n, c }, meters: [], readings: [], events: [],
    tariffs: [{ id: 'a', group: 'as', name: 'AS', from: '2025-01-01', to: '', ap: 30, gp: 0, boni: 0 }],
    abschlaege: [], payments: [], fuel: [], carlog: [],
    invest: [{ name: 'PV', date: '2025-01-01', cost: 100 }, { name: 'WB', date: '2025-01-01', cost: 50, cat: 'wallbox' }],
    charges: [], battery: { capGross: 2, reserve: 0, fullThresh: 0.3 }, pv: { kwp: 1 },
    amort: { priceInc: 0, degr: 0, years: 2, feedin: 0, feedinFrom: '' },
    cars: { ice: { rate: 0, km: 0, l100: 0, price: 0, priceSrc: 'manual', ins: 0, tax: 0, other: 0 },
      ev: { start: '2025-01-01', km: 10000, kwh100: 20, loss: 0, shHome: 100, shPV: 0, pricePublic: 0.6, thg: 0,
        pubTariffs: [T('S', 0.56, 0), T('M', 0.46, 6), T('L', 0.39, 12)], ...ev } },
    ...over,
  };
}

test('automatisch: günstigster Tarif für die Jahresmenge (2.000 kWh → L)', () => {
  const C = createCalc(state());
  assert.equal(C.pubTariff('2025-02-01').name, 'L');
  assert.ok(Math.abs(C.pubEff('2025-02-01') - (2000 * 0.39 + 144) / 2000) < 1e-9);
  const small = createCalc(state({ km: 2500 }));   // 500 kWh → S
  assert.equal(small.pubTariff('2025-02-01').name, 'S');
});

test('Blockiergebühr: Dauer = kWh ÷ Säulenleistung, ab 240 min 0,10 €/min, höchstens 12 €', () => {
  const C = createCalc(state()), t = C.pubTariffAt('L', '2025-02-01');
  assert.equal(C.pubBlock(40, t), 0);                     // 4 h genau
  assert.ok(Math.abs(C.pubBlock(45, t) - 3) < 1e-9);      // 4,5 h → 30 min
  assert.equal(C.pubBlock(200, t), 12);                   // gedeckelt
});

test('gemessen: kWh × Preis + Blockiergebühr − Arbeitspreis, dazu Grundgebühr je Monat; Fremdladung mit Marge', () => {
  const charges = [{ d: '2025-01-10', k: 45, e: 0, o: 'zu Hause' }, { d: '2025-01-20', k: 10, e: 5, o: 'zu Hause', g: true }];
  const C = createCalc(state({ pubChoice: 'L' }, { charges }));
  const h = C.homeCharging('2025-01-01', '2025-01-31');
  assert.equal(h.kwh, 45); assert.ok(Math.abs(h.block - 3) < 1e-9); assert.ok(Math.abs(h.fee - 12) < 1e-9);
  assert.ok(Math.abs(h.saving - (45 * (0.39 - 0.3) + 3 + 12)) < 1e-9);
  assert.equal(h.guest.kwh, 10); assert.ok(Math.abs(h.guest.margin - (5 - 10 * 0.3)) < 1e-9);
  const tl = C.amortTimeline(), t0 = createCalc(state({ pubChoice: 'L' })).amortTimeline();
  assert.ok(Math.abs((tl.cumS[0] - t0.cumS[0]) - (h.saving + h.guest.margin - 12)) < 1e-9, 'Grundgebühr zählt auch ohne Ladung, nur die Ladungen kommen dazu');
});

test('Preisänderung mit „gültig ab“: frühere Ladungen behalten den alten Preis', () => {
  const C = createCalc(state({ pubChoice: 'L', pubTariffs: [T('L', 0.39, 0), T('L', 0.49, 0, '2025-02-01')] },
    { charges: [{ d: '2025-01-10', k: 10, e: 0, o: 'zu Hause' }, { d: '2025-02-10', k: 10, e: 0, o: 'zu Hause' }] }));
  assert.ok(Math.abs(C.homeCharging('2025-01-01', '2025-01-31').saving - 10 * 0.09) < 1e-9);
  assert.ok(Math.abs(C.homeCharging('2025-02-01', '2025-02-28').saving - 10 * 0.19) < 1e-9);
});

test('Was wäre, wenn: anderer Tarif verschiebt die Prognose, ohne die Einstellung zu ändern', () => {
  const C = createCalc(state({ pubChoice: 'L' }));
  const a = C.amortTimeline(), b = C.amortTimeline({ pub: 'S' }), c = C.amortTimeline({ pub: { name: 'x', ap: 0.7, fee: 0 } });
  assert.ok(Math.abs(a.wbYear - (2000 * 0.39 + 144 - 2000 * 0.3)) < 1e-9);
  assert.ok(Math.abs(b.wbYear - 2000 * (0.56 - 0.3)) < 1e-9);
  assert.ok(Math.abs(c.wbYear - 2000 * 0.4) < 1e-9);
  assert.equal(createCalc(state({ pubChoice: 'L' })).amortTimeline().pub.name, 'L');
});

test('Fremdladung: nicht im eigenen Laden, nicht im Kilometerstand; guest nur mit Spalte oder wenn gesetzt', () => {
  const s = stateFromDb({ charge_log: [{ id: '1', day: '2025-01-05', kwh: 10, amount: 4, location: 'zu Hause', odometer: 100, guest: true }],
    settings: { data: { cars: { ice: {}, ev: {} } } } });
  assert.equal(s.charges[0].g, true);
  assert.equal(toDb.charge(s.charges[0]).guest, true);
  assert.equal('guest' in toDb.charge({ d: '2025-01-05', k: 1, o: 'zu Hause' }), false);
  assert.equal(toDb.charge({ d: '2025-01-05', k: 1, o: 'zu Hause', g: false, gk: true }).guest, false);
});
