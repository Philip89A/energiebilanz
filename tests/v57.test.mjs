// v0.57: Solarbank 2 als PV5–PV8 (ab 14.11.2026) und Netzbezug nur einmal bei zwei Smart Metern am Hausanschluss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnkerCsv, mergeAnkerParsed, diffAnker } from '../js/import.js';
import { createCalc, stateFromDb } from '../js/calc.js';

const NB = '‑';
const home = rows => ['"Definition: …"',
  'Datum,Eigenverbrauch (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Netzstrom zu Speicher (kWh),Gesamte Solarstromerzeugung (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Solarstrom-Einspeisung (kWh),Speicherentladung (kWh),Speicher zu Haushalt (kWh),Speicher-Einspeisung (kWh),PV1-Erzeugung (kWh),PV2-Erzeugung (kWh),PV3-Erzeugung (kWh),PV4-Erzeugung (kWh),Speicherladung (kWh)',
  ...rows].join('\n');
const sb2 = rows => ['"Definition: …"',
  `Datum,Eigenverbrauch (kWh),Verbrauch über Smart Plug (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Speicherladung (kWh),Speicherentladung (kWh),Speicher zu Haushalt (kWh),Genutzte Solarenergie (kWh),Gesamte Solarstromerzeugung (kWh),Solarstrom${NB}Einspeisung (kWh),Solarbank 2 E1600 Pro – Gesamterzeugung (kWh),Solarbank 2 E1600 Pro – PV1${NB}Erzeugung (kWh),Solarbank 2 E1600 Pro – PV2${NB}Erzeugung (kWh),Solarbank 2 E1600 Pro – PV3${NB}Erzeugung (kWh),Solarbank 2 E1600 Pro – PV4${NB}Erzeugung (kWh)`,
  ...rows].join('\n');

test('Solarbank 2: PV1–PV4 ab 14.11.2026 als PV5–PV8, davor unverändert', () => {
  const p = parseAnkerCsv(sb2([
    '13/11/2026,0,0,0,0,0,0.2,0.2,0,0,0,0.2,0,0.2,0.2,0,0,0',
    '16/11/2026,0,0,0,0,0,0.01,0.01,0,0,0,0.01,0,0.01,0.01,0,0,0']));
  assert.deepEqual(p.errors, []); assert.equal(p.sb2, true);
  assert.equal(p.rows[0].pv1, 0.2); assert.equal(p.rows[0].pv5, undefined);
  assert.equal(p.rows[1].pv1, null); assert.equal(p.rows[1].pv5, 0.01); assert.equal(p.rows[1].pv8, 0);
  assert.equal(parseAnkerCsv(home(['16/11/2026,9.7,8.02,8.02,0,1.6,1.32,0.26,0.02,0.36,0.36,0,0.58,0.47,0.3,0.25,0.26'])).sb2, false);
});

test('zwei Dateien: PV1 bleibt Solarbank 4, PV5 kommt von der Solarbank 2; ohne Netzbezug der SB2 wird addiert', () => {
  const a = home(['16/11/2026,9.7,8.02,8.02,0,1.6,1.32,0.26,0.02,0.36,0.36,0,0.58,0.47,0.3,0.25,0.26']);
  const b = sb2(['16/11/2026,0,0,0,0,0,0.01,0.01,0,0,0,0.01,0,0.01,0.01,0,0,0']);
  const m = mergeAnkerParsed([{ name: 'a', text: a, parsed: parseAnkerCsv(a) }, { name: 'b', text: b, parsed: parseAnkerCsv(b) }]);
  const r = m.rows[0];
  assert.equal(r.pv1, 0.58); assert.equal(r.pv5, 0.01); assert.equal(r.erzeugung, 1.61);
  assert.equal(r.netz_zu_haus, 8.02); assert.equal(r.eigenverbrauch, 9.7); assert.deepEqual(m.gridOnce, []);
});

test('zwei Smart Meter am Hausanschluss: Netzbezug nur einmal, Eigenverbrauch ohne Doppelung, Abweichung > 10 % gemeldet', () => {
  // SB4: Netz 6, Solar 1, Speicher 0,5 → EV 7,5; SB2: Netz 6 (gleicher Zähler), Speicher 0,8 → EV 6,8; SB2 lädt 0,3 aus dem Netz
  const a = home(['20/11/2026,7.5,6,6,0,1.2,1,0.2,0,0.5,0.5,0,0.4,0.4,0.2,0.2,0.2']);
  const b = sb2(['20/11/2026,6.8,0,6.3,6,0,0.1,0.4,0.8,0.8,0.5,0.1,0,0.1,0.1,0,0,0']);
  const m = mergeAnkerParsed([{ name: 'a', text: a, parsed: parseAnkerCsv(a) }, { name: 'b', text: b, parsed: parseAnkerCsv(b) }]);
  const r = m.rows[0];
  assert.equal(r.netz_zu_haus, 6); assert.equal(r.netzimport, 6.3); assert.equal(r.eigenverbrauch, 8.3);
  assert.equal(r.netz_zu_speicher, 0.3); assert.deepEqual(m.gridOnce, ['2026-11-20']); assert.deepEqual(m.gridDiff, []);
  const c = sb2(['20/11/2026,5.3,0,4.5,4.5,0,0.1,0.1,0.8,0.8,0.8,0.1,0,0.1,0.1,0,0,0']);
  const m2 = mergeAnkerParsed([{ name: 'a', text: a, parsed: parseAnkerCsv(a) }, { name: 'c', text: c, parsed: parseAnkerCsv(c) }]);
  assert.equal(m2.rows[0].netz_zu_haus, 6); assert.deepEqual(m2.gridDiff, ['2026-11-20']);
});

test('Bestand ohne PV5–PV8: neue Werte gelten als ergänzt, alte Daten rechnen weiter', () => {
  const d = diffAnker([{ day: '2026-11-16', pv1: 0.58, erzeugung: 1.6 }], [{ day: '2026-11-16', pv1: 0.58, erzeugung: 1.6, pv5: 0.01 }]);
  assert.deepEqual(d.ergaenzt, ['2026-11-16']); assert.equal(d.write[0].pv5, 0.01);
  const C = createCalc(stateFromDb({ anker_daily: [{ day: '2026-11-16', genutzt: 1, erzeugung: 1.6, netzimport: 1, einspeisung: 0, pv1: 0.58 }],
    settings: { data: { cars: { ice: {}, ev: {} } } } }));
  const s = C.ankerSeries(['pv1', 'pv5'], '2026-11-16', '2026-11-16', 'day');
  assert.equal(s.rows[0].pv1, 0.58); assert.equal(s.rows[0].pv5, 0);
});
