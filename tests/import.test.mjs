// Synthetische Tests für js/import.js – keine echten Daten.  Ausführen: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normHeader, parseDate, splitCsvLine, parseAnkerCsv, diffAnker,
  validateSeed, mapSeed, seedSummary, compareSummary, addDays, sumMilli,
} from '../js/import.js';

const fixture = readFileSync(new URL('./fixture_anker.csv', import.meta.url), 'utf8');

test('normHeader: geschützte Bindestriche und schmale Leerzeichen', () => {
  assert.equal(normHeader('Solarstrom‑Einspeisung (kWh)'), 'solarstrom-einspeisung (kwh)');
  assert.equal(normHeader('﻿Solarbank 2 – PV1‑Erzeugung (kWh)'), 'solarbank 2 - pv1-erzeugung (kwh)');
});

test('parseDate', () => {
  assert.equal(parseDate('22/03/2025'), '2025-03-22');
  assert.equal(parseDate('1.2.2026'), '2026-02-01');
  assert.equal(parseDate('2026-09-26'), '2026-09-26');
  assert.equal(parseDate('31/02/2025'), null);
  assert.equal(parseDate('Summe'), null);
});

test('splitCsvLine mit Anführungszeichen', () => {
  assert.deepEqual(splitCsvLine('a,"b,c","d""e"', ','), ['a', 'b,c', 'd"e']);
});

test('parseAnkerCsv: Titelzeile, Kopf, Werte, Jahreswechsel', () => {
  const p = parseAnkerCsv(fixture);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 3);
  assert.equal(p.from, '2024-12-30');
  assert.equal(p.to, '2025-01-01');
  const r = p.rows[0];
  assert.equal(r.eigenverbrauch, 3);
  assert.equal(r.smart_plug, 0.1);
  assert.equal(r.einspeisung, 0.05);
  assert.equal(r.erzeugung, 2);
  assert.equal(r.pv4, 0.5);
  assert.equal(r.speicher_zu_haus, 0.68);
  assert.ok(!('co2' in r));
});

test('parseAnkerCsv: Semikolon und Dezimalkomma', () => {
  const t = 'Datum;Eigenverbrauch (kWh);Netzimport (kWh);Netzstrom zu Haushalt (kWh);Solarstrom zu Haushalt (kWh);'
    + 'Solarstrom zu Speicher (kWh);Speicherladung (kWh);Speicherentladung (kWh);Speicher zu Haushalt (kWh);'
    + 'Genutzte Solarenergie (kWh);Gesamte Solarstromerzeugung (kWh);Solarstrom-Einspeisung (kWh);PV1-Erzeugung;PV2-Erzeugung\n'
    + '01.05.2025;1,25;0;0;0;0;0;0;0;0;1.234,5;0;0;0\n';
  const p = parseAnkerCsv(t);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows[0].eigenverbrauch, 1.25);
  assert.equal(p.rows[0].erzeugung, 1234.5);
});

test('parseAnkerCsv: fehlende Pflichtspalte wird gemeldet', () => {
  const p = parseAnkerCsv('Datum,Eigenverbrauch (kWh)\n01/01/2025,1\n');
  assert.equal(p.rows.length, 0);
  assert.ok(p.errors.some(e => e.includes('netzimport')));
});

test('diffAnker: neu, geändert, ergänzt, gleich; leere Zelle überschreibt nichts', () => {
  const incoming = parseAnkerCsv(fixture).rows;
  const existing = [
    { ...incoming[0] },                                        // gleich
    { ...incoming[1], erzeugung: 2.0, smart_plug: null },      // geändert (2,0 -> 2,1)
  ];
  const d = diffAnker(existing, incoming);
  assert.equal(d.gleich, 1);
  assert.equal(d.geaendert.length, 1);
  assert.deepEqual(d.geaendert[0].changes, [{ field: 'erzeugung', alt: 2, neu: 2.1 }]);
  assert.equal(d.neu.length, 1);
  assert.equal(d.write.length, 2);

  const onlyPlug = diffAnker([{ ...incoming[2], smart_plug: null }], [incoming[2]]);
  assert.deepEqual(onlyPlug.ergaenzt, ['2025-01-01']);

  const blank = diffAnker([{ ...incoming[2] }], [{ ...incoming[2], pv1: null }]);
  assert.equal(blank.gleich, 1);
  const withBlank = diffAnker([{ ...incoming[2] }], [{ ...incoming[2], pv1: null, erzeugung: 9 }]);
  assert.equal(withBlank.write[0].pv1, 0.3, 'Bestandswert bleibt bei leerer Zelle erhalten');
});

