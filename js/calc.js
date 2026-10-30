// Rechenlogik der Energiebilanz – reine Funktionen, ohne DOM und ohne Supabase.
// Portiert aus reference/energiebilanz_v0.14.html (zweiter <script>-Block). Die Funktionen sind bewusst
// nah am Original gehalten (gleiche Namen, gleiche Reihenfolge der Rechenschritte), damit sie sich Zeile für
// Zeile gegen die Referenz prüfen lassen. Abweichung: sumRange summiert exakt in Tausendsteln (Wh).
//
// Einstieg:  const C = createCalc(state)
//   state = Referenzform: { anker:{dates:[],c:{ev,imp,…}} | {start,n,c}, meters, readings, events, tariffs,
//           abschlaege, invest, fuel, charges, carlog, battery, pv, amort, cars }
//   stateFromDb(db) wandelt Supabase-Zeilen in diese Form um.

import { hpSum } from './hp.js?v=0.46.0';

export const ANKER_KEYS = { ev: 'eigenverbrauch', imp: 'netzimport', n2h: 'netz_zu_haus', s2h: 'solar_zu_haus',
  s2b: 'solar_zu_speicher', bch: 'speicher_ladung', bdis: 'speicher_entladung', b2h: 'speicher_zu_haus',
  use: 'genutzt', gen: 'erzeugung', feed: 'einspeisung', pv1: 'pv1', pv2: 'pv2', pv3: 'pv3', pv4: 'pv4', plug: 'smart_plug', n2b: 'netz_zu_speicher' };

/* ---------- Datumshilfen ---------- */
const DAY = 86400000;
const toD = s => new Date(s + 'T00:00:00Z');
export const iso = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(toD(s).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((toD(b) - toD(a)) / DAY);
export const monthKey = s => s.slice(0, 7);
// v0.40: CO₂-Faktoren (änderbar unter CO₂ → Faktoren). Strommix laut Umweltbundesamt (g CO₂ je kWh verbrauchten
// Stroms, ohne Vorketten): 2023 379, 2024 353, 2025 344 (Stand der UBA-Zeitreihe 2026). Spätere Jahre nutzen den
// letzten bekannten Wert. Wärme-Vergleich: Durchschnittsheizung in Deutschland (rund 3/4 Gas und Öl) ≈ 280 g je kWh
// Wärme (Gas 240 bzw. Öl 310 g je kWh Brennstoff nach GEG Anlage 9, Kesselwirkungsgrad ~0,9, Rest Fernwärme/Strom).
export const CO2_DEFAULTS = { mix: { 2023: 379, 2024: 353, 2025: 344 }, contract: { as: 0, wp: 0 }, heatRef: 280, petrol: 2370,
  pvKgKwp: 800, battKgKwh: 80, persons: 3, copFallback: 3.0 };
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
    readings: (db.meter_readings || []).map(r => ({ m: r.meter_id, d: r.day, v: +r.value, src: r.source, t: r.read_at || null })),
    // v0.46: Spalte read_at vorhanden? (ohne SQL-Update V46 fehlt sie in den Zeilen)
    readAtOk: !(db.meter_readings || []).length || 'read_at' in db.meter_readings[0],
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
    tarif: s.tarif || {}, ausbau: s.ausbau || {}, wx: s.wx || {}, offers: Array.isArray(s.offers) ? s.offers : [], water: s.water || {}, stages: Array.isArray(s.stages) ? s.stages : [],
    weather: (db.weather_daily || []).map(r => ({ d: r.day, t: +r.temp_mean, rad: +r.rad_kwh, sun: r.sun_h == null ? null : +r.sun_h }))
      .sort((a, b) => a.d.localeCompare(b.d)),
    weatherError: db.weatherError || null,
    hp: (db.hp_energy || []).map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !['user_id', 'created_at', 'updated_at'].includes(k))
      .map(([k, v]) => [k, ['grain', 'ts'].includes(k) || v == null ? v : +v]))),
    hpError: db.hpError || null,
    pvForecasts: (db.pv_forecast || []).map(r => ({ d: r.day, made: r.made_on, kwh: +r.kwh, lo: r.lo == null ? null : +r.lo, hi: r.hi == null ? null : +r.hi,
      rad: r.rad_kwh == null ? null : +r.rad_kwh, f: r.factor == null ? null : +r.factor })),
    pvForecastError: db.pvForecastError || null,
    devices: Array.isArray(s.devices) ? s.devices : [],
    deviceDays: (db.device_daily || []).map(r => ({ dev: r.device_id, d: r.day, kwh: r.kwh == null ? null : +r.kwh,
      l: r.water_l == null ? null : +r.water_l, runs: r.runs == null ? null : +r.runs, src: r.src || 'day' })),
    deviceError: db.deviceError || null,
    programs: (db.device_programs || []).map(r => ({ dev: r.device_id, m: String(r.month).slice(0, 7), prog: r.program, temp: +r.temp || 0, rpm: +r.rpm || 0,
      extra: r.extra || '', runs: +r.runs || 0, kwh: r.kwh_run == null ? null : +r.kwh_run, l: r.l_run == null ? null : +r.l_run })),
    programError: db.programError || null,
    rooms: Array.isArray(s.rooms) ? s.rooms : [],
    co2: s.co2 && typeof s.co2 === 'object' ? s.co2 : {},
    gridCo2: Object.fromEntries((db.grid_co2 || []).map(r => [r.day, { g: +r.g_mean, hours: Array.isArray(r.hours) ? r.hours.map(v => (v == null ? null : +v)) : null }])),
    gridCo2Error: db.gridCo2Error || null,
    climate: (db.room_climate || []).map(r => ({ room: r.room, d: r.day, n: +r.n, t: r.t == null ? null : +r.t, rh: r.rh == null ? null : +r.rh,
      lo: r.rh_min == null ? null : +r.rh_min, hi: r.rh_max == null ? null : +r.rh_max, dry: +r.h_dry || 0, wet: +r.h_wet || 0,
      hours: Array.isArray(r.hours) ? r.hours : null })),
    climateError: db.climateError || null,
  };
}

// Referenzform -> Supabase-Zeile (Umkehrung von stateFromDb), je Datensatzart. user_id setzt db.js.
export const toDb = {
  reading: r => ({ meter_id: r.m, day: r.d, value: +r.v, source: r.src || null, ...(r.t ? { read_at: r.t } : {}) }),
  meter: m => ({ id: m.id, name: m.name, grp: m.group, sort: +m.order || 0 }),
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
    ...(S.wx && Object.keys(S.wx).length ? { wx: S.wx } : {}), ...(S.offers && S.offers.length ? { offers: S.offers } : {}), ...(S.water && Object.keys(S.water).length ? { water: S.water } : {}), ...(S.stages && S.stages.length ? { stages: S.stages } : {}), ...(S.devices && S.devices.length ? { devices: S.devices } : {}), ...(S.rooms && S.rooms.length ? { rooms: S.rooms } : {}), ...(S.co2 && Object.keys(S.co2).length ? { co2: S.co2 } : {}) } }),
};

/* ---------- Rechenkern ---------- */
// v0.29: unausgefüllte Einträge erkennen (Anzeige markiert sie, Rechnung ignoriert sie)
export const abschlagEmpty = a => !(+a.amount > 0) && !(a.note || '').trim();
export const tariffEmpty = t => !(+t.ap > 0);

