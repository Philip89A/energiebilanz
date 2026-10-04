// Supabase-Zugriff. Einziger Ort, der createClient() aufruft.
// user_id wird überall explizit mitgeschickt; RLS prüft sie gegen auth.uid().
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js?v=0.15.0';
import { PLAIN_TABLES, seedSummary, compareSummary } from './import.js?v=0.15.0';

export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const PAGE = 1000;   // Standard-Obergrenze von PostgREST je Abfrage
const CHUNK = 200;

async function uid() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  return session.user.id;
}

function check(error, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function fetchAll(table, { select = '*', order = null, from = null, to = null } = {}) {
  const out = [];
  for (let start = 0; ; start += PAGE) {
    let q = client.from(table).select(select).range(start, start + PAGE - 1);
    if (order) q = q.order(order);
    if (from) q = q.gte('day', from);
    if (to) q = q.lte('day', to);
    const { data, error } = await q;
    check(error, `Lesen ${table}`);
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

export async function countRows(table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  check(error, `Zählen ${table}`);
  // Ohne Anzahl kann die Konfliktprüfung vorhandene Daten übersehen -> lieber abbrechen
  if (typeof count !== 'number') throw new Error(`Zählen ${table}: keine Anzahl erhalten.`);
  return count;
}

export async function upsertRows(table, rows, onConflict, onProgress) {
  const user_id = await uid();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map(r => ({ ...r, user_id }));
    const { error } = await client.from(table).upsert(part, { onConflict });
    check(error, `Schreiben ${table}`);
    onProgress?.(Math.min(i + CHUNK, rows.length), rows.length);
  }
}

export async function insertRows(table, rows) {
  const user_id = await uid();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map(r => ({ ...r, user_id }));
    const { error } = await client.from(table).insert(part);
    check(error, `Schreiben ${table}`);
  }
}

export async function deleteOwnRows(table) {
  const user_id = await uid();
  const { error } = await client.from(table).delete().eq('user_id', user_id);
  check(error, `Löschen ${table}`);
}

export async function tableCounts() {
  const tables = ['anker_daily', 'meters', 'meter_readings', 'events', 'tariffs', 'installments',
                  'investments', 'fuel_log', 'charge_log', 'car_log', 'payments', 'settings'];
  const counts = {};
  for (const t of tables) counts[t] = await countRows(t);
  return counts;
}

// Welche Tabellen würde der Seed-Import in Konflikt bringen? (nur Tabellen, für die der Seed Daten hat)
export async function seedConflicts(mapped) {
  const conflicts = [];
  for (const t of PLAIN_TABLES) {
    if (mapped[t].length && await countRows(t) > 0) conflicts.push(t);
  }
  if (await countRows('settings') > 0) conflicts.push('settings');
  return conflicts;
}

// Einmaliger Import. Reihenfolge: Zähler vor Ständen (Fremdschlüssel).
// Mit replace=true werden nur Tabellen geleert, für die der Seed Daten mitbringt.
export async function importSeed(mapped, { replace = false, onStep = () => {} } = {}) {
  const conflicts = await seedConflicts(mapped);
  if (conflicts.length && !replace) {
    throw new Error(`Bereits Daten vorhanden in: ${conflicts.join(', ')}. Nichts geschrieben. ` +
                    'Zum Überschreiben „Vorhandene ersetzen“ wählen.');
  }

  onStep('Zähler');
  await upsertRows('meters', mapped.meters, 'user_id,id');
  onStep('Zählerstände');
  await upsertRows('meter_readings', mapped.meter_readings, 'user_id,meter_id,day');
  await upsertRows('anker_daily', mapped.anker_daily, 'user_id,day',
                   (n, total) => onStep(`Anker-Tage ${n}/${total}`));

  const written = [];
  for (const t of PLAIN_TABLES) {
    if (!mapped[t].length) continue;
    onStep(t);
    if (conflicts.includes(t)) await deleteOwnRows(t);
    await insertRows(t, mapped[t]);
    written.push(t);
  }
  onStep('Einstellungen');
  await upsertRows('settings', [mapped.settings], 'user_id');

  onStep('Rückprüfung');
  return verifySeed(mapped, written);
}

// Liest die importierten Daten zurück und vergleicht Mengen und Kontrollsummen mit der Vorschau.
// Nur die Zeilen, die der Seed betrifft: spätere Einträge (z. B. neue Anker-Tage) stören die Prüfung nicht.
export async function verifySeed(mapped, written) {
  const days = new Set(mapped.anker_daily.map(r => r.day));
  const rkeys = new Set(mapped.meter_readings.map(r => r.meter_id + '|' + r.day));
  const mids = new Set(mapped.meters.map(m => m.id));
  const actual = {
    meters: (await fetchAll('meters')).filter(m => mids.has(m.id)),
    meter_readings: (await fetchAll('meter_readings')).filter(r => rkeys.has(r.meter_id + '|' + r.day)),
    anker_daily: (await fetchAll('anker_daily', { order: 'day' })).filter(r => days.has(r.day)),
  };
  for (const t of PLAIN_TABLES) actual[t] = written.includes(t) ? await fetchAll(t) : mapped[t];
  const expected = seedSummary(mapped);
  const got = seedSummary(actual);
  return { expected, got, diffs: compareSummary(expected, got) };
}

// Alle Tabellen für das Rechenmodell (calc.js stateFromDb)
export async function loadAll() {
  const tables = ['meters', 'meter_readings', 'events', 'tariffs', 'installments', 'investments',
                  'fuel_log', 'charge_log', 'car_log', 'payments'];
  const [anker, settings, ...rest] = await Promise.all([
    fetchAll('anker_daily', { order: 'day' }),
    fetchAll('settings'),
    ...tables.map(t => fetchAll(t)),
  ]);
  const db = { anker_daily: anker, settings: settings[0] || null };
  tables.forEach((t, i) => { db[t] = rest[i]; });
  // Wetter (schema v5): fehlt die Tabelle noch, läuft die App ohne Wetter weiter
  try { db.weather_daily = await fetchAll('weather_daily', { order: 'day' }); } catch (e) { db.weather_daily = []; db.weatherError = e.message; }
  // Wärmepumpen-App (schema v6), ebenso tolerant
  try { db.hp_energy = await fetchAll('hp_energy'); } catch (e) { db.hp_energy = []; db.hpError = e.message; }
  // Gastzugang (schema v7): ist der Nutzer als Gast eingetragen, nur lesen
  try { const me = await uid(); db.readOnly = (await fetchAll('shares')).some(r => r.viewer_id === me); } catch (e) { db.readOnly = false; }
  return db;
}

// Einzelne Datensätze schreiben/löschen (Bearbeiten in den Seiten). kind -> [Tabelle, Konfliktschlüssel]
const KINDS = {
  reading: ['meter_readings', 'user_id,meter_id,day'], tariff: ['tariffs', 'id'], installment: ['installments', 'id'],
  investment: ['investments', 'id'], fuel: ['fuel_log', 'id'], charge: ['charge_log', 'id'], carlog: ['car_log', 'id'],
  event: ['events', 'id'], payment: ['payments', 'id'],
};
export async function saveRow(kind, row) {
  const [table, conflict] = KINDS[kind];
  await upsertRows(table, [row], conflict);
}
export async function deleteRow(kind, row) {
  const [table] = KINDS[kind];
  const user_id = await uid();
  let q = client.from(table).delete().eq('user_id', user_id);
  q = kind === 'reading' ? q.eq('meter_id', row.meter_id).eq('day', row.day) : q.eq('id', row.id);
  const { error } = await q;
  check(error, `Löschen ${table}`);
}
export async function saveSettings(data) {
  await upsertRows('settings', [data], 'user_id');
}

// Wettertage speichern (Upsert je Tag); nur online, nicht über die Offline-Warteschlange
export async function saveWeather(rows) {
  await upsertRows('weather_daily', rows, 'user_id,day');
}

// Wärmepumpen-Export speichern (Upsert je Auflösung und Zeitpunkt)
export async function saveHp(rows, onProgress) {
  await upsertRows('hp_energy', rows, 'user_id,grain,ts', onProgress);
}