const miniSeed = {
  version: 8,
  anker: { start: '2024-12-31', n: 2, c: Object.fromEntries(
    ['ev', 'imp', 'n2h', 's2h', 's2b', 'bch', 'bdis', 'b2h', 'use', 'gen', 'feed', 'pv1', 'pv2', 'pv3', 'pv4']
      .map((k, i) => [k, [i * 0.1, 0.15]])) },
  meters: [{ id: 'm1', name: 'Zähler 1', group: 'as', order: 0 }],
  readings: [{ m: 'm1', d: '2025-01-01', v: 100, src: 'Test' }],
  events: [{ d: '2025-01-01', group: 'pv', type: 'daten', text: 'Start' }],
  tariffs: [{ id: 't1', group: 'as', name: 'T', from: '2025-01-01', to: '', ap: 30, gp: 120, boni: 0, boniNote: '', est: '' }],
  abschlag: { as: 1, wp: 2 },
  abschlaege: [{ id: 'a1', group: 'as', from: '2025-01-01', amount: 50, note: '' }],
  invest: [{ name: 'Kauf', date: '2025-01-01', cost: 100.1 }, { name: 'Verkauf', date: '2025-02-01', cost: -0.2 }],
  fuel: [], charges: [], carlog: [{ d: '2025-01-02', car: 'leon', cat: 'Wäsche', km: null, e: 12.5, note: '' }],
  battery: { capGross: 1 }, pv: { kwp: 1 }, amort: { priceInc: 3 }, cars: { ice: {} },
  view: { mode: 'all' }, ui: { logCar: 'leon' },
};

test('validateSeed erkennt kaputte Daten', () => {
  assert.deepEqual(validateSeed(miniSeed), []);
  const bad = structuredClone(miniSeed);
  bad.anker.c.gen = [1];
  bad.readings.push({ m: 'x', d: '2025-01-01', v: 1 });
  const e = validateSeed(bad);
  assert.ok(e.some(x => x.includes('anker.c.gen')));
  assert.ok(e.some(x => x.includes('unbekannter Zähler')));
});

test('mapSeed: Spalten, Tage, leere Werte, view/ui/abschlag nicht übernommen', () => {
  const m = mapSeed(miniSeed);
  assert.deepEqual(m.anker_daily.map(r => r.day), ['2024-12-31', '2025-01-01']);
  assert.equal(m.anker_daily[1].erzeugung, 0.15);
  assert.deepEqual(m.meters[0], { id: 'm1', name: 'Zähler 1', grp: 'as', sort: 0 });
  assert.deepEqual(m.meter_readings[0], { meter_id: 'm1', day: '2025-01-01', value: 100, source: 'Test' });
  assert.equal(m.events[0].note, 'Start');
  assert.equal(m.tariffs[0].valid_to, null);
  assert.equal(m.tariffs[0].boni_note, null);
  assert.match(m.tariffs[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(m.car_log[0].odometer, null);
  assert.equal(m.car_log[0].category, 'Wäsche');
  assert.deepEqual(Object.keys(m.settings.data).sort(), ['amort', 'battery', 'cars', 'pv', 'schema_version']);
});

test('seedSummary rechnet exakt in Tausendsteln', () => {
  const s = seedSummary(mapSeed(miniSeed));
  assert.equal(s.invest_milli_eur, 99900);                  // 100,10 − 0,20 ohne Fließkommafehler
  assert.equal(sumMilli([{ x: 0.1 }, { x: 0.2 }], 'x'), 300);
  assert.equal(s.counts.car_log, 1);
  assert.deepEqual(compareSummary(s, structuredClone(s)), []);
  const t = structuredClone(s); t.counts.meters = 0;
  assert.equal(compareSummary(s, t).length, 1);
});

test('addDays über Monats- und Jahresgrenzen', () => {
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-03-22', 553), '2026-09-26');
});
