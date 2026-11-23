// v0.60: Day-Ahead-Börsenpreise Deutschland/Luxemburg von Energy-Charts (Fraunhofer ISE), Endpunkt
// api.energy-charts.info/price?bzn=DE-LU, über die Edge Function „grid-co2“ (&kind=price). Seit Oktober 2025 liefert die
// Börse Viertelstundenwerte; ausgewertet wird je Ortsstunde (Europe/Berlin) als Mittelwert in €/MWh. Negative Preise
// sind möglich und bleiben erhalten. Antwortformat tolerant: Zeitachse unix_seconds/…, Werte price/data/values.
import { localDayHour } from './gridco2.js?v=0.60.0';
const isoDay = d => d.toISOString().slice(0, 10);
const addD = (s, n) => isoDay(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5));
const pickArr = (o, keys) => { for (const k of keys) if (Array.isArray(o?.[k]) && o[k].length) return o[k]; return null; };
// Antwort → [{ ms, p }] (€/MWh)
export function parseGridPrice(j) {
  const o = Array.isArray(j) ? j[0] : j;
  const ts = pickArr(o, ['unix_seconds', 'unix_ms', 'timestamps', 'xAxisValues', 'time']);
  const vs = pickArr(o, ['price', 'data', 'values']);
  if (!ts || !vs || ts.length !== vs.length) throw new Error('Format der Börsenpreise unbekannt (Zeitachse oder Werte fehlen).');
  const ms = v => (typeof v === 'string' ? Date.parse(v) : v > 1e11 ? v : v * 1000);
  return ts.map((t, i) => ({ ms: ms(t), p: vs[i] == null ? null : +vs[i] })).filter(x => isFinite(x.ms) && x.p != null && isFinite(x.p) && x.p > -1000 && x.p < 5000);
}
// [{ms,p}] → Zeilen für grid_price (nur Tage mit mindestens 23 belegten Stunden; fehlende Stunde = Mittel der Nachbarn)
export function aggregateGridPrice(pts, from = '0000-01-01', to = '9999-12-31') {
  const by = {};
  for (const x of pts) { const { day, hour } = localDayHour(x.ms); if (day < from || day > to) continue;
    const o = by[day] = by[day] || { s: Array(24).fill(0), c: Array(24).fill(0) }; o.s[hour] += x.p; o.c[hour]++; }
  return Object.entries(by).map(([day, o]) => {
    const h = o.s.map((v, i) => (o.c[i] ? Math.round(v / o.c[i] * 100) / 100 : null));
    if (h.filter(v => v != null).length < 23) return null;
    for (let i = 0; i < 24; i++) if (h[i] == null) { const a = h[(i + 23) % 24], b = h[(i + 1) % 24]; h[i] = a != null && b != null ? (a + b) / 2 : (a ?? b); }
    return { day, eur_mwh: Math.round(h.reduce((a, b) => a + b, 0) / 24 * 100) / 100, hours: h, src: 'energy-charts' };
  }).filter(Boolean).sort((a, b) => a.day.localeCompare(b.day));
}
export async function fetchGridPrice(from, to, getRaw) {
  const rows = [];
  for (let a = from; a <= to; a = addD(a, 31)) {
    const b = addD(a, 30) < to ? addD(a, 30) : to;
    rows.push(...aggregateGridPrice(parseGridPrice(await getRaw(a, b)), a, b));
  }
  return rows;
}
