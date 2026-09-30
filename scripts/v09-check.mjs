// v0.9-Test: Investitions-Kategorie, Wallbox-Ersparnis in der Amortisation, E-Auto zu Hause im Allgemeinstrom,
// Abschlag-Hinweis ab Übergabe. Simuliertes Supabase mit data/seed_state.json, ohne private Werte im Skript.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v09-check.mjs
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
async function open(page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid } };
  await ctx.addInitScript(s => localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s), JSON.stringify(session));
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop(); DB[t] ??= [];
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
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8000/#' + page); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(200);
  return { p, ctx };
}

const ok = (c, msg) => { if (!c) failures++; console.log((c ? 'OK   ' : 'FEHL ') + msg); };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ');
const num = s => +String(s).replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.');
const kpiVal = async (p, host, i) => num(await p.$eval(`#${host} .kpi:nth-child(${i}) .v`, e => e.textContent));

// 1 Stromkosten: Block „E-Auto zu Hause“ und Abschlag-Hinweis ab Übergabe (Startdatum aus dem Seed)
let { p, ctx } = await open('cost');
ok(!p.errs.length, 'Stromkosten ohne Fehler: ' + p.errs.join(' | '));
ok((await p.$$('#evh-kpis .kpi')).length === 4, 'E-Auto zu Hause: 4 Kennzahlen');
const evStart = seed.cars?.ev?.start;
ok(!evStart || (await txt(p, '#ab-ev')).includes('Abschlag rechtzeitig'), 'Abschlag-Hinweis zum E-Auto');
const asBefore = await kpiVal(p, 'evh-kpis', 3);
await ctx.close();

// 2 Laden zu Hause erfassen → Allgemeinstrom ohne E-Auto sinkt um den Netzanteil
const lastAs = DB.meter_readings.filter(r => DB.meters.find(m => m.id === r.meter_id)?.grp === 'as').map(r => r.day).sort().at(-1);
const dayIn = new Date(Date.parse(lastAs) - 20 * 864e5).toISOString().slice(0, 10);
DB.charge_log.push({ id: 'c-home', user_id: uid, day: dayIn, odometer: null, kwh: 100, amount: null, location: 'zu Hause' });
({ p, ctx } = await open('cost'));
const asAfter = await kpiVal(p, 'evh-kpis', 3), sh = +(seed.cars?.ev?.shPV || 0);
ok(Math.abs((asBefore - asAfter) - 100 * (1 - sh / 100)) <= 1, `Allgemeinstrom ohne E-Auto: −${asBefore - asAfter} kWh`);
ok(await kpiVal(p, 'evh-kpis', 1) === 100, 'Geladen zu Hause: 100 kWh');
await ctx.close();

// 3 Amortisation: Kategorie wählen, Wallbox-Ersparnis erscheint, Speichern mit Spalte category
({ p, ctx } = await open('amort'));
ok(!p.errs.length, 'Amortisation ohne Fehler');
ok((await p.$$('#am-inv select[data-k="cat"]')).length === DB.investments.length, 'Kategorie je Investition');
const sav0 = await kpiVal(p, 'am-kpis', 2);
ok(!(await txt(p, '#am-wb-note')).trim(), 'Ohne Wallbox-Investition kein Wallbox-Hinweis');
const sorted = [...DB.investments].sort((a, b) => (a.day || '').localeCompare(b.day || '')), first = sorted[0];
const idx = await p.$$eval('#am-inv select[data-k="cat"]', (els, n) => els.findIndex(e => e.closest('tr').querySelector('input[data-k="name"]').value === n), first.name);
await p.selectOption(`#am-inv select[data-k="cat"] >> nth=${idx}`, 'wallbox'); await p.waitForTimeout(500);
ok(DB.investments.find(x => x.id === first.id)?.category === 'wallbox', 'Kategorie „wallbox“ gespeichert');
ok((await txt(p, '#am-wb-note')).includes('Wallbox ab'), 'Wallbox-Hinweis in der Amortisation');
const sav1 = await kpiVal(p, 'am-kpis', 2);
ok(sav1 > sav0, `Ersparnis 12 Monate enthält die Wallbox (${sav0} → ${sav1} €)`);
ok((await txt(p, '#am-kpis')).includes('Wallbox'), 'Kennzahl nennt den Wallbox-Anteil');
await ctx.close();
// zurücksetzen
delete DB.investments.find(x => x.id === first.id).category; DB.charge_log = DB.charge_log.filter(x => x.id !== 'c-home');

// 4 Ausbau-Seite: neuer Hinweis statt Doppelzählung
({ p, ctx } = await open('ausbau'));
const f = await txt(p, '#wb-flags');
ok(f.includes('Amortisation') && !f.includes('doppelt'), 'Ausbau-Seite verweist auf die Amortisation');
await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
