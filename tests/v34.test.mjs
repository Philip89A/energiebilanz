// v0.34: Zusammenhänge – Regression, Bewertung, Karten mit synthetischen Werten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc, stateFromDb } from '../js/calc.js';

const days = []; for (let d = new Date('2026-01-01T00:00:00Z'); d <= new Date('2026-02-28T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
const hours = (t, rhN, rhD) => Array.from({ length: 24 }, (_, h) => [t, h < 6 ? rhN : rhD]);
function calc() {
  const anker_daily = days.map((day, i) => ({ day, genutzt: 2, erzeugung: 1 + (i % 5), netzimport: 6 - (i % 5) * 0.8, einspeisung: i % 5 === 4 ? 0.5 : 0 }));
  // Keller schwankt 16–20 °C, Gefrierschrank 0,40 + 0,02 je °C über 16; Wäschetage alle 7 Tage (Feuchtesprung 20 Punkte)
  const tK = i => 16 + (i % 5);
  const room_climate = days.flatMap((day, i) => [
    { room: 'Vorratskeller', day, n: 96, t: tK(i), rh: 50, rh_min: 44, rh_max: i % 7 === 0 ? 64 : 48, h_dry: 0, h_wet: 0, hours: hours(tK(i), 50, 50) },
    { room: 'Schlafzimmer', day, n: 96, t: 20, rh: 55, rh_min: 50, rh_max: 66, h_dry: 0, h_wet: 6, hours: hours(20, 55 + (i % 3) * 3, 52) }]);
  const device_daily = days.flatMap((day, i) => [
    { device_id: 'gf', day, kwh: 0.40 + 0.02 * (tK(i) - 16), src: 'day' },
    { device_id: 'lu', day, kwh: 0.9 - (i % 3) * 0.2, src: 'day' }]);
  return createCalc(stateFromDb({ anker_daily, device_daily, room_climate,
    events: [{ id: 'e', day: '2026-02-01', grp: 'wp', type: 'einstellung', note: 'Heizung 21/19' }],
    settings: { data: { battery: { fullThresh: 0.3 }, pv: { kwp: 1 }, amort: {}, cars: {},
      devices: [{ id: 'gf', name: 'Gefrierschrank', from: '', room: 'Vorratskeller' }, { id: 'lu', name: 'Lüftung', from: '' }],
      rooms: [{ id: 'Vorratskeller', name: 'Vorratskeller' }, { id: 'Schlafzimmer', name: 'Schlafzimmer' }] } } }));
}

test('fitLine: Steigung, R², Bewertung', () => {
  const C = calc();
  const f = C.fitLine([1, 2, 3, 4].map(x => ({ x, y: 2 * x + 1 })));
  assert.equal(f.slope, 2); assert.equal(f.icept, 1); assert.equal(f.r2, 1);
  assert.equal(C.fitLine([{ x: 1, y: 1 }]).slope, null);
});

test('relations: Gefrierschrank gegen Keller, Wäschetage, Lüftung gegen Schlafzimmer, PV mit vollem Speicher', () => {
  const R = Object.fromEntries(calc().relations('2026-01-01', '2026-02-28').map(c => [c.id, c]));
  assert.equal(R.freezer.x, 'Temperatur Vorratskeller °C');
  assert.ok(Math.abs(R.freezer.f.slope - 0.02) < 1e-9);
  assert.equal(R.freezer.v, 'belastbar');
  assert.ok(R.freezer.extra.nWash >= 8);
  assert.ok(R.vent.f.slope < 0 && R.vent.v === 'belastbar');      // weniger Lüftung → mehr Feuchte nachts
  assert.equal(R.pv.extra.nFull, days.filter((_, i) => i % 5 === 4).length);
  assert.ok(R.pv.f.slope < 0);
  assert.equal(R.dhw.v, 'zu wenig Daten'); assert.ok(R.dhw.need.includes('Wasserzähler'));
  assert.equal(R.base.bars.length, 7);
  assert.equal(Object.keys(R).length, 8);
});