export function createCalc(S) {
  // Anker-Daten: entweder {start, n, c} (seed_state.json) oder {dates, c} (stateFromDb)
  const src = S.anker;
  const dates = src.dates ? [...src.dates] : Array.from({ length: src.n }, (_, i) => addDays(src.start, i));
  // v0.31: Netzladung fehlt in Seed und älteren Zuständen
  const A = { dates, c: src.c.n2b ? src.c : { ...src.c, n2b: dates.map(() => null) }, n: dates.length, idx: Object.fromEntries(dates.map((d, i) => [d, i])) };
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
  // v0.46: Ablesezeit als Anteil des Tages (Ortszeit Europe/Berlin); nur wenn die Uhrzeit zum Ablesetag gehört, sonst 0 (= 00:00)
  const _BER = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function readFrac(r) {
    if (!r.t) return 0; const ms = Date.parse(r.t); if (!isFinite(ms)) return 0;
    const p = Object.fromEntries(_BER.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}` === r.d ? (+p.hour + +p.minute / 60) / 24 : 0;
  }
  function groupSeries(group) {
    if (_gcache.has(group)) return _gcache.get(group);
    const meters = S.meters.filter(m => m.group === group).sort((a, b) => a.order - b.order);
    let pts = [], offset = 0, prevEnd = null;
    meters.forEach((m, k) => {
      const rs = S.readings.filter(r => r.m === m.id).sort((a, b) => a.d.localeCompare(b.d));
      if (!rs.length) return;
      if (k > 0 && prevEnd != null) offset = prevEnd - rs[0].v;
      rs.forEach(r => pts.push({ d: r.d, f: readFrac(r), cum: r.v + offset, m: m.id }));
      prevEnd = rs[rs.length - 1].v + offset;
    });
    pts.sort((a, b) => a.d.localeCompare(b.d));
    const ded = []; pts.forEach(p => { if (ded.length && ded[ded.length - 1].d === p.d) ded[ded.length - 1] = p; else ded.push(p); });
    const intervals = [], daily = {};
    for (let i = 0; i < ded.length - 1; i++) {
      // v0.46: stundengenau – Intervall von a.d + Ablesezeit bis b.d + Ablesezeit; jeder Tag zählt mit seinem Anteil (ov)
      const a = ded[i], b = ded[i + 1], n0 = diffDays(a.d, b.d), x0 = a.f || 0, x1 = n0 + (b.f || 0), n = x1 - x0; if (n <= 0) continue;
      const kw = b.cum - a.cum, rate = kw / n; intervals.push({ from: a.d, to: b.d, days: n, kwh: kw, rate, fa: x0, fb: b.f || 0 });
      const days = [], ov = {};
      for (let j = 0; j < Math.ceil(x1); j++) { const lo = Math.max(j, x0), hi = Math.min(j + 1, x1); if (hi - lo > 1e-9) { const d = addDays(a.d, j); days.push(d); ov[d] = hi - lo; } }
      const put = (d, v) => { daily[d] = (daily[d] || 0) + v; };
      let shaped = false;
      if (group === 'as') {
        // Allgemeinstrom: Verteilung nach dem Anker-Netzbezug (ab Smart Meter), Rest gleichmäßig auf Tage ohne Messung
        const is = IMPORT_START(), meas = days.filter(d => d >= is && A.idx[d] !== undefined), pre = days.filter(d => !(d >= is && A.idx[d] !== undefined));
        if (meas.length) {
          const sImp = meas.reduce((s, d) => s + A.c.imp[A.idx[d]] * ov[d], 0), rem = kw - sImp, sPre = pre.reduce((s, d) => s + ov[d], 0);
          if (sImp > 0 && (rem >= 0 || !pre.length) && (pre.length || Math.abs(rem) / kw < 0.5)) {
            const f = pre.length ? 1 : kw / sImp;
            meas.forEach(d => put(d, A.c.imp[A.idx[d]] * ov[d] * f));
            pre.forEach(d => put(d, rem * ov[d] / sPre));
            shaped = true; intervals[intervals.length - 1].shaped = true;
          }
        }
      }
      if (!shaped && group === 'wp') {
        // Wärmepumpe (v0.12): Verteilung nach dem Geräteprofil aus der Wärmepumpen-App – Tageswert, sonst
        // Monatswert ÷ Tage des Monats. Nur wenn jeder Tag des Intervalls einen Wert hat und die Summe > 0 ist.
        const w = days.map(d => { const x = hpWeight(d); return x == null ? null : x * ov[d]; });
        const sw = w.reduce((a, x) => a + (x ?? 0), 0);
        if (w.every(x => x != null) && sw > 0) {
          days.forEach((d, j) => put(d, kw * w[j] / sw));
          shaped = true; intervals[intervals.length - 1].shaped = 'hp';
        }
      }
      if (!shaped) days.forEach(d => put(d, rate * ov[d]));
    }
    const res = { pts: ded, intervals, daily, first: ded[0]?.d, last: ded[ded.length - 1]?.d };
    _gcache.set(group, res); return res;
  }

  /* Tarife und Kosten */
  // v0.29: Tarife ohne Arbeitspreis (0 ct/kWh, unausgefüllt) zählen nicht
  function tariffAt(group, d) { return S.tariffs.find(t => t.group === group && !tariffEmpty(t) && t.from <= d && (!t.to || d <= t.to)); }
  function currentTariff(group) { const ts = S.tariffs.filter(t => t.group === group && !tariffEmpty(t)).sort((a, b) => b.from.localeCompare(a.from)); return ts[0]; }
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
  // v0.30: Anlagenstufen (settings.data.stages): PV-Leistung und Speicher gelten ab dem Datum der Stufe. Geplante Stufen
  // zählen nicht. Ohne Stufen gelten pv.kwp und battery.capGross wie bisher.
  const STAGES = (S.stages || []).filter(x => x.status !== 'planned' && x.from).sort((a, b) => a.from.localeCompare(b.from));
  function stageAt(d) { let st = null; for (const x of STAGES) if (x.from <= d) st = x;
    return { stage: st, kwp: st && +st.kwp > 0 ? +st.kwp : (+S.pv.kwp || 1), capGross: st && +st.capGross > 0 ? +st.capGross : (+S.battery.capGross || 0) }; }
  const usableOf = cap => cap * (1 - (+S.battery.reserve || 0) / 100);
  // Ø über die Tage mit Anker-Daten im Zeitraum (gewichtet nach Tagen); ohne Daten: Stand am Ende
  function stageAvg(from, to, f) { const ds = A.dates.filter(d => d >= from && d <= to); return ds.length ? ds.reduce((a, d) => a + f(stageAt(d)), 0) / ds.length : f(stageAt(to)); }
  const kwpIn = (from, to) => stageAvg(from, to, x => x.kwp), usableIn = (from, to) => stageAvg(from, to, x => usableOf(x.capGross));
  const _mcache = new Map();
  function metrics(from, to) {
    const ck = from + '|' + to;
    if (_mcache.has(ck)) return _mcache.get(ck);
    const s = k => sumRange(k, from, to), is = IMPORT_START(), b = S.battery, usable = usableIn(from, to);
    const days = diffDays(from, to) + 1, ankDays = A.dates.filter(d => d >= from && d <= to).length;
    const af = from > is ? from : is, autOK = af <= to && A.dates.some(d => d >= af && d <= to);
    const useA = autOK ? sumRange('use', af, to) : 0, impA = autOK ? sumRange('imp', af, to) : 0;
    let full = 0, measured = 0; A.dates.forEach((d, i) => { if (d < from || d > to || d < is) return; measured++; if (A.c.feed[i] >= b.fullThresh) full++; });
    const gen = s('gen'), use = s('use'), bch = s('bch'), bdis = s('bdis'), b2h = s('b2h'), feed = s('feed'), n2b = s('n2b');
    const as = periodCost('as', from, to), wp = periodCost('wp', from, to);
    const sav = ankDays ? valueAt('use', from, to) + feedValue(from, to) : null;
    const impDays = A.dates.filter(d => d >= from && d <= to && d >= is).length, feedOK = ankDays > 0 && impDays / ankDays >= 0.5;
    const m = { days, ankDays, asDays: as.days, wpDays: wp.days, bch, b2h, n2b, feed: feedOK ? feed : null,
      imp: feedOK ? impA : null, aut: feedOK && (useA + impA) > 0 ? useA / (useA + impA) : null, impDays, evq: gen > 0 ? use / gen : null,
      eff: bch > 0 ? bdis / bch : null, cyc: ankDays ? bdis / usable : null, full: feedOK ? full : null, measured, sav,
      // v0.31: Netzladung des Speichers wurde bezahlt und mindert seinen Wert
      battVal: ankDays ? valueAt('b2h', from, to) - valueAt('n2b', from, to) : null, gen: ankDays ? gen : null, use: ankDays ? use : null, bdis: ankDays ? bdis : null,
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
    return { usable: usableIn(from, to), fullShare: m.measured ? m.full / m.measured : null };
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
  // v0.29: Zeilen mit 0 € ohne Notiz sind unausgefüllt (z. B. frisch mit „Abschlag hinzufügen“ angelegt) und zählen nicht
  function abschlagAt(g, d) { const l = S.abschlaege.filter(a => a.group === g && a.from && a.from <= d && !abschlagEmpty(a)).sort((a, b) => b.from.localeCompare(a.from))[0]; return l ? +l.amount : 0; }
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
    const tr = trendRest(g, today, end), ap = t.ap / 100, trend = tr ? { ...tr, costTrend: costRest + (tr.trend - tr.prev) * ap, costMild: costRest + (tr.mild - tr.prev) * ap, costCold: costRest + (tr.cold - tr.prev) * ap } : null;
    if (trend) { trend.balTrend = paid + restPay - (costSo + trend.costTrend); trend.recTrend = nRest > 0 ? Math.max(0, (costSo + trend.costTrend - paid) / nRest) : null; }
    return { trend, t, start, end, today, kwhSo, costSo, kwhRest, costRest, paid, nPaid, nRest, cur, payTotal, costTotal, nextDue,
      evK, bal: payTotal - costTotal, recNow: nRest > 0 ? Math.max(0, (costTotal - paid) / nRest) : null, recAvg: costTotal / 12, fb, kwhTotal: kwhSo + kwhRest,
      paidSource, nExpected };
  }

  // v0.39: Prognose mit Trend. Wärmepumpe wetterbereinigt: Verbrauch = Grundlast (Warmwasser, je Tag) + k × Gradtage.
  // Grundlast aus heizfreien Tagen der letzten 60 Tage (sonst Vorjahr), k dieser Saison (ab 1. September) gemischt mit
  // k der Vorjahressaison, Gewicht w = Anteil der Vorjahres-Heizenergie in den Vergleichswochen ÷ 0,4. Restliche Tage mit den Gradtagen derselben Tage des
  // Vorjahres; „milder“/„kälter“ = Gradtage × 0,85 / × 1,15. (Mischung: k = k Vorjahr × Veränderung gleicher Wochen,
  // Veränderung mit Gewicht w Richtung 1 gezogen.) Allgemeinstrom: Faktor letzte 56 Tage ÷ dieselben Tage im
  // Vorjahr, Spanne aus den Faktoren über 28 und 84 Tage. Nur Daten bis „today“ fließen ein (auch für den Rückblick).
  const TREND = { win: 56, wShare: 0.4, band: 0.15, minGt: 30 };
  function trendModel(g, today, opt = {}) {
    const s = groupSeries(g), dly = s.daily, { heatLimit, room } = wxCfg();
    const gt = d => { const w = W[d]; return w && w.t != null ? (w.t < +heatLimit ? +room - w.t : 0) : null; };
    const sumWin = (to, n, shift) => { let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { const d = addDays(to, -i), v = dly[d], p = dly[shiftYear(d)];
      if (v == null || p == null) continue; a += v; b += p; c++; } return { a, b, c }; };
    if (g !== 'wp') {
      const r = n => { const x = sumWin(today, n); return x.c >= n * 0.7 && x.b > 0 ? x.a / x.b : null; };
      const f = r(opt.win || TREND.win), f28 = r(28), f84 = r(84), fs = [f, f28, f84].filter(v => v != null);
      if (f == null) return null;
      // Faktor je Monat aus Monaten mit gleichem Sonnenstand (derselbe Monat und sein Spiegel um den Juni: Dez↔Jan,
      // Nov↔Feb, Okt↔Mär …), jeweils das letzte vollständig gemessene Vorkommen bis „today“ gegen das Jahr davor.
      // PV und Speicher ersetzen im Sommer viel mehr Netzstrom als im Winter – ein Sommerfaktor passt nicht für den Winter.
      const mFac = {}, mSum = (k) => { let a = 0, b = 0, c = 0, n = +monthEnd(k).slice(8, 10);
        for (let i = 1; i <= n; i++) { const d = `${k}-${String(i).padStart(2, '0')}`; if (d > today) return null; const v = dly[d], p = dly[shiftYear(d)]; if (v == null || p == null) continue; a += v; b += p; c++; }
        return c >= n - 3 && b > 0 ? { a, b } : null; };
      const lastOf = mm => { let y = +today.slice(0, 4); const k = `${y}-${String(mm).padStart(2, '0')}`; return k <= today.slice(0, 7) ? k : `${y - 1}-${String(mm).padStart(2, '0')}`; };
      for (let mm = 1; mm <= 12; mm++) { let a = 0, b = 0; for (const x of new Set([mm, 13 - mm])) { const r = mSum(lastOf(x)); if (r) { a += r.a; b += r.b; } } mFac[mm] = b > 0 ? a / b : null; }
      const method = opt.method || 'win', facOf = d => method === 'flat' ? 1 : method === 'season' ? (mFac[+d.slice(5, 7)] ?? f) : f, used = Object.values(mFac).filter(v => v != null).length;
      return { g, kind: 'ratio', method, f, lo: Math.min(...fs), hi: Math.max(...fs), n: sumWin(today, TREND.win).c, mFac, used,
        day: (d, x = 1) => { const p = dly[shiftYear(d)]; if (p == null) return null; const k = facOf(d); return p * (x === 1 ? k : x < 1 ? k * Math.min(...fs) / f : k * Math.max(...fs) / f); } };
    }
    // Wärmepumpe: Grundlast aus heizfreien Tagen
    // Grundlast: heizfreie Tage (mindestens 14) der letzten 60 Tage, sonst Juni–August davor (im Winter sind
    // heizfreie Tage selten und meist Übergangstage mit etwas Heizung – das würde die Grundlast überschätzen)
    const baseFrom = (to, n, minN = 14) => { let k = 0, c = 0; for (let i = 0; i < n; i++) { const d = addDays(to, -i), v = dly[d]; if (v != null && gt(d) === 0) { k += v; c++; } } return c >= minN ? k / c : null; };
    const summer = to => { const y = to.slice(5) >= '09-01' ? +to.slice(0, 4) : +to.slice(0, 4) - 1; let k = 0, c = 0;
      for (let d = `${y}-06-01`; d <= `${y}-08-31` && d <= to; d = addDays(d, 1)) { const v = dly[d]; if (v != null) { k += v; c++; } } return c >= 30 ? k / c : null; };
    const yr = +today.slice(0, 4), sStart = today.slice(5) >= '09-01' ? `${yr}-09-01` : `${yr - 1}-09-01`;
    const season = (from, to, b) => { let k = 0, t = 0, c = 0; for (let d = from; d <= to; d = addDays(d, 1)) { const v = dly[d], x = gt(d); if (v == null || x == null) continue; k += v - b; t += x; c++; } return { k, t, c }; };
    const bNow = baseFrom(today, 60) ?? summer(today), bPrev = baseFrom(shiftYear(today), 60) ?? summer(shiftYear(today));
    const b = bNow ?? bPrev; if (b == null) return null;
    const pS = shiftYear(sStart), pE = addDays(shiftYear(sStart), 364);
    // k Vorjahr aus der ganzen Vorjahressaison; Veränderung aus denselben Wochen (diese Saison bis heute gegen dieselben
    // Kalendertage im Vorjahr), damit Übergangswochen mit wenig Heizung nicht gegen einen ganzen Winter stehen
    const prev = season(pS, pE < today ? pE : addDays(today, -1), bPrev ?? b), cur = season(sStart, today, b), same = season(pS, shiftYear(today), bPrev ?? b);
    const kPrev = prev.t >= 100 ? Math.max(0, prev.k / prev.t) : null, kNow = cur.t >= TREND.minGt ? Math.max(0, cur.k / cur.t) : null;
    const kSame = same.t >= TREND.minGt && same.k > 0 ? same.k / same.t : null;
    const relRaw = kNow != null && kSame ? Math.min(2, Math.max(0.3, kNow / kSame)) : null;
    // Gewicht: Anteil der Heizenergie des letzten Winters, der in die Vergleichswochen fiel (volles Gewicht ab 40 %)
    const heatShare = prev.k > 0 ? Math.max(0, same.k) / prev.k : 0;
    const w = relRaw == null ? 0 : Math.min(1, heatShare / TREND.wShare), rel = relRaw == null ? 1 : w * relRaw + (1 - w);
    const k = kPrev != null ? kPrev * rel : kNow;
    if (k == null) return null;
    return { g, kind: 'weather', b, bNow, bPrev, kNow, kPrev, kSame, relRaw, rel, k, w, heatShare, gtNow: cur.t, gtPrevSeason: prev.t,
      day: (d, x = 1) => { const t = gt(shiftYear(d)); return t == null ? null : b + k * t * x; } };
  }
  // Rest bis „end“: wie Vorjahr / mit Trend / milder / kälter (kWh)
  // Allgemeinstrom: Methode nach dem Rückblick wählen (geringste mittlere Abweichung der letzten Monate)
  const _bestCache = new Map();
  function bestMethod(g, today) {
    if (g === 'wp') return { method: null, scores: null };
    const key = g + today; if (_bestCache.has(key)) return _bestCache.get(key);
    const scores = {}; for (const mth of ['win', 'season', 'flat']) { const bt = trendBacktest(g, today, mth); scores[mth] = bt.list.length >= 3 ? bt.maeTrend : null; }
    const ok = Object.entries(scores).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
    const res = { method: ok.length ? ok[0][0] : 'win', scores }; _bestCache.set(key, res); return res;
  }
  function trendRest(g, today, end, method) {
    const mth = method !== undefined ? method : bestMethod(g, today).method;
    const m = trendModel(g, today, { method: mth }), dly = groupSeries(g).daily; if (!m) return null;
    const lo = m.kind === 'weather' ? 1 - TREND.band : 0, hi = m.kind === 'weather' ? 1 + TREND.band : 2;
    let prev = 0, tr = 0, mild = 0, cold = 0, miss = 0;
    for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) {
      const p = dly[shiftYear(d)], v = m.day(d), vl = m.day(d, lo), vh = m.day(d, hi);
      if (v == null || p == null) { miss++; continue; } prev += p; tr += v; mild += vl; cold += vh; }
    return { m, prev, trend: tr, mild: Math.min(mild, cold), cold: Math.max(mild, cold), miss };
  }
  // Rückblick: zu jedem Monatsersten der letzten 12 Monate die nächsten 30 Tage vorhersagen und mit der Messung vergleichen
  function trendBacktest(g, lastDay, method = null) {
    const dly = groupSeries(g).daily, out = [];
    for (let i = 12; i >= 1; i--) {
      const cut = addDays(`${addMonths(lastDay.slice(0, 7) + '-01', -i).slice(0, 7)}-01`, -1), end = addDays(cut, 30);
      if (end > lastDay) continue;
      let act = 0, n = 0; for (let d = addDays(cut, 1); d <= end; d = addDays(d, 1)) if (dly[d] != null) { act += dly[d]; n++; }
      if (n < 28) continue;
      const r = trendRest(g, cut, end, method); if (!r || r.miss > 2 || !act) continue;
      out.push({ cut, act, trend: r.trend, prev: r.prev, eT: r.trend / act - 1, eP: r.prev / act - 1 });
    }
    const mae = k => out.length ? out.reduce((a, x) => a + Math.abs(x[k]), 0) / out.length : null;
    return { list: out, maeTrend: mae('eT'), maePrev: mae('eP') };
  }
  // Monatsübersicht des Abrechnungsjahres: Vorjahr, gemessen, Prognose mit Trend
  function trendMonths(g, start, end, today) {
    const dly = groupSeries(g).daily, m = trendModel(g, today, { method: bestMethod(g, today).method }), out = {};
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const k = d.slice(0, 7), o = out[k] = out[k] || { k, prev: 0, meas: 0, fc: 0, nPrev: 0 };
      const p = dly[shiftYear(d)]; if (p != null) { o.prev += p; o.nPrev++; }
      if (d <= today) { if (dly[d] != null) o.meas += dly[d]; } else if (m) { const v = m.day(d); if (v != null) o.fc += v; else if (p != null) o.fc += p; } else if (p != null) o.fc += p;
    }
    return Object.values(out);
  }

  // v0.40: CO₂-Bilanz. Zwei Sichten: „Strommix“ (physikalisch, UBA-Faktor des Jahres) und „Vertrag“ (Stromkennzeichnung,
  // bei Ökostrom 0 g). Vergleich „ohne Technik“: Haushaltsstrom ganz aus dem Netz (ohne PV), Wärme der Wärmepumpe mit der
  // Durchschnittsheizung, Fahrten des E-Autos mit dem Leon (Benzin). Einspeisung verdrängt Netzstrom anderer – getrennt
  // als Gutschrift ausgewiesen. Werte in kg.
  const co2Cfg = () => { const c = S.co2 || {}; return { ...CO2_DEFAULTS, ...c, mix: { ...CO2_DEFAULTS.mix, ...(c.mix || {}) }, contract: { ...CO2_DEFAULTS.contract, ...(c.contract || {}) },
    persons: +c.persons || Math.round(+(S.water || {}).persons || 0) || CO2_DEFAULTS.persons }; };
  function mixAt(d, cfg = co2Cfg()) {
    const y = +d.slice(0, 4), ys = Object.keys(cfg.mix).map(Number).filter(k => +cfg.mix[k] > 0).sort((a, b) => a - b);
    if (!ys.length) return 0; let v = ys[0]; for (const k of ys) if (k <= y) v = k; return +cfg.mix[v];
  }
  // Wärmepumpe je Tag und Stunde: [[stunde, kWh], …] aus den Stundenexporten
  const hpHourByDay = (() => { let m = null; return () => { if (m) return m; m = {};
    for (const r of HP) { if (r.grain !== 'hour') continue; const d = r.ts.slice(0, 10), h = +r.ts.slice(11, 13), k = (+r.el_hp || 0) + (+r.el_aux || 0); (m[d] = m[d] || []).push([h, k]); } return m; }; })();
  // v0.41: Netz-CO₂ je Stunde, gemittelt über die Tage im Zeitraum; beste und schlechteste Stunden
  function gridProfile(from, to) {
    const G = S.gridCo2 || {}, s = Array(24).fill(0), c = Array(24).fill(0); let days = 0, sum = 0, nd = 0, lo = null, hi = null;
    for (const [d, r] of Object.entries(G)) { if (d < from || d > to) continue; nd++; sum += r.g; if (!lo || r.g < lo.g) lo = { d, g: r.g }; if (!hi || r.g > hi.g) hi = { d, g: r.g };
      if (!r.hours) continue; days++; r.hours.forEach((v, h) => { if (v != null) { s[h] += v; c[h]++; } }); }
    const hours = s.map((v, h) => (c[h] ? v / c[h] : null)), ok = hours.map((v, h) => [h, v]).filter(x => x[1] != null).sort((a, b) => a[1] - b[1]);
    return { days, nd, mean: nd ? sum / nd : null, hours, best: ok.slice(0, 3).map(x => x[0]).sort((a, b) => a - b), worst: ok.slice(-3).map(x => x[0]).sort((a, b) => a - b), lo, hi,
      spread: ok.length ? ok[ok.length - 1][1] - ok[0][1] : null };
  }
  function co2Range(from, to) {
    const cfg = co2Cfg(), as = groupSeries('as').daily, wp = groupSeries('wp').daily;
    const hd = Object.fromEntries(hpDays(from, to).map(r => [r.d, r]));
    const hpAll = hpDays('0000-01-01', '9999-12-31'), copAvg = (() => { const s = hpAll.reduce((a, r) => { a.h += r.heat || 0; a.e += (r.el || 0) - (r.elCool || 0); return a; }, { h: 0, e: 0 }); return s.e > 20 ? s.h / s.e : cfg.copFallback; })();
    const ev = S.cars?.ev || {}, ice = S.cars?.ice || {}, fs = fuelStats(), l100 = (ice.useLog && fs.l100) ? fs.l100 : (+ice.l100 || fs.l100 || 6.5);
    const evKmDay = +ev.km ? +ev.km / 365 : 0, fuelBy = {}; for (const f of S.fuel || []) fuelBy[f.d] = (fuelBy[f.d] || 0) + (+f.l || 0);
    const months = {}, T = { netDays: 0, asY: 0, wpY: 0, asKg: 0, wpKg: 0, carKg: 0, asC: 0, wpC: 0, pvSelfKg: 0, feedKg: 0, cfElecKg: 0, cfHeatKg: 0, cfCarKg: 0, heat: 0, heatEst: 0, asKwh: 0, wpKwh: 0, pvSelf: 0, feed: 0, fuelL: 0, evKm: 0, days: 0 };
    const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
    const G = cfg.hourly === false ? {} : (S.gridCo2 || {}), hh = hpHourByDay();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const fy = mixAt(d, cfg) / 1000, gd = G[d], f = gd ? gd.g / 1000 : fy, m = months[d.slice(0, 7)] = months[d.slice(0, 7)] || { k: d.slice(0, 7) }, i = A.idx[d];
      const a = as[d], w = wp[d], self = i !== undefined ? +A.c.use[i] || 0 : 0, fd = i !== undefined ? +A.c.feed[i] || 0 : 0;
      const any = a != null || w != null || i !== undefined; if (!any && !fuelBy[d]) continue; T.days++;
      const h = hd[d] ? hd[d].heat : (w != null ? w * copAvg : 0); if (!hd[d] && w != null) T.heatEst += h;
      const fuelL = fuelBy[d] || 0, evKm = ev.start && d >= ev.start ? evKmDay : 0;
      // Wärmepumpe: Stundenwerte des Netzes mit den Stunden-kWh der Wärmepumpe gewichten (Heizen nachts/morgens zählt mit dem Nachtwert)
      let fw = f; if (gd && gd.hours && hh[d]) { let e = 0, g = 0; for (const [h, k] of hh[d]) { const gv = gd.hours[h]; if (gv != null && k > 0) { e += k; g += k * gv; } } if (e > 0.5) fw = g / e / 1000; }
      const parts = { netDays: gd ? 1 : 0, asY: (a || 0) * fy, wpY: (w || 0) * fy, asKg: (a || 0) * f, wpKg: (w || 0) * fw, carKg: fuelL * cfg.petrol / 1000, asC: (a || 0) * (+cfg.contract.as || 0) / 1000, wpC: (w || 0) * (+cfg.contract.wp || 0) / 1000,
        pvSelfKg: self * f, feedKg: fd * f, cfElecKg: ((a || 0) + self) * f, cfHeatKg: h * cfg.heatRef / 1000, cfCarKg: fuelL * cfg.petrol / 1000 + evKm * l100 / 100 * cfg.petrol / 1000,
        heat: h, asKwh: a || 0, wpKwh: w || 0, pvSelf: self, feed: fd, fuelL, evKm };
      for (const [k, v] of Object.entries(parts)) { add(m, k, v); add(T, k, v); }
    }
    const fin = o => { o.actualYear = o.asY + o.wpY + o.carKg; o.actual = o.asKg + o.wpKg + o.carKg; o.contract = o.asC + o.wpC + o.carKg; o.cf = o.cfElecKg + o.cfHeatKg + o.cfCarKg; o.saved = o.cf - o.actual; o.net = o.actual - o.feedKg; return o; };
    Object.values(months).forEach(o => { for (const k of Object.keys(T)) if (o[k] == null) o[k] = 0; fin(o); });
    fin(T);
    return { cfg, copAvg, l100, months: Object.values(months).sort((x, y) => x.k.localeCompare(y.k)), T, mixFrom: mixAt(from, cfg), mixTo: mixAt(to, cfg) };
  }
  // Graue Emissionen der Anlage (aktuelle Stufe) und Rückzahlzeit über die PV-Einsparung der letzten 365 Tage
  function co2Grey(today) {
    const cfg = co2Cfg(), st = stageAt(today), kwp = +(st?.kwp ?? S.pv?.kwp) || 0, cap = +(st?.capGross) || +(S.battery?.capGross) || 0;
    const grey = kwp * cfg.pvKgKwp + cap * cfg.battKgKwh, first = STAGES.length ? STAGES[0].from : A.dates[0];
    const y = co2Range(addDays(today, -364), today).T, all = co2Range(first, today).T, perYear = y.pvSelfKg + y.feedKg, done = all.pvSelfKg + all.feedKg;
    return { kwp, cap, grey, pvGrey: kwp * cfg.pvKgKwp, battGrey: cap * cfg.battKgKwh, perYear, done, since: first, years: perYear > 0 ? grey / perYear : null, share: grey > 0 ? done / grey : null };
  }
  // Hebel: kg CO₂ und € im Jahr aus den Daten der letzten 365 Tage
  function co2Levers(today) {
    const cfg = co2Cfg(), from = addDays(today, -364), R = co2Range(from, today), f = mixAt(today, cfg) / 1000, T = R.T, out = [];
    const apAs = (currentTariff('as')?.ap || 30) / 100, apWp = (currentTariff('wp')?.ap || apAs * 100) / 100;
    const hpY = hpDays(from, today), elHeat = hpY.length >= 200 ? hpY.reduce((a, r) => a + (r.elHeat || 0), 0) : T.wpKwh * 0.7;
    out.push({ id: 'heat1', title: 'Raumtemperatur 1 °C niedriger', kwh: elHeat * 0.06, kg: elHeat * 0.06 * f, eur: elHeat * 0.06 * apWp, note: 'etwa 6 % weniger Heizenergie je Grad' });
    const plan = (S.stages || []).filter(x => x.status === 'planned').sort((a, b) => (+b.kwp || 0) - (+a.kwp || 0))[0], cur = stageAt(today);
    if (plan && cur && +plan.kwp > +cur.kwp) { const yld = kwpIn(from, today) > 0 ? sumRange('gen', from, today) / kwpIn(from, today) : 900, k = (+plan.kwp - +cur.kwp) * yld;
      // v0.43: eigene Eigenverbrauchsquote der letzten 365 Tagen statt pauschal 60 % (zusätzliche Module erreichen eher weniger)
      const genY = sumRange('gen', from, today), q = genY > 0 ? Math.min(1, sumRange('use', from, today) / genY) : 0.6, fi = (+S.amort?.feedin || 0) / 100;
      out.push({ id: 'pv', title: `PV-Ausbau „${plan.name}“ (+${(+plan.kwp - +cur.kwp).toFixed(2)} kWp)`, kwh: k, kg: k * f, eur: k * (q * apAs + (1 - q) * fi), q,
        note: `Ertrag je kWp wie in den letzten 365 Tagen; ${Math.round(q * 100)} % selbst genutzt wie bisher (Obergrenze – zusätzlicher Strom fällt oft dann an, wenn der Speicher schon voll ist), Rest eingespeist zu ${(fi * 100).toFixed(1)} ct` }); }
    const ev = S.cars?.ev || {};
    if (+ev.km) { const kwhY = +ev.km / 100 * (+ev.kwh100 || 18) * (1 + (+ev.loss || 0) / 100), gridShare = (+ev.shHome || 0) / 100 * (1 - (+ev.shPV || 0) / 100) + (1 - (+ev.shHome || 0) / 100);
      const iceKg = +ev.km / 100 * R.l100 * cfg.petrol / 1000, evKg = kwhY * gridShare * f;
      let evEur = null; try { const cc = carCalc(today); evEur = cc.iceFuelY - cc.evEnergyY; } catch { /* Auto-Vergleich unvollständig */ }
      out.push({ id: 'ev', title: 'E-Auto statt Leon (Benzin)', kwh: null, kg: iceKg - evKg, eur: evEur, note: `${Math.round(+ev.km)} km im Jahr, Leon ${R.l100.toFixed(1)} l/100 km gegen ${Math.round(kwhY)} kWh Strom (${Math.round(gridShare * 100)} % aus dem Netz); € nur Energie (Benzin gegen Strom), ohne Leasing, Versicherung, Steuer – die stehen auf der Seite „Auto“` }); }
    out.push({ id: 'base', title: 'Allgemeinstrom 10 % weniger (Grundlast, Geräte)', kwh: T.asKwh * 0.1, kg: T.asKwh * 0.1 * f, eur: T.asKwh * 0.1 * apAs, note: 'z. B. Standby, alte Geräte, Trockner' });
    // Verschieben bringt nur, was sonst eingespeist würde (Speicher voll); eingespeiste kWh ersetzen bereits Netzstrom anderer,
    // der Gewinn für die eigene Bilanz ist daher der Eigenverbrauch statt Einspeisung (CO₂ gleich, € = Arbeitspreis − Vergütung)
    const sh = Math.min(365, T.feed);
    out.push({ id: 'shift', title: 'Verbrauch in die Sonnenstunden legen', kwh: sh, kg: 0, eur: sh * (apAs - (+S.amort?.feedin || 0) / 100), note: `nur die ${Math.round(T.feed)} kWh, die im letzten Jahr eingespeist wurden, lassen sich so selbst nutzen. Fürs Klima neutral (eingespeister Strom ersetzt ohnehin Netzstrom), spart aber Geld` });
    return out.sort((a, b) => b.kg - a.kg);
  }

  // v0.44: CO₂ je Gerät auf Tagesbasis. Netzanteil des Tages = Allgemeinstrom-Netzbezug ÷ Hausverbrauch (Netzbezug +
  // selbst genutzter Solarstrom); Geräte-kWh × Netzanteil = Netzstrom des Geräts, × Netzwert des Tages (sonst Strommix).
  // Ohne Anker-Daten für den Tag: Netzanteil 1. € = Netzstrom × Arbeitspreis + Solaranteil × Einspeisevergütung (entgangen).
  function co2Devices(from, to) {
    const cfg = co2Cfg(), G = cfg.hourly === false ? {} : (S.gridCo2 || {}), as = groupSeries('as').daily, hh = hhDay(), fi = (+S.amort?.feedin || 0) / 100;
    return (S.devices || []).map(dv => {
      const rows = DEV[dv.id] || {}; let kwh = 0, grid = 0, kg = 0, eur = 0, n = 0, est = 0;
      for (const [d, r] of Object.entries(rows)) { if (d < from || d > to || !(r.kwh > 0)) { if (d >= from && d <= to) n++; continue; } n++;
        const share = hh[d] > 0 && as[d] != null ? Math.min(1, Math.max(0, as[d] / hh[d])) : (est++, 1);
        const g = r.kwh * share, f = (G[d] ? G[d].g : mixAt(d, cfg)) / 1000, t = tariffAt('as', d) || currentTariff('as'), ap = t ? t.ap / 100 : 0;
        kwh += r.kwh; grid += g; kg += g * f; eur += g * ap + (r.kwh - g) * fi; }
      return { id: dv.id, name: dv.name, n, kwh, grid, share: kwh > 0 ? grid / kwh : null, kg, eur, est, perKwh: kwh > 0 ? kg / kwh * 1000 : null };
    }).filter(x => x.n).sort((a, b) => b.kg - a.kg);
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
  // v0.25: Wasser (Zählergruppe „water“, Stände in m³). from..to einschließlich; Tage = Tage mit verteiltem Wert.
  // Kosten = m³ × (Wasser + Abwasser je m³) + Grundgebühr anteilig. Auffällig: Ableseintervall > 150 % des Medians.
  function waterStats(from, to) {
    const g = groupSeries('water'), w = S.water || {}, n = v => (v === '' || v == null || !isFinite(+v) ? 0 : +v);
    let m3 = 0, days = 0; for (const [d, v] of Object.entries(g.daily)) if (d >= from && d <= to) { m3 += v; days++; }
    const persons = Math.max(1, Math.round(n(w.persons) || 1)), lpd = days ? m3 * 1000 / days : null;
    const priceM3 = n(w.priceM3) + n(w.sewageM3), cost = m3 * priceM3 + n(w.baseYear) * days / 365;
    const rates = g.intervals.map(iv => iv.rate).sort((a, b) => a - b), med = rates.length ? rates[Math.floor((rates.length - 1) / 2)] : null;
    const high = med ? g.intervals.filter(iv => iv.to > from && iv.from <= to && iv.rate > 1.5 * med && g.intervals.length >= 4) : [];
    return { m3, days, lpd, lpp: lpd != null ? lpd / persons : null, persons, priceM3, cost: priceM3 || n(w.baseYear) ? cost : null, median: med, high, intervals: g.intervals };
  }
  // v0.32: Geräte (Messsteckdosen, Waschmaschine) je Tag. Haushalt je Tag = Allgemeinstrom-Netzbezug laut Zähler (nach
  // Anker-Profil verteilt) + selbst genutzter Solarstrom. Anteil eines Geräts nur über Tage, an denen beides vorliegt.
  const DEV = (() => { const by = {}; for (const r of S.deviceDays || []) { const dv = (S.devices || []).find(x => x.id === r.dev);
    if (!dv || (dv.from && r.d < dv.from)) continue; (by[r.dev] = by[r.dev] || {})[r.d] = r; } return by; })();
  const hhDay = (() => { let m = null; return () => { if (m) return m; m = {}; const as = groupSeries('as').daily;
    for (const [d, k] of Object.entries(as)) { const i = A.idx[d]; if (i !== undefined && A.c.use[i] != null) m[d] = k + (+A.c.use[i] || 0); } return m; }; })();
  const yearBack = d => `${+d.slice(0, 4) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28');
  function deviceSum(id, from, to) {
    const rows = DEV[id] || {}; let kwh = 0, n = 0, water = 0, runs = 0, nw = 0, month = false, eur = 0;
    for (const [d, r] of Object.entries(rows)) { if (d < from || d > to) continue; n++; kwh += r.kwh || 0;
      if (r.l != null) { water += r.l; nw++; } if (r.runs != null) runs += r.runs; if (r.src === 'month') month = true;
      const t = tariffAt('as', d) || currentTariff('as'); if (t) eur += (r.kwh || 0) * t.ap / 100; }
    return { kwh, n, perDay: n ? kwh / n : null, water: nw ? water : null, runs: runs || null, month, eur };
  }
  // v0.35: Wasser der Geräte (Waschmaschine) gegen den Wasserzähler – nur über die Tage, an denen beides vorliegt.
  function deviceWater(from, to) {
    const wd = groupSeries('water').daily;
    return (S.devices || []).map(dv => {
      const rows = DEV[dv.id] || {}; let l = 0, runs = 0, n = 0, d0 = null, d1 = null, m3 = 0, month = false;
      for (const [d, r] of Object.entries(rows)) { if (d < from || d > to || r.l == null || wd[d] == null) continue;
        l += r.l; runs += r.runs || 0; n++; m3 += wd[d]; if (r.src === 'month') month = true; if (!d0 || d < d0) d0 = d; if (!d1 || d > d1) d1 = d; }
      if (!n) return null;
      const w = waterStats(d0, d1), tot = m3 * 1000, rest = tot - l;
      const pm = programMonths(dv.id, d0, d1), nm = (+d1.slice(0, 4) - +d0.slice(0, 4)) * 12 + +d1.slice(5, 7) - +d0.slice(5, 7) + 1;
      const pw = pm.length === nm && pm.every(o => o.wash) ? { wash: pm.reduce((a, o) => a + o.wash, 0), lW: pm.reduce((a, o) => a + o.lWash, 0) } : null;
      return { id: dv.id, name: dv.name, from: d0, to: d1, n, l, runs: runs || null, perRun: runs ? l / runs : null, month,
        wash: pw && d0.slice(8) === '01' && d1 === monthEnd(d1.slice(0, 7)) ? pw.wash : null, lPerWash: pw && pw.wash ? pw.lW / pw.wash : null,
        share: tot > 0 ? l / tot : null, perDay: l / n, restPerDay: tot > 0 ? rest / n : null, restLpp: tot > 0 ? rest / n / w.persons : null };
    }).filter(Boolean);
  }
  // v0.36: Programme je Monat (Waschmaschinen-App). „Echte Wäsche“ = kein Auffrischen/Schleudern/Spülen und mehr als 10 l.
  const NOWASH = /smart ?finish|schleuder|abpump|spül|auffrisch|dampf|steam|refresh/i;
  const isWash = p => !NOWASH.test(p.prog) && !(p.l != null && p.l < 10);
  const tempClass = p => !isWash(p) ? 'other' : p.temp >= 60 ? '60' : p.temp >= 40 ? '40' : p.temp > 0 ? '30' : 'kalt';
  const progLabel = p => `${p.prog}${p.temp ? ` ${p.temp} °C` : ''}${p.rpm ? `, ${p.rpm} U/min` : ''}${p.extra ? `, ${p.extra}` : ''}`;
  function programMonths(id, from, to) {
    const out = {};
    for (const p of S.programs || []) { if (p.dev !== id || p.m < from.slice(0, 7) || p.m > to.slice(0, 7)) continue;
      const o = out[p.m] = out[p.m] || { m: p.m, runs: 0, wash: 0, kwh: 0, l: 0, kwhWash: 0, lWash: 0, cls: {} };
      const k = (p.kwh || 0) * p.runs, l = (p.l || 0) * p.runs, c = tempClass(p), w = isWash(p);
      o.runs += p.runs; o.kwh += k; o.l += l; if (w) { o.wash += p.runs; o.kwhWash += k; o.lWash += l; }
      const t = o.cls[c] = o.cls[c] || { runs: 0, kwh: 0, l: 0 }; t.runs += p.runs; t.kwh += k; t.l += l; }
    return Object.values(out).sort((a, b) => a.m.localeCompare(b.m)).map(o => {
      const tot = deviceSum(id, `${o.m}-01`, monthEnd(o.m));
      return { ...o, kwhPerWash: o.wash ? o.kwhWash / o.wash : null, lPerWash: o.wash ? o.lWash / o.wash : null,
        dayKwh: tot.n ? tot.kwh : null, dayL: tot.water, dayRuns: tot.runs, kwhDiff: tot.n && tot.kwh > 0 ? o.kwh / tot.kwh - 1 : null };
    });
  }
  function programSummary(id, from, to) {
    const ms = programMonths(id, from, to); if (!ms.length) return null;
    const by = {};
    for (const p of S.programs || []) { if (p.dev !== id || p.m < from.slice(0, 7) || p.m > to.slice(0, 7)) continue;
      const k = progLabel(p), o = by[k] = by[k] || { label: k, prog: p.prog, temp: p.temp, wash: isWash(p), cls: tempClass(p), runs: 0, kwh: 0, l: 0 };
      o.runs += p.runs; o.kwh += (p.kwh || 0) * p.runs; o.l += (p.l || 0) * p.runs; }
    const sum = (f) => ms.reduce((a, o) => a + f(o), 0), runs = sum(o => o.runs), kwh = sum(o => o.kwh), wash = sum(o => o.wash);
    const hot = sum(o => (o.cls['60'] || {}).runs || 0), hotKwh = sum(o => (o.cls['60'] || {}).kwh || 0);
    const list = Object.values(by).map(o => ({ ...o, kwhRun: o.runs ? o.kwh / o.runs : null, lRun: o.runs && o.l ? o.l / o.runs : null,
      shareRuns: runs ? o.runs / runs : null, shareKwh: kwh ? o.kwh / kwh : null })).sort((a, b) => b.kwh - a.kwh);
    return { months: ms, list, runs, wash, other: runs - wash, kwh, l: sum(o => o.l), kwhWash: sum(o => o.kwhWash), lWash: sum(o => o.lWash),
      kwhPerWash: wash ? sum(o => o.kwhWash) / wash : null, lPerWash: wash ? sum(o => o.lWash) / wash : null,
      hot, hotKwh, hotShareRuns: wash ? hot / wash : null, hotShareKwh: kwh ? hotKwh / kwh : null };
  }
  function deviceStats(from, to) {
    const hh = hhDay(), days = diffDays(from, to) + 1;
    const list = (S.devices || []).map(dv => {
      const a = deviceSum(dv.id, from, to), rows = DEV[dv.id] || {};
      let dk = 0, hk = 0; for (const [d, r] of Object.entries(rows)) if (d >= from && d <= to && hh[d] != null) { dk += r.kwh || 0; hk += hh[d]; }
      const p = deviceSum(dv.id, yearBack(from), yearBack(to)), prevOk = a.n && p.n >= 0.8 * a.n;
      return { ...dv, ...a, share: hk > 0 ? dk / hk : null, prev: prevOk ? p : null, change: prevOk && p.perDay ? a.perDay / p.perDay - 1 : null };
    }).filter(x => x.n);
    // Haushalt: Ø je Tag über die Tage mit Werten im Zeitraum; Rest = Haushalt − gemessene Geräte (Ø je Tag)
    let hs = 0, hn = 0; for (const [d, v] of Object.entries(hh)) if (d >= from && d <= to) { hs += v; hn++; }
    const hhPerDay = hn ? hs / hn : null, devPerDay = list.reduce((s, x) => s + (x.perDay || 0), 0);
    // v0.45: Summen nur über Tage mit Haushaltswert; gemessene Geräte an genau diesen Tagen
    let devOnHh = 0; for (const dv of S.devices || []) for (const [d, r] of Object.entries(DEV[dv.id] || {})) if (d >= from && d <= to && hh[d] != null) devOnHh += r.kwh || 0;
    const t = currentTariff('as'), ap = t ? t.ap / 100 : 0;
    return { list, days, hhPerDay, devPerDay, restPerDay: hhPerDay != null ? hhPerDay - devPerDay : null, restShare: hhPerDay ? 1 - devPerDay / hhPerDay : null,
      hhKwh: hn ? hs : null, hhDays: hn, devKwhOnHh: devOnHh, restKwh: hn ? Math.max(0, hs - devOnHh) : null, coverShare: hs > 0 ? Math.min(1, devOnHh / hs) : null, ap };
  }
  // Auffällig: letzte 28 Tage mit Werten mindestens 15 % über denselben Tagen des Vorjahres (je mind. 24 Tage)
  function deviceAlerts() {
    const out = [];
    for (const dv of S.devices || []) { const rows = DEV[dv.id] || {}, ds = Object.keys(rows).sort(); if (!ds.length) continue;
      const to = ds[ds.length - 1], from = addDays(to, -27), a = deviceSum(dv.id, from, to), p = deviceSum(dv.id, yearBack(from), yearBack(to));
      if (a.n >= 24 && p.n >= 24 && a.perDay > 1.15 * p.perDay) out.push({ id: dv.id, name: dv.name, from, to, now: a.perDay, prev: p.perDay, change: a.perDay / p.perDay - 1 }); }
    return out;
  }
  // Reihe je Tag oder Monat: kWh je Gerät, Außentemperatur (Ø) aus dem Wetter
  function deviceSeries(from, to, g) {
    g = g || gran(from, to); const ks = [], seen = new Set();
    for (let d = from; d <= to; d = addDays(d, 1)) { const k = bucketOf(d, g); if (!seen.has(k)) { seen.add(k); ks.push(k); } }
    const val = {}, temp = {};
    for (const dv of S.devices || []) { const v = val[dv.id] = {}; for (const [d, r] of Object.entries(DEV[dv.id] || {})) if (d >= from && d <= to) { const k = bucketOf(d, g); v[k] = (v[k] || 0) + (r.kwh || 0); } }
    for (let d = from; d <= to; d = addDays(d, 1)) { const w = W[d]; if (!w || w.t == null) continue; const k = bucketOf(d, g); (temp[k] = temp[k] || { s: 0, n: 0 }); temp[k].s += w.t; temp[k].n++; }
    // v0.45: Rest Allgemeinstrom je Zeitraum-Stück = Haushalt − gemessene Geräte (nur Tage mit Haushaltswert)
    const hh = hhDay(), hk = {}, dk = {};
    for (const [d, v] of Object.entries(hh)) { if (d < from || d > to) continue; const k = bucketOf(d, g); hk[k] = (hk[k] || 0) + v;
      for (const dv of S.devices || []) { const r = (DEV[dv.id] || {})[d]; if (r) dk[k] = (dk[k] || 0) + (r.kwh || 0); } }
    const rest = Object.fromEntries(Object.keys(hk).map(k => [k, Math.max(0, hk[k] - (dk[k] || 0))]));
    return { g, ks, val, rest, hh: hk, temp: Object.fromEntries(Object.entries(temp).map(([k, x]) => [k, x.s / x.n])) };
  }
  // v0.33: Raumklima je Raum und Tag (Govee). Tage mit weniger als 48 Werten (12 h) zählen nicht. Nacht = 0–6 Uhr,
  // Tag = 10–18 Uhr (Stundenmittel). Anteile „zu trocken“ (< 40 %) und „feucht“ (≥ 60 %) über die Stunden mit Werten.
  const CL = (() => { const by = {}; for (const r of S.climate || []) if (r.n >= 48) (by[r.room] = by[r.room] || []).push(r);
    for (const k in by) by[k].sort((a, b) => a.d.localeCompare(b.d)); return by; })();
  const roomName = id => ((S.rooms || []).find(r => r.id === id) || {}).name || id;
  function climateStats(from, to) {
    const ids = [...new Set([...(S.rooms || []).map(r => r.id), ...Object.keys(CL)])];
    return ids.map(id => {
      const rs = (CL[id] || []).filter(r => r.d >= from && r.d <= to); if (!rs.length) return null;
      let hrs = 0, ns = 0, nn = 0, ds = 0, dn = 0, tn = 0, tnn = 0;
      for (const r of rs) { if (!r.hours) continue; r.hours.forEach((x, h) => { if (!x) return; hrs++;
        if (h < 6) { ns += x[1]; nn++; tn += x[0]; tnn++; } else if (h >= 10 && h < 18) { ds += x[1]; dn++; } }); }
      const mean = k => rs.reduce((a, r) => a + r[k], 0) / rs.length;
      return { id, name: roomName(id), days: rs.length, from: rs[0].d, to: rs[rs.length - 1].d, t: mean('t'), rh: mean('rh'),
        lo: Math.min(...rs.map(r => r.lo)), hi: Math.max(...rs.map(r => r.hi)),
        dry: hrs ? rs.reduce((a, r) => a + r.dry, 0) / hrs : null, wet: hrs ? rs.reduce((a, r) => a + r.wet, 0) / hrs : null,
        rhNight: nn ? ns / nn : null, rhDay: dn ? ds / dn : null, tNight: tnn ? tn / tnn : null };
    }).filter(Boolean);
  }
  // Reihe je Tag oder Monat: Mittel je Raum (k = 't' oder 'rh'), dazu Außentemperatur
  function climateSeries(from, to, k = 'rh', g) {
    g = g || gran(from, to); const ks = [], seen = new Set();
    for (let d = from; d <= to; d = addDays(d, 1)) { const b = bucketOf(d, g); if (!seen.has(b)) { seen.add(b); ks.push(b); } }
    const val = {};
    for (const [id, rs] of Object.entries(CL)) { const acc = {}; for (const r of rs) { if (r.d < from || r.d > to) continue; const b = bucketOf(r.d, g); (acc[b] = acc[b] || { s: 0, n: 0 }); acc[b].s += r[k]; acc[b].n++; }
      val[id] = Object.fromEntries(Object.entries(acc).map(([b, x]) => [b, x.s / x.n])); }
    const tout = {}; for (let d = from; d <= to; d = addDays(d, 1)) { const w = W[d]; if (!w || w.t == null) continue; const b = bucketOf(d, g); (tout[b] = tout[b] || { s: 0, n: 0 }); tout[b].s += w.t; tout[b].n++; }
    return { g, ks, val, tout: Object.fromEntries(Object.entries(tout).map(([b, x]) => [b, x.s / x.n])) };
  }
  // Tagesverlauf eines Raums: Mittel je Stunde über den Zeitraum
  function climateProfile(id, from, to) {
    const acc = Array.from({ length: 24 }, () => ({ t: 0, h: 0, n: 0 })); let days = 0;
    for (const r of CL[id] || []) { if (r.d < from || r.d > to || !r.hours) continue; days++;
      r.hours.forEach((x, h) => { if (x) { acc[h].t += x[0]; acc[h].h += x[1]; acc[h].n++; } }); }
    return { days, hours: acc.map(x => (x.n ? { t: x.t / x.n, rh: x.h / x.n } : null)) };
  }
  // v0.34: Zusammenhänge. Lineare Regression über Tageswerte; Bewertung: belastbar ab 30 Tagen und R² ≥ 0,3,
  // Hinweis ab 10 Tagen und R² ≥ 0,1, sonst zu wenig Daten. Phasen aus Ereignissen vom Typ „einstellung“.
  function fitLine(pts) {
    const n = pts.length; if (n < 3) return { n, slope: null, r2: null };
    const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
    if (!sxx || !syy) return { n, slope: null, r2: null, mx, my };
    const slope = sxy / sxx; return { n, slope, icept: my - slope * mx, r2: sxy * sxy / (sxx * syy), mx, my };
  }
  const verdict = f => f.n >= 30 && f.r2 >= 0.3 ? 'belastbar' : f.n >= 10 && f.r2 != null && f.r2 >= 0.1 ? 'Hinweis' : 'zu wenig Daten';
  const season = d => { const m = +d.slice(5, 7); return m >= 5 && m <= 9 ? 'Sommer' : m >= 11 || m <= 2 ? 'Winter' : 'Übergang'; };
  const PHASES = (S.events || []).filter(e => e.type === 'einstellung' && e.d).sort((a, b) => a.d.localeCompare(b.d));
  const phaseOf = (d, grp) => { let p = null; for (const e of PHASES) if ((!grp || e.group === grp) && e.d <= d) p = e; return p ? `ab ${p.d.slice(8, 10)}.${p.d.slice(5, 7)}.` : 'vorher'; };
  const findDev = re => (S.devices || []).find(d => re.test(d.name || ''));
  const findRoom = re => (S.rooms || []).find(r => re.test(r.name || '') || re.test(r.id || ''));
  const devRoom = dv => dv && (dv.room ? (S.rooms || []).find(r => r.id === dv.room) : null);
  function relations(from, to) {
    const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const cl = id => Object.fromEntries((CL[id] || []).map(r => [r.d, r])), dev = id => DEV[id] || {};
    const { heatLimit, room: tRoom } = wxCfg(), gtOf = d => { const w = W[d]; return w ? (w.t < +heatLimit ? +tRoom - w.t : 0) : null; };
    const out = [];
    // 1 Gefrierschrank gegen Raum (Standort) bzw. Außentemperatur
    { const dv = findDev(/gefrier/i), rm = devRoom(dv) || findRoom(/keller|vorrat/i), c = rm ? cl(rm.id) : {}, v = dv ? dev(dv.id) : {};
      const useRoom = rm && days.filter(d => v[d] && c[d]).length >= 10;
      const pts = days.filter(d => v[d] && v[d].src === 'day' && (useRoom ? c[d] : W[d])).map(d => ({ d, x: useRoom ? c[d].t : W[d].t, y: v[d].kwh,
        g: useRoom && c[d].hi - c[d].lo >= 12 ? 'Wäschetag (Feuchtesprung)' : season(d) }));
      const f = fitLine(pts), wash = pts.filter(p => p.g.startsWith('Wäsche')), dry = pts.filter(p => !p.g.startsWith('Wäsche'));
      out.push({ id: 'freezer', title: 'Gefrierschrank und Standort', q: `Braucht der Gefrierschrank mehr Strom, wenn es ${useRoom ? `im Raum „${rm.name}“` : 'draußen'} wärmer ist${useRoom ? ' oder Wäsche trocknet' : ''}?`,
        pts, f, v: verdict(f), x: useRoom ? `Temperatur ${rm.name} °C` : 'Außentemperatur °C', y: 'kWh pro Tag', unit: 'kWh je °C',
        extra: useRoom && wash.length >= 3 && dry.length >= 3 ? { wash: wash.reduce((a, p) => a + p.y, 0) / wash.length, dry: dry.reduce((a, p) => a + p.y, 0) / dry.length, nWash: wash.length } : null,
        need: !dv ? 'Gerät „Gefrierschrank“ fehlt.' : useRoom ? null : 'Thermometer am Standort fehlt oder hat zu wenige Tage – solange gegen die Außentemperatur.' }); }
    // 2 Lüftung gegen Schlafzimmerfeuchte (nachts minus tagsüber)
    { const dv = findDev(/lüft|lueft/i), rm = findRoom(/schlaf/i), c = rm ? cl(rm.id) : {}, v = dv ? dev(dv.id) : {};
      const night = r => { const h = (r.hours || []).slice(0, 6).filter(Boolean); return h.length >= 4 ? h.reduce((a, x) => a + x[1], 0) / h.length : null; };
      const pts = days.filter(d => v[d] && v[d].src === 'day' && c[d] && night(c[d]) != null).map(d => ({ d, x: v[d].kwh, y: night(c[d]) - c[d].rh, g: phaseOf(d, 'as') === 'vorher' ? season(d) : phaseOf(d, 'as') }));
      const f = fitLine(pts), nv = pts.map(p => night(c[p.d])), nHigh = nv.filter(v => v >= 60).length;
      out.push({ extra: pts.length ? { night: nv.reduce((a, v) => a + v, 0) / nv.length, highShare: nHigh / nv.length } : null, id: 'vent', title: 'Lüftung und Schlafzimmer', q: 'Steigt die Feuchte im Schlafzimmer nachts stärker, wenn die Lüftung weniger läuft?', pts, f, v: verdict(f),
        x: 'Lüftung kWh pro Tag (≈ Laufzeit)', y: 'Feuchte nachts minus Tagesmittel (Prozentpunkte)', unit: 'Punkte je kWh',
        need: !dv ? 'Gerät „Lüftung“ fehlt.' : !rm ? 'Raum „Schlafzimmer“ fehlt.' : null }); }
    // 3 Heizung: Strom je Tag gegen Gradtage, je Phase; Raumtemperatur als Zusatz
    { const hd = Object.fromEntries(hpDays(from, to).map(r => [r.d, r]));
      const pts = days.filter(d => hd[d] && gtOf(d) != null && gtOf(d) > 0).map(d => ({ d, x: gtOf(d), y: hd[d].elHeat, g: phaseOf(d, 'wp') }));
      const f = fitLine(pts), rooms = climateStats(from, to).filter(x => !/keller|vorrat|bad/i.test(x.name));
      const ph = {}; for (const p of pts) { const o = ph[p.g] = ph[p.g] || { g: p.g, n: 0, x: 0, y: 0, from: p.d }; o.n++; o.x += p.x; o.y += p.y; if (p.d < o.from) o.from = p.d; }
      const phases = Object.values(ph).sort((a, b) => a.from.localeCompare(b.from)).map(o => ({ g: o.g, n: o.n, perGt: o.x > 0 ? o.y / o.x : null }));
      const wd = Object.keys(W).sort(), wEnd = wd[wd.length - 1]; let gtYear = 0, nY = 0;
      if (wEnd) for (let d = addDays(wEnd, -364); d <= wEnd; d = addDays(d, 1)) { const g = gtOf(d); if (g != null) { gtYear += g; nY++; } }
      out.push({ id: 'heat', title: 'Heizung, Wetter und Raumtemperatur', q: 'Wie viel Heizstrom kostet ein Gradtag, und welche Raumtemperatur kommt dabei heraus?', pts, f, v: verdict(f),
        x: `Gradtage (${tRoom} °C / Heizgrenze ${heatLimit} °C)`, y: 'Heizstrom kWh pro Tag', unit: 'kWh je Gradtag',
        extra: { rooms: rooms.length ? rooms.map(x => ({ name: x.name, t: x.t, tNight: x.tNight })) : null, phases, gtYear: nY >= 300 ? gtYear * 365 / nY : null, tRoom: +tRoom },
        need: Object.keys(hd).length ? null : 'Wärmepumpen-Tageswerte fehlen.' }); }
    // 4 Warmwasser gegen Wasserverbrauch
    { const hd = Object.fromEntries(hpDays(from, to).map(r => [r.d, r])), wd = groupSeries('water').daily;
      const pts = days.filter(d => hd[d] && wd[d] != null).map(d => ({ d, x: wd[d] * 1000, y: hd[d].elDhw, g: phaseOf(d, 'wp') }));
      const f = fitLine(pts), ph = {};
      for (const d of days) { const r = hd[d]; if (!r || r.elDhw == null) continue; const g = phaseOf(d, 'wp'); const o = ph[g] = ph[g] || { g, n: 0, k: 0, from: d }; o.n++; o.k += r.elDhw; }
      const phases = Object.values(ph).sort((a, b) => a.from.localeCompare(b.from)).map(o => ({ g: o.g, n: o.n, kwhDay: o.k / o.n }));
      out.push({ id: 'dhw', title: 'Warmwasser und Wasserverbrauch', q: 'Wie viel Warmwasser-Strom hängt am Wasserverbrauch, und wie viel ist Bereitschaft (Speicher, Zirkulation)?', pts, f, v: verdict(f),
        x: 'Wasser Liter pro Tag (zwischen Ablesungen verteilt)', y: 'Warmwasser-Strom kWh pro Tag', unit: 'kWh je Liter',
        extra: { base: f.slope != null ? f.icept : null, phases }, need: Object.keys(wd).length ? null : 'Wasserzähler fehlt (Zähler & Verbrauch → Wasser).' }); }
    // 5 Lüftung gegen Heizstrom je Gradtag
    { const dv = findDev(/lüft|lueft/i), v = dv ? dev(dv.id) : {}, hd = Object.fromEntries(hpDays(from, to).map(r => [r.d, r]));
      const pts = days.filter(d => v[d] && v[d].src === 'day' && hd[d] && gtOf(d) >= 3).map(d => ({ d, x: v[d].kwh, y: hd[d].elHeat / gtOf(d), g: season(d) }));
      const f = fitLine(pts);
      out.push({ id: 'ventheat', title: 'Lüftung und Heizenergie', q: 'Braucht die Heizung je Gradtag mehr, wenn die Lüftung (mit Wärmerückgewinnung) weniger läuft?', pts, f, v: verdict(f),
        x: 'Lüftung kWh pro Tag', y: 'Heizstrom kWh je Gradtag', unit: 'kWh/GT je kWh', need: !dv ? 'Gerät „Lüftung“ fehlt.' : null }); }
    // 6 Waschmaschine gegen Wasser, je Monat
    { const dv = findDev(/wasch/i), v = dv ? dev(dv.id) : {}, wd = groupSeries('water').daily, mon = {};
      for (const d of days) { const k = d.slice(0, 7); const m = mon[k] = mon[k] || { l: 0, w: 0, n: 0, nw: 0 }; if (v[d]?.l != null) { m.l += v[d].l; m.n++; } if (wd[d] != null) { m.w += wd[d] * 1000; m.nw++; } }
      const pts = Object.entries(mon).filter(([, m]) => m.n >= 20 && m.nw >= 20).map(([k, m]) => ({ d: k, x: m.l, y: m.w, g: 'Monat' }));
      const f = fitLine(pts);
      out.push({ id: 'wash', title: 'Waschmaschine und Wasser', q: 'Welcher Anteil des Wassers geht in die Waschmaschine?', pts, f, v: pts.length >= 3 ? 'Hinweis' : 'zu wenig Daten',
        x: 'Waschmaschine Liter pro Monat', y: 'Wasser gesamt Liter pro Monat', unit: 'l je l', monthly: true,
        extra: { share: pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.reduce((a, p) => a + p.y, 0) : null, lPerWash: dv ? (programSummary(dv.id, from, to) || {}).lPerWash ?? null : null },
        need: !dv ? 'Gerät „Waschmaschine“ fehlt.' : Object.keys(wd).length ? null : 'Wasserzähler fehlt.' }); }
    // 7 Grundlast: nicht gemessener Allgemeinstrom nach Wochentag
    { const hh = hhDay(), wk = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }));
      for (const d of days) { if (hh[d] == null) continue; let dsum = 0; for (const dv of S.devices || []) { const r = dev(dv.id)[d]; if (r) dsum += r.kwh || 0; }
        const i = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; wk[i].s += hh[d] - dsum; wk[i].n++; }
      const n = wk.reduce((a, x) => a + x.n, 0);
      out.push({ id: 'base', title: 'Grundlast nach Wochentag', q: 'Wie viel Allgemeinstrom bleibt ohne die gemessenen Geräte, und an welchen Tagen ist es mehr?', bars: wk.map(x => (x.n ? x.s / x.n : null)),
        labels: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], f: { n }, v: n >= 28 ? 'belastbar' : n >= 7 ? 'Hinweis' : 'zu wenig Daten', y: 'kWh pro Tag (ohne gemessene Geräte)' }); }
    // 8 PV, Speicher und Netzbezug
    { const is = IMPORT_START(), th = +S.battery.fullThresh || 0.3;
      const pts = days.filter(d => A.idx[d] !== undefined && d >= is && A.c.gen[A.idx[d]] != null && A.c.imp[A.idx[d]] != null).map(d => { const i = A.idx[d];
        return { d, x: +A.c.gen[i], y: +A.c.imp[i], g: (+A.c.feed[i] || 0) >= th ? 'Speicher voll' : 'Speicher nicht voll' }; });
      const f = fitLine(pts), full = pts.filter(p => p.g === 'Speicher voll'), nf = pts.filter(p => p.g !== 'Speicher voll'), avg = a => a.length ? a.reduce((s, p) => s + p.y, 0) / a.length : null;
      out.push({ id: 'pv', title: 'PV, Speicher und Netzbezug', q: 'Wie viel Netzbezug bleibt bei viel oder wenig Sonne, und an Tagen mit vollem Speicher?', pts, f, v: verdict(f),
        x: 'PV-Erzeugung kWh pro Tag', y: 'Netzbezug kWh pro Tag', unit: 'kWh je kWh',
        extra: { full: avg(full), nFull: full.length, notFull: avg(nf), fullShare: pts.length ? full.length / pts.length : null,
          sunny: (() => { const g = pts.map(p => p.x).sort((a, b) => a - b), q = g[Math.floor(g.length * 0.7)]; const sp = pts.filter(p => p.x >= q); return pts.length >= 10 ? avg(sp) : null; })() } }); }
    return out;
  }
  // v0.27: PV-Prognose. fcRows: Vorhersage [{day, rad_kwh}] ab heute; Monatsausblick 12 Monate ab dem laufenden Monat:
  // gemessen bis gestern + Tagesprognose + übrige Tage mit typischer Einstrahlung (Ø der eigenen Wetterjahre) × Monatsfaktor.
  function pvForecast(fcRows = [], today = addDays(A.dates[A.n - 1], 1)) {
    // v0.30: Faktor je kWp (Anlagenstufen); f30 nur aus der aktuellen Stufe, bis dahin Monatsfaktor je kWp × neue kWp
    const hist = []; A.dates.forEach((d, i) => { const w = W[d]; if (w && w.rad > 0.3 && A.c.gen[i] != null) hist.push({ d, gen: +A.c.gen[i] / stageAt(d).kwp, rad: w.rad }); });
    const stNow = stageAt(today), kwpNow = stNow.kwp, kwpOf = d => stageAt(d < today ? d : today).kwp;
    const F = pvFactors(hist, today, { since: stNow.stage ? stNow.stage.from : null });
    const days = pvForecastDays(fcRows.filter(r => r.day >= today), F).map(x => ({ ...x, kwh: x.kwh * kwpNow, lo: x.lo == null ? null : x.lo * kwpNow, hi: x.hi == null ? null : x.hi * kwpNow, kwp: kwpNow }));
    const radBy = {}; for (const [d, w] of Object.entries(W)) { if (w.rad == null) continue; const k = d.slice(0, 7); (radBy[k] = radBy[k] || { s: 0, n: 0 }); radBy[k].s += w.rad; radBy[k].n++; }
    const typ = {}; for (const [k, v] of Object.entries(radBy)) { const dim = +monthEnd(k).slice(8, 10); if (v.n < dim - 2) continue; const m = k.slice(5, 7); (typ[m] = typ[m] || []).push(v.s / v.n); }
    const typDay = m => (typ[m] ? typ[m].reduce((a, b) => a + b, 0) / typ[m].length : null);
    const genBy = {}; A.dates.forEach((d, i) => { const k = d.slice(0, 7); genBy[k] = (genBy[k] || 0) + (+A.c.gen[i] || 0); });
    const fcBy = Object.fromEntries(days.map(x => [x.d, x.kwh])), months = []; let k = today.slice(0, 7);
    for (let j = 0; j < 12; j++) {
      const m = k.slice(5, 7), f0 = F.factorFor(`${k}-15`, false), f = f0 == null ? null : f0 * kwpNow, td = typDay(m), end = monthEnd(k); let measured = 0, fc = 0, typical = 0, nTyp = 0;
      for (let d = `${k}-01`; d <= end; d = addDays(d, 1)) {
        if (d < today) { const i = A.idx[d]; if (i !== undefined) measured += +A.c.gen[i] || 0; else if (td != null && f != null) { typical += f * td; nTyp++; } }
        else if (fcBy[d] != null) fc += fcBy[d]; else if (td != null && f != null) { typical += f * td; nTyp++; } }
      const prevY = `${+k.slice(0, 4) - 1}-${m}`;
      months.push({ k, f, typDay: td, measured, fc, typical, nTyp, kwh: f == null && td == null && !measured && !fc ? null : measured + fc + typical, prevYear: genBy[prevY] ?? null });
      k = nextMonth(k);
    }
    const actual = {}; A.dates.forEach((d, i) => { if (A.c.gen[i] != null) actual[d] = +A.c.gen[i]; });
    // v0.28: Rückblick – Modell mit gemessenem Wetter, je Tag nur mit Daten vor diesem Tag (keine Vorschau auf die Messung)
    const back = pvBacktest(hist, addDays(today, -30), addDays(today, -1), kwpOf);
    // erster offener echter Vergleich: Prognose vor dem Tag erstellt, Messung fehlt noch
    const open = (S.pvForecasts || []).filter(s => s.made < s.d && s.d < today && actual[s.d] == null).sort((a, b) => a.d.localeCompare(b.d) || b.made.localeCompare(a.made))[0] || null;
    return { F, days, months, acc: pvAccuracy(S.pvForecasts || [], actual, addDays(today, -30), addDays(today, -1)), back, open, lastData: A.dates[A.n - 1], kwpNow, stage: stNow.stage };
  }
  // v0.30: Wirkung der Anlagenstufen – je Stufe Tage mit Anker-Daten, kWh/Tag, Ertrag je kWp und kWh/m² (wetterbereinigt),
  // Netzbezug/Tag (ab Smart Meter), Eigenverbrauchsquote, Anteil Tage mit vollem Speicher.
  function stageEffects() {
    const is = IMPORT_START(), list = STAGES.length ? STAGES : [];
    return list.map((st, j) => { const to = j + 1 < list.length ? addDays(list[j + 1].from, -1) : '9999-12-31';
      let n = 0, gen = 0, use = 0, feed = 0, imp = 0, nImp = 0, full = 0, kr = 0, gr = 0, nW = 0;
      A.dates.forEach((d, i) => { if (d < st.from || d > to) return; n++; const g = +A.c.gen[i] || 0; gen += g; use += +A.c.use[i] || 0;
        if (d >= is) { nImp++; imp += +A.c.imp[i] || 0; feed += +A.c.feed[i] || 0; if ((+A.c.feed[i] || 0) >= +S.battery.fullThresh) full++; }
        const w = W[d]; if (w && w.rad > 0.3) { nW++; gr += g; kr += stageAt(d).kwp * w.rad; } });
      return { st, from: st.from, to: to === '9999-12-31' ? A.dates[A.n - 1] : to, n, kwhDay: n ? gen / n : null, f: kr > 0 ? gr / kr : null, nW,
        impDay: nImp ? imp / nImp : null, evq: gen > 0 ? use / gen : null, fullShare: nImp ? full / nImp : null, kwp: +st.kwp || null, capGross: +st.capGross || null }; });
  }
  // v0.23: Wärmepumpe je Gradtag (from..to einschließlich). Grundlast (Warmwasser, Standby) laut Wetter-Modell der
  // passenden Seite des Gerätetauschs abgezogen; unter 20 Gradtagen (Sommer) kein Wert.
  function wpDegreeDay(from, to) {
    if (!S.weather?.length) return null;
    const g = groupSeries('wp'), { heatLimit, room } = wxCfg(), ww = wpWeather();
    const gr = ww ? (ww.swap && to < ww.swap ? ww.groups.alt : (ww.groups.neu || ww.groups.alle)) : null;
    let kwh = 0, gt = 0, n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) { const v = g.daily[d], w = W[d]; if (v == null || !w) continue; n++; kwh += v; if (w.t < +heatLimit) gt += +room - w.t; }
    if (!n) return null;
    const base = gr && gr.base > 0 ? gr.base : null, heat = base != null ? Math.max(0, kwh - base * n) : kwh;
    return { kwh, gt, days: n, base, heat, perGt: gt >= 20 ? heat / gt : null };
  }
  // PV: Erzeugung gegen Globalstrahlung (horizontal). Faktor = kWh ÷ (kWp × kWh/m²), nur Tage mit Anker- und Wetterdaten.
  function pvWeather(from, to) {
    const kwp = kwpIn(from, to), months = {}, days = [];   // v0.30: kWp je Tag aus der Anlagenstufe
    A.dates.forEach((d, i) => { if (d < from || d > to) return; const w = W[d]; if (!w || !(w.rad > 0)) return;
      const k = monthKey(d), m = months[k] = months[k] || { gen: 0, rad: 0, n: 0, sun: 0, kr: 0 }, g = A.c.gen[i] || 0, kd = stageAt(d).kwp;
      m.gen += g; m.rad += w.rad; m.kr += kd * w.rad; m.n++; m.sun += w.sun || 0; days.push({ d, gen: g, rad: w.rad, f: g / (kd * w.rad), full: (A.c.feed[i] || 0) >= (+S.battery.fullThresh || Infinity) }); });
    const ks = Object.keys(months).sort(), rows = ks.map(k => ({ k, ...months[k], f: months[k].gen / months[k].kr }));
    // auffällige Tage: sonnig (Strahlung ≥ Monatsmedian) und Faktor < 75 % des Monatsmedians
    const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; }, byM = {};
    days.forEach(x => (byM[monthKey(x.d)] = byM[monthKey(x.d)] || []).push(x));
    const odd = [];
    for (const arr of Object.values(byM)) { if (arr.length < 10) continue; const mr = med(arr.map(x => x.rad)), mf = med(arr.map(x => x.f));
      for (const x of arr) if (x.rad >= mr && x.f < 0.75 * mf) odd.push({ ...x, expected: mf * stageAt(x.d).kwp * x.rad, lost: mf * stageAt(x.d).kwp * x.rad - x.gen }); }
    odd.sort((a, b) => b.lost - a.lost);
    return { kwp, months: rows, days: days.length, list: days, odd, factor: rows.length ? rows.reduce((a, r) => a + r.gen, 0) / rows.reduce((a, r) => a + r.kr, 0) : null };
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
  // v0.19: Tagesprofil aus Stundenwerten – Tage mit Stunden, je Stunde Strom/Wärme/Temperaturen, Auswertung des Tages
  function hpHourDays() { return [...new Set(hpRows('hour').map(r => r.ts.slice(0, 10)))].sort(); }
  function hpDayProfile(d) {
    const rows = hpRows('hour').filter(r => r.ts.startsWith(d)); if (!rows.length) return null;
    const hours = Array.from({ length: 24 }, (_, h) => rows.find(r => +r.ts.slice(11, 13) === h) || null);
    const v = (r, f) => (r ? +r[f] || 0 : 0);
    // Warmwasser-Ladungen: zusammenhängende Stunden mit Warmwasser-Strom ≥ 0,1 kWh
    const loads = []; let cur = null;
    hours.forEach((r, h) => { const e = v(r, 'el_dhw') + v(r, 'el_aux_dhw');
      if (e >= 0.1) { if (cur && cur.to === h - 1) { cur.to = h; cur.kwh += e; } else { cur = { from: h, to: h, kwh: e }; loads.push(cur); } } });
    const tDhw = rows.filter(r => r.t_dhw != null), peak = tDhw.length ? tDhw.reduce((a, r) => (r.t_dhw > a.t_dhw ? r : a)) : null;
    const s = hpSum(rows), runH = hours.filter(r => v(r, 'el_hp') + v(r, 'el_aux') >= 0.15).length;
    const tOut = rows.filter(r => r.t_out != null).map(r => r.t_out);
    return { d, hours, n: rows.length, loads, peakDhw: peak ? { t: peak.t_dhw, h: +peak.ts.slice(11, 13) } : null,
      disinfection: !!(peak && peak.t_dhw >= 58), aux: s.aux, runH, ...s,
      tOutMin: tOut.length ? Math.min(...tOut) : null, tOutMax: tOut.length ? Math.max(...tOut) : null };
  }
  // v0.26: Referenz für das Tagesprofil – Ø der letzten n vollständigen Tage (24 Stunden) vor Tag d, ohne
  // Desinfektionstage (Warmwasser ≥ 65 °C oder Zuheizer ≥ 0,05 kWh). hoursSet: Summen nur über diese Stunden (für einen
  // unvollständigen Tag d); die Stundenkurven gelten immer für alle 24 Stunden.
  function hpDayAverage(d, n = 7, hoursSet = null) {
    const used = [], skipped = [];
    for (const x of hpHourDays().filter(x => x < d).reverse()) {
      if (used.length >= n) break;
      const p = hpDayProfile(x); if (p.n < 24) continue;
      if ((p.peakDhw && p.peakDhw.t >= 65) || p.aux >= 0.05) { skipped.push(x); continue; }
      used.push(p);
    }
    if (!used.length) return null;
    const k = used.length, inSet = h => !hoursSet || hoursSet.has(h), H = Array.from({ length: 24 }, (_, h) => h);
    const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const s = hpSum(used.flatMap(p => p.hours.filter((r, h) => r && inSet(h))));
    for (const key of ['el', 'elHeat', 'elDhw', 'elCool', 'aux', 'heatHeat', 'heatDhw', 'cool', 'heat']) s[key] /= k;
    const per = f => mean(used.map(f).filter(v => v != null));
    return { days: used.map(p => p.d), skipped, ...s, n: k,
      elH: H.map(h => mean(used.map(p => p.hours[h]).filter(Boolean).map(r => (+r.el_hp || 0) + (+r.el_aux || 0)))),
      tDhwH: H.map(h => mean(used.map(p => p.hours[h]).filter(r => r && r.t_dhw != null).map(r => +r.t_dhw))),
      loads: per(p => p.loads.filter(l => inSet(l.from)).length),
      peak: per(p => { const t = p.hours.filter((r, h) => r && r.t_dhw != null && inSet(h)).map(r => +r.t_dhw); return t.length ? Math.max(...t) : null; }),
      runH: per(p => p.hours.filter((r, h) => r && inSet(h) && (+r.el_hp || 0) + (+r.el_aux || 0) >= 0.15).length),
      tOutMin: per(p => { const t = p.hours.filter((r, h) => r && r.t_out != null && inSet(h)).map(r => +r.t_out); return t.length ? Math.min(...t) : null; }),
      tOutMax: per(p => { const t = p.hours.filter((r, h) => r && r.t_out != null && inSet(h)).map(r => +r.t_out); return t.length ? Math.max(...t) : null; }) };
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
    return { from: r.from, to: r.to, days, kwp: kwpIn(r.from, r.to), usable: usableIn(r.from, r.to),
      evHome: tb.evHome, ap: +(currentTariff('as')?.ap) || 0, pricePublic: +e.pricePublic || 0, evStart: e.start || '',
      priceInc: +S.amort.priceInc || 0, degr: +S.amort.degr || 0 };
  }

  return {
    A, IMPORT_START, sumRange, last12, groupSeries, tariffAt, currentTariff, costs, last365Cost, feedValue, pvSavings,
    lastDataDay, firstDataDay, periodOf, periodKeys, currentPeriods, valueAt, periodCost, metrics, flow, ankerSeries, battery,
    amortTimeline, investTotal, abschlagAt, abschlagCheck, odoPoints, kmDaily, carCostItems, ledger12, carKpis,
    fuelStats, fuelPrice, icePrice, carCalc, finData, finYears, meterReconciliation, feedReconciliation, wpSwap,
    paymentSuggestions, billingPeriods, tariffBase, boniOf, boniInfo, energyBalance, ausbauBase, homeCharging, fuelStatsIn, wallboxFrom, evAbschlagHint,
    W, degreeDays, wpWeather, pvWeather, weatherNote, hpRows, hpMonths, hpYear, hpDays, hpDayRows, hpPeriod, hpHourDays, hpDayProfile, hpDayAverage, wpDegreeDay, pvForecast, stageAt, kwpIn, usableIn, stageEffects, waterStats, co2Range, co2Devices, gridProfile, co2Grey, co2Levers, co2Cfg, mixAt, trendModel, trendRest, trendBacktest, trendMonths, bestMethod, deviceWater, deviceSum, programMonths, programSummary, isWash, deviceStats, deviceAlerts, deviceSeries, climateStats, climateSeries, climateProfile, relations, fitLine,
    ausbauCosts: p => ausbauCosts(p ?? S.ausbau, S.invest, S.offers || []),
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
  battEv: true, feedCt: 7, apPvCt: '', apEvCt: '', alt: 'public', socketEur: 400, s14a: false, s14aMod: 'manual', s14aEur: 140, years: 20,
  hwSrc: 'manual', hwFrom: '', craftSrc: 'manual' };
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

