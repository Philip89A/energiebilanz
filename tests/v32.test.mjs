// v0.32: Geräte – Tapo- und Meross-Import, Monatswerte, Rechnung je Zeitraum. Synthetische Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTapoCsv, tapoDeviceName, parseMerossSheets, monthRows, diffDevice, monthDays } from '../js/import.js';
import { createCalc, stateFromDb } from '../js/calc.js';

test('Tapo: Dateiname, führende Nullen und angebrochener erster Tag fallen weg', () => {
  assert.equal(tapoDeviceName('Power Monitor Day Data - Kühlschrank - 20261016.csv'), 'Kühlschrank');
  assert.equal(tapoDeviceName('abc-Power_Monitor_Day_Data_-_Gefrierschrank_-_20261016.csv'), 'Gefrierschrank');
  assert.equal(tapoDeviceName('irgendwas.csv'), null);
  const csv = 'Date\t,Power Consumption-(kWh)\t\n2026-01-01\t,0.000\t\n2026-01-02\t,0.100\t\n'
    + [3, 4, 5, 6, 7, 8, 9].map(d => `2026-01-0${d}\t,0.400\t`).join('\n') + '\n2026-01-10\t,0.000\t\n';
  const p = parseTapoCsv(csv);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows[0].day, '2026-01-03');
  assert.equal(p.rows.at(-1).kwh, 0);           // Null nach Messbeginn bleibt (Gerät aus)
  assert.equal(p.rows.length, 8);
});

test('Meross: Tageswerte, Monatssummen verteilt, Exporttag weg', () => {
  const sheets = {
    Monat: [['2026/03/01 00:00:00 - 2026/03/10 12:00:00', 'kWh'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => [`2026/03/${String(d).padStart(2, '0')}`, 0.5])],
    Jahr: [['2025/12/01 00:00:00 - 2026/03/10 12:00:00', 'kWh'], ['2025/12', 0], ['2026/01', 3.1], ['2026/02', 2.8], ['2026/03', 4.6]],
  };
  const r = parseMerossSheets(sheets);
  assert.equal(r.exportDay, '2026-03-10');
  assert.equal(r.rows[0].day, '2026-01-01');     // Dezember 0 → vor Messbeginn
  assert.equal(r.rows[0].src, 'month');
  assert.ok(Math.abs(r.rows[0].kwh - 0.1) < 1e-9);
  assert.equal(r.rows.filter(x => x.day.startsWith('2026-02')).length, 28);
  assert.equal(r.rows.at(-1).day, '2026-03-09');  // 10.03. unvollständig
  assert.equal(r.rows.filter(x => x.day.startsWith('2026-03')).every(x => x.src === 'day'), true);
});

test('Monatswerte von Hand und Vergleich mit dem Bestand', () => {
  const rows = monthRows('2026-02', { kwh: 14, water_l: 1120, runs: 28 });
  assert.equal(rows.length, 28);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.kwh, 0) - 14) < 1e-6);
  assert.equal(rows[0].runs, 1);
  assert.equal(monthDays('2028-02').length, 29);
  const d = diffDevice([{ day: '2026-02-01', kwh: 0.5, src: 'month' }], rows, '2026-02-02');
  assert.equal(d.vorher, 1); assert.equal(d.neu, 27); assert.equal(d.write.length, 27);
});

test('calc: Anteil am Haushalt, Vorjahr, Auffälligkeit, gemessen ab', () => {
  const days = []; for (let d = new Date('2025-01-01'); d <= new Date('2026-03-31'); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const anker_daily = days.map(day => ({ day, genutzt: 2, erzeugung: 3, netzimport: 4, einspeisung: 0 }));
  const meter_readings = [{ meter_id: 'as', day: '2025-01-01', value: 1000 }, { meter_id: 'as', day: '2026-04-01', value: 1000 + 4 * days.length }];
  const devices = [{ id: 'gf', name: 'Gefrierschrank', from: '' }, { id: 'ks', name: 'Kühlschrank', from: '2026-03-01' }];
  const device_daily = [...days.map(day => ({ device_id: 'gf', day, kwh: day >= '2026-03-04' ? 0.6 : 0.5, src: 'day' })),
    ...days.map(day => ({ device_id: 'ks', day, kwh: 0.3, src: 'day' }))];
  const C = createCalc(stateFromDb({ anker_daily, meters: [{ id: 'as', name: 'A', grp: 'as', sort: 0 }], meter_readings, device_daily,
    tariffs: [{ id: 't', grp: 'as', name: 'x', valid_from: '2024-01-01', ap_ct: 30, gp_eur_year: 0 }],
    settings: { data: { battery: {}, pv: { kwp: 1 }, amort: {}, cars: {}, devices } } }));
  const st = C.deviceStats('2026-02-01', '2026-02-28');
  assert.equal(st.list.length, 1);                 // Kühlschrank erst ab 01.03.
  const gf = st.list[0];
  assert.ok(Math.abs(gf.perDay - 0.5) < 1e-9);
  assert.ok(Math.abs(gf.share - 0.5 / 6) < 1e-6);   // Haushalt 4 + 2 kWh/Tag
  assert.ok(Math.abs(gf.eur - 28 * 0.5 * 0.3) < 1e-9);
  assert.ok(Math.abs(gf.change) < 1e-9);            // Vorjahr gleich
  assert.ok(Math.abs(st.restPerDay - 5.5) < 1e-6);
  const al = C.deviceAlerts();
  assert.equal(al.length, 1); assert.equal(al[0].id, 'gf'); assert.ok(al[0].change > 0.15);
  const ser = C.deviceSeries('2026-03-01', '2026-03-03');
  assert.equal(ser.ks.length, 3); assert.equal(ser.val.ks['2026-03-01'], 0.3);
});
