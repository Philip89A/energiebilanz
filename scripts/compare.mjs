// Seitenvergleich: reference/energiebilanz_v0.14.html gegen die App (http://localhost:8000, Supabase simuliert mit
// data/seed_state.json). Verglichen werden angezeigte Texte (Kennzahlen, Tabellen, Hinweise) und die Daten aller
// Diagramme für 9 Seiten × 6 Ansichten. Bericht: data/compare-report.json (privat).
// Gewollte Abweichungen (v0.4): neutralisierte Textstellen in #ov-todo, #mt-wp, #mt-rec, #ct-flags und die
// ausgeblendeten Löschen-Kreuze in #rd-tbl.
// Aufruf:  python3 -m http.server 8000 &   dann   npx -y -p playwright node scripts/compare.mjs
// Optional: CHROMIUM_PATH=/pfad/zu/chrome, CHROMIUM_ARGS="--flag1 --flag2"
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSeed } from '../js/import.js';
const base = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const seedTxt = readFileSync(base + '/data/seed_state.json', 'utf8');
const seed = JSON.parse(seedTxt);
const b = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: (process.env.CHROMIUM_ARGS || '').split(' ').filter(Boolean) });

const VIEWS = [
  { name: 'all', view: { mode: 'all', key: '', cmp: 'none' } },
  { name: 'r12', view: { mode: 'r12', key: '', cmp: 'none' } },
  { name: '2025-yoy', view: { mode: 'year', key: '2025', cmp: 'prev' } },
  { name: 'q1-2026-yoy', view: { mode: 'quarter', key: '2026-Q1', cmp: 'yoy' } },
  { name: 'm2026-01-prev', view: { mode: 'month', key: '2026-01', cmp: 'prev' } },
  { name: 'custom', view: { mode: 'custom', key: '', from: '2026-05-01', to: '2026-06-15', cmp: 'custom', cfrom: '2025-05-01', cto: '2025-06-15' } },
];
const PAGES = ['overview', 'fin', 'pv', 'batt', 'meter', 'cost', 'amort', 'car', 'log'];
const SEL = ['#pb-info', '#ov-sentence', '#ov-legend', '#ov-kpis', '#ov-cmp-tbl', '#fin-kpis', '#fin-tbl', '#fin-years', '#fin-inv',
  '#pv-kpis', '#pv-top', '#pv-cum-note', '#bt-kpis', '#mt-wp', '#mt-rec', '#rd-tbl', '#ct-kpis', '#ab-tbl', '#ab-flags', '#ct-tbl', '#ct-flags',
  '#am-kpis', '#car-kpis', '#lg-kpis', '#lg-car-kpis', '#lg-km-note', '#fu-tbl', '#ch-tbl', '#cl-tbl', '#ov-todo', '#car-price-info'];

async function grab(p) {
  return p.evaluate(({ SEL }) => {
    const t = {};
    for (const s of SEL) { const e = document.querySelector(s); if (e) t[s] = e.innerText.replace(/\s+/g, ' ').trim(); }
    const ch = (typeof charts !== 'undefined' ? charts : window.__ebCharts) || {};
    const c = {};
    for (const [id, x] of Object.entries(ch)) { if (!x || !x.data) continue; c[id] = { labels: x.data.labels, ds: x.data.datasets.map(d => ({ label: d.label, data: d.data })) }; }
    return { t, c };
  }, { SEL });
}

// Referenz
async function runRef(v, page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route(/^https?:/, r => r.abort());
  const s = { ...seed, view: { ...seed.view, from: '', to: '', cfrom: '', cto: '', ...v.view } };
  await ctx.addInitScript(x => localStorage.setItem('energiebilanz_v1', x), JSON.stringify(s));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + base + '/reference/energiebilanz_v0.14.html#' + page);
  await p.waitForTimeout(150);
  const r = await grab(p); await ctx.close(); return { ...r, errs };
}

// App mit simuliertem Supabase (Daten = Seed im Supabase-Format)
const m = mapSeed(seed);
const uid = '11111111-1111-4111-8111-111111111111';
const DB = { ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'settings').map(([k, rows]) => [k, rows.map(r => ({ ...r, user_id: uid }))])),
  settings: [{ ...m.settings, user_id: uid }], payments: [] };
async function runApp(v, page) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: uid, aud: 'authenticated', email: 't@t' } };
  await ctx.addInitScript(([s, vw]) => { localStorage.setItem('sb-iweelkcxmqdycmotchxh-auth-token', s); localStorage.setItem('eb_view_v1', vw); },
    [JSON.stringify(session), JSON.stringify({ view: { mode: 'all', key: '', from: '', to: '', cmp: 'none', cfrom: '', cto: '', ...v.view } })]);
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request(), u = new URL(req.url()), t = u.pathname.split('/').pop();
    let rows = [...(DB[t] || [])];
    const o = u.searchParams.get('order'); if (o?.startsWith('day')) rows.sort((a, c) => a.day.localeCompare(c.day) * (o.includes('desc') ? -1 : 1));
    const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim);
    const rg = req.headers()['range']; if (rg) { const [a, z] = rg.split('-').map(Number); rows = rows.slice(a, z + 1); }
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-expose-headers': 'Content-Range', 'access-control-allow-origin': '*', 'content-range': `0-${Math.max(rows.length - 1, 0)}/${(DB[t] || []).length}` },
      body: req.method() === 'HEAD' ? '' : JSON.stringify(rows) });
  });
  await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', x => { if (x.type() === 'error') errs.push(x.text()); });
  await p.goto('http://localhost:8000/#' + page);
  await p.waitForSelector('#loading[hidden]', { state: 'attached' });
  await p.waitForTimeout(150);
  const r = await grab(p); await ctx.close(); return { ...r, errs };
}

const report = []; let nText = 0, nChart = 0;
const norm = x => JSON.stringify(x, (k, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
for (const v of VIEWS) for (const page of PAGES) {
  const [R, P] = await Promise.all([runRef(v, page), runApp(v, page)]);
  if (R.errs.length || P.errs.length) report.push({ v: v.name, page, errs: { ref: R.errs, app: P.errs } });
  for (const s of SEL) { if (!(s in R.t)) continue; nText++; if (R.t[s] !== P.t[s]) report.push({ v: v.name, page, sel: s, ref: R.t[s], app: P.t[s] }); }
  for (const id of Object.keys(R.c)) { nChart++; if (norm(R.c[id]) !== norm(P.c[id])) report.push({ v: v.name, page, chart: id, ref: norm(R.c[id]).slice(0, 300), app: norm(P.c[id] || null).slice(0, 300) }); }
}
writeFileSync(base + '/data/compare-report.json', JSON.stringify(report, null, 1));
console.log('verglichen:', nText, 'Textblöcke,', nChart, 'Diagramme; Abweichungen:', report.length);
const bySel = {}; report.forEach(r => { const k = r.sel || r.chart || 'errs'; bySel[k] = (bySel[k] || 0) + 1; }); console.log(bySel);
await b.close();
