// Import des Energie-Exports der Wärmepumpen-App (CSV, Semikolon, Dezimalkomma, „-“ = kein Wert).
// Drei Kopfzeilen, dann Zeilen je Kategorie „Stunde“, „Tag“, „Monat“. Spalten (ab 0):
//  2–5  Produzierte Wärme aus Strom (Wärmepumpe inkl. Zuheizer): Gesamt, Heizung, Kühlung, Warmwasser
//  6–9  Produzierte Wärme aus der Umgebung:                        Gesamt, Heizung, Kühlung, Warmwasser
// 10–13 Verbrauchter Strom Wärmepumpe: Gesamt, Heizung, Kühlung, Warmwasser
// 14–16 Verbrauchter Strom elektrischer Zuheizer: Gesamt, Heizung, Warmwasser
// 17–19 Sensoren: Außen-, Vorlauf-, Warmwassertemperatur (°C)
// Wärme = Strom-Anteil + Umgebungs-Anteil (Heizung und Warmwasser, Kühlung getrennt).
const GRAIN = { Stunde: 'hour', Tag: 'day', Monat: 'month' };
const num = s => { s = String(s ?? '').trim(); if (s === '' || s === '-') return null; const v = +s.replace(',', '.'); return isFinite(v) ? v : null; };
const r1 = v => (v == null ? null : Math.round(v * 1000) / 1000);

export function parseHpCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const head = (lines[2] || '').split(';');
  if (head[0] !== 'Kategorie' || head[1] !== 'Zeitstempel' || !/Außentemperatur/.test(head[17] || '') || !/ProduzierteW/.test(lines[0] || '')) {
    throw new Error('Unbekanntes Format: erwartet wird der Energie-Export der Wärmepumpen-App (Kopfzeilen „ProduzierteWärme…“, „Kategorie;Zeitstempel;…“).');
  }
  const rows = [], skipped = { empty: 0, unknown: 0 };
  for (const line of lines.slice(3)) {
    const f = line.split(';'), grain = GRAIN[f[0]];
    if (!grain) { skipped.unknown++; continue; }
    const v = f.map(num);
    if (v.slice(2, 20).every(x => x == null)) { skipped.empty++; continue; }
    const z = i => v[i] ?? 0;
    const ts = String(f[1]).trim();
    if (!(grain === 'hour' ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : grain === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(ts)) { skipped.unknown++; continue; }
    rows.push({ grain, ts,
      el_hp: r1(z(10)), el_heat: r1(z(11)), el_cool: r1(z(12)), el_dhw: r1(z(13)), el_aux: r1(z(14)), el_aux_heat: r1(z(15)), el_aux_dhw: r1(z(16)),
      heat_heat: r1(z(3) + z(7)), heat_dhw: r1(z(5) + z(9)), heat_cool: r1(z(4) + z(8)),
      t_out: v[17], t_flow: v[18], t_dhw: v[19] });
  }
  const by = g => rows.filter(r => r.grain === g).map(r => r.ts).sort();
  const range = g => { const a = by(g); return a.length ? { n: a.length, from: a[0], to: a[a.length - 1] } : { n: 0 }; };
  return { rows, skipped, hour: range('hour'), day: range('day'), month: range('month') };
}

// Kennzahlen einer Zeile oder Summe: Strom gesamt, Wärme (Heizung + Warmwasser), Arbeitszahl ohne Kühlung
export function hpSum(rows) {
  const s = { el: 0, elHeat: 0, elDhw: 0, elCool: 0, aux: 0, heatHeat: 0, heatDhw: 0, cool: 0, n: rows.length };
  for (const r of rows) { s.el += (+r.el_hp || 0) + (+r.el_aux || 0); s.elHeat += (+r.el_heat || 0) + (+r.el_aux_heat || 0); s.elDhw += (+r.el_dhw || 0) + (+r.el_aux_dhw || 0);
    s.elCool += +r.el_cool || 0; s.aux += +r.el_aux || 0; s.heatHeat += +r.heat_heat || 0; s.heatDhw += +r.heat_dhw || 0; s.cool += +r.heat_cool || 0; }
  s.heat = s.heatHeat + s.heatDhw;
  s.cop = s.el - s.elCool > 0 ? s.heat / (s.el - s.elCool) : null;
  return s;
}
