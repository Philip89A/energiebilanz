// v0.40-Test: Seite CO₂ (Kacheln, Deutung, Monatsgrafik, Vergleich, graue Emissionen, Hebel, Faktoren) und Hinweis im Überblick.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v40-check.mjs
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
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHLER ') + msg); if (!ok) failures++; };
DB.settings[0].data = { ...DB.settings[0].data, wx: { lat: 1.2, lon: 6.7, name: 'Teststadt', heatLimit: 15, room: 20 } };
{
  const { p, ctx } = await open('co2'); await p.waitForTimeout(1500);
  check((await p.$eval('#snav', e => e.innerText)).includes('CO₂'), 'Seite im Menü');
  check(await p.isVisible('#period-bar'), 'mit Zeitraumleiste');
  await p.selectOption('#pb-mode', 'all'); await p.waitForTimeout(600);
  const k = await p.$$eval('#co-kpis .kpi', ks => ks.map(k => k.innerText.replace(/\s+/g, ' '))); console.log(k.join('\n'));
  check(k.length === 4 && /Ausstoß \(Strommix\)/.test(k[0]) && /laut Vertrag/.test(k[1]) && /ohne Technik/.test(k[2]) && /pro Person/.test(k[3]), '4 Kacheln');
  const x = await p.$eval('#co-x', e => e.innerText.replace(/\s+/g, ' ')); console.log(x.slice(0, 600));
  check(/Ergebnis.*Was es ausmacht.*Wie sicher.*Was tun/.test(x), 'Was heißt das? mit vier Zeilen');
  check(await p.evaluate(() => window.__ebCharts['co-chart'].data.datasets.length) === 6, 'Monatsgrafik mit 6 Reihen');
  const cmp = await p.$$eval('#co-cmp tbody tr', t => t.map(r => r.innerText.replace(/\s+/g, ' '))); console.log(cmp.join('\n'));
  check(cmp.length === 4, 'Vergleichstabelle Heizen, Strom, Auto, Summe');
  const g = await p.$eval('#co-grey', e => e.innerText.replace(/\s+/g, ' ')); console.log(g);
  check(/Herstellung der Anlage/.test(g) && /Rückzahlzeit/.test(g), 'Graue Emissionen');
  const lv = await p.$$eval('#co-lev tbody tr', t => t.length); check(lv >= 3, 'Hebel: ' + lv);
  // Faktor ändern
  await p.fill('[data-co="y2025"]', '300'); await p.dispatchEvent('[data-co="y2025"]', 'change'); await p.waitForTimeout(1200);
  check(DB.settings[0].data.co2?.mix?.['2025'] === 300, 'Faktor gespeichert');
  await (await p.$('#p-co2')).screenshot({ path: '/tmp/claude-0/-home-user-mm-tracker/ce052db4-0e2d-5d9a-8dd9-49418779e3ec/scratchpad/co40.png' });
  await p.goto('http://localhost:8000/#overview'); await p.waitForTimeout(800);
  check(/CO₂ im Zeitraum/.test(await p.$eval('#ov-co2', e => e.innerText)), 'Hinweis im Überblick');
  await p.goto('http://localhost:8000/#co2'); await p.waitForTimeout(500);
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(1000);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'Handy: kein waagrechtes Scrollen');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
