// v0.59: Export „Home Gesamt“ (Power Dock) ohne PV-Eingänge, Wallbox-Spalte, Netzwerte nur aus dem Hauptsystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnkerCsv, mergeAnkerParsed } from '../js/import.js';
import { createCalc, stateFromDb } from '../js/calc.js';

const NB = '‑';
const HG = 'Datum,Eigenverbrauch (kWh),Verbrauch über Smart Plug (kWh),Ladesäulen-Verbrauch (kWh),Andere Lasten (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Netzstrom zu Speicher (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Speicherladung (kWh),Speicherentladung (kWh),Speicher zu Haushalt (kWh),Genutzte Solarenergie (kWh),Gesamte Solarstromerzeugung (kWh),Eingebaute Solarstromerzeugung (kWh),Solarerzeugung durch Drittanbieter (kWh),Solarstrom-Einspeisung (kWh),CO₂-Reduktion (kgCO₂/kWh)';
const hg = rows => ['"Definition: …"', HG, ...rows].join('\n');
const SB2 = `Datum,Eigenverbrauch (kWh),Verbrauch über Smart Plug (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Speicherladung (kWh),Speicherentladung (kWh),Speicher zu Haushalt (kWh),Genutzte Solarenergie (kWh),Gesamte Solarstromerzeugung (kWh),Solarstrom${NB}Einspeisung (kWh),Solarbank 2 E1600 Pro – Gesamterzeugung (kWh),Solarbank 2 E1600 Pro – PV1${NB}Erzeugung (kWh),Solarbank 2 E1600 Pro – PV2${NB}Erzeugung (kWh),Solarbank 2 E1600 Pro – PV3${NB}Erzeugung (kWh),Solarbank 2 E1600 Pro – PV4${NB}Erzeugung (kWh)`;

test('Home Gesamt: ohne PV-Spalten lesbar, Wallbox und Netzladung übernommen, PV1–PV8 leer', () => {
  const p = parseAnkerCsv(hg(['21/11/2026,11.38,0.00,1.50,9.88,8.31,7.87,0.44,1.20,1.85,2.31,2.40,2.31,3.07,3.11,3.11,0.00,0.06,1.13']));
  assert.deepEqual(p.errors, []); assert.equal(p.sb2, false);
  const r = p.rows[0];
  assert.equal(r.wallbox, 1.5); assert.equal(r.erzeugung, 3.11); assert.equal(r.genutzt, 3.07); assert.equal(r.netz_zu_speicher, 0.44);
  assert.equal(r.pv1, undefined); assert.equal(r.pv5, undefined);
});

test('Umbautag: alte „Home“-Datei und „Home Gesamt“ sind beide Hauptsystem → Netzbezug addiert; Zuhause neu nur Solar/Speicher', () => {
  const a = hg(['19/11/2026,3.59,0,0,3.59,3.89,3.57,0.32,0,0,0.32,0.02,0.02,-0.30,0,0,0,0,0']);
  const b = hg(['19/11/2026,4.00,0,0,4.00,3.00,3.00,0,0.6,0.2,0.2,0.4,0.4,1.00,0.8,0.8,0,0,0']).replace('"Definition: …"', '"Definition (alt)"');
  const c = ['"x"', SB2, '19/11/2026,6.6,0,6.6,6.57,0.03,0.02,0.02,0,0,0.03,0.05,0,0.05,0.05,0,0,0'].join('\n');
  const m = mergeAnkerParsed([a, b, c].map((t, i) => ({ name: 'f' + i, text: t, parsed: parseAnkerCsv(t) })));
  const r = m.rows[0];
  assert.equal(r.netz_zu_haus, 6.57); assert.equal(r.netzimport, 6.89); assert.equal(r.netz_zu_speicher, 0.32);
  assert.equal(r.eigenverbrauch, 7.62); assert.equal(r.erzeugung, 0.85); assert.equal(r.pv5, 0.05);
  assert.deepEqual(m.sideGrid, ['2026-11-19']);
});

test('Rechenkern: Wallbox als Reihe wb, fehlt in älteren Daten ohne Fehler', () => {
  const C = createCalc(stateFromDb({ anker_daily: [{ day: '2026-11-20', genutzt: 1, erzeugung: 1, netzimport: 5, einspeisung: 0 }, { day: '2026-11-21', genutzt: 1, erzeugung: 1, netzimport: 5, einspeisung: 0, wallbox: 7.5 }],
    settings: { data: { cars: { ice: {}, ev: {} } } } }));
  assert.equal(C.sumRange('wb', '2026-11-20', '2026-11-21'), 7.5);
});
