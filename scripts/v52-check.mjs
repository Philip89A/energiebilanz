// v0.52-Test: Schätzwert je Tag für ein Gerät ohne Messung (Geräteliste, Tabelle, Grafik).
// Eigenständig mit synthetischen Daten (kein data/ nötig).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v52-check.mjs
import { chromium } from 'playwright';
const uid = '11111111-1111-4111-8111-111111111111';
const days = []; for (let t = Date.parse('2026-06-01'); t <= Date.parse('2026-06-30'); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
const rd = []; let v = 1000; for (const d of [...days, '2026-07-01']) { rd.push({ id: 'r' + d, meter_id: 'as', day: d, value: v, source: 'manual', user_id: uid }); v += 5; }
const hours = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 17 ? 200 : 500));
const DB = {
  anker_daily: days.map(day => ({ user_id: uid, day, genutzt: 4, speicher_zu_haus: 1.5, speicher_entladung: 1.6, speicher_ladung: 2, solar_zu_speicher: 2, solar_zu_haus: 2.5, erzeugung: 7, netzimport: 2, einspeisung: 1, eigenverbrauch: 4 })),
  meters: [{ user_id: uid, id: 'as', name: 'Allgemeinstrom', grp: 'as', sort: 0 }], meter_readings: rd,
  grid_co2: [], room_climate: [], charge_log: [], car_log: [],
  settings: [{ user_id: uid, data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} }, devices: [{ id: 'lueftung', name: 'Lüftung', from: '2026-06-01' }] } }],
  device_daily: days.filter(d => d <= '2026-06-20').map(day => ({ user_id: uid, device_id: 'lueftung', day, kwh: 0.5, src: 'day' })), payments: [], events: [], tariffs: [], installments: [], investments: [] };
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
  await ctx.route('**/functions/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ unix_seconds: [], co2eq: [] }) }));
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8000/' + (page.includes('#') ? page : '#' + page)); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHLER ') + msg); if (!ok) failures++; };
{
  const { p, ctx } = await open('?unfold#meter'); await p.waitForTimeout(700);
  await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(300); await p.selectOption('#pb-key', '2026-06'); await p.waitForTimeout(500);
  const before = await p.$eval('#dv-tbl', e => e.innerText.replace(/\s+/g, ' ')); console.log(before);
  check(/Lüftung 10,0 kWh 0,50/.test(before) && !/geschätzt/.test(before), 'vorher: 20 gemessene Tage, nichts geschätzt');
  await p.fill('#dv-list input[data-k="est"]', '0.54'); await p.dispatchEvent('#dv-list input[data-k="est"]', 'change'); await p.waitForTimeout(300);
  await p.fill('#dv-list input[data-k="estFrom"]', '2026-06-21'); await p.dispatchEvent('#dv-list input[data-k="estFrom"]', 'change'); await p.waitForTimeout(800);
  const after = await p.$eval('#dv-tbl', e => e.innerText.replace(/\s+/g, ' ')); console.log(after);
  check(/Lüftung.*10 Tage geschätzt \(0,54 kWh\/Tag\) 15,4 kWh/.test(after), 'nachher: 10 Tage geschätzt, Summe 10,0 + 5,4 kWh');
  const v = await p.evaluate(() => Chart.getChart(document.getElementById('dv-chart')).data.datasets.find(d => d.label === 'Lüftung').data.slice(-1)[0]);
  check(Math.abs(v - 0.54) < 1e-9, 'Grafik: letzter Tag mit Schätzwert');
  await p.waitForTimeout(2200);
  const d = DB.settings[0].data.devices[0]; check(d.est === '0.54' && d.estFrom === '2026-06-21', 'in den Einstellungen gespeichert');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
