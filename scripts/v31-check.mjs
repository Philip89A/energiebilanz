// v0.31-Test: Anker-Import mit zwei Dateien (gleiche Tage addiert), neues Format ohne „Genutzte Solarenergie“, Netzladung.
// Simuliertes Supabase mit data/seed_state.json, CSV-Zeilen erfunden.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v31-check.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSeed } from '../js/import.js';
import { parseHpCsv } from '../js/hp.js';
const base = fileURLToPath(new URL('..', import.meta.url));
const seed = JSON.parse(readFileSync(base + 'data/seed_state.json', 'utf8'));
const m = mapSeed(seed), uid = '11111111-1111-4111-8111-111111111111';
const DB = { ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'settings').map(([k, r]) => [k, r.map(x => ({ ...x, user_id: uid }))])), settings: [{ ...m.settings, user_id: uid }], payments: [] };
let failNext = false; const log = [];
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;
let weatherMissing = false, hpMissing = false, meteoCalls = [];
async function open(page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid } };
  await ctx.addInitScript(s => localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s), JSON.stringify(session));
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop();
    if (t === 'hp_energy' && hpMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.hp_energy" does not exist', code: '42P01' }) });
    if (t === 'weather_daily' && weatherMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.weather_daily" does not exist', code: '42P01' }) });
    DB[t] ??= [];
    const H = { 'access-control-expose-headers': 'Content-Range' };
    if (req.method() === 'POST') {
      if (failNext) { failNext = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulierter Fehler', code: '23514' }) }); }
      const keys = (u.searchParams.get('on_conflict') || 'id').split(',');
      for (const r of JSON.parse(req.postData())) { const i = DB[t].findIndex(x => keys.every(k => x[k] === r[k])); if (i >= 0) DB[t][i] = { ...DB[t][i], ...r }; else DB[t].push(r); log.push(['upsert', t]); }
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]', headers: H });
    }
    if (req.method() === 'DELETE') {
      const f = [...u.searchParams].filter(([k, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
      const before = DB[t].length; DB[t] = DB[t].filter(x => !f.every(([k, v]) => String(x[k]) === v)); log.push(['delete', t, before - DB[t].length]);
      return route.fulfill({ status: 204, headers: H });
    }
    let rows = [...DB[t]]; const o = u.searchParams.get('order'); if (o?.startsWith('day')) rows.sort((a, c) => a.day.localeCompare(c.day) * (o.includes('desc') ? -1 : 1));
    const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim); const rg = req.headers()['range']; if (rg) { const [a, z] = rg.split('-').map(Number); rows = rows.slice(a, z + 1); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...H, 'content-range': `0-0/${DB[t].length}` }, body: req.method() === 'HEAD' ? '' : JSON.stringify(rows) });
  });
  // Open-Meteo simuliert: Ortssuche und Tageswerte (synthetisch, Temperatur und Strahlung nach Jahreszeit)
  await ctx.route(/open-meteo\.com/, route => {
    const u = new URL(route.request().url()); meteoCalls.push(u.hostname + u.pathname);
    const H = { 'access-control-allow-origin': '*' };
    if (u.hostname.startsWith('geocoding')) return route.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify({ results: [{ name: 'Teststadt', admin1: 'Land', country: 'X', latitude: 1.2345, longitude: 6.789 }] }) });
    let a = u.searchParams.get('start_date'), z = u.searchParams.get('end_date');
    if (!a) { const t = new Date(); z = t.toISOString().slice(0, 10); a = new Date(t - 10 * 864e5).toISOString().slice(0, 10); }
    const time = []; for (let d = a; d <= z; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) time.push(d);
    const doy = d => (Date.parse(d) - Date.parse(d.slice(0, 4) + '-01-01')) / 864e5, sea = d => Math.sin((doy(d) - 80) / 365 * 2 * Math.PI);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify({ daily: { time,
      temperature_2m_mean: time.map(d => 10 + 10 * sea(d) + ((doy(d) * 7) % 5 - 2)), shortwave_radiation_sum: time.map(d => 3.6 * (2.5 + 2.2 * sea(d))), sunshine_duration: time.map(d => 3600 * (5 + 4 * sea(d))) } }) });
  });
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8000/#' + page); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHL ') + msg); if (!ok) failures++; };
const OLD_HEAD = 'Datum,Eigenverbrauch (kWh),Verbrauch über Smart Plug (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Speicherladung (kWh),Speicherentladung (kWh),Speicher zu Haushalt (kWh),Genutzte Solarenergie (kWh),Gesamte Solarstromerzeugung (kWh),Solarstrom‑Einspeisung (kWh),X – PV1‑Erzeugung (kWh),X – PV2‑Erzeugung (kWh)';
const NEW_HEAD = 'Datum,Eigenverbrauch (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Netzstrom zu Speicher (kWh),Gesamte Solarstromerzeugung (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Solarstrom-Einspeisung (kWh),Speicherentladung (kWh),Speicher zu Haushalt (kWh),Speicher-Einspeisung (kWh),PV1-Erzeugung (kWh),PV2-Erzeugung (kWh),Speicherladung (kWh)';
const oldCsv = '"Definition"\n' + OLD_HEAD + '\n10/01/2031,2.00,0.00,1.50,1.50,0.30,0.20,0.20,0.10,0.10,0.50,0.50,0.00,0.20,0.30\n11/01/2031,2.00,0.00,1.00,1.00,0.50,0.50,0.50,0.40,0.40,1.00,1.00,0.00,0.50,0.50\n';
const newCsv = '"Definition"\n' + NEW_HEAD + '\n11/01/2031,4.00,1.00,0.70,0.30,3.00,1.50,1.20,0.30,1.80,1.80,0.00,1.50,1.50,1.50\n';
const file = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
{
  const { p, ctx } = await open('data');
  await p.setInputFiles('#csv-file', [file('alt.csv', oldCsv), file('neu.csv', newCsv)]);
  await p.waitForSelector('#csv-apply');
  const t = await p.textContent('#csv-result');
  check(t.includes('alt.csv + neu.csv') && t.includes('2 Tage'), 'Vorschau nennt beide Dateien und 2 Tage');
  check(t.includes('Aus mehreren Dateien addiert: 11.01.2031'), 'addierter Tag genannt');
  check(/aus dem Netz geladen.*11\.01\.2031/.test(t), 'Hinweis Netzladung');
  check(!t.includes('Spalte fehlt'), 'kein Fehler „Spalte fehlt“');
  await p.click('#csv-apply'); await p.waitForSelector('#csv-progress .ok');
  const r = DB.anker_daily.find(x => x.day === '2031-01-11');
  check(r && r.erzeugung === 4 && r.genutzt === 4 && r.netz_zu_speicher === 0.3 && r.netzimport === 2 && r.pv1 === 2, 'Summe geschrieben (Erzeugung 4, genutzt 4, Netzladung 0,3)');
  check(DB.anker_daily.find(x => x.day === '2031-01-10')?.netz_zu_speicher === 0, 'altes Format: Netzladung 0');
  // nur die neue Datei erneut → Warnung kleiner, Nachfrage (Dialog wird bestätigt)
  let asked = 0; p.removeAllListeners('dialog'); p.on('dialog', d => { asked++; d.dismiss(); });
  await p.setInputFiles('#csv-file', [file('neu.csv', newCsv)]);
  await p.waitForSelector('#csv-apply');
  const t2 = await p.textContent('#csv-result');
  check(t2.includes('Kleinere Erzeugung'), 'Teil-Import: Warnung kleinere Werte');
  await p.click('#csv-apply'); await p.waitForTimeout(200);
  check(asked === 1 && DB.anker_daily.find(x => x.day === '2031-01-11').erzeugung === 4, 'Nachfrage, abgelehnt → nichts geschrieben');
  // gleiche Datei doppelt
  await p.setInputFiles('#csv-file', [file('a.csv', oldCsv), file('b.csv', oldCsv)]);
  await p.waitForSelector('#csv-apply');
  check((await p.textContent('#csv-result')).includes('doppelt gewählt'), 'doppelte Datei gemeldet');
  await p.goto('http://localhost:8000/#batt'); await p.waitForTimeout(400);
  check((await p.textContent('#bt-kpis')).includes('Wert des Speichers'), 'Batterie-Seite rendert');
  check(!p.errs.length, 'keine Skriptfehler ' + p.errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
