// v0.49: Raumklima-Import erkennt auch den Tapo-Export (Temperatur-/Feuchtesensor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClimateCsv, parseGoveeCsv } from '../js/import.js';

const head = '2026/01/10 00:00:00 - 2026/01/11 00:00:00,Temperatur(℃),Abnormal,Luftfeuchtigkeit(%),Abnormal\n';
const rows = (day, n, t = 20, h = 50) => Array.from({ length: n }, (_, i) => { const m = i * 15; return `${day} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00,${t},,${h},`; }).join('\n');

test('Tapo: Format erkannt, Datum mit Schrägstrichen, Stundenmittel', () => {
  const p = parseClimateCsv(head + rows('2026/01/10', 96, 20, 50) + '\n');
  assert.equal(p.source, 'tapo'); assert.equal(p.rows.length, 1); assert.deepEqual(p.errors, []);
  const r = p.rows[0]; assert.equal(r.day, '2026-01-10'); assert.equal(r.n, 96); assert.equal(r.t, 20); assert.equal(r.rh, 50);
  assert.equal(r.hours.length, 24); assert.deepEqual(r.hours[0], [20, 50]);
});

test('Tapo: mit „Abnormal“ markierte Werte fallen weg', () => {
  const p = parseClimateCsv(head + '2026/01/10 16:00:00,27.3,*,42,\n2026/01/10 16:15:00,21.0,,44,\n2026/01/10 16:30:00,21.2,,90,*\n');
  assert.equal(p.skipped, 2); assert.equal(p.rows[0].n, 1); assert.equal(p.rows[0].t, 21); assert.equal(p.rows[0].rh_max, 44);
});

test('Tapo: Unsinn wird gemeldet, englische Spaltennamen gehen auch', () => {
  const p = parseClimateCsv(head + '2026/01/10 10:00:00,abc,,50,\n');
  assert.equal(p.rows.length, 0); assert.equal(p.errors.length, 1);
  const e = parseClimateCsv('2026/01/10 00:00:00 - 2026/01/11 00:00:00,Temperature(℃),Abnormal,Humidity(%),Abnormal\n2026/01/10 10:00:00,19,,55,\n');
  assert.equal(e.source, 'tapo'); assert.equal(e.rows[0].rh, 55);
});

test('Govee weiter wie bisher, alter Name bleibt', () => {
  const g = parseGoveeCsv('Zeitstempel für Beispiel,Temperatur_Celsius,Relative Luftfeuchtigkeit\n2026-01-10 10:00:00,19.5,48\n');
  assert.equal(g.source, 'govee'); assert.equal(g.rows[0].t, 19.5);
  assert.ok(parseClimateCsv('a,b\n1,2').errors.length);
});
