// Rechenlogik der Energiebilanz – reine Funktionen, ohne DOM und ohne Supabase.
// Portiert aus reference/energiebilanz_v0.14.html (zweiter <script>-Block). Die Funktionen sind bewusst
// nah am Original gehalten (gleiche Namen, gleiche Reihenfolge der Rechenschritte), damit sie sich Zeile für
// Zeile gegen die Referenz prüfen lassen. Abweichung: sumRange summiert exakt in Tausendsteln (Wh).
//
// Einstieg:  const C = createCalc(state)
//   state = Referenzform: { anker:{dates:[],c:{ev,imp,…}} | {start,n,c}, meters, readings, events, tariffs,
//           abschlaege, invest, fuel, charges, carlog, battery, pv, amort, cars }
//   stateFromDb(db) wandelt Supabase-Zeilen in diese Form um.

import { hpSum } from './hp.js?v=0.18.0';

export const ANKER_KEYS = { ev: 'eigenverbrauch', imp: 'netzimport', n2h: 'netz_zu_haus', s2h: 'solar_zu_haus',
  s2b: 'solar_zu_speicher', bch: 'speicher_ladung', bdis: 'speicher_entladung', b2h: 'speicher_zu_haus',
  use: 'genutzt', gen: 'erzeugung', feed: 'einspeisung', pv1: 'pv1', pv2: 'pv2', pv3: 'pv3', pv4: 'pv4', plug: 'smart_plug' };

/* ---------- Datumshilfen ---------- */
const DAY = 86400000;
const toD = s => new Date(s + 'T00:00:00Z');
export const iso = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(toD(s).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((toD(b) - toD(a)) / DAY);
export const monthKey = s => s.slice(0, 7);
export const monthEnd = k => addDays(`${k}-01`, new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate() - 1);
export function shiftYear(d, n = -1) { const y = +d.slice(0, 4) + n; let md = d.slice(5); if (md === '02-29') md = '02-28'; return `${y}-${md}`; }
export function nextMonth(k) { const y = +k.slice(0, 4), m = +k.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
export function addMonths(s, n) {
  const d = toD(s), y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const first = new Date(Date.UTC(y, m, 1)), dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, dim)); return iso(first);
}
export function weekKey(d) { const day = (toD(d).getUTCDay() + 6) % 7; return addDays(d, -day); }
export const gran = (from, to) => (diffDays(from, to) <= 62 ? 'day' : 'month');
export const bucketOf = (d, g) => (g === 'day' ? d : monthKey(d));
export function carBucket(d, g) {
  if (g === 'week') return weekKey(d); if (g === 'month') return monthKey(d);
  if (g === 'quarter') return `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`; return d.slice(0, 4);
}

export const CAR_CATS = ['Kilometerstand', 'Versicherung', 'Kfz-Steuer', 'Räderwechsel', 'Räder/Reifen', 'Wartung/Reparatur', 'Pflege', 'Überführung', 'Sonstiges'];

/* ---------- Supabase-Zeilen -> Referenzform ---------- */
export function stateFromDb(db) {
  const rows = [...(db.anker_daily || [])].sort((a, b) => a.day.localeCompare(b.day));
  const c = Object.fromEntries(Object.keys(ANKER_KEYS).map(k => [k, []]));
  for (const r of rows) for (const [k, col] of Object.entries(ANKER_KEYS)) c[k].push(r[col] == null ? null : +r[col]);
  const s = db.settings?.data || {};
  return {
    anker: { dates: rows.map(r => r.day), c },
    meters: (db.meters || []).map(m => ({ id: m.id, name: m.name, group: m.grp, order: +m.sort || 0 })),
    readings: (db.meter_readings || []).map(r => ({ m: r.meter_id, d: r.day, v: +r.value, src: r.source })),
    events: (db.events || []).map(e => ({ id: e.id, d: e.day, group: e.grp, type: e.type, text: e.note })),
    tariffs: (db.tariffs || []).map(t => ({ id: t.id, group: t.grp, name: t.name, from: t.valid_from, to: t.valid_to || '',
      ap: +t.ap_ct, gp: +t.gp_eur_year, boni: +t.boni_eur || 0, boniNote: t.boni_note || '', est: t.estimate_note || '',
      ...(Array.isArray(t.boni_items) ? { boniItems: t.boni_items } : {}) })),
    abschlaege: (db.installments || []).map(a => ({ id: a.id, group: a.grp, from: a.valid_from, amount: +a.amount, note: a.note || '' })),
    invest: (db.investments || []).map(x => ({ id: x.id, name: x.name, date: x.day || '', cost: +x.cost, ...(x.category ? { cat: x.category } : {}) })),
    fuel: (db.fuel_log || []).map(x => ({ id: x.id, d: x.day, km: +x.odometer, l: +x.liters, e: +x.amount, s: x.fuel_type, full: x.full_tank })),
    charges: (db.charge_log || []).map(x => ({ id: x.id, d: x.day, km: x.odometer == null ? null : +x.odometer, k: +x.kwh, e: x.amount == null ? 0 : +x.amount, o: x.location })),
    carlog: (db.car_log || []).map(x => ({ id: x.id, d: x.day, car: x.car, cat: x.category, km: x.odometer == null ? null : +x.odometer, e: +x.amount || 0, note: x.note || '' })),
    payments: (db.payments || []).map(x => ({ id: x.id, group: x.grp, d: x.day, amount: +x.amount, kind: x.kind, note: x.note || '' })),
    battery: s.battery || {}, pv: s.pv || {}, amort: s.amort || {}, cars: s.cars || { ice: {}, ev: {} },
    tarif: s.tarif || {}, ausbau: s.ausbau || {}, wx: s.wx || {},
    weather: (db.weather_daily || []).map(r => ({ d: r.day, t: +r.temp_mean, rad: +r.rad_kwh, sun: r.sun_h == null ? null : +r.sun_h }))
      .sort((a, b) => a.d.localeCompare(b.d)),
    weatherError: db.weatherError || null,
    hp: (db.hp_energy || []).map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !['user_id', 'created_at', 'updated_at'].includes(k))
      .map(([k, v]) => [k, ['grain', 'ts'].includes(k) || v == null ? v : +v]))),
    hpError: db.hpError || null,
  };
}

// Referenzform -> Supabase-Zeile (Umkehrung von stateFromDb), je Datensatzart. user_id setzt db.js.
export const toDb = {
  reading: r => ({ meter_id: r.m, day: r.d, value: +r.v, source: r.src || null }),
  tariff: t => ({ id: t.id, grp: t.group, name: t.name, valid_from: t.from, valid_to: t.to || null, ap_ct: +t.ap,
    gp_eur_year: +t.gp, boni_eur: +t.boni || 0, boni_note: t.boniNote || null, estimate_note: t.est || null,
    ...(Array.isArray(t.boniItems) ? { boni_items: t.boniItems } : {}) }),   // Spalte erst ab schema v3, nur senden wenn genutzt
  installment: a => ({ id: a.id, grp: a.group, valid_from: a.from, amount: +a.amount, note: a.note || null }),
  investment: x => ({ id: x.id, day: x.date || null, name: x.name, cost: +x.cost || 0, ...(x.cat ? { category: x.cat } : {}) }),   // Spalte erst ab schema v4
  fuel: x => ({ id: x.id, day: x.d, odometer: +x.km, liters: +x.l, amount: +x.e, fuel_type: x.s || null, full_tank: !!x.full }),
  charge: x => ({ id: x.id, day: x.d, odometer: x.km ? +x.km : null, kwh: +x.k, amount: x.e == null ? null : +x.e, location: x.o || null }),
  carlog: x => ({ id: x.id, day: x.d, car: x.car, category: x.cat, odometer: x.km ? +x.km : null, amount: +x.e || 0, note: x.note || null }),
  event: e => ({ id: e.id, day: e.d, grp: e.group || null, type: e.type || null, note: e.text || null }),
  payment: x => ({ id: x.id, grp: x.group, day: x.d, amount: +x.amount, kind: x.kind, note: x.note || null }),
  settings: S => ({ data: { schema_version: 2, battery: S.battery, pv: S.pv, amort: S.amort, cars: S.cars, ...(S.tarif && Object.keys(S.tarif).length ? { tarif: S.tarif } : {}),
    ...(S.ausbau && Object.keys(S.ausbau).length ? { ausbau: S.ausbau } : {}),
    ...(S.wx && Object.keys(S.wx).length ? { wx: S.wx } : {}) } }),
};

