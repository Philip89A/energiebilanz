// v0.50: Ladevorgänge mit Ort „Sonstiges“ und Kommentar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDb, stateFromDb } from '../js/calc.js';

test('Kommentar wird gespeichert, ohne Kommentar kein Feld note (läuft auch ohne SQL-Update)', () => {
  const a = toDb.charge({ d: '2026-12-01', k: 30, e: 15, o: 'Sonstiges', n: 'Hotel' });
  assert.equal(a.location, 'Sonstiges'); assert.equal(a.note, 'Hotel');
  const b = toDb.charge({ d: '2026-12-01', k: 30, e: 0, o: 'zu Hause', n: '' });
  assert.ok(!('note' in b));
  assert.equal(toDb.charge({ d: '2026-12-01', k: 1, o: 'Sonstiges', n: 'x'.repeat(600) }).note.length, 500);
});

test('Lesen: note → n, fehlende Spalte → leer', () => {
  const S = stateFromDb({ charge_log: [{ id: '1', day: '2026-12-01', kwh: 30, amount: 10, location: 'Sonstiges', note: 'Freunde' }, { id: '2', day: '2026-12-02', kwh: 20, amount: null, location: 'zu Hause' }] });
  assert.equal(S.charges[0].n, 'Freunde'); assert.equal(S.charges[1].n, '');
});
