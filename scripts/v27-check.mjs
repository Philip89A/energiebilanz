// v0.27-Test: PV-Prognose (Vorhersage 14 Tage, Speichern je Erstellungstag, Trefferquote, Ausblick 12 Monate, ohne Tabelle).
// Simuliertes Supabase mit data/seed_state.json, synthetisches Wetter und simulierte Open-Meteo-Vorhersage.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v27-check.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSeed } from '../js/import.js';
const base = fileURLToPath(new URL('..', import.meta.url));
const seed = JSON.parse(readFileSync(base + 'data/seed_state.json', 'utf8'));
const m = mapSeed(seed), uid = '11111111-1111-4111-8111-111111111111';
const DB = { ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'settings').map(([k, r]) => [k, r.map(x => ({ ...x, user_id: uid }))])), settings: [{ ...m.settings, user_id: uid }], payments: [] };
let failNext = false; const log = [];
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;
let pvMissing = false, weatherMissing = false, hpMissing = false, meteoCalls = [];
async function open(page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid } };
  await ctx.addInitScript(s => localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s), JSON.stringify(session));
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop();
    if (t === 'pv_forecast' && pvMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.pv_forecast" does not exist', code: '42P01' }) });
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
    const fd = u.searchParams.get('forecast_days'); if (fd && +fd > 1) { const t = new Date(); a = t.toISOString().slice(0, 10); z = new Date(+t + (+fd - 1) * 864e5).toISOString().slice(0, 10); }
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

const ok = (c, msg) => { if (!c) failures++; console.log((c ? 'OK   ' : 'FEHL ') + msg); };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ');
const today = new Date().toISOString().slice(0, 10), addD = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
DB.hp_energy = [];
// synthetisches Wetter wie die Simulation: Einstrahlung im Jahresgang
DB.weather_daily = []; for (let t = Date.parse('2025-03-01'); t < Date.parse(today); t += 864e5) {
  const d = new Date(t).toISOString().slice(0, 10), doy = (t - Date.parse(d.slice(0, 4) + '-01-01')) / 864e5, sea = Math.sin((doy - 80) / 365 * 2 * Math.PI);
  DB.weather_daily.push({ user_id: uid, day: d, temp_mean: 10 + 10 * sea, rad_kwh: +(2.5 + 2.2 * sea).toFixed(2), sun_h: 5 }); }
DB.settings[0].data = { ...DB.settings[0].data, wx: { name: 'Teststadt', lat: 1.23, lon: 6.79 } };
// gespeicherte Prognosen für vergangene Tage mit Anker-Daten (Seed bis 26.09.2026): je eine vom Vortag
const ankerLast = '2026-09-26';
DB.pv_forecast = [0, 1, 2, 3, 4].map(i => ({ user_id: uid, day: addD(ankerLast, -i), made_on: addD(ankerLast, -i - 1), kwh: 5, lo: 4, hi: 6, rad_kwh: 3, factor: 1.6 }));

let { p, ctx } = await open('pv');
await p.waitForTimeout(800);
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
ok(meteoCalls.some(c => c.includes('api.open-meteo.com/v1/forecast')), 'Vorhersage bei Open-Meteo abgefragt');
const ds = await p.evaluate(() => { const c = window.__ebCharts['pvf-days']; return { labels: c.data.labels, data: c.data.datasets.map(d => d.data) }; });
ok(ds.labels.length === 14 && ds.data[0].every(v => v > 0), `14 Tage Prognose (${ds.labels[0]} …)`);
ok(ds.data[1].every((b, i) => b[0] <= ds.data[0][i] && b[1] >= ds.data[0][i]), 'Bandbreite umschließt den Wert');
let k = await txt(p, '#pvf-kpis');
ok(/Heute erwartet/.test(k) && /Nächste 7 Tage/.test(k) && /[\d,]+ kWh/.test(k), 'Kennzahlen heute/morgen/7 Tage');
const saved = DB.pv_forecast.filter(r => r.made_on === today);
ok(saved.length === 14 && saved[0].day === today && saved.every(r => r.kwh > 0 && r.factor > 0), `Prognose gespeichert (${saved.length} Zeilen, Erstellungstag heute)`);
ok(/± [\d,]+ %/.test(k) && k.includes('5 Tage der letzten 30'), 'Trefferquote angezeigt: ' + k.slice(-120));
const acc = await p.evaluate(() => window.__ebCharts['pvf-acc'].data.datasets.map(d => d.data.length));
ok(acc[0] === 5 && acc[1] === 5, 'Prognose gegen Messung: 5 Tage');
const nMon = await p.$$eval('#pvf-months tbody tr', r => r.length);
ok(nMon === 12, 'Ausblick 12 Monate');
const t = await txt(p, '#pvf-months');
ok(t.includes('Vorhersage') && t.includes('typisch'), 'Monatszeile: Vorhersage und typische Tage');
ok((await txt(p, '#pvf-method')).includes('Ertragsfaktor'), 'Methode erklärt');
// Zweites Öffnen am selben Tag: keine neue Abfrage
const n0 = meteoCalls.filter(c => c.includes('/v1/forecast')).length;
await p.goto('http://localhost:8000/#overview'); await p.waitForTimeout(200); await p.goto('http://localhost:8000/#pv'); await p.waitForTimeout(400);
ok(meteoCalls.filter(c => c.includes('/v1/forecast')).length === n0, 'gleicher Tag: Vorhersage nicht erneut geholt');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

// Gast: kein Abruf bei Open-Meteo, Anzeige aus der gespeicherten Vorhersage, nichts gespeichert
DB.shares = [{ owner_id: uid, viewer_id: uid }]; const nRows = DB.pv_forecast.length, nCalls = meteoCalls.length;
({ p, ctx } = await open('pv')); await p.waitForTimeout(800);
ok(meteoCalls.length === nCalls, 'Gast: kein Abruf bei Open-Meteo');
ok((await p.evaluate(() => window.__ebCharts['pvf-days'].data.labels.length)) === 14 && DB.pv_forecast.length === nRows, 'Gast: gespeicherte Prognose sichtbar, nichts gespeichert');
ok((await txt(p, '#pvf-flags')).includes('Vorhersage vom letzten Öffnen'), 'Gast: Hinweis');
await ctx.close(); DB.shares = [];
// ohne Tabelle (SQL-Update fehlt): Anzeige ja, Hinweis, kein Fehler
pvMissing = true;
({ p, ctx } = await open('pv')); await p.waitForTimeout(800);
ok((await txt(p, '#pvf-flags')).includes('SQL-Update v0.27') && (await p.evaluate(() => window.__ebCharts['pvf-days'].data.labels.length)) === 14, 'ohne Tabelle: Hinweis und Prognose');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close(); pvMissing = false;
console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
