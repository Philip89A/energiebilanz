// Führt reference/energiebilanz_v0.14.html mit data/seed_state.json im Browser aus und schreibt alle Kennzahlen
// nach data/golden.json (privat). Vergleichsbasis für tests/calc.reference.test.mjs.
// Aufruf im Repo-Ordner:  npx -y -p playwright node scripts/golden.mjs
// Eigener Browser: CHROMIUM_PATH=/pfad/zu/chrome node scripts/golden.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const seed = readFileSync(base + '/data/seed_state.json', 'utf8');
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext();
await ctx.route(/^https?:/, r => r.abort());          // offline, keine Fonts/Netz
await ctx.addInitScript(s => localStorage.setItem('energiebilanz_v1', s), seed);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + base + '/reference/energiebilanz_v0.14.html');
await p.waitForFunction(() => typeof metrics === 'function' && A && A.n > 0);
const out = await p.evaluate(() => {
  const r = {};
  r.first = firstDataDay(); r.last = lastDataDay(); r.importStart = IMPORT_START(); r.last12 = last12();
  r.periodKeys = { year: periodKeys('year'), quarter: periodKeys('quarter'), month: periodKeys('month') };
  const periods = [['all', periodOf('all')], ['r12', periodOf('r12')], ['vattenfall', { from: '2025-02-01', to: '2026-02-05' }],
    ['custom', { from: '2025-06-10', to: '2025-07-20' }], ['pre', { from: '2025-01-01', to: '2025-03-01' }]];
  for (const m of ['year', 'quarter', 'month']) for (const k of periodKeys(m)) periods.push([m + ':' + k, periodOf(m, k)]);
  const sel = o => { const c = { ...o }; delete c.g; return c; };
  const costOut = c => ({ per: c.per.map(p => ({ name: p.t.name, kwh: p.kwh, apE: p.apE, gpE: p.gpE, bo: p.bo || 0, days: p.days, from: p.from, to: p.to })),
    monthly: c.monthly, unpricedKwh: c.unpricedKwh, unpricedDays: c.unpricedDays });
  r.periods = periods.map(([key, P]) => {
    const { from, to } = P;
    const m = metrics(from, to);
    const fd = finData(from, to);
    return { key, from, to, label: P.label ?? null, metrics: m,
      fin: { as: fd.as, wp: fd.wp, direct: fd.direct, battVal: fd.battVal, feedVal: fd.feedVal, sav: fd.sav, cost: fd.cost, boni: fd.boni,
             net: fd.net, noPV: fd.noPV, days: fd.days, months: fd.months, mob: fd.mob },
      costsAs: costOut(costs('as', from, to)), costsWp: costOut(costs('wp', from, to)),
      flow: { s2h: sumRange('s2h', from, to), lossB: m.bch - m.bdis, feedTot: m.feed + (m.bdis - m.b2h) },
      series: ankerSeries(['gen', 'use', 'imp', 'feed', 'bch', 'bdis', 's2h', 's2b', 'pv1', 'pv2', 'pv3', 'pv4'], from, to),
      pvSav: pvSavings(from, to) };
  });
  r.groups = Object.fromEntries(['as', 'wp', 'feed'].map(g => { const s = groupSeries(g); return [g, { pts: s.pts, intervals: s.intervals, daily: s.daily, first: s.first ?? null, last: s.last ?? null }]; }));
  r.last365wp = last365Cost('wp'); r.last365as = last365Cost('as');
  r.amort = amortTimeline();
  r.abschlag = { as: sel(abschlagCheck('as') || {}), wp: sel(abschlagCheck('wp') || {}) };
  for (const g of ['as', 'wp']) if (r.abschlag[g].t) r.abschlag[g].t = r.abschlag[g].t.name;
  r.car = (() => { const c = carCalc(); return { ...c, fs: { ...c.fs } }; })();
  r.fuelStats = fuelStats(); r.icePrice = icePrice();
  r.invest = S.invest.reduce((a, b) => a + (+b.cost || 0), 0);
  r.savAll = pvSavings(A.dates[0], A.dates[A.n - 1]);
  const f0 = firstDataDay(), f1 = lastDataDay(); r.finYears = [];
  for (let y = +f0.slice(0, 4); y <= +f1.slice(0, 4); y++) { const fr = `${y}-01-01` > f0 ? `${y}-01-01` : f0, tt = `${y}-12-31` < f1 ? `${y}-12-31` : f1; const d = finData(fr, tt); r.finYears.push({ y, fr, tt, net: d.net, sav: d.sav, battVal: d.battVal, direct: d.direct, noPV: d.noPV, leon: d.mob.leon }); }
  return r;
});
writeFileSync(base + '/data/golden.json', JSON.stringify(out));
console.log('periods', out.periods.length, 'errors', errs, 'size', JSON.stringify(out).length);
await b.close();
