// v0.32-Test: Seite „Wärmepumpe“ getrennt, Geräte (Tapo-CSV, Meross-Excel, Monatswerte von Hand), Anteil am Allgemeinstrom.
// Simuliertes Supabase mit data/seed_state.json; Gerätedaten synthetisch, die Excel-Datei wird hier mit SheetJS erzeugt.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v32-check.mjs
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
const XLSX = new Function(readFileSync(base + 'vendor/xlsx.core.min.js', 'utf8') + ';return XLSX;')();
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHL ') + msg); if (!ok) failures++; };
const txt = (p, s) => p.$eval(s, e => e.innerText).catch(() => '');
// Tapo-CSV: Gefrierschrank, Jan 2025 – Mär 2026 (Seed-Zeitraum), 0,45 kWh/Tag, Jan 2026 0,6
const days = []; for (let d = new Date('2025-01-01T00:00:00Z'); d <= new Date('2026-03-31T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
const tapo = 'Date\t,Power Consumption-(kWh)\t\n2024-12-31\t,0.000\t\n' + days.map(d => `${d}\t,${d >= '2026-01-01' ? '0.600' : '0.450'}\t`).join('\n') + '\n';
// Meross: Lüftung, Monatssummen Dez 2025 – Feb 2026, Tageswerte März 2026 (Export am 20.03. um 12 Uhr)
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['2026/03/01 00:00:00 - 2026/03/20 12:00:00', 'Energieverbrauch (kWh)'], ...Array.from({ length: 20 }, (_, i) => [`2026/03/${String(i + 1).padStart(2, '0')}`, 0.5])]), 'Monat');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['2025/11/01 00:00:00 - 2026/03/20 12:00:00', 'Energieverbrauch (kWh)'], ['2025/11', 0], ['2025/12', 7.75], ['2026/01', 6.2], ['2026/02', 5.6], ['2026/03', 9.8]]), 'Jahr');
const xls = Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'biff8' }));
const file = (name, buffer, mimeType = 'text/csv') => ({ name, mimeType, buffer });
{
  const { p, ctx } = await open('hp');
  check(await p.isVisible('#hp-panel') && await p.isVisible('#wx-wp-panel') && await p.isVisible('#mt-wp'), 'Seite Wärmepumpe: Gerätewerte, Wetterbereinigung, alt gegen neu');
  check(await p.isVisible('#period-bar'), 'Zeitraumleiste auf „Wärmepumpe“');
  check((await txt(p, '#mt-wp')).includes('Tausch am'), 'Vergleich alt/neu auf der neuen Seite');
  const nav = await txt(p, '#snav');
  check(nav.includes('Zähler & Verbrauch') && nav.includes('Wärmepumpe'), 'Menü: beide Seiten');
  await p.goto('http://localhost:8000/#meter'); await p.waitForTimeout(400);
  check(!(await p.isVisible('#hp-panel')) && await p.isVisible('#dv-panel') && await p.isVisible('#mt-rate'), 'Zähler & Verbrauch ohne Wärmepumpen-Teil, mit Geräten');
  check((await txt(p, '#dv-flags')).includes('Noch keine Geräte'), 'ohne Geräte: Hinweis');
  // Import
  await p.goto('http://localhost:8000/#data'); await p.waitForTimeout(300);
  await p.setInputFiles('#dv-file', [file('Power Monitor Day Data - Gefrierschrank - 20260401.csv', Buffer.from(tapo)), file('Energieverbrauch_.xls', xls, 'application/vnd.ms-excel')]);
  await p.waitForSelector('#dvi-save', { timeout: 8000 });
  let t = await txt(p, '#dv-result');
  check(t.includes('Tapo') && t.includes('Meross') && t.includes('neues Gerät'), 'Vorschau beider Dateien');
  check(await p.$eval('[data-dvi="0"]', e => e.value) === 'new' && await p.$eval('[data-dvn="0"]', e => e.value) === 'Gefrierschrank', 'Tapo: Gerät aus dem Dateinamen');
  await p.selectOption('[data-dvi="1"]', 'new'); await p.waitForTimeout(150);
  await p.fill('[data-dvn="1"]', 'Lüftung'); await p.dispatchEvent('[data-dvn="1"]', 'change'); await p.waitForTimeout(150);
  await p.click('#dvi-save'); await p.waitForTimeout(800);
  const rows = DB.device_daily || [], devs = DB.settings[0].data.devices || [];
  const gf = devs.find(d => d.name === 'Gefrierschrank'), lu = devs.find(d => d.name === 'Lüftung');
  check(gf && lu, 'zwei Geräte angelegt');
  check(rows.filter(r => r.device_id === gf?.id).length === days.length, `Gefrierschrank: ${days.length} Tage, Null vor Messbeginn weg`);
  const lr = rows.filter(r => r.device_id === lu?.id);
  check(lr.length === 31 + 31 + 28 + 19 && lr.find(r => r.day === '2025-12-01')?.src === 'month' && !lr.some(r => r.day === '2026-03-20'), `Lüftung: Monate verteilt, Exporttag weg (${lr.length})`);
  check((await txt(p, '#dv-result')).includes('Tageswerte gespeichert'), 'Meldung gespeichert');
  // Anzeige
  await p.goto('http://localhost:8000/#meter'); await p.waitForTimeout(300);
  await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(200); await p.selectOption('#pb-key', '2026-01'); await p.waitForTimeout(500);
  t = await txt(p, '#dv-tbl');
  check(t.includes('Gefrierschrank') && t.includes('18,6 kWh') && t.includes('0,60'), 'Januar: Gefrierschrank 18,6 kWh, 0,60 kWh/Tag');
  check(/0,45 \(\+33 %\)/.test(t), 'Vorjahr mit Veränderung');
  check(t.includes('teils aus Monatssummen') && t.includes('nicht gemessen'), 'Lüftung aus Monatssummen markiert, Rest ausgewiesen');
  check((await txt(p, '#dv-flags')).includes('mehr als im Vorjahr'), 'Hinweis: Gefrierschrank über Vorjahr');
  const ds = await p.evaluate(() => window.__ebCharts['dv-chart'].data.datasets.map(d => d.label));
  check(ds.includes('Gefrierschrank') && ds.includes('Lüftung'), 'Grafik je Gerät');
  // Waschmaschine von Hand
  await p.click('#dv-add'); await p.waitForTimeout(300);
  const i = (await p.$$('#dv-list tbody tr')).length - 1;
  await p.fill(`[data-dv="${i}"][data-k="name"]`, 'Waschmaschine'); await p.dispatchEvent(`[data-dv="${i}"][data-k="name"]`, 'change'); await p.waitForTimeout(300);
  const wm = (await p.$$eval('#dvm-dev option', o => o.map(x => [x.value, x.textContent]))).find(x => x[1] === 'Waschmaschine');
  await p.selectOption('#dvm-dev', wm[0]); await p.fill('#dvm-month', '2026-02'); await p.fill('#dvm-kwh', '14'); await p.fill('#dvm-l', '1.120'); await p.fill('#dvm-runs', '28');
  await p.click('#dvm-save'); await p.waitForTimeout(600);
  const wr = (DB.device_daily || []).filter(r => r.device_id === wm[0]);
  check(wr.length === 28 && Math.abs(wr.reduce((s, r) => s + r.kwh, 0) - 14) < 1e-6 && Math.abs(wr.reduce((s, r) => s + r.water_l, 0) - 1120) < 1e-6, 'Monatswerte: 28 Tage, 14 kWh, 1.120 l');
  check((await txt(p, '#dvm-msg')).includes('gespeichert'), 'Meldung Monat gespeichert');
  await p.selectOption('#pb-key', '2026-02'); await p.waitForTimeout(400);
  check((await txt(p, '#dv-tbl')).includes('1.120 l'), 'Wasser der Waschmaschine in der Tabelle');
  check(!p.errs.length, 'keine Skriptfehler ' + p.errs.join(' | '));
  await ctx.close();
}
// Gast: Import gesperrt
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
