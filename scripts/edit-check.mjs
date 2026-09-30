// Bearbeiten-Test: alle Eingaben der App gegen ein simuliertes Supabase (Upsert/Löschen wie PostgREST), Startdaten aus
// data/seed_state.json. Prüft Speichern, Ändern, Löschen, verzögertes Speichern der Regler, Neuberechnung,
// Fehleranzeige mit Neuladen und Dauerhaftigkeit nach erneutem Öffnen.
// Aufruf:  python3 -m http.server 8000 &   dann   npx -y -p playwright node scripts/edit-check.mjs
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
let { p, ctx } = await open('meter');

// 1 Zählerstand hinzufügen und löschen
await p.selectOption('#rd-m', 'wp'); await p.fill('#rd-d', '2026-09-30'); await p.fill('#rd-v', '12530'); await p.click('#rd-add'); await p.waitForTimeout(300);
ok(DB.meter_readings.some(r => r.meter_id === 'wp' && r.day === '2026-09-30' && r.value === 12530 && r.source === 'Eingabe'), 'Zählerstand gespeichert');
ok((await txt(p, '#rd-tbl')).includes('30.09.2026'), 'Zählerstand in Tabelle');
await p.locator('#rd-tbl tr', { hasText: '30.09.2026' }).locator('button').click(); await p.waitForTimeout(300);
ok(!DB.meter_readings.some(r => r.day === '2026-09-30'), 'Zählerstand gelöscht');

// 2 Tarif ändern -> Kosten ändern sich
await p.goto('http://localhost:8000/#cost'); await p.waitForTimeout(300);
const before = await txt(p, '#ct-kpis');
const inp = p.locator('#tf-tbl input[data-k="ap"]').first(); const tid = await inp.getAttribute('data-tf');
await inp.fill('35'); await inp.dispatchEvent('change'); await p.waitForTimeout(300);
ok(DB.tariffs.find(t => t.id === tid)?.ap_ct === 35, 'Tarif-Arbeitspreis gespeichert');
ok(before !== await txt(p, '#ct-kpis'), 'Kosten neu berechnet');
// 3 Abschlag hinzufügen, Betrag ändern, löschen
const nAb = DB.installments.length; await p.click('#ab-add'); await p.waitForTimeout(300);
ok(DB.installments.length === nAb + 1, 'Abschlag angelegt');
const newAb = DB.installments[DB.installments.length - 1];
const ai = p.locator(`#ab-edit input[data-ab="${newAb.id}"][data-k="amount"]`); await ai.fill('55'); await ai.dispatchEvent('change'); await p.waitForTimeout(300);
ok(DB.installments.find(x => x.id === newAb.id)?.amount === 55, 'Abschlag-Betrag gespeichert');
await p.click(`#ab-edit button[data-del-ab="${newAb.id}"]`); await p.waitForTimeout(300);
ok(DB.installments.length === nAb, 'Abschlag gelöscht');

// 4 Tanken, Laden, Fahrzeugbuch
await p.goto('http://localhost:8000/#log'); await p.waitForTimeout(300);
for (const [km, l, e] of [[50000, 40, 70], [50600, 38, 68.4]]) { await p.fill('#fu-km', String(km)); await p.fill('#fu-l', String(l)); await p.fill('#fu-e', String(e)); await p.click('#fu-add'); await p.waitForTimeout(200); }
ok(DB.fuel_log.length === 2 && DB.fuel_log[1].liters === 38 && DB.fuel_log[0].full_tank === true, 'Tankvorgänge gespeichert');
ok((await txt(p, '#lg-kpis')).includes('6,33 l'), 'Verbrauch aus Volltank-Intervall (38 l / 600 km)');
await p.fill('#ch-k', '42.5'); await p.fill('#ch-e', '12.75'); await p.click('#ch-add'); await p.waitForTimeout(200);
ok(DB.charge_log.length === 1 && DB.charge_log[0].kwh === 42.5 && DB.charge_log[0].location === 'zu Hause', 'Ladevorgang gespeichert');
await p.selectOption('#cl-cat', 'Versicherung'); await p.fill('#cl-e', '420'); await p.fill('#cl-n', 'Jahresbeitrag'); await p.click('#cl-add'); await p.waitForTimeout(200);
ok(DB.car_log.length === 1 && DB.car_log[0].category === 'Versicherung' && DB.car_log[0].amount === 420 && DB.car_log[0].odometer === null, 'Fahrzeugbuch gespeichert');
await p.click('#fu-tbl button[data-del-fu]'); await p.waitForTimeout(200);
ok(DB.fuel_log.length === 1, 'Tankvorgang gelöscht');

