// Tests gegen die echten, privaten Daten in data/ (nicht im Repo). Fehlen die Dateien, wird übersprungen.
// Sollwerte stehen in data/expected.json, damit keine echten Zahlen im Repo landen.
// Datenordner abweichend: EB_DATA_DIR=/pfad/zu/data node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSeed, mapSeed, seedSummary, parseAnkerCsv, diffAnker } from '../js/import.js';

const dir = process.env.EB_DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const file = name => join(dir, name);
const has = (...names) => names.every(n => existsSync(file(n)));
const json = name => JSON.parse(readFileSync(file(name), 'utf8'));

test('Seed: gültig, Mengen und Kontrollsummen wie data/expected.json',
  { skip: !has('seed_state.json', 'expected.json') && 'data/seed_state.json oder data/expected.json fehlt' }, () => {
  const seed = json('seed_state.json');
  assert.deepEqual(validateSeed(seed), []);
  assert.deepEqual(seedSummary(mapSeed(seed)), json('expected.json').seedSummary);
});

test('CSV = Seed für alle Tage (15 Kennzahlen), Smart Plug nur ergänzt',
  { skip: !has('seed_state.json', 'anker_energiedetails.csv') && 'data/ fehlt' }, () => {
  const seedRows = mapSeed(json('seed_state.json')).anker_daily;
  const p = parseAnkerCsv(readFileSync(file('anker_energiedetails.csv'), 'utf8'));
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, seedRows.length);
  const d = diffAnker(seedRows.map(r => ({ ...r, smart_plug: null })), p.rows);
  assert.equal(d.neu.length, 0);
  assert.deepEqual(d.geaendert, []);
  assert.equal(d.ergaenzt.length + d.gleich, seedRows.length);
});
