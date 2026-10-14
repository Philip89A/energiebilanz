// v0.30-Test: Anlagenstufen (Bestand anlegen, geplante Stufen, Live schalten, Wirkung, kWp je Zeitraum, Batterie-Seite).
// Simuliertes Supabase mit data/seed_state.json (Anker bis 26.09.2026), erfundene Stufen.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v30-check.mjs
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
const set = async (p, sel, v) => { await p.fill(sel, v); await p.dispatchEvent(sel, 'change'); await p.waitForTimeout(200); };
let { p, ctx } = await open('pv');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
ok(await p.isVisible('#st-init') && (await txt(p, '#st-tbl')).includes('Noch keine Stufen'), 'ohne Stufen: Knopf „Bestand anlegen“');
const kpi0 = await txt(p, '#pv-kpis');
await p.click('#st-init'); await p.waitForTimeout(400);
ok((await txt(p, '#pv-kpis')) === kpi0, 'Bestand anlegen ändert nichts an den Zahlen');
await p.waitForTimeout(900);
const st = () => DB.settings[0].data.stages || [];
ok(st().length === 1 && st()[0].name === 'Bestand' && st()[0].from === '2025-03-22' && st()[0].status === 'live', 'Bestand gespeichert (ab erstem Anker-Tag)');
// geplante Stufe: Solarbank 4 Pro ab 01.09.2026 (erfunden), 12,6 kWh, gleiche kWp
await p.click('#st-add'); await p.waitForTimeout(300);
await set(p, '[data-st="1"][data-k="name"]', 'Speicher größer'); await set(p, '[data-st="1"][data-k="capGross"]', '12,6');
ok((await txt(p, '#st-eff')).includes('Bestand') && !(await txt(p, '#st-eff')).includes('Speicher größer'), 'geplante Stufe zählt noch nicht');
await set(p, '[data-st="1"][data-k="from"]', '2026-09-01'); await p.selectOption('[data-st="1"][data-k="status"]', 'live'); await p.waitForTimeout(400);
let e = await txt(p, '#st-eff');
ok(e.includes('Speicher größer') && e.includes('01.09.2026 – 26.09.2026') && e.includes('22.03.2025 – 31.08.2026'), 'Stufe live: Zeiträume in der Wirkung');
ok(e.includes('zu wenige Tage mit Wetterdaten'), 'ohne Wetterdaten: Hinweis statt Vergleich');
// dritte Stufe mit mehr kWp, „Live ab heute“
await p.click('#st-add'); await p.waitForTimeout(300);
await set(p, '[data-st="2"][data-k="name"]', 'Flex'); await set(p, '[data-st="2"][data-k="kwp"]', '2,25');
await p.click('[data-st-live="2"]'); await p.waitForTimeout(400);
const today = new Date().toISOString().slice(0, 10);
ok(st()[2]?.status === 'live' || (await p.inputValue('[data-st="2"][data-k="from"]')) === today, 'Live ab heute setzt das Datum');
// spezifischer Ertrag im Zeitraum Sep 2026: kWp der Stufen
await p.selectOption('#pb-mode', 'month'); await p.waitForTimeout(200); await p.selectOption('#pb-key', '2026-09'); await p.waitForTimeout(400);
ok((await txt(p, '#pv-kpis')).includes('bei 1,80 kWp'), 'September: 1,8 kWp (Flex erst ab heute)');
// Batterie-Seite: Kapazität je Stufe
await p.goto('http://localhost:8000/#batt'); await p.waitForTimeout(400);
ok((await txt(p, '#bt-params')).includes('je Anlagenstufe'), 'Batterie-Seite verweist auf die Stufen');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();
console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
