// Synthetische Tests für v0.20: Angebote mit Positionen (Summen, Aufteilung, Buchung) und Kosten der Ausbau-Seite aus
// Investitionen und Angeboten. Erfundene Werte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerSums, offerShare, offerBookingRows, offerBookedIds, ausbauCosts, toDb, stateFromDb } from '../js/calc.js';

const offer = (over = {}) => ({ id: 'o1', no: 'T-1', vendor: 'Testfirma', sharePv: 60, ausbau: true, items: [
  { qty: 10, name: 'Arbeit', price: 50, alloc: 'shared', due: 'montage' },
  { qty: 1, name: 'Schutzschalter', price: 80, alloc: 'wallbox', due: 'montage' },
  { qty: 2.5, name: 'Kabel je m', price: 3.33, alloc: 'shared', due: 'montage' },
  { qty: 1, name: 'Anmeldung', price: 200, alloc: 'pv', due: 'anmeldung' }], paid: {}, ...over });

test('v0.20: Summen je Zuordnung und Fälligkeit, gemeinsame Positionen nach Anteil', () => {
  const s = offerSums(offer());
  assert.equal(s.total, 788.33);
  assert.equal(s.shared, 508.33); assert.equal(s.wallbox, 80); assert.equal(s.pv, 200);
  assert.deepEqual(s.due.montage, { total: 588.33, pv: 305, wallbox: 283.33 });
  assert.deepEqual(s.due.anmeldung, { total: 200, pv: 200, wallbox: 0 });
  assert.equal(s.pvAll, 505); assert.equal(s.wbAll, 283.33);
  assert.equal(Math.round((s.pvAll + s.wbAll) * 100), Math.round(s.total * 100));
});

test('v0.20: Anteil PV – Vorgabe 75 %, Grenzen 0–100, 0 bleibt 0', () => {
  assert.equal(offerShare({}), 75); assert.equal(offerShare({ sharePv: '' }), 75);
  assert.equal(offerShare({ sharePv: 0 }), 0); assert.equal(offerShare({ sharePv: 140 }), 100);
  const s = offerSums(offer({ sharePv: 0 }));
  assert.equal(s.pvAll, 200); assert.equal(s.due.montage.pv, 0);
});

test('v0.20: Buchung legt je Fälligkeit PV- und Wallbox-Investition an, Beträge 0 entfallen', () => {
  const r = offerBookingRows(offer(), 'montage', '2026-11-03');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => [x.cat, x.cost, x.date]), [['pv', 305, '2026-11-03'], ['wallbox', 283.33, '2026-11-03']]);
  assert.match(r[0].name, /^Angebot T-1 \(Testfirma\): Montage und Material – PV\/Speicher-Anteil$/);
  const a = offerBookingRows(offer(), 'anmeldung', '2027-01-10');
  assert.deepEqual(a.map(x => [x.cat, x.cost]), [['pv', 200]]);
  assert.deepEqual(offerBookingRows(offer({ items: [] }), 'montage', '2026-11-03'), []);
});

test('v0.20: Ausbau-Kosten aus Investitionen ab Datum (ohne Erstattungen, ohne Angebotsbuchungen) und aus Angeboten', () => {
  const invest = [
    { id: 'a', name: 'alt', date: '2025-03-01', cost: 999, cat: 'pv' },
    { id: 'b', name: 'Speicher', date: '2026-10-02', cost: 1000 },
    { id: 'c', name: 'Wallbox', date: '2026-10-03', cost: 400, cat: 'wallbox' },
    { id: 'd', name: 'Gutschrift', date: '2026-10-05', cost: 30, cat: 'refund' },
    { id: 'e', name: 'Angebot gebucht', date: '2026-11-03', cost: 305, cat: 'pv' }];
  const o = offer({ paid: { montage: { date: '2026-11-03', ids: ['e'] } } });
  assert.deepEqual([...offerBookedIds([o])], ['e']);
  const c = ausbauCosts({ hwSrc: 'invest', hwFrom: '2026-10-01', craftSrc: 'offer' }, invest, [o, offer({ id: 'o2', ausbau: false })]);
  assert.equal(c.hwTotal, 1400); assert.equal(c.hwWallbox, 400);
  assert.equal(c.craftPv, 505); assert.equal(c.craftWallbox, 283.33);
  assert.deepEqual(c.hw, { n: 2, from: '2026-10-01' }); assert.deepEqual(c.craft, { n: 1, nos: ['T-1'] });
  // Eigene Werte bleiben, solange keine andere Quelle gewählt oder das Datum fehlt
  const m = ausbauCosts({ hwSrc: 'invest', hwTotal: 50, craftPv: 7 }, invest, [o]);
  assert.equal(m.hwTotal, 50); assert.equal(m.craftPv, 7); assert.equal(m.hw, null); assert.equal(m.craft, null);
});

test('v0.20: Angebote werden in den Einstellungen gespeichert und gelesen', () => {
  const S = { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} }, offers: [offer()] };
  const d = toDb.settings(S).data;
  assert.equal(d.offers.length, 1);
  assert.equal(toDb.settings({ ...S, offers: [] }).data.offers, undefined);
  const st = stateFromDb({ settings: { data: d } });
  assert.deepEqual(st.offers, [offer()]);
  assert.deepEqual(stateFromDb({ settings: { data: {} } }).offers, []);
});
