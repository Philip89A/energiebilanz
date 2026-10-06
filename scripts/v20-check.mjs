// v0.20-Test: Angebote mit Positionen (Erfassen, Aufteilung, Buchen als Investition, Zurücknehmen) und Kosten der
// Ausbau-Seite aus Angeboten und gebuchten Investitionen. Simuliertes Supabase mit data/seed_state.json, erfundene Beträge.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v20-check.mjs
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
const invN = () => (DB.investments || []).length;

let { p, ctx } = await open('amort');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
ok((await txt(p, '#of-list')).includes('Noch kein Angebot'), 'ohne Angebot: Hinweis');
const n0 = invN();
await p.click('#of-add'); await p.waitForTimeout(200);
await set(p, '[data-of="0"][data-k="no"]', 'T-1');
await set(p, '[data-of="0"][data-k="vendor"]', 'Testfirma');
await set(p, '[data-of="0"][data-ofi="0"][data-k="name"]', 'Arbeit');
await set(p, '[data-of="0"][data-ofi="0"][data-k="qty"]', '10');
await set(p, '[data-of="0"][data-ofi="0"][data-k="price"]', '50');
await p.click('[data-of-add-item="0"]'); await p.waitForTimeout(150);
await set(p, '[data-of="0"][data-ofi="1"][data-k="name"]', 'Schutzschalter');
await set(p, '[data-of="0"][data-ofi="1"][data-k="price"]', '80');
await p.selectOption('[data-of="0"][data-ofi="1"][data-k="alloc"]', 'wallbox'); await p.waitForTimeout(150);
await p.click('[data-of-add-item="0"]'); await p.waitForTimeout(150);
await set(p, '[data-of="0"][data-ofi="2"][data-k="name"]', 'Anmeldung');
await set(p, '[data-of="0"][data-ofi="2"][data-k="price"]', '200,50');
await p.selectOption('[data-of="0"][data-ofi="2"][data-k="alloc"]', 'pv'); await p.waitForTimeout(150);
await p.selectOption('[data-of="0"][data-ofi="2"][data-k="due"]', 'anmeldung'); await p.waitForTimeout(150);
await set(p, '[data-of="0"][data-k="sharePv"]', '60');
let t = await txt(p, '#of-list');
ok(t.includes('Summe brutto') && t.includes('780,50'), 'Summe brutto 780,50 €');
ok(t.includes('PV/Speicher 500,50') && t.includes('Wallbox 280,00'), 'Aufteilung 60 % der gemeinsamen Positionen: ' + (t.match(/Aufteilung[^.]*\./) || [''])[0]);
ok(/nach Montage580,00 €300,00 €280,00 €offen/.test(t), 'Fälligkeit nach Montage 580 € offen');
ok((await txt(p, '#am-kpis')).includes('offen aus Angeboten 780,50'), 'KPI: offen aus Angeboten');
ok(invN() === n0, 'vor der Buchung keine Investition angelegt');
// gespeichert in settings.data.offers
await p.waitForTimeout(900);
ok(DB.settings[0].data?.offers?.[0]?.items?.length === 3, 'Angebot in den Einstellungen gespeichert');
// Buchen
await p.fill('#of-bd-0-montage', '2026-11-03'); await p.click('[data-of-book="0"][data-due="montage"]'); await p.waitForTimeout(500);
const booked = DB.investments.slice(n0);
ok(booked.length === 2 && booked.some(x => x.category === 'pv' && +x.cost === 300 && x.day === '2026-11-03') && booked.some(x => x.category === 'wallbox' && +x.cost === 280), 'Buchung: zwei Investitionen PV 300 €, Wallbox 280 €');
t = await txt(p, '#of-list');
ok(t.includes('gebucht am 03.11.2026'), 'Status gebucht');
ok((await txt(p, '#am-kpis')).includes('offen aus Angeboten 200,50'), 'KPI: nur noch Anmeldung offen');
ok((await p.$$eval('#am-inv input[data-k="name"]', i => i.map(x => x.value))).filter(v => v.startsWith('Angebot T-1 (Testfirma): Montage und Material')).length === 2, 'Investitionstabelle zeigt die Buchung');
// Änderung nach Buchung → Hinweis
await set(p, '[data-of="0"][data-ofi="1"][data-k="price"]', '90');
ok((await txt(p, '#of-list')).includes('gebucht sind 580,00'), 'Hinweis bei Änderung nach dem Buchen');
await set(p, '[data-of="0"][data-ofi="1"][data-k="price"]', '80');
// Löschen gesperrt, solange gebucht
let alerted = ''; p.removeAllListeners('dialog'); p.on('dialog', d => { alerted = d.message(); d.accept(); });
await p.click('[data-of-del="0"]'); await p.waitForTimeout(200);
ok(alerted.includes('Buchungen zurücknehmen') && (await p.$$('[data-of-del]')).length === 1, 'Angebot mit Buchung nicht löschbar');
// Ausbau-Seite: Handwerker aus Angeboten, Hardware aus Investitionen
await p.goto('http://localhost:8000/#ausbau'); await p.waitForTimeout(400);
ok(!(await txt(p, '#wb-cost-src')).includes('Handwerker aus'), 'Ausbau: zunächst eigene Werte');
await p.selectOption('[data-wb="craftSrc"]', 'offer'); await p.waitForTimeout(300);
ok((await txt(p, '#wb-cost-src')).includes('Kein Angebot für die Ausbau-Rechnung'), 'Hinweis: kein Angebot markiert');
await p.goto('http://localhost:8000/#amort'); await p.waitForTimeout(300);
await p.check('[data-of="0"][data-k="ausbau"]'); await p.waitForTimeout(300);
await p.goto('http://localhost:8000/#ausbau'); await p.waitForTimeout(400);
t = await txt(p, '#wb-cost-src');
ok(t.includes('Handwerker aus Angebot T-1: PV/Speicher 500,50 €, Wallbox 280,00 €'), 'Ausbau: Handwerker aus dem Angebot: ' + t);
ok(await p.isHidden('[data-wb="craftPv"]') && await p.isVisible('[data-wb="hwTotal"]'), 'Eigene Handwerker-Felder ausgeblendet');
await p.selectOption('[data-wb="hwSrc"]', 'invest'); await p.waitForTimeout(300);
ok((await txt(p, '#wb-cost-src')).includes('Datum „Investitionen ab“ fehlt'), 'Hinweis ohne Datum');
await p.fill('[data-wb="hwFrom"]', '2026-11-01'); await p.dispatchEvent('[data-wb="hwFrom"]', 'change'); await p.waitForTimeout(300);
t = await txt(p, '#wb-cost-src');
ok(t.includes('Hardware aus 0 Investitionen ab 01.11.2026: 0,00 €'), 'Buchungen aus Angeboten zählen nicht als Hardware: ' + t.slice(0, 120));
ok(await p.isHidden('[data-wb="hwTotal"]'), 'Eigene Hardware-Felder ausgeblendet');
ok((await txt(p, '#wb-kpis')).includes('Investition 781 €'), 'Paket-Investition = Angebot (Hardware 0): ' + (await txt(p, '#wb-kpis')).slice(0, 90));
// Zurücknehmen
await p.goto('http://localhost:8000/#amort'); await p.waitForTimeout(300);
await p.click('[data-of-unbook="0"][data-due="montage"]'); await p.waitForTimeout(500);
ok(invN() === n0, 'Zurücknehmen löscht die Investitionen');
ok((await txt(p, '#am-kpis')).includes('offen aus Angeboten 780,50'), 'wieder offen');
// Neu laden: Angebot bleibt
await p.waitForTimeout(900); await p.reload(); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(300);
ok(await p.inputValue('[data-of="0"][data-k="no"]') === 'T-1' && (await p.$$('[data-of="0"][data-k="name"]')).length === 3, 'Angebot nach Neuladen vorhanden');
ok(!p.errs.length, 'ohne Fehler: ' + p.errs.join(' | '));
await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
