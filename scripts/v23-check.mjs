// v0.23-Test: gleitender 30-Tage-Durchschnitt statt Trendgerade in „Verbrauch pro Tag zwischen den Ablesungen“ und
// Wärmepumpe je Gradtag. Simuliertes Supabase mit data/seed_state.json und synthetischen Wetterdaten.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v23-check.mjs
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

const ok = (c, msg) => { if (!c) failures++; console.log((c ? 'OK   ' : 'FEHL ') + msg); };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ');
DB.hp_energy = [];
// synthetisches Wetter für den ganzen Zeitraum der Ablesungen: Jahresgang 10 ± 10 °C
DB.weather_daily = []; for (let t = Date.parse('2024-06-01'); t <= Date.parse('2026-12-31'); t += 864e5) {
  const d = new Date(t).toISOString().slice(0, 10), doy = (t - Date.parse(d.slice(0, 4) + '-01-01')) / 864e5;
  DB.weather_daily.push({ user_id: uid, day: d, temp_mean: +(10 + 10 * Math.sin((doy - 110) / 365 * 2 * Math.PI)).toFixed(1), rad_kwh: 3, sun_h: 5 }); }
const ma = p => p.evaluate(() => window.__ebCharts['mt-rate'].data.datasets.map(d => ({ l: d.label, n: d.data.length, min: Math.min(...d.data.map(q => q.y)), dash: d.borderDash })));

let { p, ctx } = await open('meter');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
let d = await ma(p);
ok(!d.some(x => x.l.startsWith('Trend')), 'keine Trendgerade mehr beim Strom');
const mA = d.find(x => x.l === 'Ø 30 Tage Allgemeinstrom'), mW = d.find(x => x.l === 'Ø 30 Tage Wärmepumpe');
ok(mA && mW && mA.n > 30 && mW.n > 30 && mA.dash && mW.dash, `gleitender Durchschnitt je Zählpunkt (${mA?.n} / ${mW?.n} Tage), gepunktet`);
ok(mA.min >= 0 && mW.min >= 0, 'nie negativ');
let t = await txt(p, '#mt-rate-note');
ok(t.includes('gleitender Durchschnitt der letzten 30 Tage') && /Allgemeinstrom: [\d,]+ kWh\/Tag bis/.test(t), 'Hinweis mit 30-Tage-Wert: ' + t.slice(0, 160));
ok(t.includes('Wärmepumpe wetterbereinigt'), 'Hinweis Wärmepumpe wetterbereinigt');
// Wintermonat und Sommermonat mit Ablesungen
const lab = await p.evaluate(() => window.__ebCharts['mt-rate'].data.datasets[1].data.map(q => q.x));
const months = [...new Set(lab.map(x => x.slice(0, 7)))];
const win = months.find(m => ['12', '01', '02'].includes(m.slice(5))), sum = months.find(m => ['06', '07', '08'].includes(m.slice(5)));
await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(200);
if (win) { await p.selectOption('#pb-key', win); await p.waitForTimeout(400); t = await txt(p, '#mt-rate-note');
  ok(/Heizung [\d,]+ kWh je Gradtag bei \d+ Gradtagen/.test(t), `Winter ${win}: kWh je Gradtag – ` + (t.match(/Wärmepumpe wetterbereinigt[^.]*/) || [''])[0]); }
else ok(false, 'kein Wintermonat in den Seed-Ablesungen');
if (sum) { await p.selectOption('#pb-key', sum); await p.waitForTimeout(400); t = await txt(p, '#mt-rate-note');
  ok(t.includes('nicht aussagekräftig'), `Sommer ${sum}: Hinweis außerhalb der Heizzeit`); }
d = await ma(p);
ok(d.filter(x => x.l.startsWith('Ø 30 Tage')).every(x => x.n >= 1), 'Monat: Durchschnitt auch am Monatsanfang (Fenster reicht in den Vormonat)');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();
// ohne Wetterdaten: kein Gradtag-Hinweis, kein Fehler
DB.weather_daily = [];
({ p, ctx } = await open('meter'));
t = await txt(p, '#mt-rate-note');
ok(!t.includes('wetterbereinigt') && t.includes('gleitender Durchschnitt'), 'ohne Wetter: nur Durchschnitt');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