/* ---------- Rechenkern ---------- */
export function createCalc(S) {
  // Anker-Daten: entweder {start, n, c} (seed_state.json) oder {dates, c} (stateFromDb)
  const src = S.anker;
  const dates = src.dates ? [...src.dates] : Array.from({ length: src.n }, (_, i) => addDays(src.start, i));
  const A = { dates, c: src.c, n: dates.length, idx: Object.fromEntries(dates.map((d, i) => [d, i])) };
  if (!A.n) throw new Error('Keine Anker-Daten.');

  // Smart-Meter-Start: Ereignis (pv/daten); ohne Ereignis der erste Tag mit gemessenem Netzbezug oder Einspeisung
  const smFallback = (() => { const i = A.dates.findIndex((d, j) => (A.c.imp[j] || 0) > 0 || (A.c.feed[j] || 0) > 0); return i >= 0 ? A.dates[i] : A.dates[A.n - 1]; })();
  const IMPORT_START = () => (S.events.find(e => e.type === 'daten' && e.group === 'pv') || { d: smFallback }).d;
  // exakt in Tausendsteln summieren (Fließkomma-Summen landen bei exakten ,x5-Werten sonst knapp darunter und runden ab)
  function sumRange(key, from, to) { let s = 0; A.dates.forEach((d, i) => { if (d >= from && d <= to) s += Math.round((A.c[key][i] || 0) * 1000); }); return s / 1000; }
  function last12() { const to = A.dates[A.n - 1]; return { from: addDays(to, -364), to }; }

  /* Zähler: Tageswerte aus Ablesungen */
  const _gcache = new Map();
  // Gewicht eines Tages für die Wärmepumpe aus den Gerätedaten (Strom inkl. Zuheizer), null = unbekannt
  // v0.15: Exporte mit nur Stundenwerten – vollständige Tage (mind. 23 Stunden, Sommerzeit) aus den Stunden bilden,
  // Monate ohne Monatszeile aus den Tagen (partial = laufender bzw. unvollständiger Monat). Echte Zeilen haben Vorrang.
  const HP_F = ['el_hp', 'el_heat', 'el_cool', 'el_dhw', 'el_aux', 'el_aux_heat', 'el_aux_dhw', 'heat_heat', 'heat_dhw', 'heat_cool'];
  const HP = (() => {
    const rows = S.hp || [], has = g => new Set(rows.filter(r => r.grain === g).map(r => r.ts));
    const sumOf = (list, base) => { const o = { ...base }; for (const f of HP_F) o[f] = list.reduce((a, h) => a + (+h[f] || 0), 0);
      const t = list.map(h => h.t_out).filter(v => v != null); o.t_out = t.length ? t.reduce((a, b) => a + b, 0) / t.length : null; return o; };
    const days = has('day'), byDay = {};
    for (const r of rows) if (r.grain === 'hour') (byDay[r.ts.slice(0, 10)] = byDay[r.ts.slice(0, 10)] || []).push(r);
    const dAdd = Object.entries(byDay).filter(([d, hs]) => !days.has(d) && hs.length >= 23).map(([d, hs]) => sumOf(hs, { grain: 'day', ts: d, fromHours: true }));
    const allDays = [...rows.filter(r => r.grain === 'day'), ...dAdd], months = has('month'), byMonth = {};
    for (const r of allDays) (byMonth[r.ts.slice(0, 7)] = byMonth[r.ts.slice(0, 7)] || []).push(r);
    const mAdd = Object.entries(byMonth).filter(([k]) => !months.has(k))
      .map(([k, ds]) => sumOf(ds, { grain: 'month', ts: k, fromDays: true, partial: ds.length < +monthEnd(k).slice(8, 10) }));
    return [...rows, ...dAdd, ...mAdd];
  })();
  const _hpDay = {}, _hpMonth = {};
  for (const r of HP) { const v = (+r.el_hp || 0) + (+r.el_aux || 0); if (r.grain === 'day') _hpDay[r.ts] = v; else if (r.grain === 'month' && !r.fromDays) _hpMonth[r.ts] = v; }   // abgeleitete Monate nicht verteilen
  // Gerätedaten gelten erst ab dem Tausch (Ereignis wp/geraet): Tage davor gehören zur alten Wärmepumpe
  const _hpFrom = (S.events.find(e => e.type === 'geraet' && e.group === 'wp') || {}).d || '';
  function hpWeight(d) {
    if (d < _hpFrom) return null;
    if (_hpDay[d] !== undefined) return _hpDay[d];
    const m = _hpMonth[monthKey(d)]; if (m === undefined) return null;
    const k = monthKey(d), first = _hpFrom > `${k}-01` ? _hpFrom : `${k}-01`, dim = diffDays(first, monthEnd(k)) + 1;
    const known = Object.keys(_hpDay).filter(x => x.startsWith(k) && x >= first);
    // Monatsrest ohne Tageswerte gleichmäßig auf die übrigen Tage (im Tauschmonat erst ab dem Tauschtag)
    const rest = m - known.reduce((a, x) => a + _hpDay[x], 0), n = dim - known.length;
    return n > 0 ? Math.max(0, rest) / n : null;
  }
  function groupSeries(group) {
    if (_gcache.has(group)) return _gcache.get(group);
    const meters = S.meters.filter(m => m.group === group).sort((a, b) => a.order - b.order);
    let pts = [], offset = 0, prevEnd = null;
    meters.forEach((m, k) => {
      const rs = S.readings.filter(r => r.m === m.id).sort((a, b) => a.d.localeCompare(b.d));
      if (!rs.length) return;
      if (k > 0 && prevEnd != null) offset = prevEnd - rs[0].v;
      rs.forEach(r => pts.push({ d: r.d, cum: r.v + offset, m: m.id }));
      prevEnd = rs[rs.length - 1].v + offset;
    });
    pts.sort((a, b) => a.d.localeCompare(b.d));
    const ded = []; pts.forEach(p => { if (ded.length && ded[ded.length - 1].d === p.d) ded[ded.length - 1] = p; else ded.push(p); });
    const intervals = [], daily = {};
    for (let i = 0; i < ded.length - 1; i++) {
      const a = ded[i], b = ded[i + 1], n = diffDays(a.d, b.d); if (n <= 0) continue;
      const kw = b.cum - a.cum, rate = kw / n; intervals.push({ from: a.d, to: b.d, days: n, kwh: kw, rate });
      const days = [...Array(n).keys()].map(j => addDays(a.d, j));
      let shaped = false;
      if (group === 'as') {
        // Allgemeinstrom: Verteilung nach dem Anker-Netzbezug (ab Smart Meter), Rest gleichmäßig auf Tage ohne Messung
        const is = IMPORT_START(), meas = days.filter(d => d >= is && A.idx[d] !== undefined), pre = days.filter(d => !(d >= is && A.idx[d] !== undefined));
        if (meas.length) {
          const sImp = meas.reduce((s, d) => s + A.c.imp[A.idx[d]], 0), rem = kw - sImp;
          if (sImp > 0 && (rem >= 0 || !pre.length) && (pre.length || Math.abs(rem) / kw < 0.5)) {
            const f = pre.length ? 1 : kw / sImp;
            meas.forEach(d => daily[d] = A.c.imp[A.idx[d]] * f);
            pre.forEach(d => daily[d] = rem / pre.length);
            shaped = true; intervals[intervals.length - 1].shaped = true;
          }
        }
      }
      if (!shaped && group === 'wp') {
        // Wärmepumpe (v0.12): Verteilung nach dem Geräteprofil aus der Wärmepumpen-App – Tageswert, sonst
        // Monatswert ÷ Tage des Monats. Nur wenn jeder Tag des Intervalls einen Wert hat und die Summe > 0 ist.
        const w = days.map(hpWeight);
        const sw = w.reduce((a, x) => a + (x ?? 0), 0);
        if (w.every(x => x != null) && sw > 0) {
          days.forEach((d, j) => daily[d] = kw * w[j] / sw);
          shaped = true; intervals[intervals.length - 1].shaped = 'hp';
        }
      }
      if (!shaped) days.forEach(d => daily[d] = rate);
    }
    const res = { pts: ded, intervals, daily, first: ded[0]?.d, last: ded[ded.length - 1]?.d };
    _gcache.set(group, res); return res;
  }

  /* Tarife und Kosten */
  function tariffAt(group, d) { return S.tariffs.find(t => t.group === group && t.from <= d && (!t.to || d <= t.to)); }
  function currentTariff(group) { const ts = S.tariffs.filter(t => t.group === group).sort((a, b) => b.from.localeCompare(a.from)); return ts[0]; }
  function costs(group, from, to) {
    const g = groupSeries(group), per = {}, monthly = {};
    let unpricedKwh = 0, unpricedDays = 0;
    for (const [d, k] of Object.entries(g.daily)) {
      if ((from && d < from) || (to && d > to)) continue;
      const t = tariffAt(group, d);
      if (!t) { unpricedKwh += k; unpricedDays++; continue; }
      const p = per[t.id] = per[t.id] || { t, kwh: 0, apE: 0, gpE: 0, days: 0, from: d, to: d };
      p.kwh += k; p.apE += k * t.ap / 100; p.gpE += t.gp / 365; p.days++; if (d < addDays(t.from, 365)) p.bo = (p.bo || 0) + boniOf(t) / 365; if (d < p.from) p.from = d; if (d > p.to) p.to = d;
      const mk = monthKey(d); monthly[mk] = (monthly[mk] || 0) + k * t.ap / 100 + t.gp / 365;
    }
    return { g, per: Object.values(per).sort((a, b) => a.from.localeCompare(b.from)), monthly, unpricedKwh, unpricedDays };
  }
  function last365Cost(group) {
    const g = groupSeries(group); if (!g.last) return null;
    const from = addDays(g.last, -364); let kw = 0, e = 0, days = 0;
    for (const [d, k] of Object.entries(g.daily)) { if (d < from) continue; const t = tariffAt(group, d) || currentTariff(group); kw += k; e += k * t.ap / 100 + t.gp / 365; days++; }
    return { kwh: kw, eur: e, days, from, to: g.last };
  }

  /* Einspeisevergütung und PV-Ersparnis */
  function feedValue(from, to) {
    const r = +S.amort.feedin || 0; if (!r) return 0; const f0 = S.amort.feedinFrom || '';
    let k = 0; A.dates.forEach((d, i) => { if (d < from || d > to || (f0 && d < f0)) return; k += A.c.feed[i]; }); return k * r / 100;
  }
  function pvSavings(from, to) {
    let e = 0, k = 0; A.dates.forEach((d, i) => { if (d < from || d > to) return; const t = tariffAt('as', d) || currentTariff('as'); const u = A.c.use[i]; k += u; e += u * t.ap / 100; });
    return { kwh: k, eur: e + feedValue(from, to) };
  }

  /* E-Auto zu Hause (Ladebuch, Ort „zu Hause“): läuft über den Allgemeinstrom-Zähler */
  const isHome = c => /zu hause/i.test(c.o || '');
  function homeCharging(from, to) {
    let kwh = 0, eur = 0; const e = S.cars.ev || {}, pub = +e.pricePublic || 0;
    for (const c of S.charges) { if (!isHome(c) || c.d < from || c.d > to) continue; const t = tariffAt('as', c.d) || currentTariff('as');
      kwh += +c.k || 0; eur += (+c.k || 0) * (pub - (t ? t.ap : 0) / 100); }
    return { kwh, saving: eur };     // saving: gegenüber öffentlichem Laden
  }
  // Beginn der Wallbox-Wirkung: erste Investition der Kategorie „wallbox“
  const wallboxFrom = () => S.invest.filter(x => x.cat === 'wallbox').map(x => x.date || A.dates[0]).sort()[0] || null;

  /* Zeiträume */
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const dde = s => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '–');
  function lastDataDay() {
    const ends = [A.dates[A.n - 1]]; ['as', 'wp'].forEach(g => { const s = groupSeries(g); if (s.last) ends.push(addDays(s.last, -1)); });
    return ends.sort().pop();
  }
  function firstDataDay() {
    const st = [A.dates[0]]; ['as', 'wp'].forEach(g => { const s = groupSeries(g); if (s.first) st.push(s.first); });
    return st.sort()[0];
  }
  function periodOf(mode, key, cf, ct) {
    const endData = lastDataDay();
    if (mode === 'year') return { from: `${key}-01-01`, to: `${key}-12-31`, label: key };
    if (mode === 'quarter') {
      const y = key.slice(0, 4), q = +key.slice(6); const m1 = String((q - 1) * 3 + 1).padStart(2, '0'), m3 = String(q * 3).padStart(2, '0');
      return { from: `${y}-${m1}-01`, to: monthEnd(`${y}-${m3}`), label: `Q${q} ${y}` };
    }
    if (mode === 'month') return { from: `${key}-01`, to: monthEnd(key), label: `${MON[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}` };
    if (mode === 'all') { const f = firstDataDay(); return { from: f, to: endData, label: `Gesamter Zeitraum (${dde(f)} – ${dde(endData)})` }; }
    if (mode === 'custom' && cf && ct && cf <= ct) return { from: cf, to: ct, label: `${dde(cf)} – ${dde(ct)}` };
    return { from: addDays(endData, -364), to: endData, label: `12 Monate bis ${dde(endData)}` };
  }
  function periodKeys(mode) {
    const f = firstDataDay(), t = lastDataDay(), out = [];
    if (mode === 'year') { for (let y = +f.slice(0, 4); y <= +t.slice(0, 4); y++) out.push(String(y)); }
    else if (mode === 'quarter') { for (let y = +f.slice(0, 4); y <= +t.slice(0, 4); y++) for (let q = 1; q <= 4; q++) { const k = `${y}-Q${q}`; const p = periodOf('quarter', k); if (p.to >= f && p.from <= t) out.push(k); } }
    else if (mode === 'month') { let k = f.slice(0, 7); while (k <= t.slice(0, 7)) { out.push(k); k = nextMonth(k); } }
    return out.reverse();
  }
  // view = { mode, key, from, to, cmp, cfrom, cto } (je Gerät im localStorage)
  function currentPeriods(v) {
    const P = periodOf(v.mode, v.key, v.from, v.to);
    let C = null;
    if (v.cmp === 'yoy') C = { from: shiftYear(P.from), to: shiftYear(P.to), label: 'Vorjahr' };
    else if (v.cmp === 'prev') {
      if (v.mode === 'year') C = periodOf('year', String(+v.key - 1));
      else if (v.mode === 'month') { const y = +v.key.slice(0, 4), m = +v.key.slice(5, 7); C = periodOf('month', m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`); }
      else if (v.mode === 'quarter') { const y = +v.key.slice(0, 4), q = +v.key.slice(6); C = periodOf('quarter', q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`); }
      else { const n = diffDays(P.from, P.to) + 1; C = { from: addDays(P.from, -n), to: addDays(P.from, -1) }; C.label = `${dde(C.from)} – ${dde(C.to)}`; }
      C.label = 'Vorperiode (' + C.label + ')';
    }
    else if (v.cmp === 'custom' && v.cfrom && v.cto && v.cfrom <= v.cto) C = { from: v.cfrom, to: v.cto, label: `${dde(v.cfrom)} – ${dde(v.cto)}` };
    if (C && C.label === 'Vorjahr') C.label = `Vorjahr (${dde(C.from)} – ${dde(C.to)})`;
    return { P, C };
  }

  /* Kennzahlen je Zeitraum */
  function valueAt(key, from, to) { let e = 0; A.dates.forEach((d, i) => { if (d < from || d > to) return; const t = tariffAt('as', d) || currentTariff('as'); e += A.c[key][i] * t.ap / 100; }); return e; }
  function periodCost(group, from, to) {
    const g = groupSeries(group); let kw = 0, e = 0, bo = 0, days = 0, unp = 0;
    for (const [d, k] of Object.entries(g.daily)) {
      if (d < from || d > to) continue; const t = tariffAt(group, d); days++;
      if (!t) { unp += k; kw += k; continue; } kw += k; e += k * t.ap / 100 + t.gp / 365; if (d < addDays(t.from, 365)) bo += boniOf(t) / 365;
    }
    return { kwh: kw, eur: e, bo, days, unp };
  }
  const _mcache = new Map();
  function metrics(from, to) {
    const ck = from + '|' + to;
    if (_mcache.has(ck)) return _mcache.get(ck);
    const s = k => sumRange(k, from, to), is = IMPORT_START(), b = S.battery, usable = b.capGross * (1 - b.reserve / 100);
    const days = diffDays(from, to) + 1, ankDays = A.dates.filter(d => d >= from && d <= to).length;
    const af = from > is ? from : is, autOK = af <= to && A.dates.some(d => d >= af && d <= to);
    const useA = autOK ? sumRange('use', af, to) : 0, impA = autOK ? sumRange('imp', af, to) : 0;
    let full = 0, measured = 0; A.dates.forEach((d, i) => { if (d < from || d > to || d < is) return; measured++; if (A.c.feed[i] >= b.fullThresh) full++; });
    const gen = s('gen'), use = s('use'), bch = s('bch'), bdis = s('bdis'), b2h = s('b2h'), feed = s('feed');
    const as = periodCost('as', from, to), wp = periodCost('wp', from, to);
    const sav = ankDays ? valueAt('use', from, to) + feedValue(from, to) : null;
    const impDays = A.dates.filter(d => d >= from && d <= to && d >= is).length, feedOK = ankDays > 0 && impDays / ankDays >= 0.5;
    const m = { days, ankDays, asDays: as.days, wpDays: wp.days, bch, b2h, feed: feedOK ? feed : null,
      imp: feedOK ? impA : null, aut: feedOK && (useA + impA) > 0 ? useA / (useA + impA) : null, impDays, evq: gen > 0 ? use / gen : null,
      eff: bch > 0 ? bdis / bch : null, cyc: ankDays ? bdis / usable : null, full: feedOK ? full : null, measured, sav,
      battVal: ankDays ? valueAt('b2h', from, to) : null, gen: ankDays ? gen : null, use: ankDays ? use : null, bdis: ankDays ? bdis : null,
      asKwh: as.days ? as.kwh : null, asEur: as.days ? as.eur : null, asBo: as.bo, wpKwh: wp.days ? wp.kwh : null, wpEur: wp.days ? wp.eur : null, wpBo: wp.bo,
      asTotal: as.days && ankDays ? as.kwh + use : null, pvShare: as.days && ankDays && (as.kwh + use) > 0 ? use / (as.kwh + use) : null,
      house: as.days && wp.days && ankDays ? as.kwh + use + wp.kwh : null };
    _mcache.set(ck, m); return m;
  }
  // Energiefluss (Überblick): direkt ins Haus, über den Speicher, Verlust, eingespeist inkl. Rest aus dem Speicher
  function flow(from, to) {
    const m = metrics(from, to);
    return { s2h: sumRange('s2h', from, to), b2h: m.b2h, lossB: m.bch - m.bdis, feedTot: m.feed + (m.bdis - m.b2h) };
  }
  // Zeitreihe mit automatischer Auflösung: bis 62 Tage je Tag, sonst je Monat
  function ankerSeries(keys, from, to, g) {
    g = g || gran(from, to); const out = {};
    A.dates.forEach((d, i) => { if (d < from || d > to) return; const k = bucketOf(d, g); const o = out[k] = out[k] || { _n: 0 }; o._n++; keys.forEach(x => o[x] = (o[x] || 0) + A.c[x][i]); });
    const ks = Object.keys(out).sort(); return { g, ks, rows: ks.map(k => out[k]) };
  }
  function battery(from, to) {
    const b = S.battery, m = metrics(from, to);
    return { usable: b.capGross * (1 - b.reserve / 100), fullShare: m.measured ? m.full / m.measured : null };
  }

  /* Amortisation entlang der Investitionsdaten */
  function amortTimeline() {
    const am = S.amort, items = S.invest.filter(x => x.cat !== 'refund').map(x => ({ ...x, date: x.date || A.dates[0] })).sort((a, b) => a.date.localeCompare(b.date));
    const startK = monthKey(items[0]?.date || A.dates[0]);
    const act = {}, feedK = {};
    A.dates.forEach((d, i) => {
      const t = tariffAt('as', d) || currentTariff('as'), k = monthKey(d);
      act[k] = (act[k] || 0) + A.c.use[i] * t.ap / 100 + ((am.feedin && (!am.feedinFrom || d >= am.feedinFrom)) ? A.c.feed[i] * am.feedin / 100 : 0);
      feedK[k] = (feedK[k] || 0) + A.c.feed[i];
    });
    const lastD = A.dates[A.n - 1], lastK = monthKey(lastD), dim = +monthEnd(lastK).slice(8, 10), have = +lastD.slice(8, 10);
    if (have < dim) act[lastK] = act[lastK] * dim / have;           // angefangenen Monat hochrechnen
    // Wallbox (v0.9): gemessen = Laden zu Hause laut Ladebuch × (öffentlicher Preis − Arbeitspreis), ab erster
    // Wallbox-Investition; Prognose aus dem Auto-Vergleich (kWh zu Hause pro Jahr) ab Übergabe des E-Autos
    const wbFrom = wallboxFrom(), ev = S.cars.ev || {}, wbK = {};
    if (wbFrom) for (const c of S.charges) { if (!isHome(c) || c.d < wbFrom || monthKey(c.d) > lastK) continue;
      const t = tariffAt('as', c.d) || currentTariff('as'); wbK[monthKey(c.d)] = (wbK[monthKey(c.d)] || 0) + (+c.k || 0) * ((+ev.pricePublic || 0) - (t ? t.ap : 0) / 100); }
    const tb = wbFrom ? tariffBase() : null, apNow = (currentTariff('as')?.ap || 0) / 100;
    const wbYear = tb ? tb.evHome * ((+ev.pricePublic || 0) - apNow) : 0, wbStartK = wbFrom ? monthKey([wbFrom, ev.start || wbFrom].sort()[1]) : null;
    // Erstattungen/Gutschriften (v0.18): gebuchte Beträge als Ersparnis im Monat des Eingangs. Prognose für §14a (Wert der
    // Ausbau-Seite, ab Wallbox und Übergabe) und THG-Prämie (Auto-Vergleich, ab Übergabe), jeweils frühestens 12 Monate
    // nach der letzten gebuchten Gutschrift dieser Art (Name enthält „14a“ bzw. „THG“), damit nichts doppelt zählt.
    const refunds = S.invest.filter(x => x.cat === 'refund').map(x => ({ ...x, date: x.date || A.dates[0] })), refK = {};
    refunds.forEach(x => { const rk = monthKey(x.date); refK[rk] = (refK[rk] || 0) + (+x.cost || 0); });
    const kindOf = x => (/14a/i.test(x.name || '') ? 's14a' : /thg/i.test(x.name || '') ? 'thg' : 'other');
    const fcStart = (kind, startK) => { if (!startK) return null; const lb = refunds.filter(x => kindOf(x) === kind).map(x => x.date).sort().pop();
      return [startK, lb ? monthKey(addMonths(lb, 12)) : null].filter(Boolean).sort().pop(); };
    const au = { ...AUSBAU_DEFAULTS, ...(S.ausbau || {}) };
    let s14Year = 0;
    if (am.s14aFc !== false && au.s14a && wbFrom) {
      if (au.s14aMod === 'manual') s14Year = +au.s14aEur || 0;
      else { const w = tarifRechner(tariffBase(), { as: currentTariff('as'), wp: currentTariff('wp') }, S.tarif || {}).wallbox.find(x => x.key === au.s14aMod); s14Year = w ? Math.max(0, -w.vsNone) : 0; }
    }
    const thgYear = am.thg !== false ? (+ev.thg || 0) : 0;
    const s14K = s14Year ? fcStart('s14a', wbStartK) : null, thgK = thgYear ? fcStart('thg', ev.start ? monthKey(ev.start) : null) : null;
    const prof = {}, profFeed = {}; let k = lastK;
    for (let j = 0; j < 12; j++) { const cm = k.slice(5, 7); if (prof[cm] === undefined) { prof[cm] = act[k] || 0; profFeed[cm] = feedK[k] || 0; } const y = +k.slice(0, 4), m = +k.slice(5, 7); k = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
    const labels = [], cumS = [], cumI = [], proj = []; let cs = 0, be = null; k = startK;
    const total = am.years * 12; let idxLast = null;
    for (let j = 0; j < total; j++) {
      let v;
      if (k <= lastK) { v = (act[k] || 0) + (wbK[k] || 0) + (refK[k] || 0); if (k === lastK) idxLast = j; }
      else {
        const yrs = (j - (idxLast ?? j)) / 12, cm = k.slice(5, 7);
        v = (prof[cm] || 0) * Math.pow(1 + am.priceInc / 100, yrs) * Math.pow(1 - am.degr / 100, yrs);
        const fd = `${k}-15`; if (am.feedin && (!am.feedinFrom || fd >= am.feedinFrom)) v += (profFeed[cm] || 0) * am.feedin / 100;
        if (wbStartK && k >= wbStartK) v += wbYear / 12 * Math.pow(1 + am.priceInc / 100, yrs);
        v += (refK[k] || 0) + (s14K && k >= s14K ? s14Year / 12 : 0) + (thgK && k >= thgK ? thgYear / 12 : 0);
      }
      cs += v; const me = monthEnd(k), ci = items.filter(x => x.date <= me).reduce((s, x) => s + (+x.cost || 0), 0);
      labels.push(k); cumS.push(cs); cumI.push(ci); proj.push(k > lastK);
      if (be === null && ci > 0 && cs >= ci && j > 0) be = k;
      k = nextMonth(k);
    }
    return { labels, cumS, cumI, proj, be, startK, lastK, wbFrom, wbYear, refunds, s14Year, s14K, thgYear, thgK };
  }
  function investTotal() { return S.invest.filter(x => x.cat !== 'refund').reduce((a, b) => a + (+b.cost || 0), 0); }

  /* Abschlag-Check je laufendem Vertrag */
  function abschlagAt(g, d) { const l = S.abschlaege.filter(a => a.group === g && a.from && a.from <= d).sort((a, b) => b.from.localeCompare(a.from))[0]; return l ? +l.amount : 0; }
  // calToday: Kalenderdatum (für den aktuell gültigen Abschlag); Rechenstand bleibt „letzter Zählerstand − 1 Tag“
  function abschlagCheck(g, calToday) {
    const r = abschlagCore(g, calToday); if (!r) return null;
    return { ...r, boni: boniOf(r.t) };
  }
  function abschlagCore(g, calToday) {
    const t = currentTariff(g), s = groupSeries(g); if (!t || !s.last) return null;
    const start = t.from, end = t.to || addDays(addMonths(start, 12), -1), today = addDays(s.last, -1);
    if (today < start) return null;
    let kwhSo = 0, costSo = 0, dSo = 0;
    for (let d = start; d <= today && d <= end; d = addDays(d, 1)) { const k = s.daily[d]; if (k == null) continue; kwhSo += k; costSo += k * t.ap / 100 + t.gp / 365; dSo++; }
    const avg = kwhSo / Math.max(dSo, 1); let kwhRest = 0, costRest = 0, fb = 0;
    for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) { const pv = s.daily[shiftYear(d)]; const k = pv != null ? pv : (fb++, avg); kwhRest += k; costRest += k * t.ap / 100 + t.gp / 365; }
    let evK = 0;
    if (g === 'as' && S.cars.ev.start) {
      const e = S.cars.ev, perDay = e.km / 100 * e.kwh100 * (1 + e.loss / 100) * e.shHome / 100 * (1 - e.shPV / 100) / 365;
      for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) if (d >= e.start) evK += perDay; kwhRest += evK; costRest += evK * t.ap / 100;
    }
    let paid = 0, nPaid = 0; for (let m = 1; m <= 12; m++) { const dd = addMonths(start, m); if (dd > today) break; paid += abschlagAt(g, dd); nPaid++; }
    // Zahlungsbuch (v0.7): Sind im Abrechnungsjahr Abschläge erfasst, zählen diese statt der Annahme
    const nExpected = nPaid, booked = (S.payments || []).filter(p => p.group === g && p.kind === 'abschlag' && p.d >= start && p.d <= end && p.d <= today);
    const paidSource = booked.length ? 'buch' : 'annahme';
    if (booked.length) { paid = booked.reduce((a, p) => a + (+p.amount || 0), 0); nPaid = Math.min(12, booked.length); }
    // v0.7: jeder noch offene Abschlag mit dem Betrag, der an seinem Fälligkeitstag gilt (Referenz: Betrag vom Rechenstand)
    const nRest = 12 - nPaid, cur = abschlagAt(g, calToday && calToday > today ? calToday : today), costTotal = costSo + costRest;
    let restPay = 0; for (let m = nPaid + 1; m <= 12; m++) restPay += abschlagAt(g, addMonths(start, m));
    const payTotal = paid + restPay, nextDue = nRest > 0 ? addMonths(start, nPaid + 1) : null;
    return { t, start, end, today, kwhSo, costSo, kwhRest, costRest, paid, nPaid, nRest, cur, payTotal, costTotal, nextDue,
      evK, bal: payTotal - costTotal, recNow: nRest > 0 ? Math.max(0, (costTotal - paid) / nRest) : null, recAvg: costTotal / 12, fb, kwhTotal: kwhSo + kwhRest,
      paidSource, nExpected };
  }

  /* Boni: Einzelposten je Tarif (boniItems), optional mit Mengenbedingung
     { name, amount, minKwh?, amountBelow? } – unter minKwh im ersten Vertragsjahr gilt amountBelow.
     Ohne Posten gilt die Summe boni wie in der Referenz. */
  const _boniCache = new Map();
  function firstYearKwh(t) {
    const cur = currentTariff(t.group);
    if (cur && cur.id === t.id) { const c = abschlagCore(t.group); if (c && c.start === t.from) return c.kwhTotal; }
    const s = groupSeries(t.group); let end = addDays(addMonths(t.from, 12), -1); if (t.to && t.to < end) end = t.to;
    let k = 0; for (const [d, v] of Object.entries(s.daily)) if (d >= t.from && d <= end) k += v; return k;
  }
  function boniInfo(t) {
    if (_boniCache.has(t)) return _boniCache.get(t);
    let res;
    if (!Array.isArray(t.boniItems) || !t.boniItems.length) res = { items: [], total: +t.boni || 0, effective: +t.boni || 0, kwh: null };
    else {
      const needKwh = t.boniItems.some(i => +i.minKwh > 0), kwh = needKwh ? firstYearKwh(t) : null;
      const items = t.boniItems.map(i => {
        const cond = +i.minKwh > 0, met = !cond || kwh >= +i.minKwh;
        return { ...i, amount: +i.amount || 0, cond, met, effective: met ? (+i.amount || 0) : (+i.amountBelow || 0) };
      });
      res = { items, total: items.reduce((a, i) => a + i.amount, 0), effective: items.reduce((a, i) => a + i.effective, 0), kwh };
    }
    _boniCache.set(t, res); return res;
  }
  function boniOf(t) { return t ? boniInfo(t).effective : 0; }

  /* Gesamtbilanz Energie (getrennt, nicht in der Amortisation): PV-Ersparnis, Tarifwechsel gegenüber dem
     jeweils vorherigen Vertrag derselben Gruppe (Preise fortgeschrieben), vertragliche Boni tagesanteilig */
  function energyBalance(from, to) {
    const m = metrics(from, to), out = { pv: m.sav, switchAs: 0, switchWp: 0, boniAs: 0, boniWp: 0 };
    for (const g of ['as', 'wp']) {
      const ts = S.tariffs.filter(t => t.group === g).sort((a, b) => a.from.localeCompare(b.from));
      for (const [d, k] of Object.entries(groupSeries(g).daily)) {
        if (d < from || d > to) continue;
        const t = tariffAt(g, d); if (!t) continue;
        const i = ts.indexOf(t), prev = i > 0 ? ts[i - 1] : null;
        if (prev) out[g === 'as' ? 'switchAs' : 'switchWp'] += k * (prev.ap - t.ap) / 100 + (prev.gp - t.gp) / 365;
        if (d < addDays(t.from, 365)) out[g === 'as' ? 'boniAs' : 'boniWp'] += boniOf(t) / 365;
      }
    }
    out.total = (out.pv || 0) + out.switchAs + out.switchWp + out.boniAs + out.boniWp;
    return out;
  }

  /* Zahlungsbuch */
  // Geplante Abschläge (aus installments) bis heute, für die noch keine Zahlung ±12 Tage erfasst ist
  function paymentSuggestions(today) {
    const out = [];
    for (const t of S.tariffs) {
      const g = t.group, last = t.to && t.to < today ? t.to : today;
      for (let m = 1; m <= 240; m++) {
        const d = addMonths(t.from, m); if (d > last) break;
        const amount = abschlagAt(g, d); if (!amount) continue;
        const have = (S.payments || []).some(p => p.group === g && p.kind === 'abschlag' && Math.abs(diffDays(p.d, d)) <= 12);
        if (!have) out.push({ group: g, d, amount, kind: 'abschlag', note: 'Vorschlag aus Abschlagsplan' });
      }
    }
    return out.sort((a, b) => a.d.localeCompare(b.d) || a.group.localeCompare(b.group));
  }
  // Abrechnungsjahre je Tarif (ab Lieferbeginn, 12 Monate, letztes bis Vertragsende) mit Kassen- und Kostensicht.
  // Erstattung/Nachzahlung gehören zum zuletzt beendeten Jahr (bis 270 Tage danach), Boni zum laufenden bzw. letzten.
  // Erstattungen senken keine Kosten: Kosten kommen allein aus Verbrauch × Tarif.
  function billingPeriods(g, today) {
    const s = groupSeries(g), periods = [];
    for (const t of S.tariffs.filter(x => x.group === g).sort((a, b) => a.from.localeCompare(b.from))) {
      for (let k = 0; k < 30; k++) {
        const from = addMonths(t.from, 12 * k); if (from > today || (t.to && from > t.to)) break;
        let to = addDays(addMonths(t.from, 12 * (k + 1)), -1); if (t.to && to > t.to) to = t.to;
        periods.push({ t, from, to, closed: to < today });
      }
    }
    const pays = (S.payments || []).filter(p => p.group === g);
    for (const P of periods) {
      let kwh = 0, cost = 0, days = 0, boniContract = 0;
      for (let d = P.from; d <= P.to && d <= today; d = addDays(d, 1)) {
        const k = s.daily[d]; if (k == null) continue;
        kwh += k; cost += k * P.t.ap / 100 + P.t.gp / 365; days++;
        if (d < addDays(P.t.from, 365)) boniContract += boniOf(P.t) / 365;
      }
      Object.assign(P, { kwh, cost, days, boniContract, abschlag: 0, erstattung: 0, nachzahlung: 0, bonus: 0, nAbschlag: 0 });
    }
    const containing = d => periods.find(P => P.from <= d && d <= P.to);
    const lastEnded = (d, maxDays) => periods.filter(P => P.to < d && diffDays(P.to, d) <= maxDays).sort((a, b) => b.to.localeCompare(a.to))[0];
    for (const p of pays) {
      const P = p.kind === 'abschlag' ? containing(p.d)
        : p.kind === 'bonus' ? (containing(p.d) || lastEnded(p.d, 365))
        : (lastEnded(p.d, 270) || containing(p.d));
      if (!P) continue;
      P[p.kind] += +p.amount || 0; if (p.kind === 'abschlag') P.nAbschlag++;
    }
    for (const P of periods) {
      P.netPaid = P.abschlag + P.nachzahlung - P.erstattung - P.bonus;       // Kasse: was netto geflossen ist
      P.netCost = P.cost - P.boniContract;                                     // Kosten laut Verbrauch × Tarif abzüglich Boni
      P.settled = P.erstattung > 0 || P.nachzahlung > 0;
      P.expectedSettlement = P.abschlag - P.netCost + P.bonus;                 // erwartet: + Erstattung / − Nachzahlung
      P.diff = P.settled ? P.netPaid - P.netCost : null;                       // Abweichung Versorger ↔ eigene Rechnung
    }
    return periods;
  }

  /* Tarifrechner (Stufe A): Jahresverbrauch der letzten 365 Tage, Angebote, Wallbox nach §14a, iMSys */
  // Verbrauch eines Zeitraums aufs Jahr hochgerechnet (v0.16, Tarifrechner mit gewähltem Zeitraum)
  function periodKwhYear(group, from, to) {
    const g = groupSeries(group); if (!g.last) return null; let kw = 0, days = 0;
    for (const [d, k] of Object.entries(g.daily)) { if (d < from || d > to) continue; kw += k; days++; }
    return days ? { kwh: kw * 365 / days, raw: kw, days, from, to } : null;
  }
  function tariffBase(from, to) {
    const e = S.cars.ev || {}, pr = from && to;
    const as = pr ? periodKwhYear('as', from, to) : last365Cost('as'), wp = pr ? periodKwhYear('wp', from, to) : last365Cost('wp');
    const evYear = (+e.km || 0) / 100 * (+e.kwh100 || 0) * (1 + (+e.loss || 0) / 100);
    const evHome = evYear * (+e.shHome || 0) / 100, evGrid = evHome * (1 - (+e.shPV || 0) / 100);
    // Laden zu Hause steckt ab v0.9 schon im Zählerwert: Netzanteil abziehen, damit „inkl. E-Auto“ nicht doppelt zählt
    const hc = as ? homeCharging(as.from, as.to).kwh * (1 - (+e.shPV || 0) / 100) * (pr ? 365 / as.days : 1) : 0;
    return { asKwh: as ? Math.max(0, as.kwh - hc) : 0, asMeter: as ? as.kwh : 0, homeGrid: hc, wpKwh: wp ? wp.kwh : 0, from: as?.from || wp?.from || null, to: as?.to || wp?.to || null, evYear, evHome, evGrid,
      annualized: !!pr, days: pr ? Math.max(as?.days || 0, wp?.days || 0) : 365 };
  }

  /* Fahrzeuge */
  function odoPoints(car) {
    const p = [];
    if (car === 'leon') S.fuel.forEach(x => { if (+x.km) p.push({ d: x.d, km: +x.km }); });
    if (car === 'tavascan') S.charges.forEach(x => { if (+x.km) p.push({ d: x.d, km: +x.km }); });
    S.carlog.forEach(x => { if (x.car === car && +x.km) p.push({ d: x.d, km: +x.km }); });
    p.sort((a, b) => a.d.localeCompare(b.d) || a.km - b.km);
    const o = []; p.forEach(x => { if (o.length && o[o.length - 1].d === x.d) { o[o.length - 1].km = Math.max(o[o.length - 1].km, x.km); } else o.push(x); });
    return o;
  }
  function kmDaily(car) {
    const o = odoPoints(car), out = {};
    for (let i = 0; i < o.length - 1; i++) {
      const a = o[i], b = o[i + 1], n = diffDays(a.d, b.d), dk = b.km - a.km; if (n <= 0 || dk <= 0) continue;
      for (let j = 0; j < n; j++) { const d = addDays(a.d, j); out[d] = (out[d] || 0) + dk / n; }
    }
    return out;
  }
  function carCostItems(car) {
    const it = [];
    if (car === 'leon') S.fuel.forEach(x => it.push({ d: x.d, cat: 'Sprit', e: +x.e || 0 }));
    if (car === 'tavascan') S.charges.forEach(x => it.push({ d: x.d, cat: 'Laden', e: +x.e || 0 }));
    S.carlog.forEach(x => { if (x.car === car && +x.e) it.push({ d: x.d, cat: x.cat, e: +x.e }); });
    return it;
  }
  // today als Parameter (Referenz: new Date()), damit Tests stabil bleiben
  function ledger12(car, today) {
    const to = today, from = addDays(to, -364), s = {};
    S.carlog.forEach(x => { if (x.car === car && x.d >= from && x.d <= to && +x.e) s[x.cat] = (s[x.cat] || 0) + (+x.e); }); return s;
  }
  function carKpis(car, today) {
    const kd = kmDaily(car), items = carCostItems(car), to = today, from = addDays(to, -364);
    const km12 = Object.entries(kd).filter(([d]) => d >= from && d <= to).reduce((s, [, v]) => s + v, 0);
    const span = Object.keys(kd).filter(d => d >= from && d <= to).length;
    const cost12 = items.filter(x => x.d >= from && x.d <= to).reduce((s, x) => s + x.e, 0);
    const lease = car === 'leon' ? S.cars.ice.rate : S.cars.ev.rate;
    return { km12, span, cost12, lease, ctPerKm: km12 ? cost12 / km12 * 100 : null,
      ctPerKmLease: km12 ? (cost12 + lease * span / 30.4375) / km12 * 100 : null };
  }
  function fuelStats() {
    const f = [...S.fuel].sort((a, b) => a.km - b.km); let intervals = [], acc = 0, lastFull = null;
    f.forEach(x => { if (lastFull !== null) { acc += +x.l; if (x.full) { const km = x.km - lastFull.km; if (km > 0) intervals.push({ from: lastFull, to: x, km, l: acc, l100: acc / km * 100 }); acc = 0; lastFull = x; } } else if (x.full) { lastFull = x; } });
    const L = f.reduce((a, b) => a + (+b.l || 0), 0), E = f.reduce((a, b) => a + (+b.e || 0), 0);
    const kmT = intervals.reduce((a, b) => a + b.km, 0), lT = intervals.reduce((a, b) => a + b.l, 0);
    return { intervals, L, E, avgPrice: L ? E / L : null, l100: kmT ? lT / kmT * 100 : null, n: f.length };
  }
  // Tankbuch für einen Zeitraum (v0.16): Mengen nach Datum, Verbrauch aus Volltank-Intervallen mit Ende im Zeitraum
  function fuelStatsIn(from, to) {
    const all = fuelStats(), f = S.fuel.filter(x => x.d >= from && x.d <= to);
    const L = f.reduce((a, b) => a + (+b.l || 0), 0), E = f.reduce((a, b) => a + (+b.e || 0), 0);
    const intervals = all.intervals.filter(iv => iv.to.d >= from && iv.to.d <= to);
    const kmT = intervals.reduce((a, b) => a + b.km, 0), lT = intervals.reduce((a, b) => a + b.l, 0);
    return { intervals, L, E, avgPrice: L ? E / L : null, l100: kmT ? lT / kmT * 100 : null, n: f.length };
  }
  function fuelPrice(n) {
    const f = [...S.fuel].filter(x => +x.l > 0).sort((a, b) => b.d.localeCompare(a.d) || b.km - a.km);
    const sel = n ? f.slice(0, n) : f;
    const L = sel.reduce((a, b) => a + (+b.l), 0), E = sel.reduce((a, b) => a + (+b.e || 0), 0);
    return { price: L ? E / L : null, count: sel.length, from: sel.length ? sel[sel.length - 1].d : null, to: sel.length ? sel[0].d : null };
  }
  function icePrice() {
    const i = S.cars.ice;
    if (i.priceSrc === 'all') { const p = fuelPrice(0); if (p.price) return { v: p.price, label: `Ø aller ${p.count} Tankvorgänge` }; }
    if (i.priceSrc === 'lastN') { const p = fuelPrice(Math.max(1, +i.priceN || 20)); if (p.price) return { v: p.price, label: `Ø der letzten ${p.count} Tankvorgänge` }; }
    return { v: i.price, label: i.priceSrc === 'manual' ? 'manuell' : 'manuell (Tankbuch noch leer)' };
  }
  function carCalc(today) {
    const i = S.cars.ice, e = S.cars.ev, fs = fuelStats(), apAS = (currentTariff('as')?.ap || 33) / 100;
    const l100 = (i.useLog && fs.l100) ? fs.l100 : i.l100;
    const ip = icePrice(); const iceFuelY = i.km / 100 * l100 * ip.v;
    // v0.17: Räder (Räderwechsel, Räder/Reifen) getrennt von Sonstiges; Überführung ist einmalig und zählt beim Leon nicht für die Zukunft
    let ins = i.ins, tax = i.tax, oth = i.other, wheels = 0;
    if (i.useLedger) { const L = ledger12('leon', today); ins = L['Versicherung'] || 0; tax = L['Kfz-Steuer'] || 0; wheels = (L['Räderwechsel'] || 0) + (L['Räder/Reifen'] || 0); oth = (L['Wartung/Reparatur'] || 0) + (L['Pflege'] || 0) + (L['Sonstiges'] || 0); }
    const iceM = i.rate + (iceFuelY + ins + tax + oth + wheels) / 12;
    const kwhY = e.km / 100 * e.kwh100 * (1 + e.loss / 100);
    const home = kwhY * e.shHome / 100, pv = home * e.shPV / 100, grid = home - pv, pub = kwhY - home;
    const evEnergyY = grid * apAS + pv * S.amort.feedin / 100 + pub * e.pricePublic;
    const evM = e.rate + (evEnergyY + e.ins + e.tax) / 12;
    const iceCum = [], evCum = []; let a = 0, b = +e.transfer || 0;
    for (let m = 0; m <= 36; m++) { if (m > 0) { a += iceM; b += evM; if (m % 12 === 0) b -= +e.thg || 0; } iceCum.push(a); evCum.push(b); }
    return { l100, ip, iceFuelY, kwhY, evEnergyY, iceCum, evCum, grid, pv, pub, fs, apAS,
      blocks: { ice: { Leasing: i.rate * 36, Energie: iceFuelY * 3, Versicherung: ins * 3, Steuer: tax * 3, 'Räder': wheels * 3, Sonstiges: oth * 3, 'Überführung': 0, 'THG-Prämie': 0 },
                ev: { Leasing: e.rate * 36, Energie: evEnergyY * 3, Versicherung: e.ins * 3, Steuer: e.tax * 3, 'Räder': 0, Sonstiges: 0, 'Überführung': +e.transfer || 0, 'THG-Prämie': -(+e.thg || 0) * 3 } } };
  }

  /* Kosten & Ersparnisse */
  function finData(from, to, today) {
    const m = metrics(from, to);
    const split = g => { const s = groupSeries(g); let ap = 0, gp = 0, bo = 0, k = 0; for (const [d, v] of Object.entries(s.daily)) { if (d < from || d > to) continue; const t = tariffAt(g, d); if (!t) continue; k += v; ap += v * t.ap / 100; gp += t.gp / 365; if (d < addDays(t.from, 365)) bo += boniOf(t) / 365; } return { ap, gp, bo, k }; };
    const as = split('as'), wp = split('wp');
    const direct = A.dates.some(d => d >= from && d <= to) ? valueAt('s2h', from, to) : null;
    const feedVal = feedValue(from, to);
    const cost = as.ap + as.gp, boni = as.bo;
    const days = diffDays(from, to) + 1, months = days / 30.4375;
    const i = S.cars.ice, e = S.cars.ev, ip = icePrice();
    const fuelLog = S.fuel.filter(x => x.d >= from && x.d <= to), fuelIst = fuelLog.reduce((a, b) => a + (+b.e || 0), 0);
    const fuelEst = i.km / 100 * (i.l100) * ip.v * days / 365;
    const leonLease = i.rate * months, leonFix = (i.ins + i.tax + i.other) * days / 365;
    const r = carCalc(today), tavLease = e.rate * months, tavEnergy = r.evEnergyY * days / 365, tavFix = (e.ins + e.tax - (+e.thg || 0)) * days / 365;
    return { m, as, wp, direct, battVal: m.battVal, feedVal, sav: m.sav, cost, boni, net: cost - boni, noPV: cost - boni + (m.sav || 0), days, months,
      mob: { leonLease, fuel: fuelLog.length ? fuelIst : fuelEst, fuelIsIst: fuelLog.length > 0, fuelN: fuelLog.length, leonFix, leon: leonLease + (fuelLog.length ? fuelIst : fuelEst) + leonFix,
             tavLease, tavEnergy, tavFix, tav: tavLease + tavEnergy + tavFix } };
  }
  function finYears(today) {
    const f0 = firstDataDay(), f1 = lastDataDay(), out = [];
    for (let y = +f0.slice(0, 4); y <= +f1.slice(0, 4); y++) {
      const fr = `${y}-01-01` > f0 ? `${y}-01-01` : f0, tt = `${y}-12-31` < f1 ? `${y}-12-31` : f1;
      out.push({ y, fr, tt, partial: fr !== `${y}-01-01` || tt !== `${y}-12-31`, d: finData(fr, tt, today) });
    }
    out.push({ y: 'Gesamt', fr: f0, tt: f1, total: true, d: finData(f0, f1, today) });
    return out;
  }

  /* Zähler: Abgleich Hauptzähler gegen Anker-Netzbezug, Wärmepumpe vorher/nachher */
  function meterReconciliation() {
    const is = IMPORT_START();
    return groupSeries('as').intervals.map(iv => {
      const covered = iv.from >= is, imp = sumRange('imp', iv.from, addDays(iv.to, -1));
      return { ...iv, covered, imp, hasAnker: iv.from >= A.dates[0], diff: covered ? iv.kwh - imp : null,
        ok: covered ? Math.abs(iv.kwh - imp) / iv.kwh < 0.05 : null };
    });
  }
  function feedReconciliation() {
    const is = IMPORT_START();
    return groupSeries('feed').intervals.map(iv => { const an = sumRange('feed', iv.from, addDays(iv.to, -1)), ok = iv.from >= is; return { ...iv, anker: ok ? an : null, diff: ok ? iv.kwh - an : null }; });
  }
  function wpSwap() {
    const sw = (S.events.find(e => e.type === 'geraet' && e.group === 'wp') || {}).d; if (!sw) return null;
    const bucket = d => { const m = +d.slice(5, 7); return (m >= 5 && m <= 9) ? 'Sommer (Mai–Sep)' : (m >= 11 || m <= 2) ? 'Winter (Nov–Feb)' : 'Übergang'; };
    const agg = {};
    for (const [d, k] of Object.entries(groupSeries('wp').daily)) { const side = d < sw ? 'alt' : 'neu'; const key = bucket(d) + '|' + side; agg[key] = agg[key] || { k: 0, n: 0 }; agg[key].k += k; agg[key].n++; }
    return { swap: sw, rows: ['Winter (Nov–Feb)', 'Übergang', 'Sommer (Mai–Sep)'].map(b => {
      const a = agg[b + '|alt'], n = agg[b + '|neu'], ra = a ? a.k / a.n : null, rn = n ? n.k / n.n : null;
      return { season: b, oldRate: ra, oldDays: a ? a.n : 0, newRate: rn, newDays: n ? n.n : 0, change: ra && rn ? rn / ra - 1 : null };
    }) };
  }

  /* Wetter (v0.10): Tageswerte von Open-Meteo, Standort in settings.data.wx */
  const W = Object.fromEntries((S.weather || []).map(w => [w.d, w]));
  const wxCfg = () => ({ heatLimit: 15, room: 20, ...(S.wx || {}) });
  // Gradtagzahl nach VDI 3807 (G20/15): Summe (Raum − Tagesmittel) über Heiztage (Tagesmittel < Heizgrenze).
  // Intervall wie bei Zählerständen: from inklusive, to exklusive. missing = Tage ohne Wetterdaten.
  function degreeDays(from, to) {
    const { heatLimit, room } = wxCfg(); let gt = 0, n = 0, missing = 0, tSum = 0;
    for (let d = from; d < to; d = addDays(d, 1)) { const w = W[d]; if (!w) { missing++; continue; } n++; tSum += w.t; if (w.t < +heatLimit) gt += +room - w.t; }
    return { gt, days: n, missing, tMean: n ? tSum / n : null };
  }
  // Wärmepumpe: je Ableseintervall kWh, Gradtage; Modell kWh = Grundlast × Tage + k × Gradtage (kleinste Quadrate)
  // getrennt vor und nach dem Gerätetausch. Normiert auf die Gradtage der letzten 365 Tage mit Wetterdaten.
  function fit(iv) {
    let sdd = 0, sdg = 0, sgg = 0, sdy = 0, sgy = 0;
    for (const x of iv) { sdd += x.days * x.days; sdg += x.days * x.gt; sgg += x.gt * x.gt; sdy += x.days * x.kwh; sgy += x.gt * x.kwh; }
    const det = sdd * sgg - sdg * sdg; if (iv.length < 3 || Math.abs(det) < 1e-9 * sdd * sgg) return null;
    const base = (sdy * sgg - sgy * sdg) / det, k = (sgy * sdd - sdy * sdg) / det;
    const ss = iv.reduce((a, x) => a + (x.kwh - base * x.days - k * x.gt) ** 2, 0), mean = iv.reduce((a, x) => a + x.kwh, 0) / iv.length;
    const tot = iv.reduce((a, x) => a + (x.kwh - mean) ** 2, 0);
    return { base, k, n: iv.length, r2: tot > 0 ? 1 - ss / tot : null };
  }
  function wpWeather() {
    if (!S.weather?.length) return null;
    const sw = (S.events.find(e => e.type === 'geraet' && e.group === 'wp') || {}).d || null;
    const iv = groupSeries('wp').intervals.map(x => ({ ...x, ...degreeDays(x.from, x.to) })).map(x => ({ ...x, ok: x.missing === 0,
      side: sw ? (x.to <= sw ? 'alt' : x.from >= sw ? 'neu' : 'gemischt') : 'alle' }));
    const ok = iv.filter(x => x.ok), wl = S.weather[S.weather.length - 1].d, ref = degreeDays(addDays(wl, -364), addDays(wl, 1));
    const groups = sw ? { alt: fit(ok.filter(x => x.side === 'alt')), neu: fit(ok.filter(x => x.side === 'neu')) } : { alle: fit(ok) };
    const norm = f => (f ? f.base * 365 + f.k * ref.gt : null);
    for (const g of Object.values(groups)) if (g) g.year = norm(g);
    return { swap: sw, intervals: iv, groups, ref: { ...ref, from: addDays(wl, -364), to: wl }, cfg: wxCfg() };
  }
  // PV: Erzeugung gegen Globalstrahlung (horizontal). Faktor = kWh ÷ (kWp × kWh/m²), nur Tage mit Anker- und Wetterdaten.
  function pvWeather(from, to) {
    const kwp = +S.pv.kwp || 1, months = {}, days = [];
    A.dates.forEach((d, i) => { if (d < from || d > to) return; const w = W[d]; if (!w || !(w.rad > 0)) return;
      const k = monthKey(d), m = months[k] = months[k] || { gen: 0, rad: 0, n: 0, sun: 0 }, g = A.c.gen[i] || 0;
      m.gen += g; m.rad += w.rad; m.n++; m.sun += w.sun || 0; days.push({ d, gen: g, rad: w.rad, f: g / (kwp * w.rad), full: (A.c.feed[i] || 0) >= (+S.battery.fullThresh || Infinity) }); });
    const ks = Object.keys(months).sort(), rows = ks.map(k => ({ k, ...months[k], f: months[k].gen / (kwp * months[k].rad) }));
    // auffällige Tage: sonnig (Strahlung ≥ Monatsmedian) und Faktor < 75 % des Monatsmedians
    const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; }, byM = {};
    days.forEach(x => (byM[monthKey(x.d)] = byM[monthKey(x.d)] || []).push(x));
    const odd = [];
    for (const arr of Object.values(byM)) { if (arr.length < 10) continue; const mr = med(arr.map(x => x.rad)), mf = med(arr.map(x => x.f));
      for (const x of arr) if (x.rad >= mr && x.f < 0.75 * mf) odd.push({ ...x, expected: mf * kwp * x.rad, lost: mf * kwp * x.rad - x.gen }); }
    odd.sort((a, b) => b.lost - a.lost);
    return { kwp, months: rows, days: days.length, list: days, odd, factor: rows.length ? rows.reduce((a, r) => a + r.gen, 0) / (kwp * rows.reduce((a, r) => a + r.rad, 0)) : null };
  }
  // Jahresvergleich PV (letzte 365 Tage gegen die 365 davor, nur gemeinsame Tage mit Wetter) und Satz für den Überblick
  function weatherNote() {
    if (!S.weather?.length) return null;
    const last = A.dates[A.n - 1], mk = monthKey(last), mFrom = `${mk}-01`, pFrom = shiftYear(mFrom), pTo = shiftYear(last);
    const agg = (f, t) => { let r = 0, ts = 0, n = 0; for (let d = f; d <= t; d = addDays(d, 1)) { const w = W[d]; if (!w) continue; r += w.rad; ts += w.t; n++; } return { rad: r, t: n ? ts / n : null, n }; };
    const cur = agg(mFrom, last), prev = agg(pFrom, pTo);
    const y1 = pvWeather(addDays(last, -364), last), y0 = pvWeather(addDays(last, -729), addDays(last, -365));
    const sum = (x, k) => x.months.reduce((a, r) => a + r[k], 0);
    const yoy = y0.days >= 300 && y1.days >= 300 ? { gen: sum(y1, 'gen') / sum(y0, 'gen') - 1, rad: sum(y1, 'rad') / sum(y0, 'rad') - 1, f: y1.factor / y0.factor - 1 } : null;
    return { month: mk, cur, prev: prev.n === cur.n && prev.n ? prev : null, yoy };
  }

  /* Wärmepumpen-App (v0.11): Strom und Wärme nach Heizung/Warmwasser, Arbeitszahl, Abgleich mit dem Zähler */
  const hpRows = g => HP.filter(r => r.grain === g).sort((a, b) => a.ts.localeCompare(b.ts));
  function hpMonths() {
    const meter = {}; for (const [d, k] of Object.entries(groupSeries('wp').daily)) meter[monthKey(d)] = (meter[monthKey(d)] || 0) + k;
    const wl = S.weather?.length ? S.weather[S.weather.length - 1].d : null;
    return hpRows('month').map(r => {
      const s = hpSum([r]), from = `${r.ts}-01`, end = addDays(monthEnd(r.ts), 1), dd = S.weather?.length ? degreeDays(from, end) : null;
      return { k: r.ts, partial: !!r.partial, fromDays: !!r.fromDays, ...s, tOut: r.t_out, tFlow: r.t_flow, tDhw: r.t_dhw, meter: meter[r.ts] ?? null,
        gt: dd && dd.missing === 0 ? dd.gt : null, heatPerGt: dd && dd.missing === 0 && dd.gt >= 100 ? s.elHeat / dd.gt : null };
    });
  }
  // v0.13: Tageswerte für einen Zeitraum – echte Tageswerte, sonst Monatswert (abzüglich vorhandener Tage) gleichmäßig
  // auf die übrigen Tage des Monats ab dem Tauschtag verteilt (est = geschätzt). Tage ohne Daten fehlen.
  function hpDayRows(from, to) {
    const days = Object.fromEntries(hpRows('day').map(r => [r.ts, r])), months = Object.fromEntries(hpRows('month').filter(r => !r.fromDays).map(r => [r.ts, r]));
    const spread = {}, out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (d < _hpFrom) continue;
      if (days[d]) { out.push({ ...days[d], d, est: false }); continue; }
      const k = monthKey(d), m = months[k]; if (!m) continue;
      if (!spread[k]) {
        const first = _hpFrom > `${k}-01` ? _hpFrom : `${k}-01`, known = Object.keys(days).filter(x => x.startsWith(k) && x >= first);
        const n = diffDays(first, monthEnd(k)) + 1 - known.length;
        spread[k] = Object.fromEntries(HP_F.map(f => [f, n > 0 ? Math.max(0, (+m[f] || 0) - known.reduce((a, x) => a + (+days[x][f] || 0), 0)) / n : 0]));
      }
      out.push({ ...spread[k], grain: 'day', ts: d, d, t_out: m.t_out, est: true });
    }
    return out;
  }
  function hpPeriod(from, to) {
    const rows = hpDayRows(from, to); if (!rows.length) return null;
    return { ...hpSum(rows), days: rows.length, estDays: rows.filter(r => r.est).length, total: diffDays(from, to) + 1, from: rows[0].d, to: rows[rows.length - 1].d };
  }
  // Letzte 12 Monate mit Daten (Monatswerte der App)
  function hpYear() {
    const m = hpRows('month'); if (!m.length) return null;
    const last = m[m.length - 1].ts, first = addMonths(`${last}-01`, -11).slice(0, 7), rows = m.filter(r => r.ts >= first);
    return { from: rows[0].ts, to: last, months: rows.length, ...hpSum(rows) };
  }
  function hpDays(from, to) {
    return hpRows('day').filter(r => r.ts >= from && r.ts <= to).map(r => { const s = hpSum([r]), w = W[r.ts];
      return { d: r.ts, ...s, tOut: r.t_out, tWx: w ? w.t : null, gt: w ? (w.t < wxCfg().heatLimit ? wxCfg().room - w.t : 0) : null }; });
  }

  // Hinweis Abschlag: E-Auto lädt ab Übergabe über den Allgemeinstrom, die Hochrechnung aus Zählerständen kennt das
  // erst nach einigen Wochen. Aktiv bis 90 Tage nach Übergabe über den letzten Zählerstand hinaus.
  function evAbschlagHint() {
    const e = S.cars.ev || {}; if (!e.start) return null;
    const s = groupSeries('as'); if (!s.last || addDays(e.start, 90) < s.last) return null;
    const tb = tariffBase(), t = currentTariff('as'); if (!t || !(tb.evGrid > 0)) return null;
    const perMonth = tb.evGrid / 12;
    return { from: e.start, kwhMonth: perMonth, eurMonth: perMonth * t.ap / 100, measured: homeCharging(e.start, '9999-12-31').kwh };
  }

  // Ausbau-Szenario: Tageswerte der letzten 365 Tage (Anker + Netzbezug Allgemeinstrom laut Zähler) und Rahmenwerte
  function ausbauBase(from, to) {
    const r = from && to ? { from, to } : last12(), as = groupSeries('as').daily, days = [];
    A.dates.forEach((d, i) => { if (d < r.from || d > r.to) return;
      days.push({ d, gen: A.c.gen[i] || 0, use: A.c.use[i] || 0, bch: A.c.bch[i] || 0, bdis: A.c.bdis[i] || 0, asGrid: as[d] ?? null }); });
    const b = S.battery, e = S.cars.ev || {}, tb = tariffBase();
    return { from: r.from, to: r.to, days, kwp: +S.pv.kwp || 0, usable: (+b.capGross || 0) * (1 - (+b.reserve || 0) / 100),
      evHome: tb.evHome, ap: +(currentTariff('as')?.ap) || 0, pricePublic: +e.pricePublic || 0, evStart: e.start || '',
      priceInc: +S.amort.priceInc || 0, degr: +S.amort.degr || 0 };
  }

  return {
    A, IMPORT_START, sumRange, last12, groupSeries, tariffAt, currentTariff, costs, last365Cost, feedValue, pvSavings,
    lastDataDay, firstDataDay, periodOf, periodKeys, currentPeriods, valueAt, periodCost, metrics, flow, ankerSeries, battery,
    amortTimeline, investTotal, abschlagAt, abschlagCheck, odoPoints, kmDaily, carCostItems, ledger12, carKpis,
    fuelStats, fuelPrice, icePrice, carCalc, finData, finYears, meterReconciliation, feedReconciliation, wpSwap,
    paymentSuggestions, billingPeriods, tariffBase, boniOf, boniInfo, energyBalance, ausbauBase, homeCharging, fuelStatsIn, wallboxFrom, evAbschlagHint,
    W, degreeDays, wpWeather, pvWeather, weatherNote, hpRows, hpMonths, hpYear, hpDays, hpDayRows, hpPeriod,
  };
}

