// Synthetische Tests für v0.30: Anlagenstufen (kWp und Speicher je Datum, spezifischer Ertrag, Prognose je kWp, Wirkung). Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, toDb, stateFromDb } from '../js/calc.js';

const KEYS = ['ev', 'imp', 'n2h', 's2h', 's2b', 'bch', 'bdis', 'b2h', 'use', 'gen', 'feed', 'pv1', 'pv2', 'pv3', 'pv4'];
// 60 Tage ab 01.03.2026: 30 Tage 2 kWh (Stufe 0, 1 kWp), dann 30 Tage 3 kWh (Stufe 1, 1,5 kWp); Einstrahlung immer 2 kWh/m²
function state(stages) {
  const n = 60, c = Object.fromEntries(KEYS.map(k => [k, Array(n).fill(0)]));
  for (let i = 0; i < n; i++) { c.gen[i] = i < 30 ? 2 : 3; c.use[i] = i < 30 ? 1.5 : 2; c.imp[i] = i < 30 ? 1 : 0.5; c.bdis[i] = 1; c.feed[i] = i < 30 ? 0 : 0.5; }
  const weather = Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10), t: 10, rad: 2, sun: 5 }));
  return { anker: { start: '2026-03-01', n, c }, meters: [], readings: [], events: [{ d: '2026-03-01', group: 'pv', type: 'daten', text: '' }], tariffs: [{ id: 'a', group: 'as', name: 'A', from: '2026-01-01', to: '', ap: 30, gp: 100, boni: 0 }, { id: 'w', group: 'wp', name: 'W', from: '2026-01-01', to: '', ap: 20, gp: 100, boni: 0 }], abschlaege: [], payments: [], invest: [], fuel: [], charges: [], carlog: [],
    battery: { capGross: 5, reserve: 10, fullThresh: 0.3 }, pv: { kwp: 1 }, amort: {}, cars: { ice: {}, ev: {} }, weather, stages };
}
const ST = [{ name: 'Bestand', from: '2026-03-01', status: 'live', kwp: 1, capGross: 5 },
  { name: 'Größer', from: '2026-03-31', status: 'live', kwp: 1.5, capGross: 10 },
  { name: 'Später', from: '2026-04-15', status: 'planned', kwp: 3, capGross: 20 }];

test('v0.30: kWp und Speicher je Datum, geplante Stufen zählen nicht', () => {
  const C = createCalc(state(ST));
  assert.equal(C.stageAt('2026-03-10').kwp, 1); assert.equal(C.stageAt('2026-04-20').kwp, 1.5); assert.equal(C.stageAt('2026-04-20').capGross, 10);
  assert.equal(C.kwpIn('2026-03-01', '2026-04-29'), 1.25);                       // 30 Tage 1, 30 Tage 1,5
  assert.ok(Math.abs(C.usableIn('2026-03-31', '2026-04-29') - 9) < 1e-9);         // 10 kWh − 10 % Reserve
  const C0 = createCalc(state([]));                                               // ohne Stufen wie bisher
  assert.equal(C0.stageAt('2026-04-20').kwp, 1); assert.ok(Math.abs(C0.usableIn('2026-03-01', '2026-04-29') - 4.5) < 1e-9);
  // Vollzyklen nutzen den Speicher der Stufe
  assert.ok(Math.abs(C.metrics('2026-03-31', '2026-04-29').cyc - 30 / 9) < 1e-9);
});

test('v0.30: Ertragsfaktor je kWp bleibt bei gleicher Anlagenqualität gleich', () => {
  const C = createCalc(state(ST));
  const r = C.pvWeather('2026-03-01', '2026-04-29');
  assert.ok(Math.abs(r.factor - 1) < 1e-9, 'Faktor ' + r.factor);                  // 2/(1·2) und 3/(1,5·2)
  const E = C.stageEffects();
  assert.equal(E.length, 2); assert.equal(E[0].n, 30); assert.equal(E[1].n, 30);
  assert.ok(Math.abs(E[0].f - 1) < 1e-9 && Math.abs(E[1].f - 1) < 1e-9);
  assert.equal(E[0].kwhDay, 2); assert.equal(E[1].kwhDay, 3); assert.equal(E[1].impDay, 0.5); assert.equal(E[1].fullShare, 1);
});

test('v0.30: Prognose rechnet je kWp und mit der kWp der aktuellen Stufe', () => {
  const C = createCalc(state(ST));
  const r = C.pvForecast([{ day: '2026-05-01', rad_kwh: 2 }], '2026-05-01');
  assert.equal(r.kwpNow, 1.5); assert.equal(r.stage.name, 'Größer');
  assert.ok(Math.abs(r.days[0].kwh - 3) < 1e-9, 'kWh ' + r.days[0].kwh);         // Faktor 1 je kWp × 2 kWh/m² × 1,5 kWp
  assert.ok(r.back.pairs.every(p => Math.abs(p.model - p.act) < 1e-9));          // Modell trifft bei gleicher Qualität exakt
});

test('v0.30: Stufen werden in den Einstellungen gespeichert und gelesen', () => {
  const S = { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} }, stages: ST };
  assert.equal(toDb.settings(S).data.stages.length, 3);
  assert.equal(toDb.settings({ ...S, stages: [] }).data.stages, undefined);
  assert.deepEqual(stateFromDb({ settings: { data: { stages: ST } } }).stages, ST);
});
