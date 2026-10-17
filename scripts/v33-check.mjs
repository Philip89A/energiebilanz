// v0.33-Test: Raumklima – Govee-Import (Raum aus dem Dateinamen), Tabelle je Raum, Hinweise, Grafiken, Raum umbenennen.
// Simuliertes Supabase mit data/seed_state.json; Govee-Werte synthetisch.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v33-check.mjs
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
const head = '﻿Zeitstempel für Abtastfrequenz alle 15 min min,Temperatur_Celsius (kalibriert -0.9 C),Relative Luftfeuchtigkeit\n';
const gen = (days, f) => head + days.flatMap(d => Array.from({ length: 96 }, (_, i) => { const h = Math.floor(i / 4); const [t, rh] = f(h);
  return `${d} ${String(h).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00,${t},${rh}`; })).join('\n') + '\n';
const days = []; for (let d = new Date('2026-02-01T00:00:00Z'); d <= new Date('2026-02-20T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
const schlaf = gen(days, h => [20, h < 6 ? 66 : 54]), buero = gen(days, h => [21, 33]);
const file = (name, s) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(s) });
{
  const { p, ctx } = await open('hp');
  check((await txt(p, '#rk-flags')).includes('Noch keine Raumklima-Daten'), 'ohne Daten: Hinweis');
  await p.goto('http://localhost:8000/#data'); await p.waitForTimeout(300);
  await p.setInputFiles('#rk-file', [file('Schlafzimmer_export_202602202300.csv', schlaf), file('Bu_ro_export_202602202300.csv', buero)]);
  await p.waitForSelector('#rki-save');
  check(await p.$eval('[data-rkn="0"]', e => e.value) === 'Schlafzimmer', 'Raum aus dem Dateinamen');
  await p.fill('[data-rkn="1"]', 'Büro'); await p.dispatchEvent('[data-rkn="1"]', 'change'); await p.waitForTimeout(150);
  await p.click('#rki-save'); await p.waitForTimeout(800);
  const rows = DB.room_climate || [];
  check(rows.length === 40 && rows.every(r => r.n === 96 && Array.isArray(r.hours) && r.hours.length === 24), `40 Tage gespeichert (${rows.length})`);
  check((await txt(p, '#rk-result')).includes('40 Tage gespeichert'), 'Meldung');
  await p.goto('http://localhost:8000/#hp'); await p.waitForTimeout(300);
  await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(200); await p.selectOption('#pb-key', '2026-02'); await p.waitForTimeout(500);
  const t = await txt(p, '#rk-tbl');
  check(t.includes('Schlafzimmer') && t.includes('Büro') && /66 %\s+54 %/.test(t), 'Tabelle: Schlafzimmer nachts 66 %, tagsüber 54 %');
  const f = await txt(p, '#rk-flags');
  check(f.includes('Schlafzimmer') && f.includes('60 % Feuchte oder mehr'), 'Hinweis feucht (Schlafzimmer)');
  check(f.includes('Büro') && f.includes('unter 40 %'), 'Hinweis trocken (Büro)');
  check(await p.evaluate(() => window.__ebCharts['rk-chart'].data.datasets.length) === 4, 'Grafik: 2 Räume + Linien 40/60 %');
  check(await p.evaluate(() => window.__ebCharts['rk-prof'].data.datasets[0].data[3]) === 66, 'Tagesverlauf Schlafzimmer (Standard): 3 Uhr 66 %');
  await p.selectOption('#rk-metric', 't'); await p.waitForTimeout(300);
  check((await txt(p, '#rk-chart-title')) === 'Temperatur je Raum', 'Umschalten auf Temperatur');
  await p.fill('[data-rk="1"][data-k="name"]', 'Arbeitszimmer'); await p.dispatchEvent('[data-rk="1"][data-k="name"]', 'change'); await p.waitForTimeout(400);
  check((await txt(p, '#rk-tbl')).includes('Arbeitszimmer'), 'Raum umbenannt');
  check(!p.errs.length, 'keine Skriptfehler ' + p.errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
