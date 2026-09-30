// Differenztest: js/calc.js gegen die Referenz-HTML. Vergleichswerte in data/golden.json (privat, erzeugt mit
// scripts/golden.mjs aus reference/energiebilanz_v0.14.html + data/seed_state.json). Fehlt data/, wird übersprungen.
// Zusätzlich: die gerundeten Referenzwerte aus data/REFERENZ.md als data/expected.json -> "kennzahlen".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCalc, stateFromDb } from '../js/calc.js';
import { mapSeed } from '../js/import.js';

const dir = process.env.EB_DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const has = (...n) => n.every(x => existsSync(join(dir, x)));
const json = n => JSON.parse(readFileSync(join(dir, n), 'utf8'));
const skip = !has('seed_state.json', 'golden.json') && 'data/seed_state.json oder data/golden.json fehlt';

// Toleranz: relativ 1e-9 bzw. absolut 1e-9 (sumRange rechnet exakt, die Referenz in Fließkomma)
function near(a, b, path, diffs) {
  if (typeof b === 'number' && typeof a === 'number') {
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))) diffs.push(`${path}: calc ${a} ≠ Referenz ${b}`);
  } else if (b && typeof b === 'object') {
    if (!a || typeof a !== 'object') { diffs.push(`${path}: fehlt in calc`); return; }
    for (const k of Object.keys(b)) near(a[k], b[k], `${path}.${k}`, diffs);
  } else if (a !== b && !(a == null && b == null)) diffs.push(`${path}: calc ${JSON.stringify(a)} ≠ Referenz ${JSON.stringify(b)}`);
}

function compareAll(C, G) {
  const diffs = [];
  const chk = (a, b, p) => near(a, b, p, diffs);
  chk(C.firstDataDay(), G.first, 'first'); chk(C.lastDataDay(), G.last, 'last'); chk(C.IMPORT_START(), G.importStart, 'importStart');
  chk(C.last12(), G.last12, 'last12');
  for (const m of ['year', 'quarter', 'month']) chk(C.periodKeys(m), G.periodKeys[m], 'periodKeys.' + m);
  const costOut = c => ({ per: c.per.map(p => ({ name: p.t.name, kwh: p.kwh, apE: p.apE, gpE: p.gpE, bo: p.bo || 0, days: p.days, from: p.from, to: p.to })),
    monthly: c.monthly, unpricedKwh: c.unpricedKwh, unpricedDays: c.unpricedDays });
  for (const P of G.periods) {
    const { from, to, key } = P;
    if (P.label != null) { const [mode, k] = key.includes(':') ? key.split(':') : [key]; chk(C.periodOf(mode, k), { from, to, label: P.label }, `${key}.periodOf`); }
    chk(C.metrics(from, to), P.metrics, `${key}.metrics`);
    chk(C.finData(from, to, '2026-09-30'), P.fin, `${key}.fin`);
    chk(costOut(C.costs('as', from, to)), P.costsAs, `${key}.costsAs`);
    chk(costOut(C.costs('wp', from, to)), P.costsWp, `${key}.costsWp`);
    chk(C.flow(from, to), P.flow, `${key}.flow`);
    const s = C.ankerSeries(['gen', 'use', 'imp', 'feed', 'bch', 'bdis', 's2h', 's2b', 'pv1', 'pv2', 'pv3', 'pv4'], from, to);
    chk({ g: s.g, ks: s.ks, rows: s.rows }, { g: P.series.g, ks: P.series.ks, rows: P.series.rows }, `${key}.series`);
    chk(C.pvSavings(from, to), P.pvSav, `${key}.pvSav`);
  }
  for (const g of ['as', 'wp', 'feed']) chk(C.groupSeries(g), G.groups[g], 'groups.' + g);
  chk(C.last365Cost('wp'), G.last365wp, 'last365wp'); chk(C.last365Cost('as'), G.last365as, 'last365as');
  chk(C.amortTimeline(), G.amort, 'amort');
  for (const g of ['as', 'wp']) { const r = C.abschlagCheck(g); chk({ ...r, t: r?.t?.name }, G.abschlag[g], 'abschlag.' + g); }
  chk(C.carCalc('2026-09-30'), G.car, 'car'); chk(C.fuelStats(), G.fuelStats, 'fuelStats'); chk(C.icePrice(), G.icePrice, 'icePrice');
  chk(C.investTotal(), G.invest, 'invest'); chk(C.pvSavings(C.A.dates[0], C.A.dates[C.A.n - 1]), G.savAll, 'savAll');
  chk(C.finYears('2026-09-30').filter(y => !y.total).map(y => ({ y: y.y, fr: y.fr, tt: y.tt, net: y.d.net, sav: y.d.sav, battVal: y.d.battVal, direct: y.d.direct, noPV: y.d.noPV, leon: y.d.mob.leon })), G.finYears, 'finYears');
  return diffs;
}

