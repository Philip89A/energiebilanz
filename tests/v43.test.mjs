// v0.43: Netzwerte über die Edge Function (Stücke, Ortstage einschließlich) und Hebel mit eigener Eigenverbrauchsquote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGridCo2 } from '../js/gridco2.js';

// echte Form der Energy-Charts-Antwort (geprüft am 21.10.2026): unix_seconds, co2eq, co2eq_forecast, deprecated;
// start/end als Ortstage einschließlich, 15-Minuten-Werte
function fake(start, end) {
  const a = Date.parse(start + 'T00:00:00+02:00'), z = Date.parse(end + 'T00:00:00+02:00') + 864e5, ts = [], v = [];
  for (let t = a; t < z; t += 9e5) { ts.push(t / 1000); v.push(350); }
  return { unix_seconds: ts, co2eq: v, co2eq_forecast: v, deprecated: false };
}

test('fetchGridCo2: Stücke zu höchstens 31 Tagen, jeder Tag genau einmal', async () => {
  const calls = [];
  const rows = await fetchGridCo2('2026-07-01', '2026-08-15', async (a, b) => { calls.push([a, b]); return fake(a, b); });
  assert.deepEqual(calls, [['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-15']]);
  assert.equal(rows.length, 46); assert.equal(new Set(rows.map(r => r.day)).size, 46);
  assert.ok(rows.every(r => r.g_mean === 350 && r.hours && r.hours.length === 24));
});

test('fetchGridCo2: Fehler der Funktion wird weitergereicht', async () => {
  await assert.rejects(fetchGridCo2('2026-07-01', '2026-07-02', async () => { throw new Error('Energy-Charts: HTTP 500'); }), /HTTP 500/);
});
