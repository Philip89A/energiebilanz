// v0.26-Test: Durchschnitt als Referenz im Tagesprofil Wärmepumpe (Grafik, Tabellenspalte, gleiche Stunden, ohne
// Desinfektionstage) und Start auf dem neuesten Tag. Simuliertes Supabase mit data/seed_state.json, erfundene Stundenwerte.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v26-check.mjs
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
DB.weather_daily = [];
const day = (d, el, peak = 55, aux = 0, hours = 24) => Array.from({ length: hours }, (_, h) => ({ user_id: uid, grain: 'hour', ts: `${d}T${String(h).padStart(2, '0')}:00`,
  el_hp: h === 15 ? el : 0.02, el_heat: 0, el_cool: 0, el_dhw: h === 15 ? el : 0, el_aux: h === 16 ? aux : 0, el_aux_heat: 0, el_aux_dhw: h === 16 ? aux : 0,
  heat_heat: 0, heat_dhw: h === 15 ? el * 3 : 0, heat_cool: 0, t_out: 10 + h / 4, t_flow: 30, t_dhw: h === 16 ? peak : 45 }));
DB.hp_energy = [...day('2026-03-01', 2), ...day('2026-03-02', 2), ...day('2026-03-03', 2, 68, 0.5), ...day('2026-03-04', 4), ...day('2026-03-05', 2),
  ...day('2026-03-06', 2), ...day('2026-03-07', 2), ...day('2026-03-08', 2), ...day('2026-03-09', 3, 55, 0, 10)];

let { p, ctx } = await open('meter');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
ok(await p.inputValue('#hpd-a') === '2026-03-09' && await p.inputValue('#hpd-b') === '', 'Start: neuester Tag, kein Vergleich');
let ds = await p.evaluate(() => window.__ebCharts['hp-hours'].data.datasets.map(d => ({ l: d.label, data: d.data, y: d.yAxisID, stack: d.stack })));
const avgEl = ds.find(d => d.l === 'Ø Strom (7 Tage)'), avgT = ds.find(d => d.l === 'Ø Warmwasser °C (7 Tage)');
ok(avgEl && avgT && avgEl.stack === 'avg' && avgT.y === 'y1', 'Ø-Linien Strom und Warmwasser °C (7 Tage)');
ok(Math.abs(avgEl.data[15] - 16 / 7) < 1e-9 && avgT.data[16] === 55, `Ø um 15 Uhr ${avgEl.data[15].toFixed(3)} kWh (ohne Desinfektionstag 03.03.)`);
let t = await txt(p, '#hpd-tbl');
ok(t.includes('Ø 7 Tage') && t.includes('gleiche 10 Stunden'), 'Tabellenspalte Ø mit gleichen Stunden');
const ref = await txt(p, '#hpd-ref');
ok(ref.includes('7 vollständige Tage vor dem 09.03.2026') && ref.includes('ohne Desinfektionstage 03.03.2026') && ref.includes('nur für die 10 Stunden'), 'Hinweis: ' + ref);
// Vergleichstag: Ø bleibt
await p.selectOption('#hpd-b', '2026-03-04'); await p.waitForTimeout(300);
ds = await p.evaluate(() => window.__ebCharts['hp-hours'].data.datasets.map(d => d.label));
ok(ds.some(l => l.startsWith('Ø Strom')) && ds.some(l => l.includes('04.03')), 'Ø auch mit Vergleichstag');
ok((await p.$$eval('#hpd-tbl thead th', h => h.length)) === 4, 'Tabelle: Tag, Vergleich, Ø');
// vollständiger Tag: 24 Stunden, Ø über die 7 Tage davor
await p.selectOption('#hpd-a', '2026-03-08'); await p.waitForTimeout(300);
t = await txt(p, '#hpd-tbl');
ok(t.includes('24 von 24') && (await txt(p, '#hpd-ref')).includes('6 vollständige Tage'), 'Tag 08.03.: Ø aus 6 Tagen (01.–07. ohne 03.)');
// erster Tag: kein Ø
await p.selectOption('#hpd-a', '2026-03-01'); await p.waitForTimeout(300);
ok((await txt(p, '#hpd-ref')).includes('fehlen vollständige Tage') && (await p.$$eval('#hpd-tbl thead th', h => h.length)) <= 3, 'erster Tag: kein Ø, Hinweis');
// Neustart: wieder neuester Tag
await p.reload(); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(300);
ok(await p.inputValue('#hpd-a') === '2026-03-09' && await p.inputValue('#hpd-b') === '', 'nach Neustart wieder neuester Tag');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