/* ---------- Tarifrechner (Stufe A), reine Funktion ----------
   base: tariffBase(); cur: { as, wp } aktuelle Tarife (Referenzform); p: Parameter aus settings.data.tarif
   p = { withEv, offers:[{name, grp:'as'|'wp', ap, gp, boni}], m1Eur, neAp, neHt, neSt, neNt, shNt, shHt, m2MeterEur, imsysNew, imsysOld }
   Alle Beträge brutto; ct-Werte in ct/kWh, Euro-Werte je Jahr. */
export function tarifRechner(base, cur, p = {}) {
  const n = v => (isFinite(+v) ? +v : 0);
  const kwh = { as: base.asKwh + (p.withEv ? base.evGrid : 0), wp: base.wpKwh };
  const year = (k, t) => ({ ap: k * n(t.ap) / 100, gp: n(t.gp), boni: n(t.boni) });
  const cost = (k, t) => { const y = year(k, t); return { ...y, y1: y.ap + y.gp - y.boni, y2: y.ap + y.gp }; };
  const groups = {};
  for (const g of ['as', 'wp']) {
    const c = cur[g] ? cost(kwh[g], cur[g]) : null;
    const offers = (p.offers || []).map((o, idx) => ({ ...o, idx })).filter(o => o.grp === g).map(o => { const r = cost(kwh[g], o); return { ...o, ...r, diffY1: c ? r.y1 - c.y2 : null, diffY2: c ? r.y2 - c.y2 : null }; });
    groups[g] = { kwh: kwh[g], current: c ? { name: cur[g].name, ...c } : null, offers };
  }
  // Wallbox (E-Auto-Laden zu Hause aus dem Netz) nach §14a EnWG; Grenzkosten = Arbeitspreis Allgemeinstrom
  const ev = base.evGrid, apAs = cur.as ? n(cur.as.ap) : 0, basis = ev * apAs / 100;
  const m3Shift = ev * (n(p.shNt) / 100 * (n(p.neSt) - n(p.neNt)) - n(p.shHt) / 100 * (n(p.neHt) - n(p.neSt))) / 100;
  const imsysExtra = n(p.imsysNew) - n(p.imsysOld);
  const wallbox = [
    { key: 'none', name: 'Ohne §14a', eur: basis, note: 'Laden über den Allgemeinstrom-Zähler' },
    { key: 'm1', name: 'Modul 1', eur: basis - n(p.m1Eur), note: 'Pauschale Netzentgelt-Reduzierung pro Jahr' },
    { key: 'm2', name: 'Modul 2', eur: ev * (apAs - 0.6 * n(p.neAp)) / 100 + n(p.m2MeterEur), note: 'Netzentgelt-Arbeitspreis −60 %, eigener Zähler nötig' },
    { key: 'm3', name: 'Modul 1 + 3', eur: basis - n(p.m1Eur) - m3Shift + imsysExtra, note: 'Zeitvariable Netzentgelte, braucht intelligentes Messsystem' },
  ].map(o => ({ ...o, vsNone: o.eur - basis }));
  const best = wallbox.reduce((a, b) => (b.eur < a.eur ? b : a));
  return { kwh, ev, groups, wallbox, best, m3Shift, imsysExtra, imsysBreakEven: m3Shift > 0 ? imsysExtra / m3Shift : null };
}

