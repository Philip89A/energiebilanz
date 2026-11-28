// v0.62: Was ist schon abbezahlt? – Verteilung der kumulierten Ersparnis auf die Käufe (ältester bzw. günstigster zuerst).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const inv = [
  { id: 'a', day: '2025-02-10', name: 'Großes Paket', cost: 1000 },
  { id: 'b', day: '2025-03-05', name: 'Stecker', cost: 50 },
  { id: 'c', day: '2025-06-01', name: 'Batterie', cost: 300 },
  { id: 's', day: '2025-04-01', name: 'Verkauf', cost: -20 },
  { id: 'r', day: '2025-05-01', name: 'Gutschrift', cost: 30, category: 'refund' },
];
const C = createCalc(stateFromDb({ anker_daily: [{ day: '2025-02-01', eigenverbrauch: 5, genutzt: 1, erzeugung: 1, netzimport: 4, einspeisung: 0 }], investments: inv,
  settings: { data: { cars: { ice: {}, ev: {} } } } }));
// 100 € Ersparnis pro Monat ab Feb 2025, gemessen bis Jun 2025, danach Prognose
const labels = [], cumS = [], proj = [];
for (let j = 0; j < 24; j++) { const y = 2025 + Math.floor((1 + j) / 12), m = (1 + j) % 12 + 1; labels.push(`${y}-${String(m).padStart(2, '0')}`); cumS.push(100 * (j + 1)); proj.push(j > 4); }
const tl = { labels, cumS, proj, lastK: '2025-06' };

test('ältester Kauf zuerst: großes Paket blockiert, Verkäufe zählen als Guthaben', () => {
  const r = C.amortPayoff('date', { tl });
  const a = r.items.find(x => x.id === 'a'), b = r.items.find(x => x.id === 'b'), c = r.items.find(x => x.id === 'c');
  assert.equal(r.n, 3, 'Gutschrift und Verkauf sind keine Posten');
  assert.equal(a.state, 'current'); assert.ok(Math.abs(a.paidNow - 520) < 1e-9, '5 × 100 + 20 Verkauf');
  assert.equal(b.state, 'next'); assert.equal(c.state, 'next');
  assert.equal(a.paidK, '2025-11'); assert.equal(b.paidK, '2025-12');
  assert.equal(r.nPaid, 0); assert.ok(Math.abs(r.covered - 520) < 1e-9);
  assert.deepEqual(r.byDate.map(x => x.id), ['a', 'b', 'c']);
});

test('günstigster zuerst: kleine Posten sind sofort abbezahlt, kein Kauf vor seinem Kaufdatum', () => {
  const r = C.amortPayoff('cheap', { tl });
  const b = r.items.find(x => x.id === 'b'), c = r.items.find(x => x.id === 'c'), a = r.items.find(x => x.id === 'a');
  assert.equal(b.state, 'paid'); assert.equal(b.paidK, '2025-03');
  assert.equal(c.paidK, '2025-06', 'Batterie erst ab Kaufmonat, dann aus dem vorhandenen Guthaben'); assert.equal(c.state, 'paid');
  assert.equal(a.state, 'current'); assert.ok(Math.abs(a.paidNow - (520 - 350)) < 1e-9);
  assert.equal(r.nPaid, 2);
  assert.deepEqual(r.byDate.map(x => x.id), ['b', 'c', 'a']);
});

test('nicht im Betrachtungszeitraum abbezahlt → später', () => {
  const short = { labels: labels.slice(0, 6), cumS: cumS.slice(0, 6), proj: proj.slice(0, 6), lastK: '2025-06' };
  const r = C.amortPayoff('date', { tl: short });
  assert.equal(r.items.find(x => x.id === 'c').state, 'later'); assert.equal(r.endK, '2025-07');
});
