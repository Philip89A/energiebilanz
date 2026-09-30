// Synthetische Tests für v0.10: Gradtage, Wärmepumpen-Modell vor/nach Tausch, PV gegen Einstrahlung,
// Open-Meteo-Umrechnung, Einstellungen. Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, toDb, addDays } from '../js/calc.js';
import { toRows } from '../js/weather.js';

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


const wx = (from, n, f) => Array.from({ length: n }, (_, i) => { const d = addDays(from, i); return { d, ...f(i, d) }; });

test('Gradtage nach VDI 3807 (20/15), Intervall ohne Endtag', () => {
  const s = state({ weather: wx('2025-01-01', 10, i => ({ t: i < 5 ? 0 : 16, rad: 1, sun: 1 })) });
  const g = createCalc(s).degreeDays('2025-01-01', '2025-01-11');
  assert.equal(g.gt, 5 * 20); assert.equal(g.days, 10); assert.equal(g.missing, 0);
  assert.equal(createCalc(s).degreeDays('2025-01-01', '2025-01-12').missing, 1);
  s.wx = { heatLimit: 17, room: 21 };
  assert.equal(createCalc(s).degreeDays('2025-01-01', '2025-01-11').gt, 5 * 21 + 5 * 5);
});

test('Wärmepumpe: Modell trennt Grundlast und Heizarbeit, alt gegen neu bei gleichem Wetter', () => {
  // Temperatur schwankt je Woche; Zählerstände wöchentlich; alt: 3 kWh/Tag + 0,5 kWh/Gradtag, neu: 2 + 0,3
  const n = 140, temps = i => [0, 5, 10, 14, 18][Math.floor(i / 7) % 5];
  const weather = wx('2025-01-01', n, i => ({ t: temps(i), rad: 1, sun: 1 }));
  const sw = addDays('2025-01-01', 70);
  const readings = []; let v = 0;
  for (let i = 0; i <= n; i += 7) { readings.push({ m: 'w', d: addDays('2025-01-01', i), v });
    for (let j = i; j < i + 7; j++) { const t = temps(j), gt = t < 15 ? 20 - t : 0, old = addDays('2025-01-01', j) < sw; v += old ? 3 + 0.5 * gt : 2 + 0.3 * gt; } }
  const s = state({ weather, readings: [{ m: 'a', d: '2025-01-01', v: 0 }, ...readings], events: [...state().events, { d: sw, group: 'wp', type: 'geraet', text: 'Tausch' }] });
  const r = createCalc(s).wpWeather();
  assert.ok(Math.abs(r.groups.alt.base - 3) < 1e-6 && Math.abs(r.groups.alt.k - 0.5) < 1e-6);
  assert.ok(Math.abs(r.groups.neu.base - 2) < 1e-6 && Math.abs(r.groups.neu.k - 0.3) < 1e-6);
  assert.ok(Math.abs(r.groups.alt.year - (3 * 365 + 0.5 * r.ref.gt)) < 1e-6);
  assert.ok(r.groups.neu.year < r.groups.alt.year);
});

test('Wärmepumpe: zu wenige Intervalle → kein Modell', () => {
  const s = state({ weather: wx('2025-01-01', 40, () => ({ t: 5, rad: 1, sun: 1 })) });
  const r = createCalc(s).wpWeather();
  assert.equal(r.groups.alle, null);
  assert.equal(createCalc(state()).wpWeather(), null);
});

test('PV gegen Einstrahlung: Ertragsfaktor und auffällige Sonnentage', () => {
  const weather = wx('2025-01-01', 40, i => ({ t: 5, rad: i % 2 ? 4 : 2, sun: 3 }));
  const s = state({ weather }); s.anker.c.gen = s.anker.c.gen.map((_, i) => (i % 2 ? 4 : 2) * 0.8);
  s.anker.c.gen[21] = 0.5;   // sonniger Tag mit wenig Ertrag
  const r = createCalc(s).pvWeather('2025-01-01', '2025-01-31');
  assert.equal(r.months.length, 1);
  assert.equal(r.odd.length, 1); assert.equal(r.odd[0].d, '2025-01-22');
  assert.ok(Math.abs(r.odd[0].expected - 0.8 * 4) < 1e-9);
});

test('Open-Meteo: Umrechnung MJ/m² → kWh/m², Sekunden → Stunden, Lücken fallen weg', () => {
  const rows = toRows({ daily: { time: ['2025-06-01', '2025-06-02'], temperature_2m_mean: [18.2, null], shortwave_radiation_sum: [25.2, 10], sunshine_duration: [36000, 0] } });
  assert.deepEqual(rows, [{ day: '2025-06-01', temp_mean: 18.2, rad_kwh: 7, sun_h: 10 }]);
});

test('Wetter aus Supabase und Standort in den Einstellungen', () => {
  const s = stateFromDb({ anker_daily: [], weather_daily: [{ day: '2025-01-02', temp_mean: '1.5', rad_kwh: '0.8', sun_h: null }, { day: '2025-01-01', temp_mean: 2, rad_kwh: 1, sun_h: 2 }],
    settings: { data: { wx: { name: 'Ort', lat: 1.23, lon: 4.56 } } } });
  assert.deepEqual(s.weather.map(w => w.d), ['2025-01-01', '2025-01-02']);
  assert.equal(s.weather[1].t, 1.5); assert.equal(s.weather[1].sun, null);
  assert.deepEqual(toDb.settings(s).data.wx, { name: 'Ort', lat: 1.23, lon: 4.56 });
  assert.equal(stateFromDb({ anker_daily: [], weatherError: 'fehlt' }).weatherError, 'fehlt');
});

test('Wetterbericht fürs Überblick: Monat gegen Vorjahr', () => {
  const s = state({ weather: wx('2024-01-01', 500, () => ({ t: 3, rad: 2, sun: 1 })) });
  const n = createCalc(s).weatherNote();
  assert.equal(n.month, '2025-02'); assert.ok(n.prev && n.prev.n === n.cur.n);
});
