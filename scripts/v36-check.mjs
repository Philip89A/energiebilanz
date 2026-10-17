// v0.36-Test: Waschprogramme je Monat (Anzeige, Eingabe mit Monatssumme, fehlende Tabelle), Wasser-Kachel mit echten Wäschen.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v36-check.mjs
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
const SEP = [['Pflegeleicht', 30, 1200, '', 6, 0.47, 50.8], ['Pflegeleicht', 30, 1400, '', 5, 0.47, 49.2], ['smartFinish', 0, 0, '', 4, 0.17, 3.8],
  ['Baumwolle', 60, 1400, '', 2, 1.46, 76.5], ['Hygiene', 60, 1200, '', 1, 1.03, 59.0], ['Pflegeleicht', 30, 1200, 'Miniload', 1, 0.17, 32.0], ['Schleudern/Abpumpen', 0, 1200, '', 1, 0.03, null]];
DB.meters.push({ id: 'wasser', name: 'Wasser', grp: 'water', sort: 9, user_id: uid });
DB.meter_readings.push({ meter_id: 'wasser', day: '2026-08-01', value: 100, user_id: uid }, { meter_id: 'wasser', day: '2026-10-01', value: 112.2, user_id: uid });
DB.settings[0].data = { ...DB.settings[0].data, water: { persons: 3 }, devices: [{ id: 'wasch', name: 'Waschmaschine', from: '' }] };
DB.device_daily = [];
const dim = { '2026-08': 31, '2026-09': 30 };
for (const [m, k, l, n] of [['2026-08', 16.96, 1277, 30], ['2026-09', 9.98, 810, 20]]) for (let d = 1; d <= dim[m]; d++)
  DB.device_daily.push({ user_id: uid, device_id: 'wasch', day: `${m}-${String(d).padStart(2, '0')}`, kwh: k / dim[m], water_l: l / dim[m], runs: n / dim[m], src: 'month' });
DB.device_programs = SEP.map(([program, temp, rpm, extra, runs, kwh_run, l_run]) => ({ user_id: uid, device_id: 'wasch', month: '2026-09-01', program, temp, rpm, extra, runs, kwh_run, l_run }));
const goAll = p => p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Alles$/.test(x.textContent.trim()) && x.offsetParent); if (b) b.click(); });
{
  const { p, ctx } = await open('meter'); await goAll(p); await p.waitForTimeout(300);
  check(await p.$eval('#pg-panel', e => !e.hidden), 'Abschnitt Waschprogramme sichtbar');
  const k = await p.$$eval('#pg-kpis .kpi', ks => ks.map(k => k.innerText.replace(/\s+/g, ' ')));
  console.log(k.join('\n'));
  check(/^15 Wäschen dazu 5 Auffrischen/.test(k[0]), '15 Wäschen, 5 Auffrischen/Schleudern');
  check(/0,62 kWh/.test(k[1]), '0,62 kWh je Wäsche');
  check(/53 l/.test(k[2]), '53 l je Wäsche');
  check(/^20 %/.test(k[3]) && /3 Wäschen, 40 % des Stroms/.test(k[3]), '60 °C: 20 % der Wäschen, 40 % des Stroms');
  const rows = await p.$$eval('#pg-tbl tbody tr', t => t.map(r => r.innerText.replace(/\s+/g, ' ')));
  check(rows.length === 7 && /^Baumwolle 60 °C/.test(rows[0]) && rows.some(r => /smartFinish.*keine Wäsche/.test(r)), 'Tabelle: 7 Programme, Baumwolle zuerst, smartFinish markiert');
  check(!(await p.$eval('#pg-flags', e => e.innerText)).includes('ergeben'), 'September stimmt mit Monatssumme überein');
  const wt = await p.$$eval('#wt-kpis .kpi', ks => ks.map(k => k.innerText.replace(/\s+/g, ' ')).find(t => /Waschmaschine/.test(t)) || '');
  console.log(wt);
  check(/Waschgänge/.test(wt), 'Wasser-Kachel: August ohne Programme → App-Gänge');
  // Eingabe: August neu
  await p.selectOption('#pg-edev', 'wasch'); await p.fill('#pg-month', '2026-08'); await p.dispatchEvent('#pg-month', 'change');
  const fill = async (i, k, v) => { await p.fill(`#pg-rows [data-pr="${i}"][data-k="${k}"]`, v); await p.dispatchEvent(`#pg-rows [data-pr="${i}"][data-k="${k}"]`, 'change'); };
  await fill(0, 'prog', 'Pflegeleicht'); await fill(0, 'temp', '30'); await fill(0, 'runs', '26'); await fill(0, 'kwh', '0,5'); await fill(0, 'l', '45');
  await p.click('#pg-addrow'); await fill(1, 'prog', 'Baumwolle'); await fill(1, 'temp', '60'); await fill(1, 'runs', '4'); await fill(1, 'kwh', '1,46'); await fill(1, 'l', '76,5');
  check(/30 18,84 kWh 1\.476 l/.test(await p.$eval('#pg-rows tfoot', e => e.innerText.replace(/\s+/g, ' '))), 'Summenzeile 30 Gänge, 18,84 kWh, 1.476 l');
  await p.click('#pg-save'); await p.waitForTimeout(400);
  const msg = await p.$eval('#pg-msg', e => e.innerText); console.log(msg);
  check(DB.device_programs.filter(r => r.month === '2026-08-01').length === 2, 'August: 2 Programme gespeichert');
  const aug = DB.device_daily.filter(r => r.day.startsWith('2026-08'));
  check(aug.length === 31 && Math.abs(aug.reduce((a, r) => a + r.kwh, 0) - 18.84) < 0.01, 'Monatssumme August übernommen (18,84 kWh)');
  check(/2 Programme gespeichert/.test(msg), 'Meldung');
  // erneut August wählen: Zeilen geladen, Bearbeiten ersetzt
  await p.fill('#pg-month', '2026-09'); await p.dispatchEvent('#pg-month', 'change');
  check(await p.$$eval('#pg-rows tbody tr', t => t.length) === 7, 'September lädt 7 gespeicherte Zeilen');
  const wt2 = await p.$$eval('#wt-kpis .kpi', ks => ks.map(k => k.innerText.replace(/\s+/g, ' ')).find(t => /Waschmaschine/.test(t)) || '');
  console.log(wt2); check(/45 Wäschen/.test(wt2), 'Wasser-Kachel: Aug+Sep = 30 + 15 Wäschen');
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(1000);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'Handy: kein waagrechtes Scrollen');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
{
  progMissing = true; const { p, ctx } = await open('meter'); await p.waitForTimeout(300);
  check(/UPDATE_V36\.sql/.test(await p.$eval('#pg-flags', e => e.innerText)), 'ohne Tabelle: Hinweis auf UPDATE_V36.sql');
  check(p.errs.length === 0, 'ohne Tabelle: keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
