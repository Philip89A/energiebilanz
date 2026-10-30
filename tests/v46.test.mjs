// v0.46: Ablesezeit – stundengenaue Verteilung zwischen zwei Ablesungen; ohne Uhrzeit wie bisher (00:00).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, toDb } from '../js/calc.js';

function calc(readings) {
  return createCalc(stateFromDb({ anker_daily: [{ day: '2026-10-01', genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 }],
    meters: [{ id: 'w', name: 'Wasser', grp: 'water', sort: 0 }], meter_readings: readings, settings: { data: { battery: {}, pv: {}, amort: {}, cars: {} } } }));
}

test('Uhrzeit: 20.10. 18:00 → 22.10. 06:00 = 1,5 Tage; 20.10. ¼, 21.10. ganz, 22.10. ¼', () => {
  const g = calc([{ meter_id: 'w', day: '2026-10-20', value: 100, read_at: '2026-10-20T16:00:00Z' },        // 18:00 Sommerzeit
    { meter_id: 'w', day: '2026-10-22', value: 100.3, read_at: '2026-10-22T04:00:00Z' }]).groupSeries('water');  // 06:00
  const iv = g.intervals[0]; assert.ok(Math.abs(iv.days - 1.5) < 1e-9);
  assert.ok(Math.abs(g.daily['2026-10-20'] - 0.05) < 1e-9 && Math.abs(g.daily['2026-10-21'] - 0.2) < 1e-9 && Math.abs(g.daily['2026-10-22'] - 0.05) < 1e-9);
});

test('Tag zwischen zwei Intervallen bekommt Anteile aus beiden', () => {
  const g = calc([{ meter_id: 'w', day: '2026-10-20', value: 100, read_at: '2026-10-19T22:00:00Z' },        // 00:00
    { meter_id: 'w', day: '2026-10-21', value: 100.24, read_at: '2026-10-21T10:00:00Z' },                       // 12:00
    { meter_id: 'w', day: '2026-10-22', value: 100.36, read_at: '2026-10-21T22:00:00Z' }]).groupSeries('water');  // 22.10. 00:00
  assert.ok(Math.abs(g.daily['2026-10-21'] - (0.24 * 0.5 / 1.5 + 0.12)) < 1e-9);
});

test('ohne Uhrzeit oder Uhrzeit an anderem Tag: wie bisher', () => {
  const g = calc([{ meter_id: 'w', day: '2026-10-20', value: 100 }, { meter_id: 'w', day: '2026-10-22', value: 100.2, read_at: '2026-10-25T10:00:00Z' }]).groupSeries('water');
  assert.equal(g.intervals[0].days, 2); assert.ok(Math.abs(g.daily['2026-10-20'] - 0.1) < 1e-9); assert.equal(g.daily['2026-10-22'], undefined);
});

test('toDb: read_at nur, wenn gesetzt; readAtOk erkennt fehlende Spalte', () => {
  assert.deepEqual(toDb.reading({ m: 'w', d: '2026-10-20', v: 1 }), { meter_id: 'w', day: '2026-10-20', value: 1, source: null });
  assert.equal(toDb.reading({ m: 'w', d: '2026-10-20', v: 1, t: 'x' }).read_at, 'x');
  assert.equal(stateFromDb({ meter_readings: [{ meter_id: 'w', day: '2026-10-20', value: 1 }] }).readAtOk, false);
  assert.equal(stateFromDb({ meter_readings: [{ meter_id: 'w', day: '2026-10-20', value: 1, read_at: null }] }).readAtOk, true);
});