test('calc = Referenz-HTML (direkt aus seed_state.json)', { skip }, () => {
  const diffs = compareAll(createCalc(json('seed_state.json')), json('golden.json'));
  assert.deepEqual(diffs.slice(0, 20), [], `${diffs.length} Abweichungen`);
});

test('calc = Referenz-HTML (über Supabase-Format: mapSeed -> stateFromDb)', { skip }, () => {
  const m = mapSeed(json('seed_state.json'));
  const C = createCalc(stateFromDb({ ...m, settings: m.settings }));
  const diffs = compareAll(C, json('golden.json'));
  assert.deepEqual(diffs.slice(0, 20), [], `${diffs.length} Abweichungen`);
});

test('Referenzwerte aus CLAUDE.md/REFERENZ.md (gerundet wie angezeigt)',
  { skip: !has('seed_state.json', 'expected.json') && 'data/ fehlt' }, () => {
  const K = json('expected.json').kennzahlen;
  if (!K) return;
  const C = createCalc(json('seed_state.json'));
  const r12 = C.periodOf('r12'), all = C.periodOf('all');
  const m = C.metrics(r12.from, r12.to), a = C.metrics(all.from, all.to);
  const fr = C.finData(r12.from, r12.to, '2026-09-30'), fa = C.finData(all.from, all.to, '2026-09-30');
  const r = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
  const got = {
    r12_from: r12.from, r12_to: r12.to,
    r12_gen: r(m.gen), r12_use: r(m.use, 1), r12_imp: r(m.imp, 1), r12_feed: r(m.feed, 1),
    r12_s2h: r(C.flow(r12.from, r12.to).s2h, 1), r12_s2b: r(C.sumRange('s2b', r12.from, r12.to), 1),
    r12_bdis: r(m.bdis, 1), r12_b2h: r(m.b2h, 1),
    r12_evq: r(m.evq * 100, 1), r12_aut: r(m.aut * 100, 1), r12_eff: r(m.eff * 100, 1), r12_cyc: r(m.cyc),
    r12_full: m.full, r12_measured: m.measured,
    r12_sav: r(m.sav), r12_battVal: r(m.battVal), r12_asEur: r(m.asEur), r12_asKwh: r(m.asKwh), r12_wpEur: r(m.wpEur), r12_wpKwh: r(m.wpKwh),
    r12_net: r(fr.net), r12_noPV: r(fr.noPV),
    all_gen: Math.floor(a.gen), all_use: Math.floor(a.use), all_feed: r(a.feed), all_loss: r(a.bch - a.bdis),
    all_app_ev: r((a.gen - C.sumRange('feed', all.from, all.to)) / a.gen * 100, 1),
    all_app_aut: r(a.use / (a.use + C.sumRange('imp', all.from, all.to)) * 100, 1),
    all_sav: r(fa.sav), all_battVal: r(fa.battVal), all_net: r(fa.net), all_noPV: r(fa.noPV),
    invest: r(C.investTotal(), 2), invest_n: json('seed_state.json').invest.length,
    break_even: C.amortTimeline().be,
    abschlag_as_now: Math.ceil(C.abschlagCheck('as').recNow), abschlag_as_cur: C.abschlagCheck('as').cur,
    abschlag_wp_now: Math.ceil(C.abschlagCheck('wp').recNow), abschlag_wp_cur: C.abschlagCheck('wp').cur,
    // Kontrolle Zählerlogik: Tarifzeitraum Vattenfall (Stand am 06.02. gilt als Tagesanfang, daher inkl. dieses Tages)
    vattenfall_kwh: r(C.costs('wp').per.find(p => p.t.to && p.t.from <= '2025-02-01' && p.t.to >= '2026-02-01')?.kwh ?? NaN),
  };
  const want = Object.fromEntries(Object.keys(K).map(k => [k, got[k]]));
  assert.deepEqual(want, K);
});
