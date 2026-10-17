// v0.33: Raumklima – Govee-Import und Auswertung je Raum. Synthetische Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoveeCsv, goveeRoomName } from '../js/import.js';
import { createCalc, stateFromDb } from '../js/calc.js';

const head = '﻿Zeitstempel für Abtastfrequenz alle 15 min min,Temperatur_Celsius (kalibriert -0.9 C),Relative Luftfeuchtigkeit\n';
// Ein Tag: nachts (0–6 Uhr) 65 %, sonst 50 %; Temperatur 20 °C
const day = d => Array.from({ length: 96 }, (_, i) => { const h = Math.floor(i / 4), m = (i % 4) * 15;
  return `${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00,20,${h < 6 ? 65 : 50}`; }).join('\n');

test('Govee: Raumname, Tageswerte, Stunden feucht/trocken', () => {
  assert.equal(goveeRoomName('Schlafzimmer_export_202610162354.csv'), 'Schlafzimmer');
  assert.equal(goveeRoomName('467cfa2d-Kinder_zimmer_export_202608100924.csv'), 'Kinder zimmer');
  assert.equal(goveeRoomName('foto.csv'), null);
  const p = parseGoveeCsv(head + day('2026-10-01') + '\n2026-10-02 00:04:00,19.5,38\n');
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 2);
  const r = p.rows[0];
  assert.equal(r.n, 96); assert.equal(r.t, 20); assert.equal(r.h_wet, 6); assert.equal(r.h_dry, 0);
  assert.equal(r.rh_min, 50); assert.equal(r.rh_max, 65);
  assert.deepEqual(r.hours[0], [20, 65]); assert.equal(r.hours.length, 24);
  assert.equal(p.rows[1].h_dry, 1); assert.equal(p.rows[1].hours[5], null);
  assert.ok(parseGoveeCsv('a,b\n1,2').errors.length);
});

test('calc: Raumklima je Raum, Nacht gegen Tag, unvollständige Tage zählen nicht', () => {
  const p = parseGoveeCsv(head + ['2026-10-01', '2026-10-02', '2026-10-03'].map(day).join('\n') + '\n2026-10-04 00:00:00,30,90\n');
  const room_climate = p.rows.map(r => ({ ...r, room: 'Schlafzimmer' }));
  const C = createCalc(stateFromDb({ anker_daily: [{ day: '2026-10-01', genutzt: 1 }], room_climate,
    settings: { data: { battery: {}, pv: {}, amort: {}, cars: {}, rooms: [{ id: 'Schlafzimmer', name: 'Schlafzimmer' }] } } }));
  const st = C.climateStats('2026-10-01', '2026-10-31');
  assert.equal(st.length, 1);
  const x = st[0];
  assert.equal(x.days, 3);                       // 04.10. mit 1 Wert zählt nicht
  assert.equal(x.rhNight, 65); assert.equal(x.rhDay, 50);
  assert.ok(Math.abs(x.wet - 0.25) < 1e-9);      // 6 von 24 Stunden
  assert.equal(x.dry, 0);
  const pr = C.climateProfile('Schlafzimmer', '2026-10-01', '2026-10-31');
  assert.equal(pr.days, 3); assert.equal(pr.hours[3].rh, 65); assert.equal(pr.hours[12].rh, 50);
  const ser = C.climateSeries('2026-10-01', '2026-10-03', 'rh');
  assert.equal(ser.ks.length, 3); assert.ok(Math.abs(ser.val.Schlafzimmer['2026-10-02'] - (6 * 65 + 18 * 50) / 24) < 0.06);   // Tagesmittel auf 0,1 gerundet
});