// Boni-Notiz in Posten zerlegen, z. B. „Sofortbonus 100 € + Neukundenbonus 80 € (bei unter 2.000 kWh evtl. nur 50 €)“
// → [{name:'Sofortbonus',amount:100},{name:'Neukundenbonus',amount:80,minKwh:2000,amountBelow:50}]
export function parseBoniNote(note) {
  const num = t => +String(t).replace(/\./g, '').replace(',', '.');
  const items = [];
  for (const part of String(note || '').split('+')) {
    const m = part.match(/^\s*(.+?)\s+([\d.]+(?:,\d+)?)\s*€/);
    if (!m) continue;
    const it = { name: m[1].trim(), amount: num(m[2]) };
    const c = part.match(/unter\s+([\d.]+)\s*kWh[^\d]*([\d.]+(?:,\d+)?)\s*€/i);
    if (c) { it.minKwh = num(c[1]); it.amountBelow = num(c[2]); }
    items.push(it);
  }
  return items;
}

/* ---------- Ausbau-Szenario „Weg B“ (PV-Erweiterung + Speicher + Wallbox), reine Funktion ----------
   base: ausbauBase(); p: settings.data.ausbau (fehlende Werte aus AUSBAU_DEFAULTS); today: ISO-Datum; m14a: Ersparnis
   je §14a-Modul in €/Jahr aus dem Tarifrechner ({m1, m2, m3}) oder null.
   Tagesmodell über 365 Tage: Last = genutzter Solarstrom + Netzbezug Allgemeinstrom; der Anteil dayLoadPct fällt
   tagsüber an, der Rest abends/nachts. Reihenfolge des Solarstroms: Haus tagsüber → Klimaanlage (Jun–Aug) → Auto
   tagsüber → Speicher → Einspeisung; abends Speicher → Haus, danach optional Speicher → Auto. Kalibrierung K: das
   Modell der heutigen Anlage wird auf den gemessenen genutzten Solarstrom skaliert. Alle Mehrwerte sind gegenüber
   der heutigen Anlage ohne Laden zu Hause. Kosten haben keine Vorgabe (Angebotswerte gehören nicht ins Repo). */
