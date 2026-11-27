// v0.61-Test: Abschnitt „Stromverbrauch über den Tag“ (Zähler & Verbrauch) – Messtage (_haus) und Schätzung aus Anker × Profil.
// Eigenständig mit synthetischen Daten (kein data/ nötig).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v61-check.mjs
import { chromium } from 'playwright';
const uid = '11111111-1111-4111-8111-111111111111';
const days = []; for (let t = Date.parse('2026-09-01'); t <= Date.parse('2026-11-21'); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
const DB = {
  anker_daily: days.map(day => ({ user_id: uid, day, genutzt: 1.5, speicher_zu_haus: 0.4, speicher_entladung: 0.4, speicher_ladung: 0.3, solar_zu_speicher: 0.3, solar_zu_haus: 1.1, erzeugung: 1.4, netzimport: 6, netz_zu_haus: 6, einspeisung: 0, eigenverbrauch: 7.5, pv1: 0.4, pv2: 0.4, pv3: 0.3, pv4: 0.3 })),
  meters: [], meter_readings: [], grid_co2: [], room_climate: [], charge_log: [], car_log: [],
  settings: [{ user_id: uid, data: { battery: { reserve: 10, capGross: 12.5 }, pv: { kwp: 2.8 }, amort: {}, cars: { ice: {}, ev: { km: 10000, kwh100: 18, loss: 10, shHome: 85, start: '2026-12-04' } }, devices: [] } }],
  device_daily: [], device_hourly: ['2026-11-10', '2026-11-15', '2026-11-20'].map(day => ({ user_id: uid, device_id: '_haus', day, hours: [0.15,0.15,0.15,0.15,0.15,0.2,0.3,0.4,0.3,0.25,0.25,0.3,0.4,0.3,0.25,0.25,0.3,0.6,0.7,0.8,0.6,0.4,0.25,0.2] })), hp_energy: [], payments: [], events: [], tariffs: [{ user_id: uid, id: 't1', grp: 'as', name: 'Test', valid_from: '2026-01-01', ap_ct: 30, gp_eur_year: 100 }], installments: [], investments: [], tariffs: [{ user_id: uid, id: 't1', grp: 'as', name: 'ENTEGA', valid_from: '2026-04-02', ap_ct: 33.08, gp_eur_year: 169.22, boni_eur: 0 }] };
let priceCalls = 0, failOnce = true;
const posted = []; let failNext = false; const log = [];
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
      for (const r of JSON.parse(req.postData())) { const i = DB[t].findIndex(x => keys.every(k => x[k] === r[k])); if (i >= 0) DB[t][i] = { ...DB[t][i], ...r }; else DB[t].push(r); log.push(['upsert', t]); if (t === 'anker_daily') posted.push(r); }
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
  await ctx.route('**/functions/v1/**', r => { const u = new URL(r.request().url());
    if (u.searchParams.get('kind') !== 'price') return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ unix_seconds: [], co2eq: [] }) });
    priceCalls++; if (failOnce && priceCalls === 2) { failOnce = false; return r.fulfill({ status: 502, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'Energy-Charts: HTTP 429' }) }); }
    const a = Date.parse(u.searchParams.get('start') + 'T00:00:00+01:00') / 1000, z = Date.parse(u.searchParams.get('end') + 'T23:45:00+01:00') / 1000, ts = [], pr = [];
    for (let t = a; t <= z; t += 900) { ts.push(t); const h = new Date((t + 3600) * 1000).getUTCHours(); pr.push(h >= 17 && h < 21 ? 180 : h < 6 ? 50 : 90); }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ unix_seconds: ts, price: pr, unit: 'EUR / MWh' }) }); });
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && p.errs.push(m.text())); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8000/' + (page.includes('#') ? page : '#' + page)); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHLER ') + msg); if (!ok) failures++; };

{
  const { p, ctx } = await open('?unfold#meter');
  check(await p.isVisible('#hd-panel'), 'Abschnitt sichtbar');
  if (process.env.SHOT) await p.locator('#hd-panel').screenshot({ path: process.env.SHOT });
  const k = await p.textContent('#hd-kpis');
  check(/Ø Haushalt pro Tag/.test(k) && /Grundlast nachts/.test(k) && /Anteil 17–22 Uhr/.test(k) && /Stärkste Stunde/.test(k), 'Kennzahlen');
  check(/150 W/.test(k) && /aus 3 Messtagen/.test(k), 'Grundlast aus den Messtagen: 150 W');
  const n = await p.textContent('#hd-note');
  check(/3 Tage gemessen/.test(n) && /79 Tage geschätzt/.test(n) && /Lastprofil aus 3 Messtagen/.test(n), 'Hinweis gemessen/geschätzt: ' + n.slice(0, 80));
  const ds = await p.evaluate(() => Chart.getChart(document.getElementById('hd-chart'))?.data.datasets.map(d => d.label).join('|'));
  check(/Werktag \(59 Tage\)/.test(ds) && /Wochenende \(23 Tage\)/.test(ds) && !/Vergleich/.test(ds), 'Gesamter Zeitraum: Werktag/Wochenende, kein Vergleich: ' + ds);
  const tr = await p.evaluate(() => Chart.getChart(document.getElementById('hd-trend'))?.data.datasets.map(d => d.label).join('|'));
  check(tr === 'Tag (Anker)|Tag mit Stundenwerten|Ø 7 Tage|Ø 30 Tage', 'Tagesverlauf mit gleitendem Ø 7/30');
  check(/82 Tage/.test(await p.textContent('#hd-kpis')), 'gesamter Zeitraum: 82 Tage');
  await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(300); await p.selectOption('#pb-key', '2026-11'); await p.waitForTimeout(300);
  await p.selectOption('#pb-cmp', 'prev'); await p.waitForTimeout(500);
  const k2 = await p.textContent('#hd-kpis');
  check(/01\.11\.2026–21\.11\.2026, 21 Tage/.test(k2) && /Vergleich/.test(k2), 'Monat November mit Vorperiode: ' + k2.slice(0, 120));
  const ds2 = await p.evaluate(() => Chart.getChart(document.getElementById('hd-chart'))?.data.datasets.map(d => d.label).join('|'));
  check(/Ø Vergleich 01\.10\.2026–31\.10\.2026 \(31 Tage\)/.test(ds2), 'Linie Vergleichszeitraum: ' + ds2);
  await p.selectOption('#pb-cmp', 'none'); await p.selectOption('#pb-mode', 'custom'); await p.waitForTimeout(300);
  await p.fill('#pb-from', '2026-06-01'); await p.dispatchEvent('#pb-from', 'change'); await p.fill('#pb-to', '2026-06-30'); await p.dispatchEvent('#pb-to', 'change'); await p.waitForTimeout(400);
  check(/keine Verbrauchsdaten/.test(await p.textContent('#hd-flags')), 'Monat ohne Daten: Hinweis');
  const errs = p.errs.filter(e => !/502 \(Bad Gateway\)/.test(e)); check(!errs.length, 'keine Skriptfehler (gewollter 502 ausgenommen) ' + errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
