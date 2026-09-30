// Synthetische Tests für v0.11: Import des Wärmepumpen-Exports, Kennzahlen (Arbeitszahl, Warmwasser-Anteil),
// Monate mit Zähler und Gradtagen, Supabase-Hin- und Rückweg. Erfundene Werte (tests/fixture_hp.csv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHpCsv, hpSum } from '../js/hp.js';
import { createCalc, stateFromDb } from '../js/calc.js';

const csv = readFileSync(new URL('./fixture_hp.csv', import.meta.url), 'utf8');

test('Import: Auflösungen, leere Zeilen, Umrechnung', () => {
  const r = parseHpCsv(csv);
  assert.deepEqual([r.hour.n, r.day.n, r.month.n], [1, 2, 2]);
  assert.equal(r.skipped.empty, 2);
  const m = r.rows.find(x => x.grain === 'month' && x.ts === '2025-01');
  assert.equal(m.el_hp, 298); assert.equal(m.el_aux, 2); assert.equal(m.el_aux_dhw, 2);
  assert.equal(m.heat_heat, 180 + 400); assert.equal(m.heat_dhw, 120 + 200);
  assert.equal(m.t_out, 3);
  const h = r.rows.find(x => x.grain === 'hour');
  assert.equal(h.ts, '2025-01-02T01:00'); assert.equal(h.heat_heat, 0); assert.equal(h.heat_dhw, 1.3);
});

test('Import: fremdes Format wird abgelehnt', () => {
  assert.throws(() => parseHpCsv('Datum;Wert\n2025-01-01;1'), /Unbekanntes Format/);
});

test('Kennzahlen: Strom inkl. Zuheizer, Arbeitszahl ohne Kühlung', () => {
  const r = parseHpCsv(csv), s = hpSum(r.rows.filter(x => x.grain === 'month'));
  assert.equal(s.el, 298 + 2 + 250);
  assert.equal(s.elDhw, 118 + 2 + 95);
  assert.equal(s.heat, 580 + 320 + 480 + 265);
  assert.ok(Math.abs(s.cop - s.heat / (550 - 5)) < 1e-9);
});

test('Monate: Zähler, Gradtage und Heizung je Gradtag; Jahr und Tage', () => {
  const rows = parseHpCsv(csv).rows;
  const KEYS = ['eigenverbrauch', 'netzimport', 'netz_zu_haus', 'solar_zu_haus', 'solar_zu_speicher', 'speicher_ladung', 'speicher_entladung', 'speicher_zu_haus', 'genutzt', 'erzeugung', 'einspeisung'];
  const anker = Array.from({ length: 59 }, (_, i) => ({ day: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), ...Object.fromEntries(KEYS.map(k => [k, 1])) }));
  const weather = anker.map(a => ({ day: a.day, temp_mean: 10, rad_kwh: 1, sun_h: 1 }));
  const db = { anker_daily: anker, meters: [{ id: 'w', name: 'WP', grp: 'wp', sort: 0 }],
    meter_readings: [{ meter_id: 'w', day: '2025-01-01', value: 0 }, { meter_id: 'w', day: '2025-02-01', value: 310 }], weather_daily: weather,
    hp_energy: rows.map(r => ({ ...r, user_id: 'u', el_hp: String(r.el_hp) })), settings: { data: { pv: { kwp: 1 }, battery: {}, amort: {} } } };
  const S = stateFromDb(db);
  assert.equal(typeof S.hp[0].el_hp, 'number'); assert.equal(S.hp[0].user_id, undefined);
  const C = createCalc(S), m = C.hpMonths();
  assert.equal(m.length, 2);
  assert.equal(m[0].meter, 310); assert.equal(m[0].gt, 31 * 10);
  assert.ok(Math.abs(m[0].heatPerGt - 180 / 310) < 1e-9);
  const y = C.hpYear(); assert.equal(y.months, 2); assert.equal(y.from, '2025-01');
  const d = C.hpDays('2025-01-01', '2025-01-31'); assert.equal(d.length, 2); assert.equal(d[1].tWx, 10); assert.equal(d[1].gt, 10);
});
