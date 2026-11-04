// v0.49-Test: Raumklima-Import erkennt Tapo-Export, überspringt markierte Werte, überschreibt keine vollständigen Tage.
// Eigenständig mit synthetischen Daten (kein data/ nötig).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v49-check.mjs
import { chromium } from 'playwright';
const uid = '11111111-1111-4111-8111-111111111111';
const days = []; for (let t = Date.parse('2026-06-01'); t <= Date.parse('2026-06-30'); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
const rd = []; let v = 1000; for (const d of [...days, '2026-07-01']) { rd.push({ id: 'r' + d, meter_id: 'as', day: d, value: v, source: 'manual', user_id: uid }); v += 5; }
const hours = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 17 ? 200 : 500));
const DB = {
  anker_daily: days.map(day => ({ user_id: uid, day, genutzt: 4, speicher_zu_haus: 1.5, speicher_entladung: 1.6, speicher_ladung: 2, solar_zu_speicher: 2, solar_zu_haus: 2.5, erzeugung: 7, netzimport: 2, einspeisung: 1, eigenverbrauch: 4 })),
  meters: [{ user_id: uid, id: 'as', name: 'Allgemeinstrom', grp: 'as', sort: 0 }], meter_readings: rd,
  grid_co2: [], room_climate: [],
  settings: [{ user_id: uid, data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: {} } } }], payments: [], events: [], tariffs: [], installments: [], investments: [] };
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
const H = '2026/06/10 00:00:00 - 2026/06/11 00:00:00,Temperatur(℃),Abnormal,Luftfeuchtigkeit(%),Abnormal\n';
const day = (d, n) => Array.from({ length: n }, (_, i) => { const m = i * 15; return `${d} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00,21.5,,48,`; }).join('\n');
{
  const { p, ctx } = await open('?unfold#data'); await p.waitForTimeout(600);
  check(/Govee- oder Tapo-Export/.test(await p.$eval('#rk-import h2', e => e.textContent)), 'Überschrift nennt Tapo');
  await p.setInputFiles('#rk-file', { name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from(H + '2026/06/10 00:00:00,27.3,*,42,\n' + day('2026/06/10', 96) + '\n' + day('2026/06/11', 8) + '\n') });
  await p.waitForTimeout(400);
  const t = await p.$eval('#rk-result', e => e.innerText.replace(/\s+/g, ' ')); console.log(t);
  check(/Tapo/.test(t) && /1 markierte Werte übersprungen/.test(t), 'Format Tapo erkannt, markierter Wert übersprungen');
  check(/ 2 10\.06\.2026 – 11\.06\.2026 1/.test(t), '2 Tage, davon 1 vollständig');
  await p.fill('#rk-result input[data-rkn="0"]', 'Wohnzimmer'); await p.dispatchEvent('#rk-result input[data-rkn="0"]', 'change'); await p.waitForTimeout(200);
  await p.click('#rki-save'); await p.waitForTimeout(600);
  check(/2 Tage gespeichert/.test(await p.$eval('#rk-result', e => e.innerText)), '2 Tage gespeichert');
  check(DB.room_climate.length === 2 && DB.room_climate.every(r => r.room === 'Wohnzimmer') && DB.room_climate.find(r => r.day === '2026-06-10').n === 96, 'in room_climate: Raum Wohnzimmer, 96 Werte am 10.06.');
  // kürzerer Export desselben Tages überschreibt den vollständigen Tag nicht
  await p.setInputFiles('#rk-file', { name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from(H + day('2026/06/10', 10) + '\n') }); await p.waitForTimeout(400);
  await p.selectOption('#rk-result select[data-rki="0"]', 'Wohnzimmer'); await p.waitForTimeout(200);
  await p.click('#rki-save'); await p.waitForTimeout(600);
  const msg = await p.$eval('#rk-result', e => e.innerText);
  check(/0 Tage gespeichert\. 1 vorhandene Tage mit mehr Messwerten behalten/.test(msg), 'kürzerer Export: vorhandener Tag behalten');
  check(DB.room_climate.find(r => r.day === '2026-06-10').n === 96, 'Datenbank unverändert (96 Werte)');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