export const AUSBAU_DEFAULTS = { pvAddWp: 1500, yieldPct: 100, storeAddKwh: 5, storeUsablePct: 90,
  hwTotal: '', hwWallbox: '', craftWallbox: '', craftPv: '', start: '', acKwh: 500, dayLoadPct: 30, evDayPct: 10,
  battEv: true, feedCt: 7, apPvCt: '', apEvCt: '', alt: 'public', socketEur: 400, s14a: false, s14aMod: 'manual', s14aEur: 140, years: 20 };
export function ausbauRechner(base, p0 = {}, today = '', m14a = null) {
  const p = { ...AUSBAU_DEFAULTS, ...p0 }, n = v => (v === '' || v == null || !isFinite(+v) ? 0 : +v);
  const days = base.days.filter(x => x.gen != null);
  const known = days.filter(x => x.asGrid != null), gridAvg = known.length ? known.reduce((a, x) => a + x.asGrid, 0) / known.length : 0;
  const bch = days.reduce((a, x) => a + x.bch, 0), bdis = days.reduce((a, x) => a + x.bdis, 0), eta = bch > 0 ? Math.min(1, bdis / bch) : 0.9;
  const f = n(p.dayLoadPct) / 100, summer = x => ['06', '07', '08'].includes(x.d.slice(5, 7));
  const acDay = n(p.acKwh) / Math.max(1, days.filter(summer).length), evDay = base.evHome / 365, evSun = n(p.evDayPct) / 100;
  function sim(scale, usable, ac, car) {
    let soc = 0, house = 0, pvEv = 0, feed = 0;
    for (const x of days) {
      const load = x.use + (x.asGrid ?? gridAvg), gen = x.gen * scale, day = f * load, night = load - day;
      const d = Math.min(gen, day); house += d; let sur = gen - d; const short = day - d;
      if (ac && summer(x)) { const c = Math.min(sur, acDay); house += c; sur -= c; }
      let ev = car ? evDay : 0; const e = Math.min(sur, ev * evSun); pvEv += e; sur -= e; ev -= e;
      const ch = Math.min(sur, Math.max(0, usable - soc) / eta); soc += ch * eta; feed += sur - ch;
      const o = Math.min(soc, short + night); house += o; soc -= o;
      if (car && p.battEv && ev > 0) { const b = Math.min(soc * 0.8, ev); pvEv += b; soc -= b; }
    }
    return { house, pvEv, feed };
  }
  const now = sim(1, base.usable, false, false), used = days.reduce((a, x) => a + x.use, 0);
  const K = now.house > 0 ? used / now.house : 1;
  const wpNow = base.kwp * 1000, scale = wpNow > 0 ? (wpNow + n(p.pvAddWp) * n(p.yieldPct) / 100) / wpNow : 1;
  const usable = base.usable + n(p.storeAddKwh) * n(p.storeUsablePct) / 100;
  const nowAc = sim(1, base.usable, true, false);      // Klimaanlage käme auch ohne Ausbau; Mehrwert nur durch den Ausbau
  const pk = { noCar: sim(scale, usable, true, false), car: sim(scale, usable, true, true) };
  const apPv = (p.apPvCt === '' || p.apPvCt == null ? base.ap : n(p.apPvCt)) / 100;
  const apEv = (p.apEvCt === '' || p.apEvCt == null ? base.ap : n(p.apEvCt)) / 100;
  const feedEur = n(p.feedCt) / 100, pub = p.alt === 'public';
  const s14 = !p.s14a ? 0 : p.s14aMod === 'manual' ? n(p.s14aEur) : Math.max(0, n(m14a?.[p.s14aMod]));
  const part = r => {
    const houseKwh = K * (r.house - nowAc.house), pvEv = K * r.pvEv;
    return { houseKwh, pvEvKwh: pvEv, feedKwh: r.feed - nowAc.feed, evGridKwh: Math.max(0, (r === pk.car ? base.evHome : 0) - pvEv),
      house: houseKwh * apPv, carPv: pvEv * apEv, feed: (r.feed - nowAc.feed) * feedEur };
  };
  const yNo = part(pk.noCar), yCar = part(pk.car);
  const wallbox = pub ? base.evHome * (base.pricePublic - apEv) : 0;
  const year = { ...yCar, wallbox, s14a: s14, total: yCar.house + yCar.carPv + yCar.feed + wallbox + s14 };
  const invest = { pv: n(p.hwTotal) - n(p.hwWallbox) + n(p.craftPv), wallbox: n(p.hwWallbox) + n(p.craftWallbox) - (pub ? 0 : n(p.socketEur)) };
  invest.total = invest.pv + invest.wallbox;
  // Monatlicher Verlauf ab Inbetriebnahme; Auto-Anteile erst ab Übergabe des E-Autos
  const start = p.start || today || base.to, inc = n(base.priceInc) / 100, dg = n(base.degr) / 100, N = Math.max(1, Math.round(n(p.years))) * 12;
  const evMonth = base.evStart ? base.evStart.slice(0, 7) : '';
  let cum = 0, cumPv = 0, cumWb = 0; const months = [];
  const hit = { total: null, pv: null, wallbox: null };
  for (let m = 0; m < N; m++) {
    const d = addMonths(start.slice(0, 7) + '-01', m), y = Math.floor(m / 12), carOn = !evMonth || d.slice(0, 7) >= evMonth;
    const pF = (1 + inc) ** y, dF = (1 - dg) ** y, r = carOn ? yCar : yNo;
    const pvM = ((r.house + r.carPv) * pF * dF + r.feed * dF) / 12;
    const wbM = carOn ? (wallbox * pF + s14) / 12 : 0;
    const prev = { total: cum, pv: cumPv, wallbox: cumWb };
    cum += pvM + wbM; cumPv += pvM; cumWb += wbM;
    const cur = { total: cum, pv: cumPv, wallbox: cumWb };
    for (const k of Object.keys(hit)) if (hit[k] == null && invest[k] > 0 && cur[k] >= invest[k]) {
      const fr = (invest[k] - prev[k]) / (cur[k] - prev[k]); hit[k] = { years: (m + fr) / 12, date: addDays(d, Math.round(fr * 30)) };
    } else if (hit[k] == null && invest[k] <= 0) hit[k] = { years: 0, date: start };
    months.push({ d, cum, cumPv, cumWb });
  }
  return { K, eta, scale, usable, start, evMonth, year, noCar: { ...yNo, total: yNo.house + yNo.carPv + yNo.feed }, invest, payback: hit, months,
    kwh: { house: yCar.houseKwh, pvEv: yCar.pvEvKwh, evGrid: yCar.evGridKwh, feed: yCar.feedKwh, evHome: base.evHome }, s14 };
}
