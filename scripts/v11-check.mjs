// v0.11-Test: Import des Wärmepumpen-Exports (Upload, Speichern, Auswertung „Wärmepumpe laut Gerät“), PV und Wetter
// je Tag, Wetter im Tooltip, App ohne hp_energy-Tabelle. Supabase und Open-Meteo simuliert, Datei tests/fixture_hp.csv.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v11-check.mjs
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
DB.weather_daily = []; DB.hp_energy = [];
DB.settings[0].data = { ...DB.settings[0].data, wx: { name: 'Teststadt', lat: 1.23, lon: 6.79 } };

// 1 Meter-Seite ohne Gerätedaten: Hinweis
let { p, ctx } = await open('meter');
ok(!p.errs.length, 'Zähler-Seite ohne Fehler: ' + p.errs.join(' | '));
ok((await txt(p, '#hp-flags')).includes('Noch keine Gerätedaten'), 'Hinweis ohne Gerätedaten');
await ctx.close();

// 2 Upload: Datei wählen → Vorschau → Speichern
({ p, ctx } = await open('data'));
await p.setInputFiles('#hp-file', base + 'tests/fixture_hp.csv'); await p.waitForTimeout(300);
ok((await txt(p, '#hp-result')).includes('2 Monate, 2 Tage, 1 Stunden'), 'Vorschau zeigt Monate, Tage, Stunden');
await p.click('#hp-save'); await p.waitForTimeout(800);
ok(DB.hp_energy.length === 5 && DB.hp_energy.every(r => r.user_id && r.grain && r.ts), `5 Zeilen in Supabase (${DB.hp_energy.length})`);
ok((await txt(p, '#hp-result')).includes('5 Zeilen gespeichert'), 'Meldung nach dem Speichern');
// erneut hochladen überschreibt statt zu verdoppeln
await p.setInputFiles('#hp-file', base + 'tests/fixture_hp.csv'); await p.waitForTimeout(300); await p.click('#hp-save'); await p.waitForTimeout(800);
ok(DB.hp_energy.length === 5, 'Zweiter Upload überschreibt (keine Doppelten)');
await p.setInputFiles('#hp-file', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('Datum;Wert\n2025-01-01;1') }); await p.waitForTimeout(300);
ok((await txt(p, '#hp-result')).includes('Unbekanntes Format'), 'Falsche Datei wird abgelehnt');
await ctx.close();

// 3 Auswertung auf der Zähler-Seite
({ p, ctx } = await open('meter'));
ok(!p.errs.length, 'Zähler-Seite mit Gerätedaten ohne Fehler: ' + p.errs.join(' | '));
const k = await txt(p, '#hp-kpis');
ok(k.includes('550 kWh') && k.includes('Arbeitszahl') && k.includes('Anteil Warmwasser'), 'Kennzahlen Strom, Arbeitszahl, Warmwasser-Anteil');
ok(await p.evaluate(() => window.__ebCharts['hp-month']?.data.datasets.length) === 5, 'Monatsgrafik mit Heizung, Warmwasser, Kühlung, Zähler, Arbeitszahl');
ok(await p.evaluate(() => window.__ebCharts['hp-day']?.data.labels.length) === 2, 'Tagesgrafik mit 2 Tagen');
ok((await p.$$('#hp-tbl tbody tr')).length === 2, 'Monatstabelle');
await ctx.close();

// 4 PV und Wetter je Tag bei kurzem Zeitraum; Wetter im Tooltip der Tagesgrafik
({ p, ctx } = await open('data')); await p.waitForTimeout(1500); await ctx.close();   // Wetter laden (simuliert)
({ p, ctx } = await open('pv'));
await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(400);
ok((await txt(p, '#wx-pv-panel h2')).includes('je Tag'), 'PV und Wetter: Tagesauflösung bei einem Monat');
const nDays = await p.evaluate(() => window.__ebCharts['wx-pv-chart']?.data.labels.length);
ok(nDays >= 20 && nDays <= 31, `Tageswerte in der Grafik (${nDays})`);
const foot = await p.evaluate(() => { const ch = window.__ebCharts['pv-yield']; const f = ch.options.plugins.tooltip.callbacks.footer; return f ? f([{ dataIndex: 0 }]) : ''; });
ok(/Wetter: Ø .* °C/.test(foot), 'Tooltip zeigt das Wetter des Tages: ' + foot);
await p.selectOption('#pb-mode', 'all'); await p.waitForTimeout(400);
ok((await txt(p, '#wx-pv-panel h2')).includes('je Monat'), 'Gesamter Zeitraum: Monate');
await ctx.close();

// 5 Ohne Tabelle hp_energy: Hinweis auf SQL-Update, App läuft
hpMissing = true;
({ p, ctx } = await open('data'));
ok(!p.errs.length && (await txt(p, '#hp-result')).includes('UPDATE_V11.sql'), 'Hinweis auf UPDATE_V11.sql');
await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
