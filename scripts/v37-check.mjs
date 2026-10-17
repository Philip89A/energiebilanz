// v0.37-Test: Ereignisse erfassen, ändern, löschen (Daten → Ereignisse), Rückfrage bei rechnungsrelevanten Ereignissen.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v37-check.mjs
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
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.dialogs = []; p.on('dialog', d => { p.dialogs.push(d.message()); (p.reject ? d.dismiss() : d.accept()); });
  await p.goto('http://localhost:8000/#' + page); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FEHLER ') + msg); if (!ok) failures++; };
const n0 = DB.events.length;
{
  const { p, ctx } = await open('data'); await p.waitForTimeout(300);
  check(await p.$$eval('#ev-tbl tbody tr', t => t.length) === n0, `Tabelle zeigt alle ${n0} Ereignisse`);
  const ds = await p.$$eval('#ev-tbl tbody input[type=date]', t => t.map(x => x.value));
  check(ds.every((d, i) => !i || ds[i - 1] >= d), 'neueste zuerst');
  // anlegen
  await p.fill('#ev-d', '2026-10-17'); await p.selectOption('#ev-g', 'wp'); await p.selectOption('#ev-t', 'einstellung'); await p.fill('#ev-text', 'Zirkulation Zeitfenster');
  await p.click('#ev-add'); await p.waitForTimeout(400);
  const neu = DB.events.find(e => e.note === 'Zirkulation Zeitfenster');
  check(neu && neu.day === '2026-10-17' && neu.grp === 'wp' && neu.type === 'einstellung' && neu.id, 'neues Ereignis gespeichert (Datum, Bereich, Art, Text, id)');
  check(p.dialogs.length === 0, 'Einstellung: keine Rückfrage');
  check(/Gespeichert/.test(await p.$eval('#ev-msg', e => e.innerText)) && (await p.$eval('#ev-text', e => e.value)) === '', 'Meldung, Textfeld geleert');
  // leerer Text
  await p.click('#ev-add'); await p.waitForTimeout(200);
  check(/Datum und Text/.test(await p.$eval('#ev-msg', e => e.innerText)) && DB.events.length === n0 + 1, 'ohne Text: Hinweis, nichts gespeichert');
  // ändern
  const sel = `#ev-tbl input[data-ev="${neu.id}"][data-k="text"]`;
  await p.fill(sel, 'Zirkulation 05:15–08:00 und 16:30–20:30'); await p.dispatchEvent(sel, 'change'); await p.waitForTimeout(400);
  check(DB.events.find(e => e.id === neu.id).note === 'Zirkulation 05:15–08:00 und 16:30–20:30', 'Text geändert');
  await p.selectOption(`#ev-tbl select[data-ev="${neu.id}"][data-k="group"]`, 'as'); await p.waitForTimeout(300);
  check(DB.events.find(e => e.id === neu.id).grp === 'as', 'Bereich geändert');
  await p.selectOption(`#ev-tbl select[data-ev="${neu.id}"][data-k="group"]`, ''); await p.waitForTimeout(300);
  check(DB.events.find(e => e.id === neu.id).grp === null, 'ohne Bereich = leer (Prüfregel grp)');
  // rechnungsrelevantes Ereignis: Rückfrage, Abbrechen ändert nichts
  const crit = DB.events.find(e => e.type === 'geraet' && e.grp === 'wp') || DB.events.find(e => e.type === 'daten');
  if (crit) {
    const before = crit.note; p.reject = true; p.dialogs = [];
    const cs = `#ev-tbl input[data-ev="${crit.id}"][data-k="text"]`; await p.fill(cs, 'xx'); await p.press(cs, 'Tab'); await p.waitForTimeout(300);
    check(p.dialogs.length === 1 && DB.events.find(e => e.id === crit.id).note === before && (await p.$eval(cs, e => e.value)) === (before || ''), 'steuert Rechnung: Rückfrage, Abbrechen lässt alles unverändert');
    check(await p.$eval(`#ev-tbl tr:has([data-ev="${crit.id}"]) .pill`, e => /steuert Rechnung/.test(e.innerText)), 'Kennzeichen „steuert Rechnung“');
    p.reject = false;
  } else console.log('(kein rechnungsrelevantes Ereignis im Testbestand)');
  // löschen
  p.dialogs = []; await p.click(`#ev-tbl [data-ev-del="${neu.id}"]`); await p.waitForTimeout(400);
  check(p.dialogs.length === 1 && !DB.events.some(e => e.id === neu.id) && DB.events.length === n0, 'gelöscht nach Rückfrage');
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(800);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'Handy: kein waagrechtes Scrollen');
  check(p.errs.length === 0, 'keine Seitenfehler ' + p.errs.join('; '));
  await ctx.close();
}
await b.close();
console.log(failures ? `${failures} Fehler` : 'Alles OK'); process.exit(failures ? 1 : 0);
