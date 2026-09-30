// Rechenlogik der Energiebilanz – reine Funktionen, ohne DOM und ohne Supabase.
// Portiert aus reference/energiebilanz_v0.14.html (zweiter <script>-Block). Die Funktionen sind bewusst
// nah am Original gehalten (gleiche Namen, gleiche Reihenfolge der Rechenschritte), damit sie sich Zeile für
// Zeile gegen die Referenz prüfen lassen. Abweichung: sumRange summiert exakt in Tausendsteln (Wh).
//
// Einstieg:  const C = createCalc(state)
//   state = Referenzform: { anker:{dates:[],c:{ev,imp,…}} | {start,n,c}, meters, readings, events, tariffs,
//           abschlaege, invest, fuel, charges, carlog, battery, pv, amort, cars }
//   stateFromDb(db) wandelt Supabase-Zeilen in diese Form um.

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

export const CAR_CATS = ['Kilometerstand', 'Versicherung', 'Kfz-Steuer', 'Räderwechsel', 'Wartung/Reparatur', 'Pflege', 'Sonstiges'];

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
    invest: (db.investments || []).map(x => ({ id: x.id, name: x.name, date: x.day || '', cost: +x.cost })),
    fuel: (db.fuel_log || []).map(x => ({ id: x.id, d: x.day, km: +x.odometer, l: +x.liters, e: +x.amount, s: x.fuel_type, full: x.full_tank })),
    charges: (db.charge_log || []).map(x => ({ id: x.id, d: x.day, km: x.odometer == null ? null : +x.odometer, k: +x.kwh, e: x.amount == null ? 0 : +x.amount, o: x.location })),
    carlog: (db.car_log || []).map(x => ({ id: x.id, d: x.day, car: x.car, cat: x.category, km: x.odometer == null ? null : +x.odometer, e: +x.amount || 0, note: x.note || '' })),
    payments: (db.payments || []).map(x => ({ id: x.id, group: x.grp, d: x.day, amount: +x.amount, kind: x.kind, note: x.note || '' })),
    battery: s.battery || {}, pv: s.pv || {}, amort: s.amort || {}, cars: s.cars || { ice: {}, ev: {} },
    tarif: s.tarif || {},
  };
}

