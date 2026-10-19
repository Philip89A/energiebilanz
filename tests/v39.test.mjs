// v0.39: Prognose mit Trend – Wärmepumpe wetterbereinigt (Grundlast + k × Gradtage), Allgemeinstrom über Trendfaktor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const iso = d => d.toISOString().slice(0, 10);
const days = []; for (let d = new Date('2025-01-01T00:00:00Z'); d <= new Date('2026-10-31T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d));
const doy = d => (Date.parse(d) - Date.parse(d.slice(0, 4) + '-01-01')) / 864e5;
const T = d => 10 + 10 * Math.sin((doy(d) - 105) / 365 * 2 * Math.PI);
const gt = d => (T(d) < 15 ? 20 - T(d) : 0);
// Wärmepumpe: Vorjahr 3 kWh + 1,0 × GT; ab 1.8.2026 2,5 kWh, ab 1.9.2026 0,8 × GT. Allgemeinstrom: 2026 10 % weniger als 2025.
const wpDay = d => (d >= '2026-08-01' ? 2.5 : 3) + (d >= '2026-09-01' ? 0.8 : 1.0) * gt(d);
const asDay = d => (d >= '2026-01-01' ? 9 : 10);
function calc(last = '2026-10-19') {
  const readings = []; let w = 1000, a = 5000;
  for (const d of days) { if (d > last) break; readings.push({ meter_id: 'w', day: d, value: Math.round(w * 1000) / 1000 }, { meter_id: 'a', day: d, value: Math.round(a * 1000) / 1000 }); w += wpDay(d); a += asDay(d); }
  return createCalc(stateFromDb({ anker_daily: [{ day: '2025-01-01', genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 }],
    meters: [{ id: 'w', name: 'WP', grp: 'wp', sort: 0 }, { id: 'a', name: 'AS', grp: 'as', sort: 1 }], meter_readings: readings,
    weather_daily: days.map(d => ({ day: d, temp_mean: T(d), rad_kwh: 2, sun_h: 4 })),
    tariffs: [{ id: 'tw', grp: 'wp', name: 'WP', valid_from: '2026-03-01', valid_to: null, ap_ct: 25, gp_eur_year: 100, boni_eur: 0 },
      { id: 'ta', grp: 'as', name: 'AS', valid_from: '2026-03-01', valid_to: null, ap_ct: 30, gp_eur_year: 100, boni_eur: 0 }],
    installments: [{ id: 'i1', grp: 'wp', valid_from: '2026-03-01', amount: 100 }, { id: 'i2', grp: 'as', valid_from: '2026-03-01', amount: 100 }],
    settings: { data: { battery: {}, pv: {}, amort: {}, cars: { ev: {} } } } }));
}

test('Wärmepumpe: Grundlast und k je Gradtag werden erkannt, Gewicht nach Gradtagen', () => {
  const m = calc().trendModel('wp', '2026-10-18');
  assert.equal(m.kind, 'weather');
  assert.ok(Math.abs(m.b - 2.5) < 0.05, 'Grundlast jetzt ' + m.b);
  assert.ok(Math.abs(m.bPrev - 3) < 0.05, 'Grundlast Vorjahr ' + m.bPrev);
  assert.ok(Math.abs(m.kPrev - 1.0) < 0.03, 'k Vorjahr ' + m.kPrev);
  assert.ok(m.kNow == null || Math.abs(m.kNow - 0.8) < 0.05, 'k jetzt ' + m.kNow);
  assert.ok(m.w >= 0 && m.w < 1 && m.k < m.kPrev && m.k >= 0.8 - 0.03, 'k ' + m.k);
  assert.ok(m.relRaw == null || Math.abs(m.relRaw - 0.8) < 0.05, 'Veränderung ' + m.relRaw);
});

test('Wärmepumpe: Rest mit Trend unter „wie Vorjahr“, milder < Trend < kälter', () => {
  const r = calc().abschlagCheck('wp', '2026-10-19');
  assert.ok(r.trend, 'Trend vorhanden');
  assert.ok(r.trend.trend < r.trend.prev, `${r.trend.trend} < ${r.trend.prev}`);
  assert.ok(r.trend.mild < r.trend.trend && r.trend.trend < r.trend.cold);
  assert.ok(r.trend.costTrend < r.costRest);
  assert.ok(r.trend.recTrend != null);
});

test('Allgemeinstrom: Trendfaktor 0,9 aus den letzten 8 Wochen', () => {
  const m = calc().trendModel('as', '2026-10-18');
  assert.equal(m.kind, 'ratio'); assert.ok(Math.abs(m.f - 0.9) < 0.005, 'f ' + m.f);
  const r = calc().abschlagCheck('as', '2026-10-19');
  assert.ok(Math.abs(r.trend.trend / r.trend.prev - 0.9) < 0.005);
});

test('Rückblick: Trend trifft beim Allgemeinstrom besser als „wie Vorjahr“', () => {
  const bt = calc().trendBacktest('as', '2026-10-18');
  assert.ok(bt.list.length >= 6, 'Monate ' + bt.list.length);
  assert.ok(bt.maeTrend < 0.01 && bt.maePrev > 0.09, `${bt.maeTrend} / ${bt.maePrev}`);
});

test('Methodenwahl Allgemeinstrom: nicht „wie Vorjahr“, wenn der Verbrauch dauerhaft 10 % niedriger ist', () => {
  const b = calc().bestMethod('as', '2026-10-18');
  assert.notEqual(b.method, 'flat'); assert.ok(b.scores.flat > 0.09 && b.scores[b.method] < 0.01);
});

test('Monatsübersicht: Vorjahr, gemessen bis heute, danach Prognose', () => {
  const ms = calc().trendMonths('wp', '2026-03-01', '2027-02-28', '2026-10-18');
  assert.equal(ms.length, 12);
  const okt = ms.find(x => x.k === '2026-10'), dez = ms.find(x => x.k === '2026-12');
  assert.ok(okt.meas > 0 && okt.fc > 0 && dez.meas === 0 && dez.fc > 0 && dez.fc < dez.prev);
});

test('ohne Vorjahresdaten keine Trend-Prognose', () => {
  assert.equal(calc().trendModel('as', '2025-03-01'), null);
});
