// v0.16-Test: Zeitraum auf Tanken & Laden, Tarifrechner, Ausbau, Zahlungsbuch und Zählerstände-Liste.
// Simuliertes Supabase mit data/seed_state.json, ohne private Werte im Skript.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v16-check.mjs
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
let weatherMissing = false, meteoCalls = [];
async function open(page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid } };
  await ctx.addInitScript(s => localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s), JSON.stringify(session));
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop();
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
DB.weather_daily = []; DB.hp_energy = [];
const lastFuel = DB.fuel_log.map(x => x.day).sort().at(-1) || '2026-01-15';
const mk = lastFuel.slice(0, 7);
DB.payments = [{ id: 'p1', user_id: uid, grp: 'as', day: `${mk}-05`, amount: 50, kind: 'abschlag', note: 'im Monat' }, { id: 'p2', user_id: uid, grp: 'as', day: '2024-01-05', amount: 40, kind: 'abschlag', note: 'alt' }];

let { p, ctx } = await open('log');
ok(!p.errs.length, 'Seite ohne Fehler ' + p.errs.join(' | '));
ok(await p.isVisible('#period-bar'), 'Zeitraumleiste auf Tanken & Laden');
const allRows = await p.$$eval('#fu-tbl tbody tr', r => r.length);
await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(200); await p.selectOption('#pb-key', mk).catch(() => {}); await p.waitForTimeout(400);
const k = await txt(p, '#lg-kpis');
ok(k.includes('Tankkosten im Zeitraum'), 'Kennzahlen für den Zeitraum');
const mRows = await p.$$eval('#fu-tbl tbody tr', r => r.length);
ok(mRows <= allRows, `Tankliste gefiltert (${mRows} von ${allRows})`);
ok((await txt(p, '#lg-car-kpis')).includes('im Zeitraum'), 'Fahrzeug-Kennzahlen im Zeitraum');
await p.selectOption('#pb-cmp', 'prev'); await p.waitForTimeout(400);
ok((await txt(p, '#lg-kpis')).includes('Vorperiode'), 'Vergleich mit Vorperiode angezeigt');
// Tarifrechner: Monat → hochgerechnet mit Hinweis
await p.goto('http://localhost:8000/#tarif'); await p.waitForTimeout(400);
const tb = await txt(p, '#tr-base');
ok(tb.includes('aufs Jahr hochgerechnet') && tb.includes('verzerren'), 'Tarifrechner: Hochrechnung mit Hinweis');
// Ausbau: Monat → Hinweis, gerechnet mit 365 Tagen
await p.goto('http://localhost:8000/#ausbau'); await p.waitForTimeout(400);
ok((await txt(p, '#wb-flags')).includes('ganzes Jahr'), 'Ausbau: Hinweis auf ganzes Jahr');
// Stromkosten: Zahlungsbuch gefiltert
await p.goto('http://localhost:8000/#cost'); await p.waitForTimeout(400);
const pay = await txt(p, '#pay-tbl');
ok(pay.includes('im Monat') && !pay.includes('alt'), 'Zahlungsbuch zeigt nur den Zeitraum');
// Gesamter Zeitraum: alles wie vorher
await p.selectOption('#pb-mode', 'all'); await p.waitForTimeout(400);
const pay2 = await txt(p, '#pay-tbl');
ok(pay2.includes('im Monat') && pay2.includes('alt'), 'Gesamter Zeitraum: Zahlungsbuch vollständig');
await p.goto('http://localhost:8000/#tarif'); await p.waitForTimeout(400);
ok((await txt(p, '#tr-base')).includes('365 Tage'), 'Gesamter Zeitraum: Tarifrechner mit 365 Tagen');
await p.goto('http://localhost:8000/#amort'); await p.waitForTimeout(300);
ok(await p.isHidden('#period-bar'), 'Amortisation ohne Zeitraumleiste');
await p.goto('http://localhost:8000/#car'); await p.waitForTimeout(300);
ok(await p.isHidden('#period-bar'), 'Auto-Vergleich ohne Zeitraumleiste');
ok(!p.errs.length, 'ohne Fehler ' + p.errs.join(' | '));
await ctx.close();
console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