// Referenzform -> Supabase-Zeile (Umkehrung von stateFromDb), je Datensatzart. user_id setzt db.js.
export const toDb = {
  reading: r => ({ meter_id: r.m, day: r.d, value: +r.v, source: r.src || null }),
  tariff: t => ({ id: t.id, grp: t.group, name: t.name, valid_from: t.from, valid_to: t.to || null, ap_ct: +t.ap,
    gp_eur_year: +t.gp, boni_eur: +t.boni || 0, boni_note: t.boniNote || null, estimate_note: t.est || null,
    ...(Array.isArray(t.boniItems) ? { boni_items: t.boniItems } : {}) }),   // Spalte erst ab schema v3, nur senden wenn genutzt
  installment: a => ({ id: a.id, grp: a.group, valid_from: a.from, amount: +a.amount, note: a.note || null }),
  investment: x => ({ id: x.id, day: x.date || null, name: x.name, cost: +x.cost || 0 }),
  fuel: x => ({ id: x.id, day: x.d, odometer: +x.km, liters: +x.l, amount: +x.e, fuel_type: x.s || null, full_tank: !!x.full }),
  charge: x => ({ id: x.id, day: x.d, odometer: x.km ? +x.km : null, kwh: +x.k, amount: x.e == null ? null : +x.e, location: x.o || null }),
  carlog: x => ({ id: x.id, day: x.d, car: x.car, category: x.cat, odometer: x.km ? +x.km : null, amount: +x.e || 0, note: x.note || null }),
  event: e => ({ id: e.id, day: e.d, grp: e.group || null, type: e.type || null, note: e.text || null }),
  payment: x => ({ id: x.id, grp: x.group, day: x.d, amount: +x.amount, kind: x.kind, note: x.note || null }),
  settings: S => ({ data: { schema_version: 2, battery: S.battery, pv: S.pv, amort: S.amort, cars: S.cars, ...(S.tarif && Object.keys(S.tarif).length ? { tarif: S.tarif } : {}) } }),
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
    const am = S.amort, items = S.invest.map(x => ({ ...x, date: x.date || A.dates[0] })).sort((a, b) => a.date.localeCompare(b.date));
    const startK = monthKey(items[0]?.date || A.dates[0]);
    const act = {}, feedK = {};
    A.dates.forEach((d, i) => {
      const t = tariffAt('as', d) || currentTariff('as'), k = monthKey(d);
      act[k] = (act[k] || 0) + A.c.use[i] * t.ap / 100 + ((am.feedin && (!am.feedinFrom || d >= am.feedinFrom)) ? A.c.feed[i] * am.feedin / 100 : 0);
      feedK[k] = (feedK[k] || 0) + A.c.feed[i];
    });
    const lastD = A.dates[A.n - 1], lastK = monthKey(lastD), dim = +monthEnd(lastK).slice(8, 10), have = +lastD.slice(8, 10);
    if (have < dim) act[lastK] = act[lastK] * dim / have;           // angefangenen Monat hochrechnen
    const prof = {}, profFeed = {}; let k = lastK;
    for (let j = 0; j < 12; j++) { const cm = k.slice(5, 7); if (prof[cm] === undefined) { prof[cm] = act[k] || 0; profFeed[cm] = feedK[k] || 0; } const y = +k.slice(0, 4), m = +k.slice(5, 7); k = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
    const labels = [], cumS = [], cumI = [], proj = []; let cs = 0, be = null; k = startK;
    const total = am.years * 12; let idxLast = null;
    for (let j = 0; j < total; j++) {
      let v;
      if (k <= lastK) { v = act[k] || 0; if (k === lastK) idxLast = j; }
      else {
        const yrs = (j - (idxLast ?? j)) / 12, cm = k.slice(5, 7);
        v = (prof[cm] || 0) * Math.pow(1 + am.priceInc / 100, yrs) * Math.pow(1 - am.degr / 100, yrs);
        const fd = `${k}-15`; if (am.feedin && (!am.feedinFrom || fd >= am.feedinFrom)) v += (profFeed[cm] || 0) * am.feedin / 100;
      }
      cs += v; const me = monthEnd(k), ci = items.filter(x => x.date <= me).reduce((s, x) => s + (+x.cost || 0), 0);
      labels.push(k); cumS.push(cs); cumI.push(ci); proj.push(k > lastK);
      if (be === null && ci > 0 && cs >= ci && j > 0) be = k;
      k = nextMonth(k);
    }
    return { labels, cumS, cumI, proj, be, startK, lastK };
  }
  function investTotal() { return S.invest.reduce((a, b) => a + (+b.cost || 0), 0); }

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
  function tariffBase() {
    const as = last365Cost('as'), wp = last365Cost('wp'), e = S.cars.ev || {};
    const evYear = (+e.km || 0) / 100 * (+e.kwh100 || 0) * (1 + (+e.loss || 0) / 100);
    const evHome = evYear * (+e.shHome || 0) / 100, evGrid = evHome * (1 - (+e.shPV || 0) / 100);
    return { asKwh: as ? as.kwh : 0, wpKwh: wp ? wp.kwh : 0, from: as?.from || wp?.from || null, to: as?.to || wp?.to || null, evYear, evHome, evGrid };
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
    let ins = i.ins, tax = i.tax, oth = i.other;
    if (i.useLedger) { const L = ledger12('leon', today); ins = L['Versicherung'] || 0; tax = L['Kfz-Steuer'] || 0; oth = (L['Räderwechsel'] || 0) + (L['Wartung/Reparatur'] || 0) + (L['Pflege'] || 0) + (L['Sonstiges'] || 0); }
    const iceM = i.rate + (iceFuelY + ins + tax + oth) / 12;
    const kwhY = e.km / 100 * e.kwh100 * (1 + e.loss / 100);
    const home = kwhY * e.shHome / 100, pv = home * e.shPV / 100, grid = home - pv, pub = kwhY - home;
    const evEnergyY = grid * apAS + pv * S.amort.feedin / 100 + pub * e.pricePublic;
    const evM = e.rate + (evEnergyY + e.ins + e.tax) / 12;
    const iceCum = [], evCum = []; let a = 0, b = +e.transfer || 0;
    for (let m = 0; m <= 36; m++) { if (m > 0) { a += iceM; b += evM; if (m % 12 === 0) b -= +e.thg || 0; } iceCum.push(a); evCum.push(b); }
    return { l100, ip, iceFuelY, kwhY, evEnergyY, iceCum, evCum, grid, pv, pub, fs, apAS,
      blocks: { ice: { Leasing: i.rate * 36, Energie: iceFuelY * 3, Versicherung: ins * 3, Steuer: tax * 3, Sonstiges: oth * 3 },
                ev: { Leasing: e.rate * 36, Energie: evEnergyY * 3, Versicherung: e.ins * 3, Steuer: e.tax * 3, Sonstiges: (+e.transfer || 0) - (+e.thg || 0) * 3 } } };
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

  return {
    A, IMPORT_START, sumRange, last12, groupSeries, tariffAt, currentTariff, costs, last365Cost, feedValue, pvSavings,
    lastDataDay, firstDataDay, periodOf, periodKeys, currentPeriods, valueAt, periodCost, metrics, flow, ankerSeries, battery,
    amortTimeline, investTotal, abschlagAt, abschlagCheck, odoPoints, kmDaily, carCostItems, ledger12, carKpis,
    fuelStats, fuelPrice, icePrice, carCalc, finData, finYears, meterReconciliation, feedReconciliation, wpSwap,
    paymentSuggestions, billingPeriods, tariffBase, boniOf, boniInfo, energyBalance,
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

// Boni-Notiz in Posten zerlegen, z. B. „Sofortbonus 157 € + Neukundenbonus 149 € (bei unter 2.500 kWh evtl. nur 100 €)“
// → [{name:'Sofortbonus',amount:157},{name:'Neukundenbonus',amount:149,minKwh:2500,amountBelow:100}]
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
