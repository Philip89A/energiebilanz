// v0.38: Deutung der Zusammenhänge – Sätze aus Steigung, R², Phasen und Preisen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainCard, explainAll, sureText, waitText } from '../js/explain.js';

const P = { pAs: 0.30, pWp: 0.25 };
const card = (id, o = {}) => ({ id, title: id, x: 'Temperatur Vorratskeller °C', y: 'kWh', v: 'belastbar', pts: [], f: { n: 60, slope: 0.02, icept: 0.1, r2: 0.45, my: 0.5 }, extra: null, ...o });

test('sureText und waitText in Worten', () => {
  assert.match(sureText({ n: 60, r2: 0.45 }), /deutlich.*45 %.*Grundlage: 60 Tage.*belastbar/);
  assert.match(sureText({ n: 12, r2: 0.15 }), /schwach.*Hinweis/);
  assert.match(sureText({ n: 4, r2: null }), /Erst 4 Tage/);
  assert.equal(waitText(40), null);
  assert.match(waitText(4), /Noch etwa 6 Tage.*erste Einschätzung/);
  assert.match(waitText(18), /Noch etwa 12 Tage.*belastbares/);
});

test('Gefrierschrank: Mehrverbrauch je °C, Euro für 3 °C, Wäschetage', () => {
  const x = explainCard(card('freezer', { extra: { wash: 0.55, dry: 0.5, nWash: 9 } }), P);
  assert.match(x.result, /im Raum Vorratskeller 1 °C wärmer.*0,020 kWh mehr am Tag.*\+4 %/);
  assert.ok(Math.abs(x.euro - 0.02 * 3 * 365 * 0.3) < 1e-9);
  assert.match(x.effect, /22 kWh oder 6,6 €.*Wäschetagen \(9\).*0,050 kWh mehr/);
  assert.match(x.todo, /Hebel ist klein/);
});

test('Lüftung: Feuchte nachts über 60 % → kleine Stufe empfehlen', () => {
  const x = explainCard(card('vent', { f: { n: 40, slope: -20, r2: 0.35 }, extra: { night: 64, highShare: 0.7 } }), P);
  assert.match(x.result, /steigt.*2,0 Prozentpunkte/);
  assert.match(x.effect, /64 %.*70 %/);
  assert.match(x.todo, /kleinster Stufe/);
});

test('Warmwasser: Phasenvergleich ergibt Ersparnis in Euro, kurze Phase → abwarten', () => {
  const c = card('dhw', { f: { n: 3, slope: null, r2: null }, v: 'zu wenig Daten',
    extra: { base: null, phases: [{ g: 'ab 15.10.', n: 4, kwhDay: 3.0 }, { g: 'ab 19.10.', n: 5, kwhDay: 2.4 }] } });
  const x = explainCard(c, P);
  assert.match(x.result, /Seit „ab 19.10.“: 2,40 kWh.*statt 3,00 kWh.*−20 %/);
  assert.ok(Math.abs(x.euro - 0.6 * 365 * 0.25) < 1e-6);
  assert.match(x.effect, /−219 kWh oder −55 €/);
  assert.match(x.todo, /erst 5 Tage.*volle Woche/);
});

test('Heizung: kWh je Gradtag je Phase, Hochrechnung aufs Heizjahr, Räume', () => {
  const c = card('heat', { f: { n: 40, slope: 0.9, r2: 0.6 }, extra: { tRoom: 20, gtYear: 3000, rooms: [{ name: 'Büro', t: 22.8 }],
    phases: [{ g: 'vorher', n: 20, perGt: 1.0 }, { g: 'ab 15.10.', n: 20, perGt: 0.9 }] } });
  const x = explainCard(c, P);
  assert.match(x.result, /0,90 kWh Heizstrom.*15 Gradtage.*0,90 kWh je Gradtag statt 1,00 kWh \(−10 %/);
  assert.match(x.effect, /3\.000 Gradtage\): −300 kWh oder −75 €.*Wärmer als nötig: Büro/);
  assert.ok(Math.abs(x.euro - 75) < 1e-6);
  assert.match(x.todo, /wirkt – beibehalten/);
});

test('PV: Speicher oft voll und abends Netzbezug → mehr Speicher', () => {
  const x = explainCard(card('pv', { f: { n: 200, slope: -0.4, r2: 0.5 }, extra: { full: 1.2, notFull: 4, nFull: 80, fullShare: 0.4, sunny: 1.5 } }), P);
  assert.match(x.result, /0,40 kWh.*1,5 kWh Netzbezug/);
  assert.match(x.effect, /40 %.*1,2 kWh statt 4,0 kWh/);
  assert.match(x.todo, /Mehr Speicher/);
});

test('Grundlast: auffälliger Wochentag, Euro im Jahr', () => {
  const x = explainCard({ id: 'base', title: 'b', bars: [3, 3, 3, 3, 3, 5, 3], labels: [], f: { n: 70 }, v: 'belastbar' }, P);
  assert.match(x.result, /3,3 kWh.*Samstag \(5,0 kWh, \+52 %\)/);
  assert.match(x.effect, /360 €.*2,0 kWh/);
  assert.match(x.todo, /Gewohnheiten/);
});

test('explainAll: nur belastbare Karten mit Euro, nach Wirkung sortiert, höchstens drei', () => {
  const cards = [card('freezer'), card('dhw', { v: 'Hinweis', extra: { phases: [{ g: 'a', n: 5, kwhDay: 3 }, { g: 'b', n: 5, kwhDay: 2 }] } }),
    card('heat', { f: { n: 40, slope: 0.9, r2: 0.6 }, extra: { tRoom: 20, gtYear: 3000, phases: [{ g: 'a', n: 9, perGt: 1 }, { g: 'b', n: 9, perGt: 0.8 }] } })];
  const { top, list } = explainAll(cards, P);
  assert.equal(list.length, 3);
  assert.deepEqual(top.map(t => t.id), ['heat', 'freezer']);
});
