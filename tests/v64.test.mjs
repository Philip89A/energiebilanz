// v0.64: Gruppen in den Investitionen – Kauf, Verkauf, Erstattung und Rücksendekosten werden miteinander verrechnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, toDb } from '../js/calc.js';

const labels = [], cumS = [], proj = [];
for (let j = 0; j < 36; j++) { const y = 2025 + Math.floor((1 + j) / 12), m = (1 + j) % 12 + 1; labels.push(`${y}-${String(m).padStart(2, '0')}`); cumS.push(100 * (j + 1)); proj.push(j > 20); }
const tl = { labels, cumS, proj, lastK: '2026-10' };
const inv = [
  { id: 'a', day: '2025-02-10', name: 'Anlage', cost: 1000, grp: null },
  { id: 'p1', day: '2025-03-27', name: 'Plug 4x', cost: 69, grp: 'Smart Plugs' },
  { id: 'p2', day: '2025-05-28', name: 'Plug 2x', cost: 38.99, grp: 'Smart Plugs' },
  { id: 's1', day: '2025-12-31', name: 'Plug 3x Verkauf', cost: -35, grp: 'Smart Plugs' },
  { id: 's2', day: '2026-01-06', name: 'Plug 3x Verkauf', cost: -46, grp: 'Smart Plugs' },
  { id: 'c', day: '2026-10-02', name: 'CEE 16A', cost: 41.93, grp: 'CEE' },
  { id: 'cr', day: '2026-11-24', name: 'Erstattung CEE', cost: 49.9, category: 'refund', grp: 'CEE' },
  { id: 'cv', day: '2026-11-24', name: 'Rückversand CEE', cost: 6.19, grp: 'CEE ' },
  { id: 'x', day: '2025-04-01', name: 'Verkauf ohne Gruppe', cost: -20, grp: null },
];
const S = stateFromDb({ anker_daily: [{ day: '2025-02-01', eigenverbrauch: 5, genutzt: 1, erzeugung: 1, netzimport: 4, einspeisung: 0 }], investments: inv, settings: { data: { cars: { ice: {}, ev: {} } } } });
const C = createCalc(S);

test('Gruppe mit Verlust wird ein Restposten, Gruppe mit Plus ist erledigt', () => {
  const r = C.amortPayoff('date', { tl });
  const plugs = r.items.find(x => x.id === 'grp:Smart Plugs');
  assert.ok(plugs && Math.abs(plugs.cost - 26.99) < 1e-9 && Math.abs(plugs.buy - 107.99) < 1e-9);
  assert.equal(r.n, 2, 'Anlage + Plug-Rest');
  assert.equal(r.settled.length, 1); const cee = r.settled[0];
  assert.equal(cee.name, 'CEE'); assert.ok(Math.abs(cee.result - 1.78) < 1e-9); assert.equal(cee.paidK, '2026-11'); assert.equal(cee.n, 3, 'Gruppenname ohne Leerzeichen');
  assert.ok(r.byDate.some(x => x.state === 'settled'));
});

test('Guthaben: ungruppierte Verkäufe zählen, gruppierte Erstattungen nicht doppelt', () => {
  const r = C.amortPayoff('date', { tl }), idx = labels.indexOf('2026-11');
  const t2 = { ...tl, lastK: '2026-11' }, r2 = C.amortPayoff('date', { tl: t2 });
  assert.ok(Math.abs(r2.credit - (cumS[idx] + 20 - 49.9)) < 1e-9);
  assert.ok(Math.abs(r.credit - (cumS[labels.indexOf('2026-10')] + 20)) < 1e-9);
});

test('Spalte grp wird nur gesendet, wenn sie geladen wurde', () => {
  assert.equal(toDb.investment(S.invest.find(x => x.id === 'cv')).grp, 'CEE');
  assert.equal(toDb.investment(S.invest.find(x => x.id === 'a')).grp, null);
  assert.ok(!('grp' in toDb.investment({ id: 'n', name: 'neu', date: '', cost: 0 })));
});
