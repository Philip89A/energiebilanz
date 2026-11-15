// v0.56: Stundenwerte der Messsteckdosen (Excel-Blatt „Tag“) und Tagesprofil Strom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMerossSheets } from '../js/import.js';
import { createCalc, stateFromDb } from '../js/calc.js';

const tag = (days, v) => [['2026/11/01 00:00:00 - 2026/11/03 09:01:07', 'Energieverbrauch (kWh)'],
  ...days.flatMap(d => Array.from({ length: 24 }, (_, h) => [`${d} ${String(h).padStart(2, '0')}:00:00`, v(h)]))];

test('Blatt „Tag“: vollständige Tage mit 24 Stundenwerten, angebrochener Export-Tag fällt weg', () => {
  const sheets = { Tag: [...tag(['2026/11/01', '2026/11/02'], h => (h >= 18 ? 0.1 : 0.002)), ['2026/11/03 00:00:00', 0.002], ['2026/11/03 08:00:00', 0.002]],
    Monat: [['2026/09/01 00:00:00 - 2026/11/03 09:01:07', 'kWh'], ['2026/11/01', 0.6], ['2026/11/02', 0.6], ['2026/11/03', 0.01]] };
  const p = parseMerossSheets(sheets);
  assert.equal(p.hourly.length, 2); assert.equal(p.hourly[0].day, '2026-11-01'); assert.equal(p.hourly[0].hours.length, 24);
  assert.equal(p.hourly[1].hours[20], 0.1); assert.equal(p.rows.length, 2);
});

test('Tagesprofil: Wärmepumpe und Geräte je Stunde, Summen, Spitze, Ø der Tage davor', () => {
  const hp = []; for (const d of ['2026-11-01', '2026-11-02']) for (let h = 0; h < 24; h++) hp.push({ grain: 'hour', ts: `${d}T${String(h).padStart(2, '0')}:00`, el_hp: 0.3, el_heat: 0.2, el_dhw: h === 6 ? 1 : 0.1, heat_heat: 0.8 });
  const dh = d => ({ device_id: 'pc', day: d, hours: Array.from({ length: 24 }, (_, h) => (h >= 19 && h < 23 ? 0.15 : 0.002)) });
  const C = createCalc(stateFromDb({ anker_daily: [{ day: '2026-11-01', genutzt: 1, erzeugung: 1, netzimport: 1, einspeisung: 0 }], hp_energy: hp,
    device_hourly: [dh('2026-11-01'), dh('2026-11-02')], grid_co2: [{ day: '2026-11-02', g_mean: 400, hours: Array(24).fill(400) }],
    settings: { data: { devices: [{ id: 'pc', name: 'PC', from: '' }], cars: { ice: {}, ev: {} } } } }));
  assert.deepEqual(C.powerDays(), ['2026-11-01', '2026-11-02']);
  const p = C.powerDayProfile('2026-11-02');
  assert.equal(p.devs.length, 1); assert.ok(Math.abs(p.sums.devs.pc - (4 * 0.15 + 20 * 0.002)) < 1e-9);
  assert.equal(p.peak.h, 6); assert.ok(Math.abs(p.sums.heat - 4.8) < 1e-9);
  assert.ok(Math.abs(p.nightW - (0.2 + 0.1 + 0.002) * 1000) < 1e-6);
  const a = C.powerDayAverage('2026-11-02'); assert.equal(a.n, 1); assert.ok(Math.abs(a.devs.pc.h[20] - 0.15) < 1e-9);
});
