// v0.59-Test: Import „Home Gesamt“ (Power Dock) ohne PV-Eingänge, Wallbox-Spalte, Wallbox laut Anker gegen Ladebuch.
// Eigenständig mit synthetischen Daten (kein data/ nötig).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v59-check.mjs
import { chromium } from 'playwright';
const uid = '11111111-1111-4111-8111-111111111111';
const days = []; for (let t = Date.parse('2026-11-01'); t <= Date.parse('2026-11-15'); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
const DB = {
  anker_daily: days.map(day => ({ user_id: uid, day, genutzt: 1.5, speicher_zu_haus: 0.4, speicher_entladung: 0.4, speicher_ladung: 0.3, solar_zu_speicher: 0.3, solar_zu_haus: 1.1, erzeugung: 1.4, netzimport: 6, netz_zu_haus: 6, einspeisung: 0, eigenverbrauch: 7.5, pv1: 0.4, pv2: 0.4, pv3: 0.3, pv4: 0.3 })),
  meters: [], meter_readings: [], grid_co2: [], room_climate: [], charge_log: [], car_log: [],
  settings: [{ user_id: uid, data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} }, devices: [] } }],
  device_daily: [], device_hourly: [], hp_energy: [], payments: [], events: [], tariffs: [{ user_id: uid, id: 't1', grp: 'as', name: 'Test', valid_from: '2026-01-01', ap_ct: 30, gp_eur_year: 100 }], installments: [], investments: [] };
const posted = []; let failNext = false; const log = [];
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;
let weatherMissing = false, hpMissing = false, meteoCalls = [], progMissing = false;
async function open(page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid } };
  await ctx.addInitScript(s => localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s), JSON.stringify(session));
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop();
    if (t === 'device_programs' && progMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.device_programs" does not exist', code: '42P01' }) });
    if (t === 'hp_energy' && hpMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.hp_energy" does not exist', code: '42P01' }) });
    if (t === 'weather_daily' && weatherMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.weather_daily" does not exist', code: '42P01' }) });
    DB[t] ??= [];
    const H = { 'access-control-expose-headers': 'Content-Range' };
    if (req.method() === 'POST') {
      if (failNext) { failNext = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulierter Fehler', code: '23514' }) }); }
      const keys = (u.searchParams.get('on_conflict') || 'id').split(',');
      for (const r of JSON.parse(req.postData())) { const i = DB[t].findIndex(x => keys.every(k => x[k] === r[k])); if (i >= 0) DB[t][i] = { ...DB[t][i], ...r }; else DB[t].push(r); log.push(['upsert', t]); if (t === 'anker_daily') posted.push(r); }
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
  await ctx.route('**/functions/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ unix_seconds: [], co2eq: [] }) }));
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && p.errs.push(m.text())); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8000/' + (page.includes('#') ? page : '#' + page)); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHLER ') + msg); if (!ok) failures++; };
const HG = 'Datum,Eigenverbrauch (kWh),Verbrauch über Smart Plug (kWh),Ladesäulen-Verbrauch (kWh),Andere Lasten (kWh),Netzimport (kWh),Netzstrom zu Haushalt (kWh),Netzstrom zu Speicher (kWh),Solarstrom zu Haushalt (kWh),Solarstrom zu Speicher (kWh),Speicherladung (kWh),Speicherentladung (kWh),Speicher zu Haushalt (kWh),Genutzte Solarenergie (kWh),Gesamte Solarstromerzeugung (kWh),Eingebaute Solarstromerzeugung (kWh),Solarerzeugung durch Drittanbieter (kWh),Solarstrom-Einspeisung (kWh),CO₂-Reduktion (kgCO₂/kWh)';
const hgCsv = '"Definition"\n' + HG + '\n10/11/2026,6.29,0.00,0.00,6.29,6.94,5.99,0.95,0.20,0.45,1.40,0.10,0.10,-0.65,0.65,0.65,0.00,0.00,0.24\n11/11/2026,11.38,0.00,1.50,9.88,8.31,7.87,0.44,1.20,1.85,2.31,2.40,2.31,3.07,3.11,3.11,0.00,0.06,1.13\n';
const file = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
{
  const { p, ctx } = await open('data');
  await p.setInputFiles('#csv-file', [file('Home_Gesamt.csv', hgCsv)]);
  await p.waitForSelector('#csv-apply');
  const t = await p.textContent('#csv-result');
  check(!t.includes('Spalte fehlt'), 'Home Gesamt ohne PV-Spalten lesbar');
  check(t.includes('Wallbox: 1,50 kWh'), 'Vorschau nennt Wallbox 1,50 kWh');
  check(/aus dem Netz geladen.*10\.11\.2026/.test(t), 'Hinweis Netzladung des Speichers');
  await p.click('#csv-apply'); await p.waitForSelector('#csv-progress .ok');
  const r10 = DB.anker_daily.find(x => x.day === '2026-11-10'), r11 = DB.anker_daily.find(x => x.day === '2026-11-11');
  check(r11.wallbox === 1.5 && r11.erzeugung === 3.11 && r11.genutzt === 3.07, '11.11.: Wallbox 1,5, Erzeugung 3,11, genutzt 3,07');
  check(r10.pv1 === 0.4 && r10.netz_zu_speicher === 0.95 && r10.erzeugung === 0.65, '10.11.: bisherige PV1 bleibt, Netzladung 0,95 übernommen');
  check(!p.errs.length, 'keine Skriptfehler ' + p.errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
