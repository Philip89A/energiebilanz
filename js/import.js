// Import-Logik: reine Funktionen ohne DOM und ohne Supabase, damit sie in Node testbar sind.
//  - mapSeed(seed)        seed_state.json -> Datensätze je Tabelle
//  - seedSummary(mapped)  Mengen und Kontrollsummen für Vorschau und Rückprüfung
//  - parseAnkerCsv(text)  Anker-Export „Energiedetails“ -> Tageszeilen für anker_daily
//  - mergeAnkerParsed(l)  mehrere Exporte (z. B. zwei Anker-Systeme) zu einem Import, gleiche Tage addiert
//  - diffAnker(alt, neu)  neue / geänderte / ergänzte / unveränderte Tage

export const ANKER_FIELDS = [
  'eigenverbrauch', 'netzimport', 'netz_zu_haus', 'solar_zu_haus', 'solar_zu_speicher',
  'speicher_ladung', 'speicher_entladung', 'speicher_zu_haus', 'genutzt', 'erzeugung', 'einspeisung',
  'pv1', 'pv2', 'pv3', 'pv4', 'smart_plug', 'netz_zu_speicher',
];

// Kürzel in seed_state.json -> Spalte in anker_daily
const SEED_ANKER = {
  ev: 'eigenverbrauch', imp: 'netzimport', n2h: 'netz_zu_haus', s2h: 'solar_zu_haus',
  s2b: 'solar_zu_speicher', bch: 'speicher_ladung', bdis: 'speicher_entladung',
  b2h: 'speicher_zu_haus', use: 'genutzt', gen: 'erzeugung', feed: 'einspeisung',
  pv1: 'pv1', pv2: 'pv2', pv3: 'pv3', pv4: 'pv4',
};

