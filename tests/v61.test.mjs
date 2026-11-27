// v0.61: Stromverbrauch über den Tag – gemessene Stundenwerte (Gerät „_haus“) oder Tagesverbrauch × Lastprofil;
// Profil aus den Messtagen abgeleitet und in der Simulation dynamischer Tarif verwendet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb, HAUS_ID } from '../js/calc.js';

const H = Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 22 ? 0.6 : 0.15));   // 19 × 0,15 + 5 × 0,6 = 5,85 kWh
const sum = a => a.reduce((x, y) => x + y, 0);
function mk({ haus = [], anker = 10 } = {}) {
  const a = []; for (let i = 0; i < anker; i++) a.push({ day: `2026-11-${String(i + 1).padStart(2, '0')}`, eigenverbrauch: 8, wallbox: i === 0 ? 2 : null, erzeugung: 1, netzimport: 7, genutzt: 1, einspeisung: 0 });
  return { anker_daily: a, device_hourly: haus.map(([day, hours]) => ({ device_id: HAUS_ID, day, hours })),
    settings: { data: { cars: { ice: {}, ev: {} }, battery: { capGross: 10 }, devices: [], loadProfile: { S_we0: Array(24).fill(1) } } } };
}

test('Profil aus Messtagen: Ø der normierten Tage je Gruppe, fehlende Gruppen aus dem gespeicherten Profil', () => {
  const C = createCalc(stateFromDb(mk({ haus: [['2026-11-03', H], ['2026-11-04', H.map(v => v * 2)]] })));
  const p = C.houseProfile();
  assert.equal(p.src, 'measured'); assert.equal(p.n.U_we0, 2);
  assert.ok(Math.abs(sum(p.U_we0) - 100) < 1e-9); assert.ok(Math.abs(p.U_we0[18] - 0.6 / 5.85 * 100) < 1e-9);
  assert.equal(p.S_we0.length, 24, 'gespeicherte Gruppe bleibt');
  assert.equal(createCalc(stateFromDb(mk())).houseProfile().S_we0.length, 24, 'ohne Messtage: gespeichertes Profil');
});

test('Tage: Messtag exakt, sonst Anker ohne Wallbox × Profil; Kennzahlen', () => {
  const C = createCalc(stateFromDb(mk({ haus: [['2026-11-03', H], ['2026-11-12', H]] })));
  const d = C.houseDays('2026-11-01', '2026-11-30');
  assert.equal(d.length, 11, '10 Anker-Tage + 1 Messtag ohne Anker-Tag');
  assert.equal(d[0].src, 'e'); assert.ok(Math.abs(d[0].kwh - 6) < 1e-9, 'Eigenverbrauch 8 − Wallbox 2');
  assert.ok(Math.abs(sum(d[0].h) - 6) < 1e-9);
  const m = d.find(x => x.d === '2026-11-03'); assert.equal(m.src, 'm'); assert.deepEqual(m.h, H); assert.equal(m.anker, 8);
  const st = C.houseDayStats('2026-11-01', '2026-11-30');
  assert.equal(st.measured, 2); assert.equal(st.est, 9); assert.equal(st.nWe0 + st.nWe1, 11);
  assert.ok(Math.abs(st.nightW - 150) < 1e-9, 'Grundlast nur aus Messtagen');
  assert.ok(st.peak.h >= 17 && st.peak.h < 22); assert.ok(st.eveningShare > 0.4);
  assert.ok(Math.abs(sum(st.avg) - st.kwhDay) < 1e-9);
});

test('Unvollständige oder fremde Stundenreihen werden ignoriert, Geräte-Tagesprofil bleibt unberührt', () => {
  const db = mk({ haus: [['2026-11-03', H.slice(0, 23)], ['2026-11-04', [...H.slice(0, 23), null]]] });
  const C = createCalc(stateFromDb(db));
  assert.equal(C.houseMeasuredDays().length, 0);
  assert.equal(C.powerDays().length, 0, '_haus ist kein Gerät');
});

test('Dynamischer Tarif nutzt die gemessene Tagesform', () => {
  const SP = Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 22 ? 300 : 50));
  const run = haus => { const db = mk({ haus, anker: 1 }); db.anker_daily[0].wallbox = null; db.grid_price = [{ day: '2026-11-01', eur_mwh: 100, hours: SP }];
    db.tariffs = [{ id: 'a', grp: 'as', name: 'x', valid_from: '2026-01-01', ap_ct: 33, gp_eur_year: 100, boni_eur: 0 }];
    db.settings.data.dyn = { ev: false, gridCharge: false }; db.settings.data.battery.capGross = 0; return createCalc(stateFromDb(db)).dynTariff(); };
  const flat = Array(24).fill(8 / 24), evening = Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 22 ? 1.6 : 0));
  assert.ok(run([['2026-11-01', evening]]).tot.naive > run([['2026-11-01', flat]]).tot.naive);
});
