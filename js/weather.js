// Wetterdaten von Open-Meteo (frei, ohne Schlüssel): Ortssuche und Tageswerte.
// Archiv (ERA5/DWD-Reanalyse) bis ca. 6 Tage vor heute, die letzten Tage aus der Vorhersage-API (past_days).
// Standort und Daten liegen nur in Supabase; Open-Meteo sieht die Koordinaten und die IP-Adresse.
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const DAILY = 'temperature_2m_mean,shortwave_radiation_sum,sunshine_duration';

export const round2 = v => Math.round(+v * 100) / 100;
const isoDay = d => d.toISOString().slice(0, 10);
const addD = (s, n) => isoDay(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5));

export async function geocode(name) {
  const r = await fetch(`${GEO}?name=${encodeURIComponent(name)}&count=5&language=de&format=json`);
  if (!r.ok) throw new Error(`Ortssuche: HTTP ${r.status}`);
  const j = await r.json();
  return (j.results || []).map(x => ({ name: [x.name, x.admin1, x.country].filter(Boolean).join(', '), lat: round2(x.latitude), lon: round2(x.longitude) }));
}

// Open-Meteo-Antwort -> Zeilen für weather_daily (Strahlung MJ/m² -> kWh/m², Sonnenschein s -> h)
export function toRows(j) {
  const d = j?.daily; if (!d?.time) return [];
  return d.time.map((day, i) => ({ day, temp_mean: d.temperature_2m_mean[i], rad_kwh: d.shortwave_radiation_sum[i] == null ? null : round2(d.shortwave_radiation_sum[i] / 3.6),
    sun_h: d.sunshine_duration[i] == null ? null : round2(d.sunshine_duration[i] / 3600) })).filter(r => r.temp_mean != null && r.rad_kwh != null);
}

// Fehlende Tage holen: from..to (inklusive). Die letzten 10 Tage kommen immer neu (Vorhersagewerte werden später genauer).
export async function fetchDays(lat, lon, from, to, today = isoDay(new Date())) {
  const q = `latitude=${round2(lat)}&longitude=${round2(lon)}&daily=${DAILY}&timezone=Europe%2FBerlin`;
  const cut = addD(today, -6), rows = [];
  if (from <= cut) {
    const r = await fetch(`${ARCHIVE}?${q}&start_date=${from}&end_date=${to < cut ? to : cut}`);
    if (!r.ok) throw new Error(`Wetter-Archiv: HTTP ${r.status}`);
    rows.push(...toRows(await r.json()));
  }
  if (to > cut) {
    const r = await fetch(`${FORECAST}?${q}&past_days=10&forecast_days=1`);
    if (!r.ok) throw new Error(`Wetter aktuell: HTTP ${r.status}`);
    const have = new Set(rows.map(x => x.day));
    rows.push(...toRows(await r.json()).filter(x => x.day >= from && x.day <= to && x.day < today && !have.has(x.day)));
  }
  return rows;
}
