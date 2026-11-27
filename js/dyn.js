// v0.60: Simulation „Dynamischer Tarif“ – reine Funktionen ohne DOM, in Node testbar.
// Je Tag: Hausverbrauch nach Lastprofil auf 24 Stunden verteilt, PV als Sonnenkurve, E-Auto in die billigsten Nachtstunden,
// Speicher wahlweise wie heute (Eigenverbrauch, chronologisch) oder preisgesteuert (dynamische Programmierung mit den am
// Vortag bekannten Day-Ahead-Preisen: lädt mit PV und – wenn erlaubt – billig aus dem Netz, entlädt in teuren Stunden).
// Der Speicher entlädt nie ins Auto und nie ins Netz. Endpreis je Stunde = (Börse + Aufschlag + Netzentgelt + Steuern und
// Umlagen) × (1 + MwSt); Modul 3 (§ 14a) ersetzt das Netzentgelt durch Nieder-/Standard-/Hochtarif nach Uhrzeit.

export const DYN_DEFAULTS = {
  netzCt: 10, taxCt: 6.5, markupCt: 1.7, feeMonth: 6, netzGpYear: 80, vat: 19,   // ct/kWh netto, €/Monat und €/Jahr brutto
  mod3: false, ntCt: 2.5, htCt: 15, ntFrom: 0, ntTo: 6, htFrom: 17, htTo: 21,     // Modul 3: Netzentgelt ct netto je Fenster
  gridCharge: true, ev: true, capKwh: null, chgKw: 1.2, disKw: 0.8, eff: 88, evKw: 11, days: 365,
};
// Allgemeines Haushaltsprofil (Anteil je Stunde 0–23), wenn kein eigenes Lastprofil hinterlegt ist
const GENERIC = [2.6, 2.3, 2.2, 2.1, 2.2, 2.6, 3.6, 4.4, 4.6, 4.5, 4.6, 4.9, 5.3, 5.0, 4.6, 4.3, 4.3, 4.8, 5.6, 6.3, 6.2, 5.4, 4.2, 3.3];
const norm = a => { const s = a.reduce((x, y) => x + (+y || 0), 0) || 1; return a.map(v => (+v || 0) / s); };
export const GENERIC_PROFILE = norm(GENERIC);

// Jahreszeit und Tagesart wie im eigenen Lastprofil: W = Dez–Feb, S = Jun–Sep, U = übrige; we1 = Samstag/Sonntag
export function profileKey(d) {
  const m = +d.slice(5, 7), dow = new Date(d + 'T12:00:00Z').getUTCDay();
  return `${m === 12 || m <= 2 ? 'W' : m >= 6 && m <= 9 ? 'S' : 'U'}_${dow === 0 || dow === 6 ? 'we1' : 'we0'}`;
}
export function profileFor(d, prof) {
  const p = prof && (prof[profileKey(d)] || prof[profileKey(d).replace(/we\d/, 'we0')]);
  return Array.isArray(p) && p.length === 24 ? norm(p) : GENERIC_PROFILE;
}

// Sonnenkurve je Ortsstunde (Breite ~50 °N, Länge ~8,6 °O); Sommerzeit grob letzter So im März bis letzter So im Oktober
const lastSun = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
export function pvShape(d, lat = 50.2, lon = 8.6) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +d.slice(8, 10);
  const doy = Math.round((Date.UTC(y, m, day) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  const dec = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + doy) / 365), phi = lat * Math.PI / 180;
  const w0 = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec)))), len = 2 * w0 * 180 / Math.PI / 15;
  const dst = (m > 2 && m < 9) || (m === 2 && day >= lastSun(y, 2)) || (m === 9 && day < lastSun(y, 9));
  const noon = 12 - lon / 15 + 1 + (dst ? 1 : 0), a = noon - len / 2, out = Array(24).fill(0);
  for (let h = 0; h < 24; h++) for (let q = 0; q < 4; q++) { const t = h + (q + 0.5) / 4; if (t > a && t < a + len) out[h] += Math.sin(Math.PI * (t - a) / len); }
  return norm(out);
}

// Endpreis je Stunde in €/kWh brutto aus Börsenpreisen (€/MWh)
export function hourPrices(spot, cfg) {
  const c = { ...DYN_DEFAULTS, ...cfg }, inW = (h, f, t) => (f <= t ? h >= f && h < t : h >= f || h < t);
  return spot.map((p, h) => {
    const netz = !c.mod3 ? +c.netzCt : inW(h, +c.ntFrom, +c.ntTo) ? +c.ntCt : inW(h, +c.htFrom, +c.htTo) ? +c.htCt : +c.netzCt;
    return ((+p || 0) / 10 + +c.markupCt + netz + +c.taxCt) * (1 + +c.vat / 100) / 100;
  });
}