// Tabellen ohne natürlichen Schlüssel: werden nur in leere Tabellen geschrieben (oder ersetzt)
export const PLAIN_TABLES = ['events', 'tariffs', 'installments', 'investments', 'fuel_log', 'charge_log', 'car_log'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const uuid = () => crypto.randomUUID();
const orNull = v => (v === '' || v === undefined || v === null ? null : v);
const numOrNull = v => (v === '' || v === undefined || v === null || !isFinite(+v) ? null : +v);

// Summen exakt in ganzen Tausendsteln (Wh bzw. 0,1 ct), damit keine Fließkomma-Rundungsfehler entstehen
export const milli = v => Math.round((+v || 0) * 1000);
export const sumMilli = (rows, key) => rows.reduce((s, r) => s + (r[key] == null ? 0 : milli(r[key])), 0);

export function validateSeed(seed) {
  const errors = [];
  if (!seed || typeof seed !== 'object') return ['Datei ist kein JSON-Objekt.'];
  const a = seed.anker;
  if (!a || !ISO.test(a.start || '') || !(a.n > 0) || !a.c) errors.push('anker: start, n oder c fehlt.');
  else for (const k of Object.keys(SEED_ANKER)) {
    if (!Array.isArray(a.c[k])) errors.push(`anker.c.${k} fehlt.`);
    else if (a.c[k].length !== a.n) errors.push(`anker.c.${k}: ${a.c[k].length} Werte statt ${a.n}.`);
  }
  for (const k of ['meters', 'readings', 'events', 'tariffs', 'abschlaege', 'invest']) {
    if (!Array.isArray(seed[k])) errors.push(`${k} fehlt oder ist keine Liste.`);
  }
  const meterIds = new Set((seed.meters || []).map(m => m.id));
  (seed.readings || []).forEach((r, i) => {
    if (!meterIds.has(r.m)) errors.push(`readings[${i}]: unbekannter Zähler „${r.m}“.`);
    if (!ISO.test(r.d || '')) errors.push(`readings[${i}]: Datum ungültig.`);
  });
  return errors;
}

export function mapSeed(seed) {
  const a = seed.anker;
  const anker_daily = [];
  for (let i = 0; i < a.n; i++) {
    const row = { day: addDays(a.start, i) };
    for (const [k, col] of Object.entries(SEED_ANKER)) row[col] = numOrNull(a.c[k][i]);
    anker_daily.push(row);
  }
  const s = seed;
  return {
    meters: s.meters.map(m => ({ id: m.id, name: m.name, grp: m.group, sort: +m.order || 0 })),
    // ohne id: Upsert über (user_id, meter_id, day), die id vergibt die Datenbank
    meter_readings: s.readings.map(r => ({ meter_id: r.m, day: r.d, value: +r.v, source: orNull(r.src) })),
    anker_daily,
    events: s.events.map(e => ({ id: uuid(), day: e.d, grp: orNull(e.group), type: orNull(e.type), note: orNull(e.text) })),
    tariffs: s.tariffs.map(t => ({
      id: uuid(), grp: t.group, name: t.name, valid_from: t.from, valid_to: orNull(t.to),
      ap_ct: +t.ap, gp_eur_year: +t.gp, boni_eur: +t.boni || 0,
      boni_note: orNull(t.boniNote), estimate_note: orNull(t.est),
    })),
    installments: s.abschlaege.map(x => ({ id: uuid(), grp: x.group, valid_from: x.from, amount: +x.amount, note: orNull(x.note) })),
    investments: s.invest.map(x => ({ id: uuid(), day: orNull(x.date), name: x.name, cost: +x.cost })),
    fuel_log: (s.fuel || []).map(x => ({
      id: uuid(), day: x.d, odometer: +x.km, liters: +x.l, amount: +x.e,
      fuel_type: orNull(x.s), full_tank: x.full !== false,
    })),
    charge_log: (s.charges || []).map(x => ({
      id: uuid(), day: x.d, odometer: numOrNull(x.km) || null, kwh: +x.k, amount: numOrNull(x.e), location: orNull(x.o),
    })),
    car_log: (s.carlog || []).map(x => ({
      id: uuid(), day: x.d, car: x.car, category: x.cat, odometer: numOrNull(x.km) || null,
      amount: +x.e || 0, note: orNull(x.note),
    })),
    // view, ui (je Gerät), abschlag und version (Altbestand) werden bewusst nicht übernommen
    settings: {
      data: {
        schema_version: 2,
        battery: s.battery || {}, pv: s.pv || {}, amort: s.amort || {}, cars: s.cars || {},
      },
    },
  };
}

// Mengen und Kontrollsummen; dieselbe Funktion läuft über die Vorschau und über die zurückgelesenen Daten
export function seedSummary(m) {
  const days = m.anker_daily.map(r => r.day).sort();
  return {
    counts: {
      meters: m.meters.length, meter_readings: m.meter_readings.length, anker_daily: m.anker_daily.length,
      events: m.events.length, tariffs: m.tariffs.length, installments: m.installments.length,
      investments: m.investments.length, fuel_log: m.fuel_log.length, charge_log: m.charge_log.length,
      car_log: m.car_log.length,
    },
    anker_from: days[0] || null,
    anker_to: days[days.length - 1] || null,
    erzeugung_wh: sumMilli(m.anker_daily, 'erzeugung'),
    genutzt_wh: sumMilli(m.anker_daily, 'genutzt'),
    readings_sum: sumMilli(m.meter_readings, 'value'),
    invest_milli_eur: sumMilli(m.investments, 'cost'),
  };
}

export function compareSummary(expected, actual) {
  const diffs = [];
  for (const [k, v] of Object.entries(expected.counts)) {
    if (actual.counts[k] !== v) diffs.push(`${k}: erwartet ${v}, gefunden ${actual.counts[k]}`);
  }
  for (const k of ['anker_from', 'anker_to', 'erzeugung_wh', 'genutzt_wh', 'readings_sum', 'invest_milli_eur']) {
    if (expected[k] !== actual[k]) diffs.push(`${k}: erwartet ${expected[k]}, gefunden ${actual[k]}`);
  }
  return diffs;
}

/* ---------- Anker-CSV ---------- */

// Anker setzt geschützte Bindestriche (U+2011) und schmale geschützte Leerzeichen (U+202F) in die Spaltennamen
export function normHeader(h) {
  return String(h)
    .replace(/^﻿/, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[\s   ]+/g, ' ')
    .trim()
    .toLowerCase();
}

// Spaltenerkennung über den normalisierten Namen; die Reihenfolge ist egal
const CSV_COLUMNS = [
  ['eigenverbrauch', h => h.startsWith('eigenverbrauch')],
  ['netzimport', h => h.startsWith('netzimport')],
  ['netz_zu_haus', h => h.startsWith('netzstrom zu haushalt')],
  ['solar_zu_haus', h => h.startsWith('solarstrom zu haushalt')],
  ['solar_zu_speicher', h => h.startsWith('solarstrom zu speicher')],
  ['netz_zu_speicher', h => h.startsWith('netzstrom zu speicher')],
  ['speicher_ladung', h => h.startsWith('speicherladung')],
  ['speicher_entladung', h => h.startsWith('speicherentladung')],
  ['speicher_zu_haus', h => h.startsWith('speicher zu haushalt')],
  ['genutzt', h => h.startsWith('genutzte solarenergie')],
  ['erzeugung', h => h.startsWith('gesamte solarstromerzeugung')],
  ['einspeisung', h => h.startsWith('solarstrom-einspeisung')],
  ['pv1', h => /pv1-erzeugung/.test(h)],
  ['pv2', h => /pv2-erzeugung/.test(h)],
  ['pv3', h => /pv3-erzeugung/.test(h)],
  ['pv4', h => /pv4-erzeugung/.test(h)],
  ['smart_plug', h => h.includes('smart plug')],
];
// v0.31: der Export des neuen Heimsystems (Solarbank 4) hat keine Spalte „Genutzte Solarenergie“; sie wird wie im
// alten Export als Eigenverbrauch − Netzimport berechnet. „Netzstrom zu Speicher“ gibt es im alten Export nicht, dort
// gilt Netzimport − Netzstrom zu Haushalt (laut Definition in beiden Exporten).
const OPTIONAL_COLUMNS = new Set(['smart_plug', 'pv3', 'pv4', 'genutzt', 'netz_zu_speicher']);
const r3 = v => Math.round(v * 1000) / 1000;

export function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseDate(s) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isValidIso(iso) ? iso : null;
  }
  if (ISO.test(s)) return isValidIso(s) ? s : null;
  return null;
}
function isValidIso(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === iso;
}

