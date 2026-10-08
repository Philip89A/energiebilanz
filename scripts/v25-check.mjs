// v0.25-Test: Wasser (Zähler anlegen, Stände in m³, Kennzahlen, Grafik, Kosten, auffälliges Intervall, Erfassen, Kosten-Seite).
// Simuliertes Supabase mit data/seed_state.json, erfundene Wasserstände.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v25-check.mjs
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
const set = async (p, sel, v) => { await p.fill(sel, v); await p.dispatchEvent(sel, 'change'); await p.waitForTimeout(150); };

let { p, ctx } = await open('meter');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
ok(await p.isVisible('#wt-create'), 'Knopf „Wasserzähler anlegen“ sichtbar');
ok((await txt(p, '#wt-flags')).includes('Noch kein Wasserzähler'), 'Hinweis ohne Wasserzähler');
await p.click('#wt-create'); await p.waitForTimeout(500);
ok((DB.meters || []).some(m => m.id === 'water' && m.grp === 'water'), 'Zähler in Supabase angelegt (grp water)');
ok(await p.isHidden('#wt-create'), 'Knopf danach ausgeblendet');
ok((await txt(p, '#wt-flags')).includes('Noch keine zwei Wasserstände'), 'Hinweis: Stände fehlen');
// Preise und Personen
await set(p, '[data-wt="persons"]', '3'); await set(p, '[data-wt="priceM3"]', '2,10'); await set(p, '[data-wt="sewageM3"]', '2,90');
await p.waitForTimeout(900);
ok(DB.settings[0].data?.water?.persons === 3 && DB.settings[0].data.water.priceM3 === 2.1 && DB.settings[0].data.water.sewageM3 === 2.9, 'Einstellungen gespeichert');
// Stände über die Zählerseite (m³, erfunden): 7 Tage je 0,35 m³, dann ein Ausreißer
const rows = [['2026-08-01', '100'], ['2026-08-08', '102,45'], ['2026-08-15', '104,9'], ['2026-08-22', '107,35'], ['2026-08-29', '112']];
for (const [d, v] of rows) { await p.selectOption('#rd-m', 'water'); await p.fill('#rd-d', d); await p.fill('#rd-v', v.replace(',', '.')); await p.click('#rd-add'); await p.waitForTimeout(250); }
ok(DB.meter_readings.filter(r => r.meter_id === 'water').length === 5, 'fünf Wasserstände gespeichert');
ok(!DB.meter_readings.some(r => r.meter_id !== 'water' && r.day >= '2026-08-01' && r.day <= '2026-08-29' && [100, 102.45, 104.9, 107.35, 112].includes(+r.value)), 'Zählerauswahl bleibt beim Neuzeichnen erhalten (kein Stand beim falschen Zähler)');
ok((await txt(p, '#rd-tbl')).includes('112,000 m³'), 'Ablesetabelle zeigt m³');
await p.selectOption('#pb-mode', 'custom'); await p.waitForTimeout(150);
await p.fill('#pb-from', '2026-08-01'); await p.dispatchEvent('#pb-from', 'change'); await p.fill('#pb-to', '2026-08-21'); await p.dispatchEvent('#pb-to', 'change'); await p.waitForTimeout(500);
let k = await txt(p, '#wt-kpis');
ok(k.includes('7,35 m³') && k.includes('350 l') && k.includes('117 l') && k.includes('37 €'), 'Kennzahlen: 7,35 m³, 350 l/Tag, 117 l/Person, 37 €: ' + k.slice(0, 200));
const ds = await p.evaluate(() => window.__ebCharts['wt-rate'].data.datasets.map(d => ({ l: d.label, n: d.data.length, max: Math.max(...d.data.map(q => q.y)), dash: !!d.borderDash })));
ok(ds[0].l === 'Liter pro Tag' && Math.abs(ds[0].max - 350) < 1e-6, 'Grafik: Liter pro Tag');
ok(ds.some(d => d.l === 'Ø 30 Tage' && d.dash), 'gleitender Durchschnitt gepunktet');
ok(!(await txt(p, '#wt-flags')).includes('Auffällig'), 'kein Ausreißer im Zeitraum bis 21.08.');
await p.fill('#pb-to', '2026-08-31'); await p.dispatchEvent('#pb-to', 'change'); await p.waitForTimeout(400);
ok((await txt(p, '#wt-flags')).includes('Auffällig hoher Verbrauch: 22.08.2026–29.08.2026 664 l/Tag'), 'Ausreißer erkannt: ' + (await txt(p, '#wt-flags')).slice(0, 120));
// Erfassen: Einheit m³ und Hinweis in Litern
await p.goto('http://localhost:8000/#quick'); await p.waitForTimeout(300);
const qb = await p.$('[data-q="reading"]'); if (qb) { await qb.click(); await p.waitForTimeout(200); }
if (await p.$('#q-m')) {
  await p.selectOption('#q-m', 'water'); await p.dispatchEvent('#q-m', 'change'); await p.fill('#q-d', '2026-09-05'); await p.fill('#q-v', '114,1'); await p.dispatchEvent('#q-v', 'input'); await p.waitForTimeout(200);
  ok((await txt(p, '#q-form')).includes('Stand in m³') && (await txt(p, '#q-hint')).includes('2.100 l (300 l/Tag)'), 'Erfassen: m³ und Liter-Hinweis: ' + (await txt(p, '#q-hint')));
} else ok(false, 'Erfassen-Formular für Zählerstand nicht gefunden');
// Kosten & Ersparnisse: Zeile Wasser
await p.goto('http://localhost:8000/#fin'); await p.waitForTimeout(400);
ok((await txt(p, '#fin-tbl')).includes('Wasser (in den Nebenkosten)'), 'Kosten-Seite mit Zeile Wasser');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
