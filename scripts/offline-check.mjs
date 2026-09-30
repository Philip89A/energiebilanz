// Offline-Test: Service Worker, Schnell-Erfassen, Warteschlange ohne Netz, Neustart offline, Senden bei Netz,
// Serverfehler beim Nachsenden, Offline-Start ohne gültige Sitzung. Supabase wird simuliert (data/seed_state.json).
// Aufruf:  python3 -m http.server 8000 &   dann   npx -y -p playwright node scripts/offline-check.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSeed } from '../js/import.js';
const base = fileURLToPath(new URL('..', import.meta.url));
const seed = JSON.parse(readFileSync(base + 'data/seed_state.json', 'utf8'));
const m = mapSeed(seed), uid = '11111111-1111-4111-8111-111111111111';
const DB = { ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'settings').map(([k, r]) => [k, r.map(x => ({ ...x, user_id: uid }))])), settings: [{ ...m.settings, user_id: uid }], payments: [] };
let failNext = false, failures = 0;
const ok = (c, msg) => { if (!c) failures++; console.log((c ? 'OK   ' : 'FEHL ') + msg); };
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const now = Math.floor(Date.now() / 1000);
const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid } };
await ctx.addInitScript(s => { if (!sessionStorage.getItem('eb_test_init')) { localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s); sessionStorage.setItem('eb_test_init', '1'); } }, JSON.stringify(session));
await ctx.route('**/rest/v1/**', async route => {
  const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop(); DB[t] ??= [];
  const H = { 'access-control-expose-headers': 'Content-Range' };
  if (req.method() === 'POST') {
    if (failNext) { failNext = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulierter Serverfehler' }) }); }
    const keys = (u.searchParams.get('on_conflict') || 'id').split(',');
    for (const r of JSON.parse(req.postData())) { const i = DB[t].findIndex(x => keys.every(k => x[k] === r[k])); if (i >= 0) DB[t][i] = { ...DB[t][i], ...r }; else DB[t].push(r); }
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]', headers: H });
  }
  if (req.method() === 'DELETE') { const f = [...u.searchParams].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]); DB[t] = DB[t].filter(x => !f.every(([k, v]) => String(x[k]) === v)); return route.fulfill({ status: 204, headers: H }); }
  let rows = [...DB[t]]; const o = u.searchParams.get('order'); if (o?.startsWith('day')) rows.sort((a, c) => a.day.localeCompare(c.day) * (o.includes('desc') ? -1 : 1));
  const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim); const rg = req.headers()['range']; if (rg) { const [a, z] = rg.split('-').map(Number); rows = rows.slice(a, z + 1); }
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...H, 'content-range': `0-0/${DB[t].length}` }, body: req.method() === 'HEAD' ? '' : JSON.stringify(rows) });
});
await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
const txt = async s => (await p.textContent(s)).replace(/\s+/g, ' ');
const ready = () => p.waitForSelector('#loading[hidden]', { state: 'attached' });

// 1 Start als installierte App (#quick), Manifest und Service Worker
await p.goto('http://localhost:8000/#quick'); await ready();
ok(await p.isVisible('#p-quick') && (await p.locator('.qbtn').count()) === 4, 'Seite „Erfassen“ mit 4 Knöpfen');
const man = await p.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
ok(man.start_url === './#quick' && man.icons.length === 3 && man.display === 'standalone', 'Manifest gültig');
await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(500);
ok(await p.evaluate(() => !!navigator.serviceWorker.controller) || (await p.reload(), await ready(), await p.evaluate(() => !!navigator.serviceWorker.controller)), 'Service Worker aktiv');

// 2 Zählerstand online mit deutschem Komma
await p.click('[data-q=reading]'); await p.selectOption('#q-m', 'wp'); await p.fill('#q-v', '12.531,5');
ok((await txt('#q-hint')).includes('Verbrauch seitdem'), 'Hinweis: Verbrauch seit letztem Stand');
await p.click('#q-save'); await p.waitForTimeout(300);
ok(DB.meter_readings.some(r => r.meter_id === 'wp' && r.value === 12531.5), 'Zählerstand gespeichert (12.531,5 → 12531.5)');
ok((await txt('#q-msg')).includes('Gespeichert'), 'Bestätigung „Gespeichert“');

// 3 Offline: Tankvorgang wird vorgemerkt
await ctx.setOffline(true); await p.waitForTimeout(200);
ok(await p.isVisible('#offline-banner'), 'Offline-Hinweis sichtbar');
await p.click('[data-q=fuel]'); await p.fill('#q-km', '61000'); await p.fill('#q-l', '40,2'); await p.fill('#q-e', '70,35');
ok((await txt('#q-hint')).includes('1,750 €/l'), 'Hinweis €/l live');
await p.click('#q-save'); await p.waitForTimeout(300);
ok(DB.fuel_log.length === 0 && (await txt('#q-msg')).includes('Offline gespeichert'), 'Tankvorgang offline vorgemerkt, nicht gesendet');
ok((await txt('#pending-banner')).includes('1 Eintrag wartet'), 'Hinweis „1 Eintrag wartet auf Senden“');

// 4 Neustart ohne Netz: App aus dem Cache, Daten aus dem lokalen Stand inkl. wartendem Eintrag
await p.reload(); await ready(); await p.waitForTimeout(300);
ok(await p.isVisible('#p-quick'), 'App startet offline');
ok((await txt('[data-qs=fuel]')).includes('61.000 km'), 'wartender Tankvorgang nach Neustart sichtbar');
ok((await txt('#pending-banner')).includes('1 Eintrag wartet'), 'Warteschlange überlebt Neustart');
await p.goto('http://localhost:8000/#overview'); await p.waitForTimeout(300);
ok((await txt('#ov-kpis')).includes('kWh'), 'Überblick offline aus lokalem Stand');

// 5 Wieder online: automatisch senden
await ctx.setOffline(false); await p.waitForTimeout(1200);
ok(DB.fuel_log.length === 1 && DB.fuel_log[0].liters === 40.2 && DB.fuel_log[0].amount === 70.35, 'Tankvorgang nach Netzrückkehr gesendet');
ok(await p.isHidden('#pending-banner') && await p.isHidden('#offline-banner'), 'Hinweise verschwinden');

// 6 Serverfehler beim Nachsenden: verwerfen und melden
await ctx.setOffline(true); await p.goto('http://localhost:8000/#quick'); await p.waitForTimeout(300);
await p.click('[data-q=charge]'); await p.fill('#q-k', '30'); await p.click('#q-save'); await p.waitForTimeout(200);
failNext = true; await ctx.setOffline(false); await p.waitForTimeout(1500);
ok(DB.charge_log.length === 0 && (await txt('#main')).includes('verworfen'), 'Serverfehler: Eintrag verworfen und gemeldet');
ok(await p.isHidden('#pending-banner'), 'Warteschlange danach leer');

// 7 Offline-Start ohne gültige Sitzung: lokaler Stand, bei Netz Anmeldung verlangt
await ctx.setOffline(true);
await p.evaluate(() => localStorage.removeItem('sb-iweelkcxmqdycmotchxh-auth-token'));
await p.reload(); await p.waitForTimeout(800);
ok(await p.isVisible('#app-shell') && await p.isVisible('#offline-banner'), 'ohne Sitzung offline: App mit lokalem Stand');
await ctx.setOffline(false); await p.waitForTimeout(800);
ok(await p.isVisible('#auth-screen'), 'bei Netz ohne Sitzung: Anmeldung');
ok(errs.length === 0, 'keine JS-Fehler' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
if (failures) { console.log(failures + ' Prüfungen fehlgeschlagen'); process.exit(1); }
