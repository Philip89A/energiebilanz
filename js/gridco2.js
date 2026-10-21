// v0.41: CO₂-Intensität des deutschen Stromnetzes von Energy-Charts (Fraunhofer ISE, frei, ohne Schlüssel), Endpunkt
// api.energy-charts.info/co2eq?country=de – seit v0.43 über die Supabase Edge Function „grid-co2“ (supabase/functions).
// Abruf je höchstens 31 Tage; Auswertung in Ortszeit (Europe/Berlin): Tagesmittel und 24 Stundenmittel.
// Das Antwortformat wird tolerant gelesen (Zeitachse: unix_seconds/unix_ms/timestamps, Werte: co2eq/co2/data);
// unbekanntes Format → Fehler mit Hinweis, die App rechnet dann mit dem Jahresfaktor weiter.
const isoDay = d => d.toISOString().slice(0, 10);
const addD = (s, n) => isoDay(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5));
const FMT = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
export function localDayHour(ms) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}
const pickArr = (o, keys) => { for (const k of keys) if (Array.isArray(o?.[k]) && o[k].length) return o[k]; return null; };
// Antwort → [{ ms, g }]
export function parseGridCo2(j) {
  const o = Array.isArray(j) ? j[0] : j;
  const ts = pickArr(o, ['unix_seconds', 'unix_ms', 'timestamps', 'xAxisValues', 'time']);
  const vs = pickArr(o, ['co2eq', 'co2', 'co2eq_intensity', 'data', 'values']);
  if (!ts || !vs || ts.length !== vs.length) throw new Error('Format der Netzwerte unbekannt (Zeitachse oder Werte fehlen).');
  const ms = v => (typeof v === 'string' ? Date.parse(v) : v > 1e11 ? v : v * 1000);
  return ts.map((t, i) => ({ ms: ms(t), g: vs[i] == null ? null : +vs[i] })).filter(x => isFinite(x.ms) && x.g != null && isFinite(x.g) && x.g >= 0 && x.g < 2000);
}
// [{ms,g}] → Zeilen für grid_co2 (nur Tage mit mindestens 20 belegten Stunden)
export function aggregateGridCo2(pts, from = '0000-01-01', to = '9999-12-31') {
  const by = {};
  for (const p of pts) { const { day, hour } = localDayHour(p.ms); if (day < from || day > to) continue;
    const o = by[day] = by[day] || { s: Array(24).fill(0), c: Array(24).fill(0), n: 0 }; o.s[hour] += p.g; o.c[hour]++; o.n++; }
  return Object.entries(by).map(([day, o]) => {
    const hrs = o.s.map((v, h) => (o.c[h] ? Math.round(v / o.c[h]) : null)), filled = hrs.filter(v => v != null);
    if (filled.length < 20) return null;
    const g = filled.reduce((a, b) => a + b, 0) / filled.length;
    return { day, g_mean: Math.round(g * 10) / 10, hours: filled.length === 24 ? hrs : null, n: o.n, src: 'energy-charts' };
  }).filter(Boolean).sort((a, b) => a.day.localeCompare(b.day));
}
// v0.43: getRaw(start, end) liefert die Energy-Charts-Antwort (über die Edge Function „grid-co2“); start/end sind
// Ortstage einschließlich (geprüft: start 18.10. → ab 17.10. 22:00 UTC, end 19.10. → bis 19.10. 23:45 Ortszeit).
export async function fetchGridCo2(from, to, getRaw) {
  const rows = [];
  for (let a = from; a <= to; a = addD(a, 31)) {
    const b = addD(a, 30) < to ? addD(a, 30) : to;
    rows.push(...aggregateGridCo2(parseGridCo2(await getRaw(a, b)), a, b));
  }
  return rows;
}
