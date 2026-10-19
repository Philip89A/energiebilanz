// v0.41-Test: Netz-CO₂ je Stunde (Energy-Charts simuliert): Abruf, Speichern, Profil, Bilanz mit Netzwerten; Fehlerfälle und Gast.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v41-check.mjs
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
let weatherMissing = false, hpMissing = false, meteoCalls = [], progMissing = false, gcMissing = false, gcMode = 'ok', gcCalls = [];
async function open(page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid } };
  await ctx.addInitScript(s => localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s), JSON.stringify(session));
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop();
    if (t === 'grid_co2' && gcMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.grid_co2" does not exist', code: '42P01' }) });
    if (t === 'device_programs' && progMissing) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'relation "public.device_programs" does not exist', code: '42P01' }) });
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
  await ctx.route(/energy-charts\.info/, route => { gcCalls.push(route.request().url()); if (gcMode === 'bad') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"foo":1}' });
    const u = new URL(route.request().url()), a = Date.parse(u.searchParams.get('start') + 'T00:00:00Z') - 2 * 36e5, z = Date.parse(u.searchParams.get('end') + 'T00:00:00Z'), ts = [], v = [];
    for (let t = a; t < z; t += 9e5) { const h = (new Date(t).getUTCHours() + 1) % 24; ts.push(t / 1000); v.push(h >= 11 && h <= 14 ? 180 : h >= 17 && h <= 20 ? 480 : 340); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ unix_seconds: ts, co2eq: v }) }); });
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8000/#' + page); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHLER ') + msg); if (!ok) failures++; };
DB.settings[0].data = { ...DB.settings[0].data, wx: { lat: 1.2, lon: 6.7, name: 'Teststadt', heatLimit: 15, room: 20 } };
DB.grid_co2 = [];
{
  const { p, ctx } = await open('co2'); await p.waitForTimeout(4000);
  check(gcCalls.length >= 10 && gcCalls.every(u => /country=de/.test(u)), 'Abruf in Monatsstücken: ' + gcCalls.length);
  check(DB.grid_co2.length > 300, 'Netzwerte gespeichert: ' + DB.grid_co2.length + ' Tage');
  const r0 = DB.grid_co2.find(r => r.day === '2026-07-01'); check(r0 && r0.hours && r0.hours[12] === 180 && r0.hours[18] === 480, 'Stundenwerte in Ortszeit');
  await p.selectOption('#pb-mode', 'all'); await p.waitForTimeout(600);
  const gk = await p.$$eval('#co-grid-kpis .kpi', ks => ks.map(k => k.innerText.replace(/\s+/g, ' '))); console.log(gk.join('\n'));
  check(gk.length === 4 && /11, 12, 13|12, 13, 14|11, 12, 14|11, 13, 14/.test(gk[1]), 'sauberste Stunden mittags');
  check(/17|18|19|20/.test(gk[2]), 'schmutzigste Stunden abends');
  const k0 = await p.$eval('#co-kpis .kpi', e => e.innerText.replace(/\s+/g, ' ')); console.log(k0);
  check(/Tagen mit Netzwerten je Stunde/.test(k0), 'Bilanz nennt Netzwerte und Jahresfaktor');
  check(await p.evaluate(() => window.__ebCharts['co-grid-chart'].data.datasets[0].data.length) === 24, 'Stundengrafik');
  await p.uncheck('#co-hourly'); await p.waitForTimeout(1200);
  check(DB.settings[0].data.co2?.hourly === false && !/Tagen mit Netzwerten/.test(await p.$eval('#co-kpis .kpi', e => e.innerText)), 'abschaltbar');
  await p.check('#co-hourly'); await p.waitForTimeout(800);
  await (await p.$('#co-grid-panel')).screenshot({ path: '/tmp/claude-0/-home-user-mm-tracker/ce052db4-0e2d-5d9a-8dd9-49418779e3ec/scratchpad/grid41.png' });
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(1000);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'Handy: kein waagrechtes Scrollen');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
{ // unbekanntes Format: Hinweis, Rechnung mit Jahresfaktor
  DB.grid_co2 = []; gcMode = 'bad'; gcCalls = [];
  const { p, ctx } = await open('co2'); await p.waitForTimeout(2500);
  const m = await p.$eval('#co-grid-msg', e => e.innerText); console.log(m);
  check(/Format der Netzwerte unbekannt/.test(m) && /Jahresfaktor/.test(m), 'falsches Format: Hinweis');
  check(DB.grid_co2.length === 0 && (await p.$$('#co-kpis .kpi')).length === 4, 'Seite rechnet weiter');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
{ // Tabelle fehlt: kein Abruf, Hinweis auf SQL
  gcMissing = true; gcMode = 'ok'; gcCalls = [];
  const { p, ctx } = await open('co2'); await p.waitForTimeout(2000);
  check(gcCalls.length === 0 && /UPDATE_V41\.sql/.test(await p.$eval('#co-grid-flags', e => e.innerText)), 'ohne Tabelle: kein Abruf, Hinweis');
  await ctx.close(); gcMissing = false;
}
{ // Gast: kein Abruf
  DB.shares = [{ owner_id: '22222222-2222-4222-8222-222222222222', viewer_id: uid }]; gcCalls = []; DB.grid_co2 = [];
  const { p, ctx } = await open('co2'); await p.waitForTimeout(2000);
  check(gcCalls.length === 0, 'Gast löst keinen Abruf aus');
  await ctx.close(); DB.shares = [];
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