// E-Auto: kWh in die billigsten Stunden des Ladefensters 18–7 Uhr (gleicher Kalendertag), höchstens evKw je Stunde
export function evHours(kwh, price, evKw = 11) {
  const out = Array(24).fill(0); if (!(kwh > 0)) return out;
  const win = [...Array(24).keys()].filter(h => h >= 18 || h < 7).sort((a, b) => price[a] - price[b] || a - b);
  let rest = kwh; for (const h of win) { if (rest <= 0) break; const k = Math.min(rest, evKw); out[h] = k; rest -= k; }
  if (rest > 1e-9) out[win[0]] += rest;
  return out;
}

// Ein Tag. mode: 'self' = Speicher wie heute (chronologisch Eigenverbrauch), 'opt' = preisgesteuert.
// load, pv, ev: kWh je Stunde; price: €/kWh je Stunde; soc0: kWh im Speicher zu Tagesbeginn.
export function simDay({ load, pv, ev, price, soc0, cap, cfg, mode, feed = 0, next = null }) {
  const c = { ...DYN_DEFAULTS, ...cfg }, eta = Math.sqrt(Math.max(0.5, Math.min(1, +c.eff / 100)));
  const grid = Array(24).fill(0), exp = Array(24).fill(0);
  if (mode !== 'opt' || !(cap > 0)) {
    let soc = Math.min(cap || 0, Math.max(0, soc0 || 0)), cost = 0, fromGrid = 0;
    for (let h = 0; h < 24; h++) {
      const n = load[h] - pv[h]; let sur = Math.max(0, -n), def = Math.max(0, n);
      if (sur > 0 && cap > 0) { const st = Math.min(sur * eta, cap - soc, 99); soc += st; sur -= st / eta; }
      if (def > 0 && cap > 0) { const dl = Math.min(def, +c.disKw, soc * eta); soc -= dl / eta; def -= dl; }
      const evG = Math.max(0, ev[h] - sur); sur = Math.max(0, sur - ev[h]);
      grid[h] = def + evG; exp[h] = sur; cost += grid[h] * price[h] - exp[h] * feed; fromGrid += grid[h];
    }
    return { grid, exp, soc, cost, gridKwh: fromGrid };
  }
  // v0.60.2: Preisgesteuert = stufenlose Regel mit Schwellen statt diskreter Ladestufen (die waren bei kleinen stündlichen
  // Defiziten zu grob): entladen nur in Stunden ab Preis θ, aus dem Netz laden in Stunden bis Preis φ bis zum Ziel-Ladestand.
  // θ, φ und Ziel werden je Tag gesucht, bewertet über 48 Stunden (heute + morgen, sofern bekannt); ausgeführt werden nur
  // die ersten 24. Die Regel „wie heute“ (θ = −∞, keine Netzladung) ist immer unter den Kandidaten.
  const nx = next && next.load ? next : null;
  const L = nx ? [...load, ...nx.load] : load, PV = nx ? [...pv, ...nx.pv] : pv, EV = nx ? [...ev, ...nx.ev] : ev, PR = nx ? [...price, ...nx.price] : price;
  const H = L.length, endP = nx ? 0 : Math.min(...price);
  const run = (th, ph, tgt, hours, rec) => {
    let soc = Math.min(cap, Math.max(0, soc0 || 0)), cost = 0, fromGrid = 0;
    for (let h = 0; h < hours; h++) {
      const n = L[h] - PV[h]; let sur = Math.max(0, -n), def = Math.max(0, n), gch = 0;
      if (sur > 0) { const st = Math.min(sur * eta, cap - soc); soc += st; sur -= st / eta; }
      if (def > 0 && PR[h] >= th) { const dl = Math.min(def, +c.disKw, soc * eta); soc -= dl / eta; def -= dl; }
      if (c.gridCharge && PR[h] <= ph && soc < tgt * cap - 1e-9) { gch = Math.min(+c.chgKw, (tgt * cap - soc) / eta); soc += gch * eta; }
      const evG = Math.max(0, EV[h] - sur), ex = Math.max(0, sur - EV[h]), g = def + evG + gch;
      cost += g * PR[h] - ex * feed; fromGrid += g; if (rec) { grid[h] = g; exp[h] = ex; }
    }
    return { cost, soc, fromGrid };
  };
  const ths = [-Infinity, ...[...new Set(price)].sort((a, b) => a - b)];
  const phs = [-Infinity, ...(c.gridCharge ? [...PR].sort((a, b) => a - b).slice(0, 6) : [])];
  const tgts = c.gridCharge ? [0.5, 1] : [1];
  let best = null;
  for (const th of ths) for (const ph of phs) for (const tg of (ph === -Infinity ? [1] : tgts)) {
    const r = run(th, ph, tg, H, false), v = r.cost - r.soc * eta * endP;
    if (!best || v < best.v - 1e-12) best = { v, th, ph, tg };
  }
  const r = run(best.th, best.ph, best.tg, 24, true);
  return { grid, exp, soc: r.soc, cost: r.cost, gridKwh: r.fromGrid };
}

