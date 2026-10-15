// v0.31: neues Anker-Exportformat, mehrere Dateien in einem Import, Netzladung des Speichers. Synthetische Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAnkerCsv, mergeAnkerParsed, diffAnker, gridChargeDays } from '../js/import.js';
import { createCalc, stateFromDb } from '../js/calc.js';

const oldCsv = readFileSync(new URL('./fixture_anker.csv', import.meta.url), 'utf8');
// Kopf wie im Export des neuen Heimsystems (ohne „Genutzte Solarenergie“, mit Netzstrom zu Speicher)
const NEW_HEAD = 'Datum,Eigenverbrauch (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Netzstrom zu Speicher (kWh),'
  + 'Gesamte Solarstromerzeugung (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Solarstrom-Einspeisung (kWh),'
  + 'Speicherentladung (kWh),Speicher zu Haushalt (kWh),Speicher-Einspeisung (kWh),PV1-Erzeugung (kWh),PV2-Erzeugung (kWh),'
  + 'PV3-Erzeugung (kWh),PV4-Erzeugung (kWh),Speicherladung (kWh),Gesamterzeugung (kWh),Drittanbieter-Solar (kWh),'
  + 'Verbrauch über Smart Plug (kWh),Ladesäulen-Verbrauch (kWh),CO₂-Reduktion (kgCO₂/kWh),Freie Energie (Off-Grid) (kWh),Andere Lasten (kWh)';
const newCsv = '"Definition: frei erfunden"\n' + NEW_HEAD + '\n'
  + '01/01/2025,4.00,1.00,0.80,0.20,3.00,1.50,1.00,0.50,1.80,1.70,0.10,0.50,0.50,1.00,1.00,1.20,3.00,0.00,0.00,0.00,1.00,0.00,0.00\n'
  + '02/01/2025,3.00,0.50,0.50,0.00,2.00,1.00,1.00,0.00,1.00,1.00,0.00,0.50,0.50,0.50,0.50,1.00,2.00,0.00,0.00,0.00,0.70,0.00,0.00\n';

test('neues Format: genutzt = Eigenverbrauch − Netzimport, Netzladung gelesen', () => {
  const p = parseAnkerCsv(newCsv);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 2);
  const r = p.rows[0];
  assert.equal(r.genutzt, 3);
  assert.equal(r.netz_zu_speicher, 0.2);
  assert.equal(r.einspeisung, 0.5);            // Speicher-Einspeisung nicht addiert
  assert.equal(r.speicher_ladung, 1.2);
  assert.equal(r.erzeugung, 3);
  assert.deepEqual(gridChargeDays(p.rows), ['2025-01-01']);
});

test('altes Format: Netzladung aus Netzimport − Netzstrom zu Haushalt, genutzt aus der Spalte', () => {
  const p = parseAnkerCsv(oldCsv);
  assert.deepEqual(p.errors, []);
  assert.ok(p.rows.every(r => r.netz_zu_speicher === 0));
  assert.equal(p.rows[0].genutzt, 1.88);
});

test('mergeAnkerParsed: gleiche Tage addiert, wiederholbar, doppelte Datei zählt einmal', () => {
  const a = { name: 'alt.csv', text: oldCsv, parsed: parseAnkerCsv(oldCsv) };
  const b = { name: 'neu.csv', text: newCsv, parsed: parseAnkerCsv(newCsv) };
  const m = mergeAnkerParsed([a, b]);
  assert.deepEqual(m.summed, ['2025-01-01']);
  assert.equal(m.from, '2024-12-30');
  assert.equal(m.to, '2025-01-02');
  const d = m.rows.find(r => r.day === '2025-01-01');
  assert.equal(d.erzeugung, 4.2);              // 1,2 + 3,0
  assert.equal(d.genutzt, 4.95);               // 1,95 + 3,0
  assert.equal(d.netz_zu_speicher, 0.2);
  assert.equal(d.smart_plug, 0.2);             // 0,2 + 0
  assert.deepEqual(mergeAnkerParsed([a, b]).rows, m.rows);
  const dup = mergeAnkerParsed([a, { ...a }]);
  assert.equal(dup.summed.length, 0);
  assert.ok(dup.errors.some(e => e.includes('doppelt')));
});

test('diffAnker: nur eine von zwei Dateien erneut → kleiner gemeldet', () => {
  const both = mergeAnkerParsed([{ name: 'a', text: oldCsv, parsed: parseAnkerCsv(oldCsv) }, { name: 'b', text: newCsv, parsed: parseAnkerCsv(newCsv) }]).rows;
  const d = diffAnker(both, parseAnkerCsv(newCsv).rows);
  assert.deepEqual(d.kleiner, ['2025-01-01']);
  assert.equal(diffAnker(both, both).kleiner.length, 0);
});

test('calc: Netzladung mindert den Wert des Speichers, ohne Spalte unverändert', () => {
  const rows = parseAnkerCsv(newCsv).rows;
  const settings = { data: { battery: { capGross: 2, reserve: 10, fullThresh: 0.3 }, pv: { kwp: 1 }, amort: {}, cars: {} } };
  const tariffs = [{ id: 't', grp: 'as', name: 'x', valid_from: '2024-01-01', valid_to: null, ap_ct: 30, gp_eur_year: 0, boni_eur: 0 }];
  const C1 = createCalc(stateFromDb({ anker_daily: rows, settings, tariffs }));
  const C0 = createCalc(stateFromDb({ anker_daily: rows.map(r => ({ ...r, netz_zu_speicher: null })), settings, tariffs }));
  const m1 = C1.metrics('2025-01-01', '2025-01-02'), m0 = C0.metrics('2025-01-01', '2025-01-02');
  assert.equal(m1.n2b, 0.2);
  assert.ok(Math.abs((m0.battVal - m1.battVal) - 0.2 * 0.3) < 1e-9);
  assert.equal(m0.n2b, 0);
});
