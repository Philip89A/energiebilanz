// v0.42-Test: PV-Kalender je Jahr (Zeilen Monate, Spalten Tage) und kumulierte Erzeugung nur im gewählten Zeitraum, mit Vergleich.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v42-check.mjs
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
{
  const { p, ctx } = await open('pv'); await p.waitForTimeout(800);
  // Monat Juli 2026
  await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(300); await p.selectOption('#pb-key', '2026-07'); await p.waitForTimeout(600);
  check((await p.$$('.cal-year')).length === 1 && (await p.$$('.cal-year .cal-row:not(.cal-head)')).length === 1, 'Juli: ein Jahr, ein Monat');
  check(await p.$$eval('.cal-year .cal-row:not(.cal-head) i[title]', is => is.filter(i => !i.classList.contains('e')).length) === 31, '31 Tage mit Werten');
  const n1 = await p.$eval('#pv-cum-note', e => e.innerText); console.log(n1);
  check(/Im Zeitraum \(/.test(n1) && /Gesamt seit/.test(n1), 'Hinweis: Zeitraum und Gesamt');
  const lab = await p.evaluate(() => window.__ebCharts['pv-cum'].data.labels); check(lab.length === 31 && lab[0].startsWith('01.07'), 'Kurve nur Juli');
  const g = await p.evaluate(() => window.__ebCharts['pv-cum'].data.datasets[0].data); check(g[0] < g[30] && g[0] >= 0 && g[0] < 20, 'beginnt bei Tag 1 klein');
  // Vergleich Vorjahr
  await p.selectOption('#pb-cmp', { index: 1 }); await p.waitForTimeout(600);
  const ds = await p.evaluate(() => window.__ebCharts['pv-cum'].data.datasets.map(d => d.label)); console.log(ds.join(' | '));
  check(ds.length === 4 && /Erzeugung .+/.test(ds[3]), 'Vergleichskurve gestrichelt');
  check(/Vergleich/.test(await p.$eval('#pv-cum-note', e => e.innerText)), 'Vergleich im Hinweis');
  // Gesamtzeitraum: mehrere Jahre untereinander, neuestes oben
  await p.selectOption('#pb-mode', 'all'); await p.waitForTimeout(800);
  const ys = await p.$$eval('.cal-year h3', h => h.map(x => x.innerText)); console.log(ys.join(', '));
  check(ys.length >= 2 && ys[0] > ys[1], 'Jahre untereinander, neuestes oben');
  check(/Beste Tage/.test(await p.$eval('#pv-top', e => e.innerText)) && /Schwächste/.test(await p.$eval('#pv-top', e => e.innerText)), 'beste und schwächste Tage');
  await (await p.$('#pv-heat')).screenshot({ path: '/tmp/claude-0/-home-user-mm-tracker/ce052db4-0e2d-5d9a-8dd9-49418779e3ec/scratchpad/cal42.png' });
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(1000);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'Handy: kein waagrechtes Scrollen');
  const wd = await p.$eval('#pv-heat', e => { const r = e.getBoundingClientRect(), rows = [...e.querySelectorAll('.cal-row i')].map(i => i.getBoundingClientRect().right); return { r: r.right, m: Math.max(...rows) }; }); console.log(wd);
  check(wd.m <= wd.r + 0.5, 'Kalender-Kästchen passen in die Breite');
  await (await p.$('.cal-year')).screenshot({ path: '/tmp/claude-0/-home-user-mm-tracker/ce052db4-0e2d-5d9a-8dd9-49418779e3ec/scratchpad/cal42m.png' });
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
