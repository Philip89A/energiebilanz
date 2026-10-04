// v0.19-Test: Tagesprofil Wärmepumpe (Stundenwerte, Vergleichstag, Warmwasser-Ladungen, Desinfektion, unvollständige Tage).
// Simuliertes Supabase mit data/seed_state.json und synthetischen Stundenwerten (erfunden).
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v19-check.mjs
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
// Synthetische Stundenwerte: 10.03. voll (Ladung 02–03 Uhr, Desinfektion 65 °C, Heizung tagsüber),
// 11.03. voll (zwei Ladungen, Zuheizer 1 h), 12.03. nur 5 Stunden
const H = []; const hr = (d, h, o) => H.push({ grain: 'hour', ts: `${d}T${String(h).padStart(2, '0')}:00`, el_hp: 0, el_heat: 0, el_cool: 0, el_dhw: 0, el_aux: 0, el_aux_heat: 0, el_aux_dhw: 0,
  heat_heat: 0, heat_dhw: 0, heat_cool: 0, t_out: 5 + h / 4, t_flow: 30, t_dhw: 48, user_id: uid, ...o });
for (let h = 0; h < 24; h++) {
  const dhw = h === 2 || h === 3, heat = h >= 8 && h <= 17;
  hr('2026-03-10', h, { el_dhw: dhw ? 1.2 : 0, heat_dhw: dhw ? 2.8 : 0, el_heat: heat ? 0.5 : 0, heat_heat: heat ? 1.8 : 0, el_hp: (dhw ? 1.2 : 0) + (heat ? 0.5 : 0), t_dhw: h === 3 ? 65 : 50 });
  const dhw2 = h === 2 || h === 15, aux = h === 15;
  hr('2026-03-11', h, { el_dhw: dhw2 ? 1 : 0, heat_dhw: dhw2 ? 2.4 : 0, el_aux: aux ? 0.8 : 0, el_aux_dhw: aux ? 0.8 : 0, el_hp: dhw2 ? 1 : 0, t_dhw: h === 15 ? 55 : 49 });
}
for (let h = 0; h < 5; h++) hr('2026-03-12', h, {});
DB.hp_energy = H; DB.weather_daily = [];

let { p, ctx } = await open('meter');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
ok(await p.isVisible('#hpd-a'), 'Tagesprofil sichtbar');
const opts = await p.$$eval('#hpd-a option', o => o.map(x => x.value));
ok(JSON.stringify(opts) === JSON.stringify(['2026-03-12', '2026-03-11', '2026-03-10']), 'Tagesauswahl, neuester zuerst: ' + opts);
ok((await txt(p, '#hpd-flags')).includes('nur 5 von 24 Stunden'), 'Hinweis bei unvollständigem Tag');
await p.selectOption('#hpd-a', '2026-03-10'); await p.waitForTimeout(300);
ok(!(await txt(p, '#hpd-flags')).includes('von 24'), 'voller Tag ohne Hinweis');
let t = await txt(p, '#hpd-tbl');
ok(t.includes('1: 02:00–04:00 (2,4 kWh)'), 'eine Warmwasser-Ladung 02:00 über zwei Stunden: ' + t.match(/Warmwasser-Ladungen[^]*?Höchste/)?.[0]);
ok(/65,0 °C um 03:00.*Desinfektion/.test(t), 'Desinfektion erkannt');
ok(t.includes('Strom gesamt') && t.includes('7,4 kWh'), 'Strom gesamt 7,4 kWh');
ok(t.includes('Laufstunden12 h'), 'Laufstunden 12 h');
let n = await p.evaluate(() => window.__ebCharts['hp-hours'].data);
ok(n.labels.length === 24, '24 Stunden in der Grafik');
ok(!n.datasets.some(d => d.label.includes('11.03')), 'ohne Vergleich nur ein Tag');
ok(await p.evaluate(() => !window.__ebCharts['hp-hours'].config.plugins.some(x => x.id === 'ebTotals') || window.__ebCharts['hp-hours'].options.plugins.ebTotals === false), 'keine Summen über Stundenbalken');
// Vergleichstag
await p.selectOption('#hpd-b', '2026-03-11'); await p.waitForTimeout(300);
n = await p.evaluate(() => window.__ebCharts['hp-hours'].data.datasets.map(d => ({ l: d.label, s: d.stack, t: d.type, dash: !!d.borderDash })));
ok(n.some(d => d.l.includes('11.03') && d.s === 'b'), 'Vergleichstag als eigener Stapel');
ok(n.filter(d => d.t === 'line' && d.l.includes('11.03')).every(d => d.dash), 'Vergleichslinien gestrichelt');
ok((await p.$$eval('#hpd-tbl thead th', h => h.length)) === 3, 'Tabelle mit zwei Tagesspalten');
t = await txt(p, '#hpd-tbl');
ok(t.includes('2: 02:00 (1,0 kWh), 15:00 (1,8 kWh)'), 'zwei Ladungen am Vergleichstag, Zuheizer mitgezählt');
ok(/Zuheizernein0,8 kWh/.test(t), 'Zuheizer am Vergleichstag');
ok(!(await p.$$eval('#hpd-b option', o => o.map(x => x.value))).includes('2026-03-10'), 'Vergleich bietet den gewählten Tag nicht an');
// Auswahl bleibt nach Neuladen
await p.reload(); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(300);
ok(await p.inputValue('#hpd-a') === '2026-03-10' && await p.inputValue('#hpd-b') === '2026-03-11', 'Auswahl bleibt gespeichert');
// unabhängig vom Zeitraum oben
await p.selectOption('#pb-mode', 'year'); await p.waitForTimeout(200); await p.selectOption('#pb-key', '2025'); await p.waitForTimeout(300);
ok((await p.$$('#hpd-a option')).length === 3, 'Tagesprofil unabhängig vom Zeitraum');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

// ohne Stundenwerte: Hinweis statt Fehler
DB.hp_energy = DB.hp_energy.filter(r => r.grain !== 'hour');
({ p, ctx } = await open('meter'));
ok((await txt(p, '#hpd-flags')).includes('Noch keine Stundenwerte'), 'Hinweis ohne Stundenwerte');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
