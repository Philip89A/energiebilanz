// v0.38-Test: Deutung der Zusammenhänge (Was heißt das?, Lesehilfe, wichtigste Erkenntnisse).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v38-check.mjs
// Simuliertes Supabase mit data/seed_state.json; Geräte- und Raumklimawerte synthetisch.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v34-check.mjs
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
const txt = (p, s) => p.$eval(s, e => e.innerText).catch(() => '');
const days = []; for (let d = new Date('2026-01-01T00:00:00Z'); d <= new Date('2026-02-28T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
const tK = i => 16 + (i % 5), hrs = (t, a, b) => Array.from({ length: 24 }, (_, h) => [t, h < 6 ? a : b]);
DB.device_daily = days.flatMap((day, i) => [{ user_id: uid, device_id: 'gf', day, kwh: 0.40 + 0.02 * (tK(i) - 16), src: 'day' }, { user_id: uid, device_id: 'lu', day, kwh: 0.9 - (i % 3) * 0.2, src: 'day' }]);
DB.room_climate = days.flatMap((day, i) => [{ user_id: uid, room: 'Keller', day, n: 96, t: tK(i), rh: 50, rh_min: 44, rh_max: i % 7 === 0 ? 64 : 48, h_dry: 0, h_wet: 0, hours: hrs(tK(i), 50, 50) },
  { user_id: uid, room: 'Schlafzimmer', day, n: 96, t: 20, rh: 55, rh_min: 50, rh_max: 66, h_dry: 0, h_wet: 6, hours: hrs(20, 55 + (i % 3) * 3, 52) }]);
DB.settings[0].data = { ...DB.settings[0].data, devices: [{ id: 'gf', name: 'Gefrierschrank', from: '' }, { id: 'lu', name: 'Lüftung', from: '' }], rooms: [{ id: 'Keller', name: 'Vorratskeller' }, { id: 'Schlafzimmer', name: 'Schlafzimmer' }] };
{
  const { p, ctx } = await open('rel');
  await p.selectOption('#pb-mode', 'quarter'); await p.waitForTimeout(200); await p.selectOption('#pb-key', '2026-Q1'); await p.waitForTimeout(500);
  check((await p.$$('#rel-cards .rel-x')).length === 8, 'jede Karte hat „Was heißt das?“');
  const fz = await txt(p, '#rel-x-freezer'); console.log(fz.replace(/\n+/g, ' | '));
  check(/Ergebnis.*1 °C wärmer.*0,020 kWh mehr/s.test(fz), 'Gefrierschrank: Ergebnis als Satz');
  check(/Wie sicher.*belastbar/s.test(fz) && /Was es ausmacht.*3 °C kühler/s.test(fz) && /Was tun/.test(fz), 'Gefrierschrank: alle vier Zeilen');
  const ve = await txt(p, '#rel-x-vent'); console.log(ve.replace(/\n+/g, ' | '));
  check(/Luftfeuchte/.test(ve) && /Was tun/.test(ve), 'Lüftung: Feuchte und Empfehlung');
  const dh = await txt(p, '#rel-x-dhw'); console.log(dh.replace(/\n+/g, ' | '));
  check(/Was tun/.test(dh), 'Warmwasser: Handlung oder was fehlt');
  const ba = await txt(p, '#rel-x-base'); console.log(ba.replace(/\n+/g, ' | '));
  check(/am meisten am/.test(ba), 'Grundlast: Wochentag benannt');
  check(await p.$eval('#rel-x-freezer details', e => !e.open) , 'Lesehilfe eingeklappt');
  await p.click('#rel-x-freezer summary'); check(/Jeder Punkt ist ein Tag/.test(await txt(p, '#rel-x-freezer details')), 'Lesehilfe aufklappbar');
  const top = await txt(p, '#rel-top'); console.log(top.replace(/\n+/g, ' | '));
  check(/wichtigsten Erkenntnisse/.test(top), 'Zusammenfassung oben');
  await (await p.$('#rel-freezer')).screenshot({ path: '/tmp/claude-0/-home-user-mm-tracker/ce052db4-0e2d-5d9a-8dd9-49418779e3ec/scratchpad/rel38.png' });
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(1000);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'Handy: kein waagrechtes Scrollen');
  await (await p.$('#rel-x-vent')).screenshot({ path: '/tmp/claude-0/-home-user-mm-tracker/ce052db4-0e2d-5d9a-8dd9-49418779e3ec/scratchpad/rel38m.png' });
  check(!p.errs.length, 'keine Skriptfehler ' + p.errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
