// v0.51-Test: Leasing-Kilometer Tavascan (Abschnitt auf „Tanken & Laden“, Vertragsdaten, Schnellerfassung Kilometerstand).
// Eigenständig mit synthetischen Daten (kein data/ nötig).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v51-check.mjs
import { chromium } from 'playwright';
const uid = '11111111-1111-4111-8111-111111111111';
const days = []; for (let t = Date.parse('2026-06-01'); t <= Date.parse('2026-06-30'); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
const rd = []; let v = 1000; for (const d of [...days, '2026-07-01']) { rd.push({ id: 'r' + d, meter_id: 'as', day: d, value: v, source: 'manual', user_id: uid }); v += 5; }
const hours = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 17 ? 200 : 500));
const DB = {
  anker_daily: days.map(day => ({ user_id: uid, day, genutzt: 4, speicher_zu_haus: 1.5, speicher_entladung: 1.6, speicher_ladung: 2, solar_zu_speicher: 2, solar_zu_haus: 2.5, erzeugung: 7, netzimport: 2, einspeisung: 1, eigenverbrauch: 4 })),
  meters: [{ user_id: uid, id: 'as', name: 'Allgemeinstrom', grp: 'as', sort: 0 }], meter_readings: rd,
  grid_co2: [], room_climate: [], charge_log: [], car_log: [],
  settings: [{ user_id: uid, data: { battery: {}, pv: {}, amort: {}, cars: { ice: {}, ev: { start: '2026-12-15', months: 36, km: 10000 } } } }], payments: [], events: [], tariffs: [], installments: [], investments: [] };
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
const today = new Date().toISOString().slice(0, 10), back = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
{
  const { p, ctx } = await open('log'); await p.waitForTimeout(700);
  check(await p.isVisible('#lk-panel'), 'Abschnitt Leasing-Kilometer sichtbar (nicht eingeklappt)');
  check(/Übernahme am 15\.12\.2026/.test(await p.$eval('#lk-flags', e => e.innerText)) || today >= '2026-12-15', 'vor der Übernahme: Hinweis mit Datum');
  const ds = await p.evaluate(() => Chart.getChart(document.getElementById('lk-chart')).data.datasets.map(d => d.label));
  check(ds[0] === 'Budget laut Vertrag', 'Grafik zeigt Budgetlinie schon vor den ersten Daten');
  // Vertragsdaten: Übernahme in die Vergangenheit, Freigrenze und Sätze
  await p.click('#lk-cfg > summary');
  await p.fill('#lk-start', back(100)); await p.dispatchEvent('#lk-start', 'change');
  await p.fill('#lk-kmFree', '2500'); await p.dispatchEvent('#lk-kmFree', 'change');
  await p.fill('#lk-ctMore', '8'); await p.dispatchEvent('#lk-ctMore', 'change');
  await p.fill('#lk-kmStart', '15'); await p.dispatchEvent('#lk-kmStart', 'change'); await p.waitForTimeout(2500);
  const ev = DB.settings[0].data.cars.ev; check(ev.kmFree === 2500 && ev.ctMore === 8 && ev.kmStart === 15 && ev.start === back(100), 'Vertragsdaten gespeichert');
  check(/Noch kein Kilometerstand/.test(await p.$eval('#lk-flags', e => e.innerText)), 'ohne Stand: Hinweis zum Erfassen');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
{
  const { p, ctx } = await open('quick'); await p.waitForTimeout(600);
  await p.click('#q-grid [data-q="odo"]'); await p.waitForTimeout(300);
  check(await p.$eval('#q-car', e => e.value) === 'tavascan', 'Kilometerstand: Tavascan vorgewählt');
  await p.fill('#q-km', '4015'); await p.dispatchEvent('#q-km', 'input'); await p.waitForTimeout(200);
  const hint = await p.$eval('#q-hint', e => e.innerText); console.log(hint);
  check(/Leasing: 4\.000 km gefahren, Budget bis heute 2\.73\d km \(\+1\.2\d\d km\)/.test(hint), 'Hinweis rechnet gegen das Budget');
  await p.click('#q-save'); await p.waitForTimeout(500);
  const r = DB.car_log[0] || {}; check(r.car === 'tavascan' && r.category === 'Kilometerstand' && r.odometer === 4015 && r.amount === 0, 'als Fahrzeugbuch „Kilometerstand“ gespeichert');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
{
  const { p, ctx } = await open('log'); await p.waitForTimeout(800);
  const k = await p.$eval('#lk-kpis', e => e.innerText.replace(/\s+/g, ' ')); console.log(k);
  check(/4\.000 km Gefahren seit Übernahme/.test(k), 'Kennzahl gefahren');
  check(/\+1\.2\d\d km über dem Budget bis heute/.test(k), 'Kennzahl Vorsprung');
  check(/Prognose Rückgabe/.test(k) && /über dem Budget/.test(k) && /Nachzahlung ca\./.test(k), 'Prognose mit Mehrkilometer-Kosten');
  check(/pro Monat/.test(await p.$eval('#lk-note', e => e.innerText)), 'Spielraum pro Monat');
  const ds = await p.evaluate(() => Chart.getChart(document.getElementById('lk-chart')).data.datasets.map(d => d.label));
  check(ds.includes('Gefahren') && ds.includes('Prognose') && ds.includes('Freigrenze (ohne Kosten)'), 'Grafik: Budget, Freigrenze, gefahren, Prognose');
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(1000);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'Handy: kein waagrechtes Scrollen');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
