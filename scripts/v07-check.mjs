// v0.7-Test: Abschlag-Check mit künftigem Abschlag, Zahlungsbuch (Vorschlag, Bonus), Boni-Posten mit Bedingung,
// Abrechnung prüfen, Tarifrechner, Gesamtbilanz, einheitlicher Break-even, Zähler-Linie, Zahlung unter „Erfassen“.
// Simuliertes Supabase mit data/seed_state.json. Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v07-check.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSeed } from '../js/import.js';
const base = fileURLToPath(new URL('..', import.meta.url));
const seed = JSON.parse(readFileSync(base + 'data/seed_state.json', 'utf8'));
const m = mapSeed(seed), uid = '11111111-1111-4111-8111-111111111111';
const DB = { ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'settings').map(([k, r]) => [k, r.map(x => ({ ...x, user_id: uid }))])), settings: [{ ...m.settings, user_id: uid }], payments: [] };
// Künftige Abschlagsänderung Allgemeinstrom (Datum morgen, Betrag −25 %), unabhängig von echten Werten
const asInst = DB.installments.filter(x => x.grp === 'as').sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
const newAmount = Math.round(asInst.amount * 0.75), tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
DB.installments.push({ id: 'ab-neu', user_id: uid, grp: 'as', valid_from: tomorrow, amount: newAmount, note: 'Test' });
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
let { p, ctx } = await open('cost');
// 1 Abschlag-Check berücksichtigt den künftigen Abschlag in der Jahressumme
const ab = await txt(p, '#ab-tbl');
const avg = +((ab.match(/12 × Ø ([\d.,]+) €/) || [])[1] || '0').replace(/\./g, '').replace(',', '.');
ok(avg > 0 && avg < asInst.amount, `Abschläge im Abrechnungsjahr enthalten den neuen Betrag (Ø ${avg} € < ${asInst.amount} €)`);
ok(ab.includes('angenommen') && ab.includes('Nächster Abschlag'), 'Quelle „angenommen“ und nächster Abschlag');

// 2 Boni-Posten aus Notiz, Tarif mit Mengenbedingung
const entega = DB.tariffs.find(t => /unter [\d.]+ kWh/.test(t.boni_note || ''));   // Tarif mit Mengenbedingung
await p.click(`[data-boni-parse="${entega.id}"]`); await p.waitForTimeout(300);
const entegaDb = DB.tariffs.find(t => t.id === entega.id);   // Speichern ersetzt die Zeile
ok(Array.isArray(entegaDb.boni_items) && entegaDb.boni_items.length === 2 && entegaDb.boni_items[1].minKwh === 2500 && entegaDb.boni_items[1].amountBelow === 100, 'Boni-Posten aus Notiz gespeichert (inkl. Bedingung)');
const bt = await txt(p, '#boni-tbl');
const de = t => +t.replace(/\./g, '').replace(',', '.');
const m2 = bt.match(/Summe ([\d.,]+) €, wirksam ([\d.,]+) €/);
ok(bt.includes('nicht erfüllt') && m2 && de(m2[2]) < de(m2[1]), 'Mengenbedingung nicht erfüllt → wirksame Boni kleiner als Summe');

// 3 Zahlungsbuch: Vorschlag und Bonus
await p.click('#pay-suggest'); await p.waitForTimeout(600);
const nSug = DB.payments.length;
ok(nSug >= 5 && DB.payments.every(x => x.kind === 'abschlag'), `Vorschlag: ${nSug} Abschläge angelegt`);
ok((await txt(p, '#ab-tbl')).includes('laut Zahlungsbuch'), 'Abschlag-Check nutzt Zahlungsbuch');
await p.selectOption('#pay-g', 'as'); await p.selectOption('#pay-k', 'bonus'); await p.waitForTimeout(100);
const firstItem = DB.tariffs.find(t => t.id === entega.id).boni_items[0];
await p.selectOption('#pay-bonus', { label: `${entega.name}: ${firstItem.name}` }); await p.fill('#pay-a', '12,5'); await p.fill('#pay-d', '2026-05-10');
await p.click('#pay-add'); await p.waitForTimeout(300);
ok(DB.payments.some(x => x.kind === 'bonus' && x.amount === 12.5 && x.note.startsWith(`${entega.name}: ${firstItem.name}`)), 'Bonus-Zahlung gespeichert');
ok((await txt(p, '#boni-tbl')).includes('12,50 € am 10.05.2026'), 'Bonus als erhalten markiert');
ok((await txt(p, '#bill-tbl')).includes('läuft'), 'Abrechnungsjahre angezeigt');
await p.locator('#pay-tbl button[data-del-pay]').first().click(); await p.waitForTimeout(300);
ok(DB.payments.length === nSug, 'Zahlung gelöscht');