// Gesamtlauf über Tage. days: [{ d, load (kWh), pv (kWh), ev (kWh), spot[24] (€/MWh) }]
// fixed: { ap (€/kWh brutto), gpYear (€) }. Ergebnis je Monat und gesamt, aufgeteilt nach Haus / Speicher / E-Auto.
const addDay = d => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
export function dynSim(days, { cfg = {}, fixed, cap, profile, feed = 0 } = {}) {
  const c = { ...DYN_DEFAULTS, ...cfg };
  const st = { fix: cap / 2, naive: cap / 2, opt: cap / 2 }, months = {}, hourSum = Array(24).fill(0), loadSum = Array(24).fill(0);
  const tot = { n: 0, fix: 0, naive: 0, opt: 0, evKwh: 0, evFix: 0, evDyn: 0, gridFix: 0, gridOpt: 0, spot: 0, load: 0 };
  const prep = days.map(x => {
    // v0.61: gemessene Tagesform (Stundenwerte des Haushalts), sonst Lastprofil
    const price = hourPrices(x.spot, c), prof = Array.isArray(x.shape) && x.shape.length === 24 && x.shape.some(v => v > 0) ? norm(x.shape) : profileFor(x.d, profile), sh = pvShape(x.d);
    return { x, price, load: prof.map(f => f * x.load), pv: sh.map(f => f * (x.pv || 0)), ev: c.ev ? evHours(x.ev || 0, price, +c.evKw) : Array(24).fill(0) };
  });
  for (let i = 0; i < prep.length; i++) {
    const { x, price, load, pv, ev } = prep[i], nxt = prep[i + 1] && prep[i + 1].x.d === addDay(x.d) ? prep[i + 1] : null;
    const flat = Array(24).fill(fixed.ap);
    const f = simDay({ load, pv, ev, price: flat, soc0: st.fix, cap, cfg: c, mode: 'self', feed });
    const nv = simDay({ load, pv, ev, price, soc0: st.naive, cap, cfg: c, mode: 'self', feed });
    const o = simDay({ load, pv, ev, price, soc0: st.opt, cap, cfg: c, mode: 'opt', feed, next: nxt });
    st.fix = f.soc; st.naive = nv.soc; st.opt = o.soc;
    const evK = ev.reduce((a, b) => a + b, 0), evD = ev.reduce((a, k, h) => a + k * price[h], 0);
    const k = x.d.slice(0, 7), M = months[k] = months[k] || { n: 0, fix: 0, naive: 0, opt: 0, evFix: 0, evDyn: 0, gridFix: 0, gridOpt: 0 };
    for (const [key, v] of [['fix', f.cost], ['naive', nv.cost], ['opt', o.cost], ['evFix', evK * fixed.ap], ['evDyn', evD], ['gridFix', f.gridKwh], ['gridOpt', o.gridKwh]]) { M[key] += v; tot[key] += v; }
    M.n++; tot.n++; tot.evKwh += evK; tot.spot += x.spot.reduce((a, b) => a + b, 0) / 24; tot.load += x.load;
    price.forEach((p, h) => { hourSum[h] += p; loadSum[h] += load[h]; });
  }
  const yf = tot.n / 365, feesFix = (+fixed.gpYear || 0) * yf, feesDyn = (12 * +c.feeMonth + +c.netzGpYear) * yf;
  return { months, tot, feesFix, feesDyn, totalFix: tot.fix + feesFix, totalDyn: tot.opt + feesDyn,
    saving: tot.fix + feesFix - tot.opt - feesDyn, storage: tot.naive - tot.opt, evSaving: tot.evFix - tot.evDyn,
    avgSpot: tot.n ? tot.spot / tot.n : null, avgPrice: hourSum.map(v => (tot.n ? v / tot.n : null)), avgLoad: loadSum.map(v => (tot.n ? v / tot.n : 0)) };
}
