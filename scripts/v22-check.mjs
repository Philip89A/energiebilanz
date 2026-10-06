// v0.22/v0.24-Test: Spritpreis je Tankvorgang inkl. Teilbetankungen, Ø-Linie und gleitende Durchschnitte (v0.24 statt Trendgeraden).
// Simuliertes Supabase mit data/seed_state.json, zusätzlich erfundene Tankvorgänge.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v22-check.mjs
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
DB.hp_energy = []; DB.weather_daily = [];
// erfundene Tankvorgänge: zwei Volltankungen mit einer Teilbetankung dazwischen
DB.fuel_log = [...(DB.fuel_log || []),
  { id: 'f1', user_id: uid, day: '2030-01-05', odometer: 900000, liters: 40, amount: 72, fuel_type: 'Super E10', full_tank: true },
  { id: 'f2', user_id: uid, day: '2030-01-20', odometer: 900300, liters: 20, amount: 38, fuel_type: 'Super E10', full_tank: false },
  { id: 'f3', user_id: uid, day: '2030-02-04', odometer: 900700, liters: 25, amount: 50, fuel_type: 'Super E10', full_tank: true },
  ...[['2030-03-02', 30, 2.05], ['2030-03-18', 32, 2.10], ['2030-04-03', 28, 1.95], ['2030-04-19', 31, 2.00], ['2030-05-05', 29, 2.08]]
    .map(([day, l, pr], i) => ({ id: 'f' + (4 + i), user_id: uid, day, odometer: 901200 + i * 500 + (i % 2) * 40, liters: l, amount: +(l * pr).toFixed(2), fuel_type: 'Super E10', full_tank: true }))];
const fuel = p => p.evaluate(() => { const c = window.__ebCharts['lg-fuel']; return { labels: c.options.scales.x.labels, ds: c.data.datasets.map(d => ({ l: d.label, data: d.data, bg: d.pointBackgroundColor, dash: d.borderDash })) }; });

let { p, ctx } = await open('log');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
let f = await fuel(p);
const nFill = DB.fuel_log.filter(x => +x.liters > 0).length;
const price = f.ds.find(d => d.l === '€/l je Tankvorgang');
ok(price && price.data.length === nFill, `€/l für jeden Tankvorgang (${price?.data.length} von ${nFill})`);
ok(f.ds.some(d => d.l === 'Ø €/l im Zeitraum') && f.ds.some(d => d.l === 'Ø 5 Tankvorgänge €/l') && f.ds.some(d => d.l === 'Ø 3 Volltank-Intervalle l/100 km'), 'Ø-Linie und gleitende Durchschnitte vorhanden');
ok(!f.ds.some(d => d.l.startsWith('Trend')), 'v0.24: keine Trendgeraden mehr');
// gleitender Ø am letzten Tankvorgang: Kosten ÷ Liter der letzten 5; Verbrauch: Liter ÷ km der letzten 3 Volltank-Intervalle
const F = DB.fuel_log.filter(x => x.day >= '2030').sort((a, c) => a.day.localeCompare(c.day)), l5 = F.slice(-5);
const mp = f.ds.find(d => d.l === 'Ø 5 Tankvorgänge €/l').data.at(-1);
ok(mp.x === '2030-05-05' && Math.abs(mp.y - l5.reduce((a, x) => a + x.amount, 0) / l5.reduce((a, x) => a + x.liters, 0)) < 1e-9, `Ø 5 Tankvorgänge = Kosten ÷ Liter (${mp.y.toFixed(3)})`);
const iv = F.slice(-4), kmS = iv.at(-1).odometer - iv[0].odometer, lS = iv.slice(1).reduce((a, x) => a + x.liters, 0);
const mc = f.ds.find(d => d.l === 'Ø 3 Volltank-Intervalle l/100 km').data.at(-1);
ok(Math.abs(mc.y - lS / kmS * 100) < 1e-9, `Ø 3 Intervalle = Liter ÷ km (${mc.y.toFixed(2)} l/100 km)`);
let t0 = await txt(p, '#lg-fuel-note');
ok(/Spritpreis [\d,]+ €\/l \(letzte 5 Tankvorgänge, 5 Tankvorgänge davor [\d,]+ \([+−]/.test(t0) && /Verbrauch [\d,]+ l\/100 km \(letzte 3 Volltank-Intervalle, davor/.test(t0), 'Hinweis: aktueller Ø und Vergleich: ' + t0.slice(0, 220));
ok(f.labels.length > 2 && f.labels.every((d, i, a) => !i || a[i - 1] < d), 'Datumsachse sortiert');
// Zeitraum: Januar bis Februar 2030 (erfundene Werte)
await p.selectOption('#pb-mode', 'custom'); await p.waitForTimeout(150);
await p.fill('#pb-from', '2030-01-01'); await p.dispatchEvent('#pb-from', 'change'); await p.fill('#pb-to', '2030-02-28'); await p.dispatchEvent('#pb-to', 'change'); await p.waitForTimeout(400);
f = await fuel(p);
const pr = f.ds.find(d => d.l === '€/l je Tankvorgang');
ok(JSON.stringify(pr.data.map(q => [q.x, +q.y.toFixed(3), q.full])) === JSON.stringify([['2030-01-05', 1.8, true], ['2030-01-20', 1.9, false], ['2030-02-04', 2, true]]), 'Zeitraum: drei Preise inkl. Teilbetankung');
ok(pr.bg[1] !== pr.bg[0] && pr.bg[0] === pr.bg[2], 'Teilbetankung als hohler Punkt');
const avg = f.ds.find(d => d.l === 'Ø €/l im Zeitraum');
ok(Math.abs(avg.data[0].y - 160 / 85) < 1e-9, 'Ø nach Litern gewichtet (160 € / 85 l)');
const mj = f.ds.find(d => d.l === 'Ø 5 Tankvorgänge €/l');
ok(mj.data.length === 1 && mj.data[0].x === '2030-02-04', 'Ø €/l erst ab 3 Tankvorgängen im Fenster');
const c100 = f.ds.find(d => d.l === 'l/100 km');
ok(c100.data.length === 1 && Math.abs(c100.data[0].y - 45 / 700 * 100) < 1e-9, 'l/100 km nur zwischen Volltankungen (45 l / 700 km)');
ok(!f.ds.some(d => d.l === 'Ø 3 Volltank-Intervalle l/100 km'), 'kein Verbrauchs-Ø bei nur einem Intervall');
let t = await txt(p, '#lg-fuel-note');
ok(t.includes('3 Tankvorgänge, davon 1 Teilbetankung (hohler Punkt)') , 'Hinweis: ' + t.slice(0, 160));
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

// v0.23: in „Verbrauch pro Tag zwischen den Ablesungen“ ersetzt der gleitende Durchschnitt die Trendgerade (scripts/v23-check.mjs)
console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
