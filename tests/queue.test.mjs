// Tests für js/queue.js – Offline-Warteschlange
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, enqueue, isNetworkError, parseNum, localStore } from '../js/queue.js';

const db = {
  meter_readings: [{ meter_id: 'w', day: '2025-01-01', value: 5 }],
  fuel_log: [{ id: 'f1', day: '2025-01-02', odometer: 100 }],
  settings: { data: { amort: { priceInc: 3 } } },
};

test('applyOps: speichern (neu und ersetzen), löschen, Einstellungen; Original bleibt unverändert', () => {
  const out = applyOps(db, [
    { op: 'save', kind: 'reading', row: { meter_id: 'w', day: '2025-01-01', value: 7 } },
    { op: 'save', kind: 'reading', row: { meter_id: 'w', day: '2025-02-01', value: 9 } },
    { op: 'save', kind: 'charge', row: { id: 'c1', kwh: 20 } },
    { op: 'delete', kind: 'fuel', row: { id: 'f1' } },
    { op: 'settings', data: { data: { amort: { priceInc: 6 } } } },
  ]);
  assert.deepEqual(out.meter_readings.map(r => r.value), [7, 9]);
  assert.equal(out.charge_log.length, 1);
  assert.equal(out.fuel_log.length, 0);
  assert.equal(out.settings.data.amort.priceInc, 6);
  assert.equal(db.meter_readings[0].value, 5);
  assert.equal(db.fuel_log.length, 1);
});

test('enqueue: Reihenfolge bleibt, Einstellungen nur die neueste', () => {
  let q = [];
  q = enqueue(q, { op: 'settings', data: { a: 1 } });
  q = enqueue(q, { op: 'save', kind: 'fuel', row: { id: 'x' } });
  q = enqueue(q, { op: 'settings', data: { a: 2 } });
  assert.deepEqual(q.map(o => o.op), ['save', 'settings']);
  assert.equal(q[1].data.a, 2);
});

test('isNetworkError', () => {
  assert.equal(isNetworkError(new Error('TypeError: Failed to fetch')), true);
  assert.equal(isNetworkError({ message: 'Load failed' }), true);          // Safari
  assert.equal(isNetworkError({ message: 'duplicate key value' }), false);
  assert.equal(isNetworkError({ message: 'irgendwas' }, false), true);       // offline
});

test('parseNum: deutsche und englische Schreibweise', () => {
  assert.equal(parseNum('42,5'), 42.5);
  assert.equal(parseNum('1.234,5'), 1234.5);
  assert.equal(parseNum('42.5'), 42.5);
  assert.equal(parseNum(' 12 504 '), 12504);
  assert.ok(Number.isNaN(parseNum('')));
  assert.ok(Number.isNaN(parseNum('12a')));
});

test('localStore: Datenstand und Warteschlange je Nutzer', () => {
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const a = localStore('a', storage), b = localStore('b', storage);
  a.saveQueue([{ op: 'save' }]); a.saveSnapshot({ x: 1 });
  assert.equal(a.queue().length, 1); assert.equal(b.queue().length, 0);
  assert.deepEqual(a.snapshot().db, { x: 1 });
  a.clear(); assert.equal(a.snapshot(), null);
});
