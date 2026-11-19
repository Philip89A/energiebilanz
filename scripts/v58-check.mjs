// v0.58-Test: Vergleich öffentliches Laden (Tarife mit Grundgebühr, ohne Blockiergebühr), „Was wäre, wenn“, Fremdladung im Ladebuch.
// Eigenständig mit synthetischen Daten (kein data/ nötig).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v58-check.mjs
import { chromium } from 'playwright';
const uid = '11111111-1111-4111-8111-111111111111';
const days = []; for (let t = Date.parse('2026-11-01'); t <= Date.parse('2026-11-15'); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
const DB = {
  anker_daily: days.map(day => ({ user_id: uid, day, genutzt: 1.5, speicher_zu_haus: 0.4, speicher_entladung: 0.4, speicher_ladung: 0.3, solar_zu_speicher: 0.3, solar_zu_haus: 1.1, erzeugung: 1.4, netzimport: 6, netz_zu_haus: 6, einspeisung: 0, eigenverbrauch: 7.5, pv1: 0.4, pv2: 0.4, pv3: 0.3, pv4: 0.3 })),
  meters: [], meter_readings: [], grid_co2: [], room_climate: [], car_log: [],
  settings: [{ user_id: uid, data: { battery: {}, pv: { kwp: 1 }, amort: { priceInc: 0, degr: 0, years: 10, feedin: 0 }, cars: { ice: {}, ev: { start: '2026-11-05', km: 10000, kwh100: 19, loss: 0, shHome: 100, shPV: 0, pricePublic: 0.49 } }, devices: [] } }],
  device_daily: [], device_hourly: [], hp_energy: [], payments: [], events: [], tariffs: [{ user_id: uid, id: 't1', grp: 'as', name: 'Test', valid_from: '2026-01-01', ap_ct: 30, gp_eur_year: 100 }], installments: [], investments: [{ user_id: uid, id: 'i1', name: 'PV', day: '2026-11-01', cost: 1500, category: 'pv' }, { user_id: uid, id: 'i2', name: 'Wallbox', day: '2026-11-01', cost: 1200, category: 'wallbox' }],
  charge_log: [{ user_id: uid, id: 'c1', day: '2026-11-10', kwh: 45, amount: 0, location: 'zu Hause', odometer: 500, guest: false }] };
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
  await ctx.route('**/functions/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ unix_seconds: [], co2eq: [] }) }));
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && p.errs.push(m.text())); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8000/' + (page.includes('#') ? page : '#' + page)); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHLER ') + msg); if (!ok) failures++; };
{
  const { p, ctx } = await open('?unfold#amort');
  const t = await p.textContent('#am-pub');
  check(/Gerechnet wird mit EnBW L/.test(t), 'automatisch günstigster: EnBW L bei 1.900 kWh');
  check(/Ohne Blockiergebühr/.test(t) && /11,99 € Grundgebühr/.test(t), 'Grundgebühr genannt, ohne Blockiergebühr');
  check((await p.textContent('#am-wb-note')).includes('gegenüber EnBW L'), 'Wallbox-Hinweis nennt den Vergleichstarif');
  check(!/Break-even mit/.test(t), 'ohne Vergleich keine Zusatzkennzahlen');
  await p.selectOption('#pub-alt', 'EnBW S'); await p.waitForTimeout(300);
  const t2 = await p.textContent('#am-pub');
  check(/Break-even mit EnBW S/.test(t2) && /gegenüber Standard/.test(t2), '„Was wäre, wenn“ EnBW S zeigt Break-even und Differenz');
  await p.waitForTimeout(2600);
  const st = DB.settings[0].data.cars.ev;
  check(!st.pubChoice && !st.pubTariffs, 'Vergleich ändert die gespeicherten Einstellungen nicht');
  await p.selectOption('#pub-alt', 'custom'); await p.waitForTimeout(200);
  await p.fill('#pub-alt-ap', '0.79'); await p.dispatchEvent('#pub-alt-ap', 'change'); await p.waitForTimeout(300);
  check(/Break-even mit eigener Preis 0,79 €/.test(await p.textContent('#am-pub')), 'eigener Preis 0,79 €');
  await p.selectOption('#pub-choice', 'EnBW M'); await p.waitForTimeout(2800);
  check(DB.settings[0].data.cars.ev.pubChoice === 'EnBW M', 'Auswahl „Rechnen mit“ gespeichert');
  check(/Gerechnet wird mit EnBW M/.test(await p.textContent('#am-pub')), 'Rechnung mit EnBW M');
  check(!p.errs.length, 'keine Skriptfehler ' + p.errs.join(' | '));
  await ctx.close();
}
{
  const { p, ctx } = await open('?unfold#log');
  await p.fill('#ch-d', '2026-11-12'); await p.fill('#ch-k', '12'); await p.fill('#ch-e', '5'); await p.fill('#ch-km', '700');
  await p.selectOption('#ch-o', 'zu Hause'); await p.check('#ch-g'); await p.click('#ch-add'); await p.waitForTimeout(400);
  const r = DB.charge_log.find(x => x.day === '2026-11-12');
  check(r && r.guest === true && r.odometer == null, 'Fremdladung gespeichert (guest, ohne Kilometerstand)');
  const ct = await p.textContent('#ch-tbl'); check(ct.includes('Fremdladung'), 'Ladebuch zeigt „Fremdladung“ ' + ct.slice(0, 160));
  check(!p.errs.length, 'keine Skriptfehler ' + p.errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
