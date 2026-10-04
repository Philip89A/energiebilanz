// v0.8-Test: Ausbau-Szenario „Weg B“ (Seite, Tabelle, §14a an/aus, Alternative Steckdose, Speichern in settings,
// Diagramm, Handybreite). Simuliertes Supabase mit data/seed_state.json, ohne private Werte im Skript.
// Aufruf: python3 -m http.server 8000 &  dann  npx -y -p playwright node scripts/v08-check.mjs
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
const cells = async p => p.$$eval('#wb-tbl tbody tr', rs => rs.map(r => [...r.children].map(c => c.textContent.trim())));
const total = async p => num(await p.textContent('#wb-tbl tfoot td:nth-child(4)'));
const set = async (p, k, val) => { const s = `[data-wb="${k}"]`; const t = await p.getAttribute(s, 'type');
  if (t === 'checkbox') await p.setChecked(s, val); else if (await p.$eval(s, e => e.tagName) === 'SELECT') await p.selectOption(s, val); else { await p.fill(s, String(val)); await p.press(s, 'Tab'); }
  await p.waitForTimeout(250); };

let { p, ctx } = await open('ausbau');
ok((await txt(p, '#wb-flags')).includes('Noch keine Kosten'), 'Hinweis, solange keine Kosten eingetragen sind');
// Beispielkosten (keine echten Angebotswerte)
await set(p, 'hwTotal', 2000); await set(p, 'hwWallbox', 400); await set(p, 'craftPv', 500); await set(p, 'craftWallbox', 1000);
ok(!(await txt(p, '#wb-flags')).includes('Noch keine Kosten'), 'Hinweis verschwindet mit Kosten');
ok(!p.errs.length, 'Seite ohne Fehler: ' + p.errs.join(' | '));
ok((await txt(p, '#snav')).includes('Ausbau (Weg B)'), 'Navigation enthält „Ausbau (Weg B)“');
const k = await txt(p, '#wb-kpis');
ok(/Paket amortisiert nach/.test(k) && /[\d,]+ Jahre/.test(k), 'Kennzahl Paket-Amortisation in Jahren');
let rows = await cells(p), t0 = await total(p);
ok(rows.length === 5, '5 Posten in der Tabelle');
const sum = rows.reduce((a, r) => a + num(r[3]), 0);
ok(Math.abs(sum - t0) <= 3, `Summe der Posten = Gesamt (${sum} ≈ ${t0})`);
ok(num(rows[2][3]) > 0, 'Wallbox-Vorteil gegen öffentliches Laden > 0');
ok(num(rows[3][3]) === 0, '§14a standardmäßig aus (0 €)');
ok(await p.isHidden('[data-wb="s14aEur"]'), 'Betragsfeld §14a ausgeblendet, solange aus');
const ch = await p.evaluate(() => window.__ebCharts['wb-chart']?.data.datasets.length);
ok(ch === 6, 'Diagramm mit 6 Linien');

// §14a an: eigener Betrag (Standard) kommt auf den Jahresvorteil
await set(p, 's14a', true);
rows = await cells(p); const t1 = await total(p), s14 = num(rows[3][3]);
ok(s14 > 0 && Math.abs(t1 - t0 - s14) <= 1, `§14a an: +${s14} € pro Jahr`);
ok(await p.isVisible('[data-wb="s14aEur"]'), 'Betragsfeld §14a sichtbar');
await set(p, 's14aEur', 100);
rows = await cells(p); ok(num(rows[3][3]) === 100, 'Eigener §14a-Betrag übernommen');
await set(p, 's14aMod', 'm1');
ok((await txt(p, '#wb-flags')).includes('Tarifrechner') || num((await cells(p))[3][3]) > 0, 'Modul aus Tarifrechner: Wert oder Hinweis auf fehlende Werte');
await set(p, 's14aMod', 'manual');

// Alternative Steckdose: Wallbox-Anteil ohne Laden-Vorteil, Steckdosen-Kosten sichtbar
await set(p, 'alt', 'socket');
rows = await cells(p);
ok(num(rows[2][3]) === 0, 'Alternative Steckdose: Wallbox-Vorteil 0 €');
ok(await p.isVisible('[data-wb="socketEur"]'), 'Feld „Kosten Steckdose“ sichtbar');
await set(p, 'alt', 'public');

// Ohne PV- und Speicher-Ausbau bleibt kaum Mehrwert im Haus
await set(p, 'pvAddWp', 0); await set(p, 'storeAddKwh', 0);
rows = await cells(p);
ok(Math.abs(num(rows[0][3])) <= 30, `Ohne Ausbau fast kein Mehrwert im Haus (${rows[0][3]})`);
await set(p, 'pvAddWp', 1500); await set(p, 'storeAddKwh', 5);

// Speichern in settings.data.ausbau und nach Neuladen wieder da
await p.waitForTimeout(1200);
const saved = DB.settings[0].data?.ausbau || {};
ok(saved.s14a === true && saved.s14aEur === 100 && saved.alt === 'public', 'Parameter in settings.data.ausbau gespeichert');
ok(saved.battery === undefined && DB.settings[0].data.battery, 'Übrige Einstellungen unverändert');
await ctx.close();
({ p, ctx } = await open('ausbau'));
ok(await p.isChecked('[data-wb="s14a"]') && num((await cells(p))[3][3]) === 100, 'Nach Neuladen: §14a an, 100 €');
await ctx.close();

// Handybreite: keine waagrechte Verschiebung der Seite
({ p, ctx } = await open('ausbau'));
await p.setViewportSize({ width: 390, height: 844 });
// Diagramme passen sich verzögert an (unter Last bis zu einigen hundert ms): bis 4 s auf stabile Breite warten
await p.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, null, { timeout: 4000 }).catch(() => {});
const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(over <= 0, `Handy: keine Überbreite (${over}px)`);
await ctx.close();

// Andere Seiten laufen weiter ohne Fehler
({ p, ctx } = await open('amort')); ok(!p.errs.length, 'Amortisation ohne Fehler'); await ctx.close();
({ p, ctx } = await open('tarif')); ok(!p.errs.length, 'Tarifrechner ohne Fehler'); await ctx.close();

console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
await b.close(); process.exit(failures ? 1 : 0);