/* ---------- Angebote mit Positionen (v0.20), reine Funktionen ----------
   offer (settings.data.offers[]): {id, no, date, vendor, sharePv, ausbau, items, paid}
   items: [{qty, name, price, alloc: 'pv' | 'wallbox' | 'shared', due: 'montage' | 'anmeldung'}], Beträge brutto.
   sharePv: Anteil der gemeinsamen Positionen für PV/Speicher in % (Rest Wallbox), Vorgabe 75.
   ausbau: true → Summen ersetzen die Handwerkskosten der Ausbau-Seite (ausbau.craftSrc = 'offer').
   paid: {montage: {date, ids}, anmeldung: {date, ids}} – ids der beim Buchen angelegten Investitionen. */
export const OFFER_DUES = [['montage', 'nach Montage'], ['anmeldung', 'nach Anmeldung']];
export const OFFER_ALLOC = [['pv', 'PV/Speicher'], ['wallbox', 'Wallbox'], ['shared', 'gemeinsam']];
const r2 = v => Math.round(+(v * 100).toFixed(6)) / 100;     // kaufmännisch, ohne Gleitkomma-Fehler (8,325 → 8,33)
export function offerShare(o) { const v = o.sharePv; return v === '' || v == null || !isFinite(+v) ? 75 : Math.min(100, Math.max(0, +v)); }
export function offerSums(o) {
  const sh = offerShare(o) / 100, s = { total: 0, pv: 0, wallbox: 0, shared: 0, due: {} };
  for (const it of o.items || []) {
    const t = r2((+it.qty || 0) * (+it.price || 0)), a = it.alloc === 'pv' || it.alloc === 'wallbox' ? it.alloc : 'shared', d = it.due === 'anmeldung' ? 'anmeldung' : 'montage';
    s.total += t; s[a] += t;
    const D = s.due[d] ??= { total: 0, pv: 0 };
    D.total += t; D.pv += a === 'pv' ? t : a === 'shared' ? t * sh : 0;
  }
  for (const D of Object.values(s.due)) { D.total = r2(D.total); D.pv = r2(D.pv); D.wallbox = r2(D.total - D.pv); }
  ['total', 'pv', 'wallbox', 'shared'].forEach(k => s[k] = r2(s[k]));
  s.pvAll = r2(Object.values(s.due).reduce((a, D) => a + D.pv, 0)); s.wbAll = r2(s.total - s.pvAll);
  return s;
}
// Investitionen für eine bezahlte Fälligkeit: je ein Eintrag PV/Speicher und Wallbox (Beträge 0 entfallen)
export function offerBookingRows(o, due, date) {
  const D = offerSums(o).due[due]; if (!D) return [];
  const what = due === 'anmeldung' ? 'fällig nach Anmeldung' : 'Montage und Material';
  const head = `Angebot ${o.no || ''}${o.vendor ? ` (${o.vendor})` : ''}: ${what}`.replace(/\s+/g, ' ');
  return [['pv', 'PV/Speicher-Anteil', D.pv], ['wallbox', 'Wallbox-Anteil', D.wallbox]].filter(([, , v]) => v > 0)
    .map(([cat, l, cost]) => ({ name: `${head} – ${l}`, date, cost, cat }));
}
export function offerBookedIds(offers = []) { return new Set(offers.flatMap(o => Object.values(o.paid || {}).flatMap(x => (x && x.ids) || []))); }
// Kosten der Ausbau-Seite: Hardware aus gebuchten Investitionen ab hwFrom (ohne Erstattungen und ohne Buchungen aus
// Angeboten), Handwerk aus Angeboten mit „ausbau“; sonst die eingetragenen Werte.
export function ausbauCosts(p0 = {}, invest = [], offers = []) {
  const p = { ...AUSBAU_DEFAULTS, ...p0 };
  const out = { hwTotal: p.hwTotal, hwWallbox: p.hwWallbox, craftPv: p.craftPv, craftWallbox: p.craftWallbox, hw: null, craft: null };
  if (p.hwSrc === 'invest' && p.hwFrom) {
    const booked = offerBookedIds(offers), its = invest.filter(x => x.cat !== 'refund' && x.date && x.date >= p.hwFrom && !booked.has(x.id));
    out.hwTotal = r2(its.reduce((a, x) => a + (+x.cost || 0), 0)); out.hwWallbox = r2(its.filter(x => x.cat === 'wallbox').reduce((a, x) => a + (+x.cost || 0), 0));
    out.hw = { n: its.length, from: p.hwFrom };
  }
  if (p.craftSrc === 'offer') {
    const os = offers.filter(o => o.ausbau), ss = os.map(offerSums);
    out.craftPv = r2(ss.reduce((a, x) => a + x.pvAll, 0)); out.craftWallbox = r2(ss.reduce((a, x) => a + x.wbAll, 0));
    out.craft = { n: os.length, nos: os.map(o => o.no || 'ohne Nummer') };
  }
  return out;
}