export function parseAnkerCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  const headerIdx = lines.findIndex(l => /^"?\s*datum\s*"?\s*[,;]/i.test(l));
  if (headerIdx < 0) return { rows: [], errors: ['Kopfzeile mit „Datum“ nicht gefunden. Ist das der Export „Energiedetails“?'] };

  const headLine = lines[headerIdx];
  const sep = (headLine.split(';').length > headLine.split(',').length) ? ';' : ',';
  const decimalComma = sep === ';';
  const header = splitCsvLine(headLine, sep).map(normHeader);

  const idx = {};
  const errors = [];
  for (const [col, test] of CSV_COLUMNS) {
    const i = header.findIndex(test);
    if (i >= 0) idx[col] = i;
    else if (!OPTIONAL_COLUMNS.has(col)) errors.push(`Spalte fehlt: ${col}`);
  }
  if (errors.length) return { rows: [], errors };

  const num = v => {
    let s = String(v ?? '').trim();
    if (s === '' || s === '-' || s === '–') return null;
    if (decimalComma) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  };

  const rows = [];
  const seen = new Set();
  for (let li = headerIdx + 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li], sep);
    const day = parseDate(cells[0]);
    if (!day) { errors.push(`Zeile ${li + 1}: Datum „${cells[0]}“ nicht lesbar.`); continue; }
    if (seen.has(day)) { errors.push(`Zeile ${li + 1}: ${day} doppelt.`); continue; }
    seen.add(day);
    const row = { day };
    for (const col of ANKER_FIELDS) {
      if (idx[col] === undefined) continue;
      const n = num(cells[idx[col]]);
      if (Number.isNaN(n)) { errors.push(`Zeile ${li + 1}: ${col} „${cells[idx[col]]}“ ist keine Zahl.`); row[col] = null; }
      else row[col] = n;
    }
    if (idx.genutzt === undefined) row.genutzt = row.eigenverbrauch != null && row.netzimport != null ? r3(row.eigenverbrauch - row.netzimport) : null;
    if (idx.netz_zu_speicher === undefined) row.netz_zu_speicher = row.netzimport != null && row.netz_zu_haus != null ? Math.max(0, r3(row.netzimport - row.netz_zu_haus)) : null;
    rows.push(row);
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  return { rows, errors, from: rows[0]?.day ?? null, to: rows[rows.length - 1]?.day ?? null };
}

