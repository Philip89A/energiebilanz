// v0.63: neuer Arbeitspreis in der Amortisationsprognose (Annahme oder eingetragener künftiger Tarif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

function mk(amort = {}, tariffs = []) {
  const a = []; for (let t = Date.parse('2026-01-01'); t <= Date.parse('2026-11-27'); t += 864e5) a.push({ day: new Date(t).toISOString().slice(0, 10), eigenverbrauch: 6, genutzt: 2, erzeugung: 2, netzimport: 4, einspeisung: 0 });
  return createCalc(stateFromDb({ anker_daily: a, investments: [{ id: 'i', day: '2026-01-01', name: 'Anlage', cost: 2000 }],
    tariffs: [{ id: 't', grp: 'as', name: 'heute', valid_from: '2025-01-01', ap_ct: 30, gp_eur_year: 100 }, ...tariffs],
    settings: { data: { cars: { ice: {}, ev: {} }, amort: { years: 10, priceInc: 0, degr: 0, ...amort } } } }));
}
const at = (tl, k) => tl.cumS[tl.labels.indexOf(k)] - tl.cumS[tl.labels.indexOf(k) - 1];

test('Annahme: ab April 2027 neuer Preis, Monatsersparnis skaliert mit dem Verhältnis', () => {
  const base = mk().amortTimeline(), nx = mk({ apNext: 36, apNextFrom: '2027-04-01' }).amortTimeline();
  assert.equal(nx.nextAp.ap, 36); assert.equal(nx.nextAp.src, 'amort');
  assert.ok(Math.abs(at(nx, '2027-03') - at(base, '2027-03')) < 1e-9, 'vor dem Wechsel unverändert');
  assert.ok(Math.abs(at(nx, '2027-05') / at(base, '2027-05') - 1.2) < 1e-9, '36 / 30');
  assert.ok(!nx.be || !base.be || nx.be <= base.be);
});

test('Preissteigerung läuft ab dem Wechsel vom neuen Preis', () => {
  const nx = mk({ apNext: 36, apNextFrom: '2027-04-01', priceInc: 10 }).amortTimeline(), base = mk({ priceInc: 10 }).amortTimeline();
  assert.ok(Math.abs(at(nx, '2027-04') / at(base, '2027-04') - 1.2 / Math.pow(1.1, 5 / 12)) < 1e-9);
});

test('eingetragener künftiger Tarif geht vor; Annahme in der Vergangenheit oder ohne Preis wirkt nicht', () => {
  const t = mk({ apNext: 50, apNextFrom: '2027-04-01' }, [{ id: 'n', grp: 'as', name: 'Folgevertrag', valid_from: '2027-04-02', ap_ct: 33, gp_eur_year: 100 }]).amortTimeline();
  assert.equal(t.nextAp.src, 'tariff'); assert.equal(t.nextAp.ap, 33); assert.equal(t.apNow, 0.3, 'heutiger Preis, nicht der künftige');
  assert.equal(mk({ apNext: 36, apNextFrom: '2026-05-01' }).amortTimeline().nextAp, null);
  assert.equal(mk({ apNextFrom: '2027-04-01' }).amortTimeline().nextAp, null);
});
