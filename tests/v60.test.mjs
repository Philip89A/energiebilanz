// v0.60: Simulation dynamischer Tarif (Börsenpreise, Lastprofil, Speicher, E-Auto) und Börsenpreis-Aggregation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourPrices, evHours, simDay, dynSim, pvShape, profileKey, DYN_DEFAULTS } from '../js/dyn.js';
import { parseGridPrice, aggregateGridPrice } from '../js/gridprice.js';
import { createCalc, stateFromDb, toDb } from '../js/calc.js';

const SPOT = [60, 55, 50, 48, 50, 60, 90, 120, 110, 90, 70, 60, 50, 45, 50, 70, 100, 150, 180, 170, 140, 110, 90, 70];

test('Endpreis: (Börse + Aufschlag + Netz + Steuern) × MwSt; Modul 3 ersetzt das Netzentgelt nach Uhrzeit', () => {
  const p = hourPrices(SPOT, {});
  assert.ok(Math.abs(p[0] - (6 + 1.7 + 10 + 6.5) * 1.19 / 100) < 1e-12);
  const m = hourPrices(SPOT, { mod3: true });
  assert.ok(Math.abs(m[2] - (5 + 1.7 + 2.5 + 6.5) * 1.19 / 100) < 1e-12);    // Niedertarif 0–6
  assert.ok(Math.abs(m[18] - (18 + 1.7 + 15 + 6.5) * 1.19 / 100) < 1e-12);   // Hochtarif 17–21
  assert.ok(Math.abs(m[12] - p[12]) < 1e-12);                               // Standard
});

test('E-Auto lädt in den billigsten Stunden des Fensters 18–7 Uhr', () => {
  const ev = evHours(15, hourPrices(SPOT, {}), 11);
  assert.equal(ev[3], 11); assert.equal(ev[2], 4); assert.equal(ev.reduce((a, b) => a + b, 0), 15);
});

test('Speicher: preisgesteuert nie teurer als Eigenverbrauch, entlädt nicht ins Auto, Netzladung nur wenn erlaubt', () => {
  const price = hourPrices(SPOT, {}), load = Array(24).fill(0.3), pv = Array(24).fill(0), ev = Array(24).fill(0); ev[3] = 5;
  const self = simDay({ load, pv, ev, price, soc0: 5, cap: 10, cfg: {}, mode: 'self' });
  const opt = simDay({ load, pv, ev, price, soc0: 5, cap: 10, cfg: {}, mode: 'opt' });
  const noGrid = simDay({ load, pv, ev, price, soc0: 5, cap: 10, cfg: { gridCharge: false }, mode: 'opt' });
  const val = r => r.cost - r.soc * Math.sqrt(0.88) * price.reduce((a, b) => a + b, 0) / 24;   // Kosten minus Wert der Restladung
  assert.ok(val(opt) <= val(self) + 1e-9);
  assert.ok(opt.grid[3] >= 5 - 1e-9, 'Auto immer aus dem Netz');
  assert.ok(noGrid.gridKwh <= 24 * 0.3 + 5 + 1e-9);
  assert.ok(opt.grid.every(g => g >= -1e-9));
});

test('Gesamtlauf: Ersparnis = fest − dynamisch, Bausteine ergeben die Summe', () => {
  const days = []; for (let i = 0; i < 20; i++) days.push({ d: `2026-01-${String(i + 1).padStart(2, '0')}`, load: 7.5, pv: 1, ev: 4.6, spot: SPOT });
  const r = dynSim(days, { fixed: { ap: 0.3308, gpYear: 169.22 }, cap: 11 });
  const house = (r.tot.fix - r.tot.naive) - r.evSaving;
  assert.ok(Math.abs(house + r.evSaving + r.storage + (r.feesFix - r.feesDyn) - r.saving) < 1e-9);
  assert.ok(r.storage >= -1e-6);
  assert.equal(Object.keys(r.months).length, 1);
});

