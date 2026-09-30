// Ausbau-Szenario „Weg B“ (v0.8) mit synthetischen Tageswerten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ausbauRechner } from '../js/calc.js';

const days = Array.from({ length: 365 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), s = 1 + Math.sin((i - 80) / 365 * 2 * Math.PI);
  return { d, gen: 3 * s, use: 2 * s * 0.8, bch: s, bdis: 0.9 * s, asGrid: 4 };
});
const COST = { hwTotal: 2000, hwWallbox: 400, craftWallbox: 1000, craftPv: 500 };
const base = { from: days[0].d, to: days[364].d, days, kwp: 1, usable: 2, evHome: 1500, ap: 30, pricePublic: 0.6, evStart: '', priceInc: 0, degr: 0 };

test('Ohne Ausbau und ohne Auto kein Mehrwert', () => {
  const r = ausbauRechner(base, { pvAddWp: 0, storeAddKwh: 0, acKwh: 0 }, '2026-01-01');
  assert.ok(Math.abs(r.noCar.total) < 1e-6);
});

test('Wallbox gegen öffentliches Laden, Steckdose als Alternative', () => {
  const r = ausbauRechner(base, COST, '2026-01-01');
  assert.ok(Math.abs(r.year.wallbox - 1500 * (0.6 - 0.3)) < 1e-9);
  assert.ok(Math.abs(r.year.total - (r.year.house + r.year.carPv + r.year.feed + r.year.wallbox + r.year.s14a)) < 1e-9);
  assert.equal(r.invest.total, 2000 + 1000 + 500);
  const s = ausbauRechner(base, { ...COST, alt: 'socket' }, '2026-01-01');
  assert.equal(s.year.wallbox, 0);
  assert.equal(s.invest.wallbox, 400 + 1000 - 400);
  assert.ok(s.payback.total == null || s.payback.total.years > r.payback.total.years);
});

test('§14a an/aus, eigener Betrag und Modul aus dem Tarifrechner', () => {
  const off = ausbauRechner(base, COST, '2026-01-01');
  const on = ausbauRechner(base, { ...COST, s14a: true, s14aEur: 150 }, '2026-01-01');
  assert.equal(off.year.s14a, 0);
  assert.equal(on.year.s14a, 150);
  assert.ok(on.payback.total.years < off.payback.total.years);
  assert.equal(ausbauRechner(base, { s14a: true, s14aMod: 'm1' }, '2026-01-01', { m1: 120 }).year.s14a, 120);
  assert.equal(ausbauRechner(base, { s14a: true, s14aMod: 'm2' }, '2026-01-01', null).year.s14a, 0);
});

test('Auto-Anteile erst ab Übergabe', () => {
  const r = ausbauRechner({ ...base, evStart: '2026-07-01' }, COST, '2026-01-01');
  const m = r.months;
  assert.ok(Math.abs(m[0].cumWb) < 1e-9 && Math.abs(m[5].cumWb) < 1e-9);
  assert.ok(Math.abs(m[6].cumWb - r.year.wallbox / 12) < 1e-9);
});

test('Ohne Kosten: keine Vorgabewerte aus Angeboten', () => {
  assert.equal(ausbauRechner(base, {}, '2026-01-01').invest.total, 0);
});