// 5 Investition anlegen/ändern/löschen, Amortisations-Regler
await p.goto('http://localhost:8000/#amort'); await p.waitForTimeout(300);
const nInv = DB.investments.length; await p.click('#am-add'); await p.waitForTimeout(200);
const newInv = DB.investments[DB.investments.length - 1]; ok(DB.investments.length === nInv + 1 && newInv.name === 'Neue Position', 'Investition angelegt');
const ci = p.locator('#am-inv input[data-k="cost"]').last(); await ci.fill('100'); await ci.dispatchEvent('change'); await p.waitForTimeout(200);
ok(DB.investments.find(x => x.id === newInv.id)?.cost === 100, 'Investition geändert');
await p.locator('#am-inv button[data-del-inv]').last().click(); await p.waitForTimeout(200);
ok(DB.investments.length === nInv, 'Investition gelöscht');
const be1 = await txt(p, '#am-kpis');
await p.locator('#am-sl input[type=range]').first().evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await p.waitForTimeout(1200);
ok(DB.settings[0].data.amort.priceInc === 6, 'Regler Preissteigerung gespeichert (verzögert)');
ok(be1 !== await txt(p, '#am-kpis'), 'Break-even neu berechnet');

// 6 Batterie-Parameter, Auto-Parameter, Ereignis
await p.goto('http://localhost:8000/#batt'); await p.waitForTimeout(300);
const bi = p.locator('#bt-params input').nth(1); await bi.fill('20'); await bi.dispatchEvent('input'); await p.waitForTimeout(1200);
ok(DB.settings[0].data.battery.reserve === 20, 'Batterie-Reserve gespeichert');
await p.goto('http://localhost:8000/#car'); await p.waitForTimeout(300);
const ce = p.locator('#car-ice input[type=number]').first(); await ce.fill('399'); await ce.dispatchEvent('input'); await p.waitForTimeout(1200);
ok(DB.settings[0].data.cars.ice.rate === 399, 'Leasingrate gespeichert');
await p.goto('http://localhost:8000/#data'); await p.waitForTimeout(300);
const ev = p.locator('#ev-tbl input[type=text]').first(); await ev.fill('Test-Notiz'); await ev.dispatchEvent('change'); await p.waitForTimeout(300);
ok(DB.events.some(e => e.note === 'Test-Notiz'), 'Ereignis gespeichert');

// 7 Fehlerfall: Speichern scheitert -> Hinweis und Neuladen aus der Datenbank
await p.goto('http://localhost:8000/#meter'); await p.waitForTimeout(300);
failNext = true; await p.fill('#rd-d', '2026-10-01'); await p.fill('#rd-v', '12600'); await p.click('#rd-add'); await p.waitForTimeout(800);
ok((await txt(p, '#main')).includes('Speichern fehlgeschlagen') && !(await txt(p, '#rd-tbl')).includes('01.10.2026'), 'Fehler angezeigt, Stand aus DB neu geladen');
ok(p.errs.length === 0, 'keine JS-Fehler: ' + p.errs.join(' | '));
await ctx.close();

// 8 Neu öffnen: Änderungen sind dauerhaft
({ p, ctx } = await open('amort'));
ok((await p.locator('#am-sl output').first().textContent()).includes('6'), 'nach Neuladen: Regler-Wert aus Supabase');
await p.goto('http://localhost:8000/#log'); await p.waitForTimeout(300);
ok((await txt(p, '#ch-tbl')).includes('42,5'), 'nach Neuladen: Ladevorgang da');
await b.close();
if (failures) { console.log(failures + ' Prüfungen fehlgeschlagen'); process.exit(1); }