/* ---------- Gleitender Durchschnitt über Einträge (v0.24), reine Funktion ----------
   items: [{y, w}] in zeitlicher Reihenfolge; je Eintrag gewichteter Ø der letzten n Einträge (einschließlich).
   Mit y = €/l und w = Liter ergibt das Kosten ÷ Liter, mit y = l/100 km und w = km Liter ÷ km. Weniger als minN
   Einträge im Fenster → null. (Ersetzt die Trendgerade „linTrend“ aus v0.22.) */
export function movingAvgN(items, n, minN = 1) {
  return items.map((_, i) => { const s = items.slice(Math.max(0, i - n + 1), i + 1).filter(x => x && isFinite(x.y) && x.y !== null && +x.w > 0);
    const W = s.reduce((a, x) => a + +x.w, 0); return s.length >= minN && W > 0 ? s.reduce((a, x) => a + x.y * x.w, 0) / W : null; });
}

/* ---------- Gleitender Durchschnitt (v0.23), reine Funktion ----------
   daily: {ISO-Datum: kWh}; days: Tage, für die der Wert gebraucht wird. Je Tag Ø der letzten `win` Tage (einschließlich),
   nur Tage mit Wert; weniger als minN Tage mit Wert → null. */
export function movingAvg(daily, days, win = 30, minN = 15) {
  return days.map(d => { let s = 0, n = 0;
    for (let j = 0; j < win; j++) { const v = daily[addDays(d, -j)]; if (v != null && isFinite(v)) { s += +v; n++; } }
    return n >= minN ? s / n : null; });
}