// 4 Tarifrechner
await p.goto('http://localhost:8000/#tarif'); await p.waitForTimeout(400);
ok((await txt(p, '#tr-base')).includes('kWh') && (await txt(p, '#tr-offers')).includes('aktuell'), 'Tarifrechner: Basis und aktuelle Tarife');
await p.click('#tr-add'); await p.waitForTimeout(200);
const ap = p.locator('#tr-offers input[data-k="ap"]').first(); await ap.fill('25'); await ap.dispatchEvent('change'); await p.waitForTimeout(200);
ok(await p.locator('#tr-offers input[data-k="name"]').first().inputValue() === 'Neues Angebot' && /[−+]\d/.test(await txt(p, '#tr-offers')), 'Angebot angelegt und berechnet (Differenz zu aktuell)');
const m1 = p.locator('[data-tr="m1Eur"]'); await m1.fill('120'); await m1.dispatchEvent('change'); await p.waitForTimeout(1200);
ok(DB.settings[0].data.tarif?.m1Eur === 120 && DB.settings[0].data.tarif.offers.length === 1, 'Tarifrechner-Parameter in Einstellungen gespeichert');
ok((await txt(p, '#tr-wallbox')).includes('günstigste'), 'Wallbox-Varianten mit günstigster');

// 5 Überblick: Zähler-Linie und volle Breite; Kosten & Ersparnisse: Break-even und Gesamtbilanz
await p.goto('http://localhost:8000/#overview'); await p.waitForTimeout(400);
const mg = await p.evaluate(() => { const c = window.__ebCharts['ov-month']; const d = c.data.datasets.find(x => x.label === 'Netzbezug laut Zähler'); return d ? d.data.filter(v => v != null).length : -1; });
ok(mg > 12, `Zähler-Linie mit ${mg} Monatswerten (auch vor dem Smart Meter)`);
ok(await p.evaluate(() => document.getElementById('ov-month-panel').style.gridColumn === '1 / -1'), 'Grafik volle Breite ohne Vergleich');
const beOv = ((await txt(p, '#ov-kpis')).match(/([A-ZÄÖÜ][a-zäöü]{2} \d{2}) ?Break-even/) || [])[1];
await p.goto('http://localhost:8000/#amort'); await p.waitForTimeout(400);
const beAm = ((await txt(p, '#am-kpis')).match(/([A-ZÄÖÜ][a-zäöü]{2} \d{2}) ?Break-even/) || [])[1];
await p.goto('http://localhost:8000/#fin'); await p.waitForTimeout(400);
const beFin = ((await txt(p, '#fin-inv')).match(/([A-ZÄÖÜ][a-zäöü]{2} \d{2}) ?Break-even/) || [])[1];
ok(beOv && beOv === beAm && beFin === beAm, `Break-even überall gleich (${beOv} / ${beFin} / ${beAm})`);
ok((await txt(p, '#bal-tbl')).includes('Gesamt'), 'Kosten & Ersparnisse: Gesamtbilanz');

// 6 Zahlung unter „Erfassen“ mit Betrag aus dem Abschlagsplan
await p.goto('http://localhost:8000/#quick'); await p.waitForTimeout(300);
await p.click('[data-q=payment]'); await p.selectOption('#q-pg', 'wp'); await p.waitForTimeout(100);
const wpPlan = DB.installments.filter(x => x.grp === 'wp').sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0].amount;
const before = DB.payments.length; await p.click('#q-save'); await p.waitForTimeout(300);
ok(DB.payments.length === before + 1 && DB.payments.at(-1).grp === 'wp' && DB.payments.at(-1).amount === wpPlan, 'Zahlung erfasst (Wärmepumpe, Betrag aus dem Abschlagsplan)');
ok(p.errs.length === 0, 'keine JS-Fehler' + (p.errs.length ? ': ' + p.errs.join(' | ') : ''));
await b.close();
if (failures) { console.log(failures + ' Prüfungen fehlgeschlagen'); process.exit(1); }