test('Sonnenkurve und Profilschlüssel', () => {
  const w = pvShape('2026-12-21'), s = pvShape('2026-06-21');
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(w[3], 0); assert.ok(s[20] > 0 && w[17] === 0);
  assert.equal(profileKey('2026-11-22'), 'U_we1'); assert.equal(profileKey('2026-01-05'), 'W_we0'); assert.equal(profileKey('2026-07-16'), 'S_we0');
});

test('Börsenpreise: Viertelstunden → Stundenmittel in Ortszeit, negative Preise bleiben', () => {
  const t0 = Date.parse('2026-01-10T00:00:00+01:00') / 1000, ts = [], pr = [];
  for (let q = 0; q < 96; q++) { ts.push(t0 + q * 900); pr.push(q < 4 ? -10 : 80); }
  const rows = aggregateGridPrice(parseGridPrice({ unix_seconds: ts, price: pr }));
  assert.equal(rows.length, 1); assert.equal(rows[0].day, '2026-01-10'); assert.equal(rows[0].hours[0], -10); assert.equal(rows[0].hours[5], 80);
});

test('Rechenkern: dynTariff mit Anker-Tagen und Preisen; Einstellungen dyn und loadProfile werden gespeichert', () => {
  const anker = [], gp = [];
  for (let i = 0; i < 10; i++) { const d = `2026-11-${String(i + 1).padStart(2, '0')}`; anker.push({ day: d, eigenverbrauch: 7, erzeugung: 1, netzimport: 6, genutzt: 1, einspeisung: 0 }); gp.push({ day: d, eur_mwh: 90, hours: SPOT }); }
  const db = { anker_daily: anker, grid_price: gp, tariffs: [{ id: 'a', grp: 'as', name: 'x', valid_from: '2026-01-01', ap_ct: 33.08, gp_eur_year: 169.22, boni_eur: 0 }],
    settings: { data: { cars: { ice: {}, ev: { km: 10000, kwh100: 18, loss: 10, shHome: 85 } }, battery: { reserve: 10, capGross: 12.5 }, dyn: { netzCt: 9 }, loadProfile: { W_we0: Array(24).fill(1) } } } };
  const S = stateFromDb(db), C = createCalc(S), r = C.dynTariff();
  assert.equal(r.n, 10); assert.ok(Math.abs(r.cap - 11.25) < 1e-9); assert.equal(r.cfg.netzCt, 9);
  assert.ok(isFinite(r.saving));
  const out = toDb.settings(S).data; assert.equal(out.dyn.netzCt, 9); assert.ok(out.loadProfile.W_we0);
});

test('v0.60.1: Börsenpreise blockweise speichern, ein Fehler wird einmal wiederholt, Daten davor bleiben erhalten', async () => {
  const { fetchGridPrice } = await import('../js/gridprice.js');
  const mk = (a, b) => { const ts = [], pr = []; for (let t = Date.parse(a + 'T00:00:00+01:00') / 1000; t <= Date.parse(b + 'T23:45:00+01:00') / 1000; t += 900) { ts.push(t); pr.push(80); } return { unix_seconds: ts, price: pr }; };
  let calls = 0; const saved = [];
  const flaky = async (a, b) => { calls++; if (calls === 2) throw new Error('Energy-Charts: HTTP 429'); return mk(a, b); };
  const rows = await fetchGridPrice('2026-01-01', '2026-03-15', flaky, async part => saved.push(...part), { wait: 0, retryWait: 0 });
  assert.equal(calls, 4); assert.equal(rows.length, 74); assert.equal(saved.length, 74);
  let n = 0; const broken = async (a, b) => { n++; if (n >= 2) throw new Error('HTTP 502'); return mk(a, b); };
  const kept = [];
  await assert.rejects(fetchGridPrice('2026-01-01', '2026-03-15', broken, async part => kept.push(...part), { wait: 0, retryWait: 0 }));
  assert.equal(kept.length, 31, 'erster Block bleibt gespeichert');
});