// v0.31: mehrere Exporte in einem Import. Tage, die in mehreren Dateien stehen (Umbautag, später zwei Systeme), werden
// addiert; leere Zellen zählen nur, wenn alle Dateien leer sind. Weil die Summe vor dem Schreiben entsteht, ergibt
// derselbe Import zweimal dasselbe Ergebnis. Dieselbe Datei zweimal gewählt ist ein Fehler.
export function mergeAnkerParsed(list) {
  const errors = [], byDay = new Map(), seenText = new Set(), summed = new Set();
  for (const { name, text, parsed } of list) {
    if (seenText.has(text)) { errors.push(`${name}: dieselbe Datei wurde doppelt gewählt, sie zählt nur einmal.`); continue; }
    seenText.add(text);
    for (const e of parsed.errors) errors.push(`${name}: ${e}`);
    for (const r of parsed.rows) {
      const old = byDay.get(r.day);
      if (!old) { byDay.set(r.day, { ...r }); continue; }
      summed.add(r.day);
      for (const f of ANKER_FIELDS) {
        const a = old[f] ?? null, b = r[f] ?? null;
        old[f] = a == null && b == null ? null : r3((a || 0) + (b || 0));
      }
    }
  }
  const rows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { rows, errors, summed: [...summed].sort(), from: rows[0]?.day ?? null, to: rows[rows.length - 1]?.day ?? null };
}

// Tage mit Netzladung des Speichers über der Schwelle (kWh), für den Hinweis im Import
export const gridChargeDays = (rows, min = 0.1) => rows.filter(r => (r.netz_zu_speicher || 0) > min).map(r => r.day);

// Vergleich mit dem Bestand. „ergänzt“ = nur bisher leere Felder bekommen einen Wert (z. B. Smart Plug nach dem
// Seed-Import); „geändert“ = ein vorhandener Wert weicht ab. Toleranz 0,5 Wh gegen Rundung aus der Datenbank.
// `write` enthält die Zeilen für den Upsert: vollständige Zeilen (Bestand + neue Werte), damit eine leere
// Zelle im Export nie einen vorhandenen Wert mit NULL überschreibt.
export function diffAnker(existing, incoming) {
  const byDay = new Map(existing.map(r => [r.day, r]));
  const out = { neu: [], geaendert: [], ergaenzt: [], gleich: 0, write: [], kleiner: [] };
  for (const r of incoming) {
    const old = byDay.get(r.day);
    if (!old) {
      const row = { day: r.day };
      for (const f of ANKER_FIELDS) row[f] = r[f] ?? null;
      out.neu.push(row);
      out.write.push(row);
      continue;
    }
    const merged = { day: r.day };
    const changes = [];
    let filled = false;
    for (const f of ANKER_FIELDS) {
      const a = old[f] == null ? null : +old[f];
      const b = r[f] ?? null;
      merged[f] = b ?? a;
      if (b == null) continue;               // leere Zelle im Export überschreibt keinen Bestand
      if (a == null) { filled = true; continue; }
      if (Math.abs(a - b) > 0.0005) changes.push({ field: f, alt: a, neu: b });
    }
    // v0.31: kleinere Erzeugung oder kleinerer Eigenverbrauch deuten auf einen Teil-Import (nur eine von zwei Dateien)
    if (changes.some(c => (c.field === 'erzeugung' || c.field === 'eigenverbrauch') && c.neu < c.alt - 0.0005)) out.kleiner.push(r.day);
    if (changes.length) { out.geaendert.push({ day: r.day, changes }); out.write.push(merged); }
    else if (filled) { out.ergaenzt.push(r.day); out.write.push(merged); }
    else out.gleich++;
  }
  return out;
}

/* ---------- Geräte (v0.32): Messsteckdosen und Monatswerte ---------- */

const r6 = v => Math.round(v * 1e6) / 1e6;
const daysInMonth = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
export const monthDays = ym => Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);

// Gerätename aus dem Tapo-Dateinamen „Power Monitor Day Data - Gefrierschrank - 20261016.csv“
export function tapoDeviceName(fileName) {
  const m = String(fileName).replace(/\.[^.]+$/, '').replace(/_/g, ' ').match(/day data\s*-\s*(.+?)\s*-\s*\d{8}$/i);
  return m ? m[1].trim() : null;
}