/* ---------- PV-Prognose (v0.27), reine Funktionen ----------
   hist: gemessene Tage [{d, gen, rad}] (Erzeugung kWh, Einstrahlung kWh/m², nur rad > 0,3). Ertragsfaktor f = Erzeugung ÷
   Einstrahlung je Kalendermonat (Summe ÷ Summe über alle Jahre), Streuung cv = Standardabweichung ÷ Mittel der Tagesfaktoren.
   Für die nächsten Tage: f = Ø aus Monatsfaktor und den letzten 30 Tagen (f30), damit die Prognose dem aktuellen Zustand folgt. */
export function pvFactors(hist, today, opt = {}) {
  const by = {}, all = [];
  for (const x of hist) { if (!(x.rad > 0.3) || x.gen == null || x.d >= today) continue; const m = x.d.slice(5, 7);
    (by[m] = by[m] || []).push(x); all.push(x); }
  const stat = arr => { const G = arr.reduce((a, x) => a + x.gen, 0), R = arr.reduce((a, x) => a + x.rad, 0), fs = arr.map(x => x.gen / x.rad);
    const mf = fs.reduce((a, b) => a + b, 0) / fs.length, sd = Math.sqrt(fs.reduce((a, b) => a + (b - mf) ** 2, 0) / fs.length);
    return { f: R > 0 ? G / R : null, cv: mf > 0 ? sd / mf : null, n: arr.length }; };
  const month = {}; for (const [m, arr] of Object.entries(by)) if (arr.length >= 10) month[m] = stat(arr);
  const overall = all.length >= 10 ? stat(all) : null;
  const from30 = [addDays(today, -30), opt.since || ''].sort().pop(), last = all.filter(x => x.d >= from30);   // v0.30: nicht über einen Stufenwechsel hinweg
  const f30 = last.length >= 10 ? { ...stat(last), from: last[0].d, to: last[last.length - 1].d } : null;
  const factorFor = (d, near = true) => { const m = month[d.slice(5, 7)];
    if (near && f30 && m) return (f30.f + m.f) / 2; return m ? m.f : near && f30 ? f30.f : overall ? overall.f : null; };
  const cvFor = d => { const m = month[d.slice(5, 7)]; return (m && m.cv != null ? m.cv : overall ? overall.cv : null); };
  return { month, overall, f30, factorFor, cvFor };
}
// Prognose je Tag aus vorhergesagter Einstrahlung: kwh = f × rad, Band ± cv (nicht unter 0)
export function pvForecastDays(rows, F) {
  return rows.map(r => { const f = F.factorFor(r.day), cv = F.cvFor(r.day); if (f == null || r.rad_kwh == null) return null;
    const kwh = f * r.rad_kwh; return { d: r.day, rad: r.rad_kwh, f, kwh, lo: cv != null ? Math.max(0, kwh * (1 - cv)) : null, hi: cv != null ? kwh * (1 + cv) : null }; })
    .filter(Boolean);
}
// Trefferquote: je vergangenem Tag die jüngste Prognose, die vor dem Tag erstellt wurde, gegen die Messung.
// Tage unter 0,5 kWh zählen nicht (Prozentfehler sonst beliebig groß). mape = Ø |Prognose − Messung| ÷ Messung, bias = Σ Prognose ÷ Σ Messung − 1.
export function pvAccuracy(stored, actual, from, to) {
  const best = {}; for (const s of stored) { if (s.made >= s.d || s.d < from || s.d > to) continue; if (!best[s.d] || s.made > best[s.d].made) best[s.d] = s; }
  const pairs = Object.values(best).filter(s => actual[s.d] != null).map(s => ({ d: s.d, fc: s.kwh, act: actual[s.d], lead: Math.round((Date.parse(s.d) - Date.parse(s.made)) / 864e5) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  const ok = pairs.filter(p => p.act >= 0.5);
  const A = ok.reduce((a, p) => a + p.act, 0), Fc = ok.reduce((a, p) => a + p.fc, 0);
  return { pairs, n: ok.length, mape: ok.length ? ok.reduce((a, p) => a + Math.abs(p.fc - p.act) / p.act, 0) / ok.length : null, bias: A > 0 ? Fc / A - 1 : null };
}

// v0.28: Rückblick für from..to: je Tag f aus pvFactors(hist, Tag) × gemessene Einstrahlung gegen die Messung.
// Fehlermaße wie pvAccuracy (Tage ab 0,5 kWh).
export function pvBacktest(hist, from, to, scale = () => 1) {   // scale(d): z. B. kWp des Tages, wenn hist je kWp ist
  const pairs = hist.filter(x => x.d >= from && x.d <= to && x.rad > 0.3 && x.gen != null).map(x => {
    const f = pvFactors(hist, x.d).factorFor(x.d), k = scale(x.d); return f == null ? null : { d: x.d, act: x.gen * k, model: f * x.rad * k, rad: x.rad }; }).filter(Boolean);
  const ok = pairs.filter(p => p.act >= 0.5), A = ok.reduce((a, p) => a + p.act, 0), M = ok.reduce((a, p) => a + p.model, 0);
  return { pairs, n: ok.length, mape: ok.length ? ok.reduce((a, p) => a + Math.abs(p.model - p.act) / p.act, 0) / ok.length : null, bias: A > 0 ? M / A - 1 : null };
}