// Tapo-Export „Power Monitor Day Data“: Zeilen „2025-05-01<TAB>,0.087<TAB>“ (Datum, kWh).
// Nullen vor dem ersten echten Messtag zählen nicht (Steckdose noch nicht eingesteckt).
export function parseTapoCsv(text) {
  const rows = [], errors = [];
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const cells = line.split(',').map(c => c.replace(/[\s"]+/g, ''));
    if (!cells[0] || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
    const v = Number(cells[1]);
    if (!isFinite(v) || v < 0) { errors.push(`${cells[0]}: „${cells[1]}“ ist keine Zahl.`); continue; }
    rows.push({ day: cells[0], kwh: v, src: 'day' });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  const first = rows.findIndex(r => r.kwh > 0);
  const out = first < 0 ? [] : rows.slice(first);
  // erster Messtag meist angebrochen (Steckdose tagsüber eingesteckt): weglassen, wenn unter halbem Median der Folgewoche
  const next = out.slice(1, 8).map(r => r.kwh).sort((a, b) => a - b);
  if (next.length >= 3 && out[0].kwh < next[Math.floor(next.length / 2)] / 2) out.shift();
  if (!rows.length) errors.push('Keine Tageswerte gefunden. Ist das der Tapo-Export „Power Monitor Day Data“?');
  return { rows: out, errors };
}

// Meross-Export (Excel, Blätter „Tag“ stündlich, „Monat“ täglich, „Jahr“ monatlich), hier schon als Zeilen-Arrays.
// Tageswerte aus „Monat“; Monate ohne (vollständige) Tageswerte aus „Jahr“, gleichmäßig auf die fehlenden Tage
// verteilt (src 'month'). Der Tag des Exports ist unvollständig und fällt weg, ebenso Nullen vor dem ersten Messwert.
export function parseMerossSheets(sheets) {
  const errors = [], byDay = new Map(), months = new Map();
  const norm = s => String(s ?? '').trim().replace(/\//g, '-');
  const head = (sheets.Monat?.[0]?.[0] ?? sheets.Jahr?.[0]?.[0] ?? '') + '';
  const endM = head.match(/-\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  const exportDay = endM ? `${endM[1]}-${endM[2]}-${endM[3]}` : null, completeEnd = endM && +endM[4] === 23 && +endM[5] >= 59;
  for (const r of (sheets.Monat || []).slice(1)) {
    const d = norm(r[0]), v = Number(r[1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isFinite(v)) continue;
    if (d === exportDay && !completeEnd) continue;
    byDay.set(d, { day: d, kwh: r6(v), src: 'day' });
  }
  for (const r of (sheets.Jahr || []).slice(1)) {
    const m = norm(r[0]).slice(0, 7), v = Number(r[1]);
    if (/^\d{4}-\d{2}$/.test(m) && isFinite(v)) months.set(m, v);
  }
  if (!byDay.size && !months.size) errors.push('Keine Werte gefunden. Ist das der Meross-Export (Blätter „Monat“ und „Jahr“)?');
  const firstDaily = [...byDay.keys()].sort()[0] || null;
  for (const [m, total] of months) {
    const days = monthDays(m).filter(d => !(exportDay && d >= exportDay));   // laufender Monat: nur aus Tageswerten
    if (!days.length || (exportDay && m >= exportDay.slice(0, 7))) continue;
    if (firstDaily && m > firstDaily.slice(0, 7)) continue;                    // Monat ganz durch Tageswerte gedeckt
    const missing = days.filter(d => !byDay.has(d));
    if (!missing.length) continue;
    const rest = total - days.reduce((s, d) => s + (byDay.get(d)?.kwh || 0), 0);
    if (rest < 0) { errors.push(`${m}: Monatssumme kleiner als die Tageswerte, Monat übersprungen.`); continue; }
    for (const d of missing) byDay.set(d, { day: d, kwh: r6(rest / missing.length), src: 'month' });
  }
  const rows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const first = rows.findIndex(r => r.kwh > 0);
  return { rows: first < 0 ? [] : rows.slice(first), errors, exportDay };
}

// Monatswerte von Hand (z. B. Waschmaschinen-App): gleichmäßig auf die Tage des Monats verteilt
export function monthRows(ym, { kwh, water_l = null, runs = null }) {
  const days = monthDays(ym), n = days.length;
  return days.map(day => ({ day, kwh: r6(kwh / n), water_l: water_l == null ? null : r6(water_l / n),
    runs: runs == null ? null : r6(runs / n), src: 'month' }));
}

// Vergleich mit dem Bestand eines Geräts: neu / geändert / gleich; Tage vor „gemessen ab“ fallen weg
export function diffDevice(existing, incoming, from = '') {
  const byDay = new Map(existing.map(r => [r.day, r]));
  const out = { neu: 0, geaendert: 0, gleich: 0, vorher: 0, write: [] };
  for (const r of incoming) {
    if (from && r.day < from) { out.vorher++; continue; }
    const o = byDay.get(r.day);
    const same = o && Math.abs((+o.kwh || 0) - r.kwh) < 0.0005 && (o.src || 'day') === r.src
      && (r.water_l == null || Math.abs((+o.water_l || 0) - r.water_l) < 0.05);
    if (same) { out.gleich++; continue; }
    o ? out.geaendert++ : out.neu++;
    out.write.push(r);
  }
  return out;
}
