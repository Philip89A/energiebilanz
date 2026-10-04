// Seiten der Energiebilanz. Die render*-Funktionen sind aus reference/energiebilanz_v0.14.html übernommen
// (zweiter <script>-Block), die Rechenfunktionen kommen aus calc.js. Geändert gegenüber der Referenz:
//  - S/A kommen aus setModel(), Ansicht und UI-Auswahl (S.view, S.ui) je Gerät im localStorage
//  - private Details in Texten (Anbieter, Daten, Geräteaufbau) durch Werte aus den Daten oder neutral ersetzt
//  - Bearbeiten (v0.5): Handler der Referenz, jede Änderung wird als einzelner Datensatz nach Supabase geschrieben
import { createCalc, shiftYear, weekKey, carBucket, toDb, tarifRechner, parseBoniNote, ausbauRechner, AUSBAU_DEFAULTS } from './calc.js?v=0.15.0';
import { parseNum } from './queue.js?v=0.15.0';
import { geocode, fetchDays } from './weather.js?v=0.15.0';
import { parseHpCsv, hpSum } from './hp.js?v=0.15.0';
const hpSumOne = r => hpSum([r]);

let S = null, A = null, C = null;
const VIEW_KEY = 'eb_view_v1';
const VIEW_DEFAULTS = { view: { mode: 'all', key: '', from: '', to: '', cmp: 'none', cfrom: '', cto: '' },
  ui: { meterFilter: 'all', yoyGroup: 'wp', logCar: 'leon', logGran: 'month' } };
function loadView() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch (e) { v = {}; }
  return { view: { ...VIEW_DEFAULTS.view, ...(v.view || {}) }, ui: { ...VIEW_DEFAULTS.ui, ...(v.ui || {}) } };
}
// Referenz: persist() speicherte alles. Hier: Ansicht je Gerät in localStorage, Parameter (battery, pv, amort, cars)
// verzögert nach Supabase, Rechenmodell neu aufbauen. Einzelne Datensätze schreibt write()/remove().
let store = null;              // { saveRow, deleteRow, saveSettings, reload } aus app.js
export function setStore(s) { store = s; }
let settingsJson = null, settingsTimer = null;
function persist() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: S.view, ui: S.ui })); } catch (e) { /* privat/voll */ }
  refreshCalc();
  const data = toDb.settings(S), json = JSON.stringify(data);
  if (json !== settingsJson) {
    settingsJson = json;
    clearTimeout(settingsTimer);
    setSaveState('Änderung …');
    settingsTimer = setTimeout(() => track(store.saveSettings(data)), 700);
  }
}
function refreshCalc() { C = createCalc(S); A = C.A; }
function setSaveState(t) { const e = document.getElementById('save-state'); if (e) e.textContent = t; }
let pending = 0;
// Ergebnis: 'saved' (in Supabase), 'queued' (offline vorgemerkt) oder 'error'
async function track(promise) {
  pending++; setSaveState('Speichert …');
  try {
    const r = await promise;
    if (--pending === 0) setSaveState(r === 'readonly' ? 'Nur lesen' : r === 'queued' ? 'Offline gespeichert' : 'Gespeichert');
    return r === 'queued' ? 'queued' : 'saved';
  } catch (err) {
    pending--; setSaveState('Fehler');
    $("main").insertAdjacentHTML("afterbegin", flag("Speichern fehlgeschlagen: " + esc(err.message) + " Der Stand aus der Datenbank wird neu geladen."));
    store.reload();
    return 'error';
  }
}
// Einzelnen Datensatz schreiben bzw. löschen (kind wie in db.js), danach neu rechnen
function write(kind, obj) { if (!obj.id && kind !== 'reading') obj.id = crypto.randomUUID(); refreshCalc(); return track(store.saveRow(kind, toDb[kind](obj))); }
function remove(kind, obj) { refreshCalc(); return track(store.deleteRow(kind, toDb[kind](obj))); }

export function setModel(state) {
  const v = loadView();
  S = { ...state, view: v.view, ui: v.ui };
  C = createCalc(S);
  A = C.A;
  settingsJson = JSON.stringify(toDb.settings(S));
}
export const hasModel = () => !!C;

/* ---------- Rechenfunktionen aus calc.js (Namen wie in der Referenz) ---------- */
const today = () => new Date().toISOString().slice(0, 10);
const IMPORT_START = () => C.IMPORT_START();
const sumRange = (...a) => C.sumRange(...a);
const last12 = () => C.last12();
const groupSeries = g => C.groupSeries(g);
const tariffAt = (g, d) => C.tariffAt(g, d);
const currentTariff = g => C.currentTariff(g);
const costs = (...a) => C.costs(...a);
const last365Cost = g => C.last365Cost(g);
const pvSavings = (f, t) => C.pvSavings(f, t);
const lastDataDay = () => C.lastDataDay();
const firstDataDay = () => C.firstDataDay();
const periodOf = (...a) => C.periodOf(...a);
const periodKeys = m => C.periodKeys(m);
const currentPeriods = () => C.currentPeriods(S.view);
const metrics = (f, t) => C.metrics(f, t);
const ankerSeries = (keys, from, to, g) => { const s = C.ankerSeries(keys, from, to, g); return { ...s, labels: s.ks.map(k => bucketLabel(k, s.g)) }; };
const amortTimeline = () => C.amortTimeline();
const abschlagCheck = g => C.abschlagCheck(g, today());
const odoPoints = car => C.odoPoints(car);
const kmDaily = car => C.kmDaily(car);
const carCostItems = car => C.carCostItems(car);
const fuelStats = () => C.fuelStats();
const fuelPrice = n => C.fuelPrice(n);
const carCalc = () => C.carCalc(today());
const finData = (f, t) => C.finData(f, t, today());
// Break-even einheitlich aus der Amortisations-Rechnung (v0.7; vorher drei verschiedene Rechnungen)
function breakEven() {
  const tl = C.amortTimeline(); if (!tl.be) return null;
  const yrsFrom = (a, b) => (new Date(b + "-01") - new Date(a + "-01")) / 864e5 / 365.25;
  return { be: tl.be, total: yrsFrom(tl.startK, tl.be), rest: Math.max(0, yrsFrom(today().slice(0, 7), tl.be)) };
}

const DAY = 86400000;
const toD = s => new Date(s+"T00:00:00Z");
const iso = d => d.toISOString().slice(0,10);
const addDays = (s,n) => iso(new Date(toD(s).getTime()+n*DAY));
const diffDays = (a,b) => Math.round((toD(b)-toD(a))/DAY);
const nf = (v,d=0) => (v==null||!isFinite(v)) ? "–" : v.toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d});
const eur = (v,d=0) => nf(v,d)+" €";
const kwh = (v,d=0) => nf(v,d)+" kWh";
const pct = (v,d=0) => nf(v*100,d)+" %";
const dde = s => s ? s.slice(8,10)+"."+s.slice(5,7)+"."+s.slice(0,4) : "–";
const monthKey = s => s.slice(0,7);
const monthLabel = k => ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"][+k.slice(5,7)-1]+" "+k.slice(2,4);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = id => document.getElementById(id);
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function kpi(v,l,s){ return `<div class="panel kpi"><div class="v">${v}</div><div class="l">${l}</div>${s?`<div class="s">${s}</div>`:""}</div>`; }
function flag(t,info){ return `<div class="flag${info?" info":""}">${t}</div>`; }

const PERIOD_PAGES = ["p-overview","p-fin","p-pv","p-batt","p-meter","p-cost"];
const MON = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

function keyLabel(mode,k){ return mode==="quarter" ? `Q${k.slice(6)} ${k.slice(0,4)}` : mode==="month" ? `${MON[+k.slice(5,7)-1]} ${k.slice(0,4)}` : k; }

function renderPeriodBar(){
  const bar=$("period-bar"); bar.hidden = !PERIOD_PAGES.includes(current); if(bar.hidden) return;
  const v=S.view;
  const keys = periodKeys(v.mode);
  if(["year","quarter","month"].includes(v.mode) && !keys.includes(v.key)) v.key = keys[0];
  $("pb-mode").value=v.mode; $("pb-cmp").value=v.cmp;
  $("pb-key").innerHTML = keys.map(k=>`<option value="${k}" ${k===v.key?"selected":""}>${keyLabel(v.mode,k)}</option>`).join("");
  $("pb-keywrap").hidden = !["year","quarter","month"].includes(v.mode);
  $("pb-cust").hidden = v.mode!=="custom"; $("pb-from").value=v.from||""; $("pb-to").value=v.to||"";
  $("pb-ccust").hidden = v.cmp!=="custom"; $("pb-cfrom").value=v.cfrom||""; $("pb-cto").value=v.cto||"";
  const {P,C}=currentPeriods(), m=metrics(P.from,P.to);
  let info=`<b>${esc(P.label)}</b>`; if(C) info+=` verglichen mit <b>${esc(C.label)}</b>`;
  const cov=[]; if(m.ankDays<m.days) cov.push(`Anker-Daten für ${m.ankDays} von ${m.days} Tagen`);
  if(m.asDays<m.days) cov.push(`Zählerdaten Allgemeinstrom für ${m.asDays} Tage`);
  if(C){ const mc=metrics(C.from,C.to); if(mc.ankDays<mc.days) cov.push(`Vergleich: Anker-Daten für ${mc.ankDays} von ${mc.days} Tagen`); }
  $("pb-info").innerHTML = info + (cov.length?` <span class="pill">${cov.join(", ")}</span>`:"");
}

/* ---------- Kennzahlen je Zeitraum ---------- */

const METRIC_ROWS = [
  ["Erzeugung","gen","kwh",1],["Selbst genutzter Solarstrom","use","kwh",1],["Eigenverbrauchsquote","evq","pct",1],
  ["Autarkie Anker-Messkreis","aut","pct",1],["Eingespeist","feed","kwh",0],
  ["Speicher entladen","bdis","kwh",1],["Speicherwirkungsgrad","eff","pct",1],["Vollzyklen","cyc","n1",1],["Tage mit vollem Speicher","full","n0",0],
  ["Vermiedene Netzkosten","sav","eur",1],["Wert des Speichers","battVal","eur",1],
  ["Allgemeinstrom aus dem Netz","asKwh","kwh",-1],["Allgemeinstrom gesamt (Netz + PV)","asTotal","kwh",-1],["PV-Anteil am Allgemeinstrom","pvShare","pct",1],
  ["Wärmepumpe","wpKwh","kwh",-1],["Gesamtverbrauch Haus","house","kwh",-1],
  ["Stromkosten Allgemeinstrom","asEur","eur",-1],["Stromkosten Wärmepumpe","wpEur","eur",-1]
];
function fmtM(v,f){ if(v==null||!isFinite(v)) return "–"; return f==="kwh"?kwh(v):f==="eur"?eur(v):f==="pct"?pct(v,1):f==="n1"?nf(v,1):nf(v); }
function deltaHtml(a,b,f,dir){
  if(a==null||b==null||!isFinite(a)||!isFinite(b)) return {abs:"–",rel:"–",col:"inherit"};
  const d=a-b, rel = f==="pct" ? null : (Math.abs(b)>Math.abs(a)*0.02 && b!==0 ? d/Math.abs(b) : null);
  const good = dir===0 ? null : (d*dir>0);
  const col = good===null||Math.abs(d)<1e-9 ? "inherit" : good ? "var(--ok)" : "var(--warn)";
  const absS = f==="pct" ? `${d>=0?"+":"−"}${nf(Math.abs(d)*100,1)} Pp.` : (d>=0?"+":"")+fmtM(d,f).replace(/^-/,"−");
  return {abs:absS, rel: rel==null?"–":`${rel>=0?"+":"−"}${nf(Math.abs(rel)*100,1)} %`, col};
}
function kpiC(m,c,key,f,dir,label,sub){
  let s=sub||"";
  if(c){ const d=deltaHtml(m[key],c[key],f,dir); if(d.abs!=="–") s += `${s?"<br>":""}<span style="color:${d.col};font-weight:600">${d.rel!=="–"?d.rel:d.abs}</span> ggü. Vergleich (${fmtM(c[key],f)})`; }
  return kpi(fmtM(m[key],f), label, s);
}
function compareTable(m,c,P,C){
  const note = `<p class="note">Autarkie, Einspeisung und volle Speichertage erscheinen nur, wenn mindestens die Hälfte des Zeitraums nach dem Smart-Meter-Start (${dde(IMPORT_START())}) liegt; sonst „–“.</p>`;
  return note + `<div class="tbl-wrap"><table><thead><tr><th>Kennzahl</th><th>${esc(P.label)}</th>${c?`<th>${esc(C.label)}</th><th>Differenz</th><th>Veränderung</th>`:""}</tr></thead><tbody>${
    METRIC_ROWS.map(([l,k,f,dir])=>{ if(false) return ""; const d=c?deltaHtml(m[k],c[k],f,dir):null;
      return `<tr><td>${l}</td><td>${fmtM(m[k],f)}</td>${c?`<td>${fmtM(c[k],f)}</td><td style="color:${d.col}">${d.abs}</td><td style="color:${d.col}">${d.rel}</td>`:""}</tr>`; }).join("")}</tbody></table></div>`;
}
/* Zeitreihen mit automatischer Auflösung: Tage bis 62 Tage, sonst Monate */
function gran(from,to){ return diffDays(from,to)<=62 ? "day" : "month"; }
function bucketOf(d,g){ return g==="day"?d:monthKey(d); }
function bucketLabel(k,g){ return g==="day" ? k.slice(8,10)+"."+k.slice(5,7)+"." : monthLabel(k); }

const CAR_CATS=["Kilometerstand","Versicherung","Kfz-Steuer","Räderwechsel","Wartung/Reparatur","Pflege","Sonstiges"];
const CARS={leon:"Cupra Leon", tavascan:"Cupra Tavascan"};

function carBucketLabel(k,g){ if(g==="week") return "Wo. "+k.slice(8,10)+"."+k.slice(5,7)+"."+k.slice(2,4); if(g==="month") return monthLabel(k); if(g==="quarter") return `Q${k.slice(6)} ${k.slice(0,4)}`; return k; }

function renderCarAnalytics(){
  const car=S.ui.logCar, g=S.ui.logGran;
  $("lg-car").value=car; $("lg-gran").value=g;
  const kd=kmDaily(car), b={}; Object.entries(kd).forEach(([d,v])=>{ const k=carBucket(d,g); b[k]=(b[k]||0)+v; });
  const ks=Object.keys(b).sort();
  chart("lg-km",{type:"bar",data:{labels:ks.map(k=>carBucketLabel(k,g)),datasets:[{label:"Kilometer",data:ks.map(k=>b[k]),backgroundColor:css("--grid")}]},
    options:{plugins:{legend:{display:false},tooltip:numTip("km")},scales:{x:{ticks:{maxTicksLimit:16}},y:{title:{display:true,text:"km"}}}}});
  $("lg-km-note").textContent = ks.length ? `Aus ${odoPoints(car).length} Kilometerständen (Tanken, Laden und Fahrzeugbuch), zwischen zwei Ständen gleichmäßig verteilt.` : "Mindestens zwei Kilometerstände nötig (Tankvorgang, Ladevorgang oder Eintrag „Kilometerstand“ im Fahrzeugbuch).";
  const items=carCostItems(car), cats=[...new Set(items.map(x=>x.cat))], cb={};
  items.forEach(x=>{ const k=carBucket(x.d,g); cb[k]=cb[k]||{}; cb[k][x.cat]=(cb[k][x.cat]||0)+x.e; });
  const ck=Object.keys(cb).sort(), pal=["--sun","--grid","--heat","--batt","--warn","--muted","--loss","--feed"];
  chart("lg-cost",{type:"bar",data:{labels:ck.map(k=>carBucketLabel(k,g)),datasets:cats.map((c,i)=>({label:c,data:ck.map(k=>cb[k][c]||0),backgroundColor:css(pal[i%pal.length]),stack:"s"}))},
    options:{plugins:{tooltip:numTip("€",2)},scales:{x:{stacked:true,ticks:{maxTicksLimit:16}},y:{stacked:true,title:{display:true,text:"€"}}}}});
  const fs=fuelStats();
  chart("lg-fuel",{type:"line",data:{labels:fs.intervals.map(iv=>dde(iv.to.d)),datasets:[
    {label:"l/100 km",data:fs.intervals.map(iv=>iv.l100),borderColor:css("--warn"),backgroundColor:css("--warn"),yAxisID:"y",pointRadius:3},
    {label:"€/l",data:fs.intervals.map(iv=>iv.to.e/iv.to.l),borderColor:css("--grid"),backgroundColor:css("--grid"),yAxisID:"y1",pointRadius:3}]},
    options:{scales:{y:{title:{display:true,text:"l/100 km"}},y1:{position:"right",grid:{drawOnChartArea:false},title:{display:true,text:"€/l"}}}}});
  // Fahrzeugbuch-Tabelle
  const rows=S.carlog.map((x,i)=>({...x,i})).sort((a,b)=>b.d.localeCompare(a.d));
  $("cl-tbl").innerHTML = rows.length ? `<thead><tr><th>Datum</th><th class="l">Fahrzeug</th><th class="l">Kategorie</th><th>km</th><th>Betrag</th><th class="l">Notiz</th><th></th></tr></thead><tbody>${
    rows.map(x=>`<tr><td>${dde(x.d)}</td><td class="l">${CARS[x.car]||x.car}</td><td class="l">${esc(x.cat)}</td><td>${x.km?nf(x.km):"–"}</td><td>${x.e?eur(x.e,2):"–"}</td><td class="l">${esc(x.note||"")}</td><td><button class="x" data-del-cl="${x.i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="l" style="color:var(--muted)">Noch keine Einträge. Hier landen Kilometerstände ohne Tanken, Versicherung, Steuer, Räderwechsel und alles Weitere mit Datum.</td></tr></tbody>`;
  // KPIs Fahrzeug
  const to=iso(new Date()), from=addDays(to,-364);
  const km12=Object.entries(kd).filter(([d])=>d>=from&&d<=to).reduce((s,[,v])=>s+v,0);
  const span=Object.keys(kd).filter(d=>d>=from&&d<=to).length;
  const cost12=items.filter(x=>x.d>=from&&x.d<=to).reduce((s,x)=>s+x.e,0);
  const lease = car==="leon"?S.cars.ice.rate:S.cars.ev.rate;
  $("lg-car-kpis").innerHTML =
    kpi(km12?nf(km12)+" km":"–","Gefahren, letzte 12 Monate", km12?`Kontingent Leasing ${nf(car==="leon"?S.cars.ice.km:S.cars.ev.km)} km`:"Kilometerstände fehlen") +
    kpi(eur(cost12,0),"Kosten ohne Leasing, 12 Monate","Sprit bzw. Laden und Fahrzeugbuch") +
    kpi(km12?nf(cost12/km12*100,1)+" ct":"–","Je km ohne Leasing","") +
    kpi(km12?nf((cost12+lease*span/30.4375)/km12*100,1)+" ct":"–","Je km mit Leasing",`Leasing ${eur(lease,2)} pro Monat, anteilig für ${nf(span)} Tage mit Kilometerdaten`);
}

/* ---------- PV-Kalender ---------- */
function renderHeat(){
  const max=Math.max(...A.c.gen), start=weekKey(A.dates[0]), end=A.dates[A.n-1];
  let html='<div class="heat">', d=start, col=0, months='';
  while(d<=end){ html+='<div class="hcol">';
    if(d.slice(8,10)<="07") months+=`<span style="grid-column:${col+1}">${MON[+d.slice(5,7)-1]}</span>`;
    for(let j=0;j<7;j++){ const dd=addDays(d,j), i=A.idx[dd]; const v=i===undefined?null:A.c.gen[i];
      html+= v==null?'<i class="e"></i>':`<i style="background:color-mix(in srgb,var(--sun) ${Math.round(8+92*v/max)}%,var(--bg))" title="${dde(dd)}: ${nf(v,2)} kWh"></i>`; }
    html+='</div>'; d=addDays(d,7); col++; }
  html+='</div>';
  $("pv-heat").innerHTML = `<div class="heat-months" style="grid-template-columns:repeat(${col},12px)">${months}</div>`+html;
  const top=A.dates.map((d,i)=>({d,v:A.c.gen[i]})).sort((a,b)=>b.v-a.v).slice(0,5);
  $("pv-top").innerHTML = `Beste Tage: ${top.map(x=>`${dde(x.d)} (${nf(x.v,2)} kWh)`).join(", ")}.`;
}

/* ---------- Zähler: Filter und Monatsgrafiken ---------- */
function renderMeterExtras(){
  const f=S.ui.meterFilter||"all";
  $("rd-filter").innerHTML = `<option value="all">Alle Zähler</option>`+S.meters.map(m=>`<option value="${m.id}" ${m.id===f?"selected":""}>${esc(m.name)}</option>`).join("");
  const groups=[["as","Allgemeinstrom","--grid"],["wp","Wärmepumpe","--heat"],["feed","Einspeisung (Zähler)","--feed"]].filter(([g])=>groupSeries(g).intervals.length);
  // v0.13: nur der oben gewählte Zeitraum, bis 62 Tage je Tag
  const {P:MP}=currentPeriods(), mg=gran(MP.from,MP.to);
  const mo={}; groups.forEach(([g])=>{ for(const [d,k] of Object.entries(groupSeries(g).daily)){ if(d<MP.from||d>MP.to) continue; const key=mg==="day"?d:monthKey(d); mo[key]=mo[key]||{}; mo[key][g]=(mo[key][g]||0)+k; } });
  const ks=Object.keys(mo).sort();
  $("mt-month-title").textContent = mg==="day" ? "Verbrauch pro Tag" : "Verbrauch pro Monat";
  chart("mt-month",{type:"bar",data:{labels:ks.map(k=>mg==="day"?dde(k).slice(0,6):monthLabel(k)),datasets:groups.map(([g,l,c])=>({label:l,data:ks.map(k=>mo[k][g]||0),backgroundColor:css(c)}))},
    options:{plugins:{tooltip:numTip("kWh")},scales:{y:{title:{display:true,text:"kWh"}}}}});
  const yg=S.ui.yoyGroup||"wp"; $("mt-yoy-g").value=yg;
  const ser=groupSeries(yg).daily, yy={}; for(const [d,k] of Object.entries(ser)){ const y=d.slice(0,4), m=+d.slice(5,7)-1; yy[y]=yy[y]||Array(12).fill(null); yy[y][m]=(yy[y][m]||0)+k; }
  const pal=["--loss","--grid","--sun","--heat"];
  chart("mt-yoy",{type:"bar",data:{labels:MON,datasets:Object.keys(yy).sort().map((y,i)=>({label:y,data:yy[y],backgroundColor:css(pal[i%pal.length])}))},
    options:{plugins:{tooltip:numTip("kWh")},scales:{y:{title:{display:true,text:"kWh"}}}}});
}

/* ---------- Charts ---------- */
const charts = {};
// v0.15: Summe über jedem Balken (gestapelt: Gesamtwert über dem Stapel), nur wenn der Balken breit genug ist.
// Abschalten je Diagramm mit options.plugins.ebTotals = false. Linien und schwebende Balken werden ignoriert.
const ebTotals = { id: "ebTotals", afterDatasetsDraw(ch) {
  if (ch.config.type !== "bar" || ch.options.indexAxis === "y" || ch.options.plugins?.ebTotals === false) return;
  const metas = ch.getSortedVisibleDatasetMetas().filter(m => m.type === "bar" && !m.hidden);
  if (!metas.length || (metas[0].data[0]?.width || 0) < 14) return;
  const ctx = ch.ctx, stacked = !!ch.options.scales?.x?.stacked, n = ch.data.labels.length, fmt = v => nf(v, Math.abs(v) >= 10 ? 0 : 1);
  ctx.save(); ctx.font = "600 10px system-ui, sans-serif"; ctx.fillStyle = css("--ink"); ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  const put = (v, x, y) => { if (v == null || !isFinite(v) || Math.abs(v) < 0.05) return; ctx.fillText(fmt(v), x, y - 2); };
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let sum = 0, top = Infinity, x = null, any = false;
      for (const m of metas) { const v = ch.data.datasets[m.index].data[i], el = m.data[i]; if (typeof v !== "number" || !el) continue;
        sum += v; any = true; top = Math.min(top, el.y, el.base); x = el.x; }
      if (any) put(sum, x, top);
    }
  } else {
    for (const m of metas) m.data.forEach((el, i) => { const v = ch.data.datasets[m.index].data[i]; if (typeof v === "number") put(v, el.x, Math.min(el.y, el.base)); });
  }
  ctx.restore();
} };
function chart(id, cfg){
  if(charts[id]) charts[id].destroy();
  const ctx = $(id); if(!ctx || typeof Chart==="undefined") return;
  Chart.defaults.font.family = '"Public Sans", system-ui, sans-serif';
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--line");
  cfg.options = Object.assign({responsive:true, maintainAspectRatio:false, locale:"de-DE", animation:{duration:250}, interaction:{mode:"index",intersect:false},
    plugins:{legend:{position:"bottom",labels:{boxWidth:10,boxHeight:10}}}}, cfg.options||{});
  if(cfg.type==="bar" && !cfg.options.layout) cfg.options.layout = { padding: { top: 14 } };
  cfg.plugins = [...(cfg.plugins||[]), ebTotals];
  charts[id] = new Chart(ctx, cfg);
}
const numTip = (unit,d=0) => ({callbacks:{label:c=>`${c.dataset.label}: ${nf(c.parsed.y,d)} ${unit}`}});
// v0.11: bei Tagesauflösung Wetter des Tages im Tooltip (Temperatur, Einstrahlung, Sonnenstunden)
function wxTip(tip, sr){
  if(sr.g!=="day" || !S.weather?.length) return tip;
  return {...tip, callbacks:{...tip.callbacks, footer:items=>{ const w=C.W[sr.ks[items[0]?.dataIndex]]; return w?`Wetter: Ø ${nf(w.t,1)} °C, ${nf(w.rad,1)} kWh/m²${w.sun!=null?`, ${nf(w.sun,1)} h Sonne`:""}`:""; }}};
}

/* ---------- Überblick ---------- */

function renderOverview(){
  const {P,C}=currentPeriods(), m=metrics(P.from,P.to), c=C?metrics(C.from,C.to):null;
  const {from,to}=P;
  const s2h=sumRange("s2h",from,to), lossB=m.bch-m.bdis, feed=m.feed+(m.bdis-m.b2h), gen=m.gen;
  $("ov-lead").textContent = `Zeitraum: ${P.label}. Datenbasis: Anker-Export, Zählerstände und Stromverträge.`;
  $("ov-sentence").innerHTML = gen>0 ? `Die Anlage hat <b>${kwh(gen)}</b> erzeugt. <b>${pct(m.use/gen)}</b> davon hast du selbst genutzt, das ersetzte Netzstrom im Wert von <b>${eur(m.sav)}</b>. Der Speicher hat ${kwh(lossB)} geschluckt, ohne sie wieder abzugeben.` : "Für diesen Zeitraum liegen keine Anker-Daten vor.";
  const segs = [["Direkt ins Haus",s2h,"--sun"],["Über den Speicher ins Haus",m.b2h,"--batt"],["Verlust im Speicher",lossB,"--loss"],["Eingespeist",feed,"--feed"]];
  $("ov-flow").innerHTML = gen>0 ? segs.map(([l,v,col])=>`<div style="flex:${Math.max(v,0)};background:var(${col})" title="${l}: ${kwh(v)}">${v/gen>0.09?nf(v/gen*100)+" %":""}</div>`).join("") : "";
  $("ov-legend").innerHTML = segs.map(([l,v,col])=>`<span style="--c:var(${col})">${l} ${kwh(v)}</span>`).join("");
  $("ov-flow-note").textContent = "Einspeisung wird erst seit dem Smart Meter gemessen; in den Monaten davor kann sie im Speicherverlust stecken.";
  const cost = (m.asEur!=null&&m.wpEur!=null)?m.asEur+m.wpEur:null, costC = c&&c.asEur!=null&&c.wpEur!=null?c.asEur+c.wpEur:null;
  const inv = S.invest.reduce((a,b)=>a+(+b.cost||0),0), r12=last12(), sav12=pvSavings(r12.from,r12.to).eur;
  const mm={...m,cost}, cc=c?{...c,cost:costC}:null;
  $("ov-kpis").innerHTML =
    kpiC(mm,cc,"gen","kwh",1,"PV-Erzeugung",`Genutzt ${kwh(m.use)}`) +
    kpiC(mm,cc,"sav","eur",1,"Vermiedene Netzkosten","Nur Arbeitspreis, ohne Grundpreis") +
    kpiC(mm,cc,"cost","eur",-1,"Stromkosten Haus", m.asEur!=null&&m.wpEur!=null?`Allgemein ${eur(m.asEur)}, Wärmepumpe ${eur(m.wpEur)}, inkl. Grundpreis, ohne Boni`:"Zählerdaten unvollständig") +
    (()=>{ const b=inv>0?breakEven():null; return kpi(b?monthLabel(b.be):(inv>0?"–":"offen"),"Break-even", b?`noch ${nf(b.rest,1)} Jahre, ${nf(b.total,1)} Jahre nach der ersten Investition (wie Amortisation)`:(inv>0?"Nicht innerhalb der Betrachtungsdauer":"Investitionskosten fehlen noch")); })();
  const sr = ankerSeries(["gen","use","imp","feed"],from,to), is=IMPORT_START();
  chart("ov-month",{type:"bar",data:{labels:sr.labels,datasets:[
    {label:"Erzeugung",data:sr.rows.map(r=>r.gen),backgroundColor:css("--sun-soft"),borderColor:css("--sun"),borderWidth:1,order:3},
    {type:"line",label:"Genutzt",data:sr.rows.map(r=>r.use),borderColor:css("--sun"),backgroundColor:css("--sun"),pointRadius:0,tension:.3,order:1},
    {type:"line",label:"Netzbezug",data:sr.ks.map((k,j)=>(sr.g==="day"?k:monthKey(k))>=(sr.g==="day"?is:monthKey(is))?sr.rows[j].imp:null),borderColor:css("--grid"),backgroundColor:css("--grid"),pointRadius:0,tension:.3,order:1},
    {label:"Einspeisung",data:sr.rows.map(r=>r.feed),backgroundColor:css("--feed"),order:2},
    {type:"line",label:"Netzbezug laut Zähler",data:meterGrid(sr,from,to),borderColor:css("--heat"),backgroundColor:css("--heat"),borderDash:[2,3],borderWidth:2,pointRadius:0,tension:.2,order:0}]},
    options:{plugins:{tooltip:wxTip(numTip("kWh",1),sr)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh"}}}}});
  $("ov-mtitle").textContent = sr.g==="day" ? "Tagesbilanz PV-Messkreis" : "Monatsbilanz PV-Messkreis";
  $("ov-cmp-panel").hidden = !C;
  $("ov-month-panel").style.gridColumn = C ? "" : "1 / -1";
  if(C){
    const g=gran(from,to), a=ankerSeries(["gen","use"],from,to,g), b=ankerSeries(["gen","use"],C.from,C.to,g);
    const n=Math.max(a.ks.length,b.ks.length);
    $("ov-cmp-note").textContent = `Erzeugung und genutzter Solarstrom je ${g==="day"?"Tag":"Monat"}, nach Position im Zeitraum ausgerichtet.`;
    chart("ov-cmp",{type:"bar",data:{labels:[...Array(n).keys()].map(i=>a.labels[i]||b.labels[i]),datasets:[
      {label:"Erzeugung "+P.label,data:a.rows.map(r=>r.gen),backgroundColor:css("--sun")},
      {label:"Erzeugung "+C.label,data:b.rows.map(r=>r.gen),backgroundColor:css("--grid"),borderColor:css("--grid"),borderWidth:1},
      {type:"line",label:"Genutzt "+P.label,data:a.rows.map(r=>r.use),borderColor:css("--batt"),backgroundColor:css("--batt"),pointRadius:2,borderWidth:2.5,tension:.3},
      {type:"line",label:"Genutzt "+C.label,data:b.rows.map(r=>r.use),borderColor:css("--heat"),borderDash:[5,3],backgroundColor:css("--heat"),pointRadius:2,borderWidth:2.5,tension:.3}]},
      options:{plugins:{tooltip:{callbacks:{title:c=>`${a.labels[c[0].dataIndex]||"–"} ↔ ${b.labels[c[0].dataIndex]||"–"}`,label:c=>`${c.dataset.label}: ${nf(c.parsed.y,1)} kWh`}}},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh"}}}}});
  }
  $("ov-cmp-tbl").innerHTML = compareTable(m,c,P,C);
  const todo = [];
  if(inv===0) todo.push("Investitionskosten der PV-Anlage fehlen, deshalb keine Amortisation.");
  S.tariffs.filter(t=>t.est).forEach(t=>todo.push(`${t.name}: ${t.est}.`));
  if(!S.cars.ev.ins || !S.cars.ice.ins) todo.push("Versicherungsbeiträge beider Autos fehlen.");
  if(!S.cars.ev.transfer) todo.push("Überführungs- und Zulassungskosten des Tavascan fehlen.");
  const ev = S.events.find(e=>e.type==="geraet"); if(ev && /geschätzt/.test(ev.text)) todo.push(`Tauschdatum Wärmepumpe ist geschätzt (${dde(ev.d)}).`);
  if(!S.readings.some(r=>r.m==="as_feed")) todo.push("Einspeisezähler (2.8.0) hat noch keine Stände, Abgleich mit Anker fehlt.");
  todo.push("Wärmepumpe noch nicht wetterbereinigt (Gradtagzahlen fehlen).");
    $("ov-todo").innerHTML = `<ul style="margin:8px 0 0;padding-left:18px">${todo.map(t=>`<li style="margin:4px 0">${esc(t)}</li>`).join("")}</ul>`;
}

/* ---------- PV ---------- */
function renderPV(){
  const {P,C}=currentPeriods(), m=metrics(P.from,P.to), c=C?metrics(C.from,C.to):null, kwp=S.pv.kwp, is=IMPORT_START();
  const mm={...m, spec:m.gen/kwp}, cc=c?{...c, spec:c.gen/kwp}:null;
  $("pv-kpis").innerHTML =
    kpiC(mm,cc,"gen","kwh",1,"Erzeugung",`${nf(m.gen/kwp)} kWh je kWp bei ${nf(kwp,2)} kWp`) +
    kpiC(mm,cc,"evq","pct",1,"Eigenverbrauchsquote","Genutzter Solarstrom je erzeugter kWh") +
    kpiC(mm,cc,"aut","pct",1,"Autarkie Messkreis",m.aut==null?`Netzbezug erst ab ${dde(is)} gemessen`:"Ohne Wärmepumpe") +
    kpiC(mm,cc,"feed","kwh",0,"Eingespeist","Gemessen erst seit dem Smart Meter");
  const sr = ankerSeries(["use","imp","pv1","pv2","pv3","pv4","gen","s2h","s2b","feed"],P.from,P.to);
  const okImp = k => (sr.g==="day"?k:monthKey(k)) >= (sr.g==="day"?is:monthKey(is));
  chart("pv-aut",{type:"bar",data:{labels:sr.labels,datasets:[
    {label:"Autarkie",data:sr.ks.map((k,j)=>okImp(k)&&(sr.rows[j].use+sr.rows[j].imp)>0?sr.rows[j].use/(sr.rows[j].use+sr.rows[j].imp)*100:null),backgroundColor:css("--sun")}]},
    options:{plugins:{legend:{display:false},tooltip:wxTip(numTip("%"),sr)},scales:{x:{ticks:{maxTicksLimit:14}},y:{max:100,title:{display:true,text:"%"}}}}});
  const cols=["--sun","--batt","--grid","--heat"];
  chart("pv-str",{type:"line",data:{labels:sr.labels,datasets:["pv1","pv2","pv3","pv4"].map((p,i)=>({label:"Strang "+(i+1),data:sr.rows.map(r=>r[p]),borderColor:css(cols[i]),backgroundColor:css(cols[i]),pointRadius:sr.g==="day"?0:2,tension:.3}))},
    options:{plugins:{tooltip:numTip("kWh",1)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh"}}}}});
  chart("pv-yield",{type:"bar",data:{labels:sr.labels,datasets:[{label:"kWh je kWp",data:sr.rows.map(r=>r.gen/kwp),backgroundColor:css("--sun")}]},
    options:{plugins:{legend:{display:false},tooltip:wxTip(numTip("kWh/kWp",1),sr)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh je kWp"}}}}});
  chart("pv-use",{type:"bar",data:{labels:sr.labels,datasets:[
    {label:"Direkt ins Haus",data:sr.rows.map(r=>r.s2h),backgroundColor:css("--sun"),stack:"s"},
    {label:"In den Speicher",data:sr.rows.map(r=>r.s2b),backgroundColor:css("--batt"),stack:"s"},
    {label:"Eingespeist",data:sr.rows.map(r=>r.feed),backgroundColor:css("--feed"),stack:"s"}]},
    options:{plugins:{tooltip:wxTip(numTip("kWh",1),sr)},scales:{x:{stacked:true,ticks:{maxTicksLimit:14}},y:{stacked:true,title:{display:true,text:"kWh"}}}}});
  $("pv-gran").textContent = sr.g==="day" ? "je Tag" : "je Monat";
  renderHeat();
  // kumuliert: immer Gesamtzeitraum, gewählter Zeitraum hervorgehoben
  const off=+S.pv.offset||0; let cg=off, cu=0, cf=0; const cG=[], cU=[], cF=[], inP=[];
  A.dates.forEach((d,i)=>{ cg+=A.c.gen[i]; cu+=A.c.use[i]; cf+=A.c.feed[i]; cG.push(cg); cU.push(cu); cF.push(cf); inP.push(d>=P.from&&d<=P.to?cg:null); });
  const savAll = pvSavings(A.dates[0], A.dates[A.n-1]);
  $("pv-cum-note").textContent = `Gesamt seit ${dde(A.dates[0])}: ${kwh(cg)} erzeugt${off?` (inkl. ${kwh(off)} vor Exportbeginn)`:""}, davon ${kwh(cu)} selbst genutzt und ${kwh(cf)} eingespeist. Ersetzter Netzstrom: ${eur(savAll.eur)}. Der gewählte Zeitraum ist farbig hervorgehoben.`;
  const po=$("pv-offset"); if(document.activeElement!==po) po.value=off;
  po.onchange=()=>{ S.pv.offset=+po.value||0; persist(); rerender(); };
  chart("pv-cum",{type:"line",data:{labels:A.dates.map(dde),datasets:[
    {label:"Gewählter Zeitraum",data:inP,borderColor:css("--sun"),backgroundColor:css("--sun")+"40",fill:"origin",pointRadius:0,borderWidth:3},
    {label:"Erzeugung",data:cG,borderColor:css("--sun"),backgroundColor:"transparent",pointRadius:0,borderWidth:1.5},
    {label:"Selbst genutzt",data:cU,borderColor:css("--batt"),backgroundColor:css("--batt"),pointRadius:0,borderWidth:2},
    {label:"Eingespeist",data:cF,borderColor:css("--feed"),backgroundColor:css("--feed"),pointRadius:0,borderWidth:2}]},
    options:{plugins:{tooltip:numTip("kWh")},scales:{x:{ticks:{maxTicksLimit:8}},y:{title:{display:true,text:"kWh"}}}}});
}

/* ---------- Batterie ---------- */
function battParamsInit(){
  const h=$("bt-params"); h.innerHTML=""; const b=S.battery;
  const add=(key,label,step)=>{ const l=document.createElement("label"); l.className="f"; l.textContent=label; const i=document.createElement("input"); i.type="number"; i.step=step; i.value=b[key];
    i.addEventListener("input",()=>{ b[key]=+i.value||0; persist(); renderBattery(false); }); l.appendChild(i); h.appendChild(l); };
  add("capGross","Kapazität brutto kWh","0.1"); add("reserve","Reserve, bleibt immer drin %","1"); add("fullThresh","Voll-Schwelle Einspeisung kWh/Tag","0.1");
  const l=document.createElement("label"); l.className="f"; l.textContent="Installierte PV-Leistung kWp"; const i=document.createElement("input"); i.type="number"; i.step="0.01"; i.value=S.pv.kwp;
  i.addEventListener("input",()=>{ S.pv.kwp=+i.value||1; persist(); }); l.appendChild(i); h.appendChild(l);
}
function renderBattery(first){
  if(first) battParamsInit();
  const {P,C}=currentPeriods(), m=metrics(P.from,P.to), c=C?metrics(C.from,C.to):null;
  const b=S.battery, usable=b.capGross*(1-b.reserve/100), is=IMPORT_START();
  const mm={...m, fullShare:m.measured?m.full/m.measured:null}, cc=c?{...c, fullShare:c.measured?c.full/c.measured:null}:null;
  $("bt-kpis").innerHTML =
    kpi(nf(usable,2)+" kWh","Nutzbare Kapazität",`${nf(b.capGross,1)} kWh brutto, ${nf(b.reserve)} % Reserve`) +
    kpiC(mm,cc,"fullShare","pct",0,"Tage mit vollem Speicher", m.measured?`${m.full} von ${m.measured} gemessenen Tagen`:`Erst ab ${dde(is)} messbar`) +
    kpiC(mm,cc,"cyc","n1",1,"Vollzyklen",`${kwh(m.bdis)} entladen, Wirkungsgrad ${m.eff!=null?pct(m.eff):"–"} (Entladung ÷ Ladung)`) +
    kpiC(mm,cc,"battVal","eur",1,"Wert des Speichers",`Netzstrom, den ${kwh(m.b2h)} aus dem Speicher abends und nachts ersetzt haben (Arbeitspreis)`);
  const sr = ankerSeries(["bch","bdis","feed"],P.from,P.to);
  const fullIn = {}; A.dates.forEach((d,i)=>{ if(d<P.from||d>P.to||d<is) return; const k=bucketOf(d,sr.g); const o=fullIn[k]=fullIn[k]||{f:0,n:0}; o.n++; if(A.c.feed[i]>=b.fullThresh) o.f++; });
  chart("bt-full",{type:"bar",data:{labels:sr.labels,datasets:[
    {label:"Tage voll",data:sr.ks.map(k=>fullIn[k]?fullIn[k].f:null),backgroundColor:css("--batt"),stack:"s"},
    {label:"Tage nicht voll",data:sr.ks.map(k=>fullIn[k]?fullIn[k].n-fullIn[k].f:null),backgroundColor:css("--grid-soft"),stack:"s"}]},
    options:{plugins:{tooltip:numTip("Tage")},scales:{x:{stacked:true,ticks:{maxTicksLimit:14}},y:{stacked:true,title:{display:true,text:"Tage"}}}}});
  const idx=A.dates.map((d,i)=>i).filter(i=>A.dates[i]>=P.from&&A.dates[i]<=P.to);
  const isFull=i=>A.dates[i]>=is&&A.c.feed[i]>=b.fullThresh;
  chart("bt-daily",{type:"bar",data:{labels:idx.map(i=>dde(A.dates[i])),datasets:[
    {type:"line",label:"Speicher voll",data:idx.map(i=>isFull(i)?A.c.bch[i]:null),showLine:false,pointRadius:3,pointBackgroundColor:css("--sun"),borderColor:css("--sun"),order:0},
    {label:"Geladen",data:idx.map(i=>A.c.bch[i]),backgroundColor:css("--batt"),order:1},
    {label:"Entladen",data:idx.map(i=>-A.c.bdis[i]),backgroundColor:css("--grid-soft"),order:1}]},
    options:{plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${nf(Math.abs(c.parsed.y),1)} kWh`}}},scales:{x:{stacked:true,ticks:{maxTicksLimit:7}},y:{stacked:true,title:{display:true,text:"kWh pro Tag"}}}}});
  chart("bt-cyc",{type:"bar",data:{labels:sr.labels,datasets:[{label:"Vollzyklen",data:sr.rows.map(r=>r.bdis/usable),backgroundColor:css("--batt")}]},
    options:{plugins:{legend:{display:false},tooltip:numTip("Zyklen",2)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"Zyklen"}}}}});
  chart("bt-loss",{type:"bar",data:{labels:sr.labels,datasets:[
    {label:"Verlust im Speicher",data:sr.rows.map(r=>r.bch-r.bdis),backgroundColor:css("--loss"),yAxisID:"y"},
    ...(sr.g==="day"?[]:[{type:"line",label:"Wirkungsgrad",data:sr.rows.map(r=>r.bch>1?r.bdis/r.bch*100:null),borderColor:css("--batt"),backgroundColor:css("--batt"),pointRadius:2,yAxisID:"y1"}])]},
    options:{scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh"}},y1:{position:"right",min:0,max:100,grid:{drawOnChartArea:false},title:{display:true,text:"%"}}}}});
}

/* ---------- Zähler ---------- */
function renderMeters(){
  const as=groupSeries("as"), wp=groupSeries("wp");
  const step = g => g.intervals.flatMap(iv=>[{x:iv.from,y:iv.rate},{x:iv.to,y:iv.rate}]);
  const allD = [...new Set([...as.pts,...wp.pts].map(p=>p.d))].sort();
  chart("mt-rate",{type:"line",data:{datasets:[
    {label:"Allgemeinstrom",data:step(as),borderColor:css("--grid"),backgroundColor:css("--grid"),pointRadius:0,borderWidth:2},
    {label:"Wärmepumpe",data:step(wp),borderColor:css("--heat"),backgroundColor:css("--heat"),pointRadius:0,borderWidth:2}]},
    options:{parsing:true,scales:{x:{type:"category",labels:allD,ticks:{maxTicksLimit:8,callback:function(v){return dde(this.getLabelForValue(v));}}},y:{title:{display:true,text:"kWh pro Tag"}}},
      plugins:{tooltip:{callbacks:{title:c=>dde(c[0].raw.x),label:c=>`${c.dataset.label}: ${nf(c.parsed.y,1)} kWh/Tag`}}}}});
  // Wärmepumpe vorher/nachher
  const sw = (S.events.find(e=>e.type==="geraet"&&e.group==="wp")||{}).d;
  if(sw){
    const bucket = (d)=>{ const m=+d.slice(5,7); return (m>=5&&m<=9)?"Sommer (Mai–Sep)":(m>=11||m<=2)?"Winter (Nov–Feb)":"Übergang"; };
    const agg = {};
    for(const [d,k] of Object.entries(wp.daily)){ const side=d<sw?"alt":"neu"; const b=bucket(d); const key=b+"|"+side; agg[key]=agg[key]||{k:0,n:0}; agg[key].k+=k; agg[key].n++; }
    const rows = ["Winter (Nov–Feb)","Übergang","Sommer (Mai–Sep)"].map(b=>{
      const a=agg[b+"|alt"], n=agg[b+"|neu"]; const ra=a?a.k/a.n:null, rn=n?n.k/n.n:null;
      return `<tr><td>${b}</td><td>${ra?nf(ra,1):"–"}</td><td>${a?a.n:0}</td><td>${rn?nf(rn,1):"–"}</td><td>${n?n.n:0}</td><td>${ra&&rn?nf((rn/ra-1)*100)+" %":"–"}</td></tr>`;}).join("");
    const l365 = last365Cost("wp");
    $("mt-wp").innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Jahreszeit</th><th>Alt kWh/Tag</th><th>Tage</th><th>Neu kWh/Tag</th><th>Tage</th><th>Veränderung</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Tausch am ${dde(sw)}. Der Sommer ist der belastbarere Vergleich, weil dort fast nur Warmwasser läuft. Der Winter ist nicht wetterbereinigt.</p>
      ${l365?`<p class="note">Letzte 365 Tage: ${kwh(l365.kwh)} (neue Pumpe).</p>`:""}`;
  }
  // Tabelle Ablesungen
  const mOpts = S.meters.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("");
  $("rd-m").innerHTML = mOpts;
  renderMeterExtras();
  const rs = S.readings.map((r,i)=>({...r,i})).filter(r=>(S.ui.meterFilter||"all")==="all"||r.m===S.ui.meterFilter).sort((a,b)=>b.d.localeCompare(a.d)||a.m.localeCompare(b.m));
  $("rd-tbl").innerHTML = `<thead><tr><th>Datum</th><th class="l">Zähler</th><th>Stand kWh</th><th class="l">Quelle</th><th></th></tr></thead><tbody>${
    rs.map(r=>`<tr><td>${dde(r.d)}</td><td class="l">${esc(S.meters.find(m=>m.id===r.m)?.name||r.m)}</td><td>${nf(r.v,1)}</td><td class="l">${esc(r.src||"Eingabe")}</td><td><button class="x" data-del-rd="${r.i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`;
  // Abgleich
  const is = IMPORT_START();
  const ivs = as.intervals.map(iv=>{
    const covered = iv.from>=is; const imp = sumRange("imp",iv.from,addDays(iv.to,-1));
    return {...iv, covered, imp};
  });
  const ok = ivs.filter(x=>x.covered);
  $("mt-rec").innerHTML = (ok.length? "" : flag(`Noch kein Ablesezeitraum liegt vollständig nach dem ${dde(is)}. Ein neuer Zählerstand des Allgemeinstroms macht den Abgleich möglich.`, true)) +
    `<div class="tbl-wrap"><table><thead><tr><th>Zeitraum</th><th>Hauptzähler kWh</th><th>Anker Netzbezug kWh</th><th>Differenz</th><th class="l">Bewertung</th></tr></thead><tbody>${
      ivs.map(x=>`<tr><td>${dde(x.from)} – ${dde(x.to)}</td><td>${nf(x.kwh)}</td><td>${x.from>=A.dates[0]?nf(x.imp):"–"}</td><td>${x.covered?nf(x.kwh-x.imp):"–"}</td><td class="l">${x.covered?(Math.abs(x.kwh-x.imp)/x.kwh<0.05?"passt":"Verbraucher außerhalb des Anker-Messkreises?"):"Anker ohne Netzbezug in Teilen des Zeitraums"}</td></tr>`).join("")}</tbody></table></div>` + (()=>{
    const fs=groupSeries("feed");
    if(!fs.intervals.length) return flag("Einspeisezähler (2.8.0): mindestens zwei Stände eintragen (Zähler „Einspeisung, neuer Zähler“), dann erscheint hier der Abgleich mit der Anker-Einspeisung.",true);
    return `<h2 style="margin-top:16px">Einspeisung: Zähler gegen Anker</h2><div class="tbl-wrap"><table><thead><tr><th>Zeitraum</th><th>Zähler 2.8.0 kWh</th><th>Anker Einspeisung kWh</th><th>Differenz</th></tr></thead><tbody>${
      fs.intervals.map(iv=>{ const an=sumRange("feed",iv.from,addDays(iv.to,-1)); const ok=iv.from>=is; return `<tr><td>${dde(iv.from)} – ${dde(iv.to)}</td><td>${nf(iv.kwh,1)}</td><td>${ok?nf(an,1):"–"}</td><td>${ok?nf(iv.kwh-an,1):"vor Smart Meter"}</td></tr>`; }).join("")}</tbody></table></div>`;
  })();
}

/* ---------- Abschlag-Check ---------- */

function renderAbschlag(){
  const rs=[["as","Allgemeinstrom"],["wp","Wärmepumpe"]].map(([g,l])=>({g,l,r:abschlagCheck(g)})).filter(x=>x.r);
  const col=v=>v>=0?"var(--ok)":"var(--warn)";
  const row=(label,fn)=>`<tr><td>${label}</td>${rs.map(x=>`<td>${fn(x.r)}</td>`).join("")}</tr>`;
  $("ab-tbl").innerHTML = rs.length ? `<thead><tr><th>Position</th>${rs.map(x=>`<th>${x.l}</th>`).join("")}</tr></thead><tbody>
    ${row("Vertrag",r=>`${esc(r.t.name)}${r.t.est?` <span class="pill">${esc(r.t.est)}</span>`:""}`)}
    ${row("Abrechnungsjahr",r=>`${dde(r.start)} – ${dde(r.end)}`)}
    ${row("Aktueller Abschlag",r=>eur(r.cur)+" / Monat")}
    ${row("Bisher gezahlt",r=>`${eur(r.paid)} (${r.nPaid} Abschläge, ${r.paidSource==="buch"?"laut Zahlungsbuch":"angenommen"})`)}
    ${row("Nächster Abschlag",r=>r.nextDue?`${eur(C.abschlagAt(r.t.group,r.nextDue))} am ${dde(r.nextDue)}`:"–")}
    ${row("Bisher verbraucht",r=>`${eur(r.costSo)} (${kwh(r.kwhSo)} bis ${dde(r.today)})`)}
    ${row("Stand heute",r=>`<span style="color:${col(r.paid-r.costSo)};font-weight:600">${r.paid-r.costSo>=0?"+":"−"}${eur(Math.abs(r.paid-r.costSo))}</span>`)}
    ${row("Prognose restliches Jahr",r=>`${eur(r.costRest)} (${kwh(r.kwhRest)})${r.fb?` <span class="pill">${r.fb} Tage geschätzt</span>`:""}`)}
    ${row("davon Laden Tavascan",r=>r.evK?`${kwh(r.evK)}, ${eur(r.evK*r.t.ap/100)} ab ${dde(S.cars.ev.start)}`:"–")}
    ${row("Erwartete Jahreskosten",r=>eur(r.costTotal))}
    ${row("Abschläge im Abrechnungsjahr",r=>`${eur(r.payTotal)} (12 × Ø ${eur(r.payTotal/12)})`)}
    ${row("<b>Erwartetes Ergebnis ohne Boni</b>",r=>`<b style="color:${col(r.bal)}">${r.bal>=0?"Guthaben ":"Nachzahlung "}${eur(Math.abs(r.bal))}</b>`)}
    ${row("Mit Vertragsboni",r=>`${r.bal+r.boni>=0?"Guthaben ":"Nachzahlung "}${eur(Math.abs(r.bal+r.boni))}`)}
    ${row("<b>Passender Abschlag ab jetzt</b>",r=>r.recNow!=null?`<b>${eur(Math.ceil(r.recNow))} / Monat</b>`:"–")}
    ${row("Passender Abschlag im Jahresmittel",r=>eur(Math.ceil(r.recAvg))+" / Monat")}
  </tbody>` : `<tbody><tr><td class="l" style="color:var(--muted)">Keine laufenden Verträge mit Zählerdaten.</td></tr></tbody>`;
  let fl=""; rs.forEach(x=>{ const r=x.r, over=r.cur-(r.recNow??r.recAvg);
    if(r.recNow!=null && over>5) fl+=flag(`${x.l}: Du zahlst etwa ${eur(over)} im Monat zu viel. Mit ${eur(Math.ceil(r.recNow))} statt ${eur(r.cur)} landest du am Ende des Abrechnungsjahres bei etwa null.`);
    else if(r.recNow!=null && over<-5) fl+=flag(`${x.l}: Der Abschlag reicht voraussichtlich nicht. Passend wären etwa ${eur(Math.ceil(r.recNow))} pro Monat.`);
    else if(r.recNow!=null) fl+=flag(`${x.l}: Der Abschlag passt, Abweichung unter 5 € im Monat.`,true); });
  fl+=flag("Saisonalität: Der restliche Verbrauch kommt aus denselben Kalendertagen des Vorjahres. Beim Allgemeinstrom wird der Zählerverbrauch dafür nach dem täglichen Anker-Netzbezug verteilt (weniger PV im Winter = mehr Netzbezug), vor dem Smart Meter gleichmäßig. Laden des Tavascan wird ab dem geplanten Übergabedatum (Auto-Vergleich) zum Netzstrom addiert. Weitere Annahmen: 12 Abschläge je Abrechnungsjahr, der erste einen Monat nach Lieferbeginn. Boni fließen meist mit der Jahresrechnung oder separat und sind deshalb getrennt ausgewiesen.",true);
  $("ab-flags").innerHTML=fl;
  const ab=[...S.abschlaege].sort((a,b)=>a.group.localeCompare(b.group)||a.from.localeCompare(b.from));
  $("ab-edit").innerHTML = `<thead><tr><th class="l">Zählpunkt</th><th class="l">Gültig ab</th><th>€ pro Monat</th><th class="l">Notiz</th><th></th></tr></thead><tbody>${
    ab.map(a=>`<tr><td class="l"><select data-ab="${a.id}" data-k="group"><option value="as" ${a.group==="as"?"selected":""}>Allgemeinstrom</option><option value="wp" ${a.group==="wp"?"selected":""}>Wärmepumpe</option></select></td><td class="l"><input type="date" value="${a.from}" data-ab="${a.id}" data-k="from" style="min-width:140px"></td><td><input type="number" step="1" value="${a.amount}" data-ab="${a.id}" data-k="amount" style="width:90px"></td><td class="l"><input type="text" value="${esc(a.note||"")}" data-ab="${a.id}" data-k="note" style="min-width:240px"></td><td><button class="x" data-del-ab="${a.id}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`;
}

/* ---------- Kosten ---------- */
function renderCosts(){
  const {P,C}=currentPeriods(), m=metrics(P.from,P.to), c=C?metrics(C.from,C.to):null;
  const ca=costs("as",P.from,P.to), cw=costs("wp",P.from,P.to);
  const rows = [...ca.per.map(p=>({...p,g:"Allgemeinstrom"})), ...cw.per.map(p=>({...p,g:"Wärmepumpe"}))];
  let tot={kwh:0,ap:0,gp:0,bo:0};
  $("ct-tbl").innerHTML = rows.length ? `<thead><tr><th>Tarif</th><th class="l">Zeitraum</th><th>kWh</th><th>Arbeitspreis</th><th>Grundpreis</th><th>Boni</th><th>Summe</th><th>€/kWh eff.</th></tr></thead><tbody>${
    rows.map(p=>{ const bo=p.bo||0; tot.kwh+=p.kwh; tot.ap+=p.apE; tot.gp+=p.gpE; tot.bo+=bo; const sum=p.apE+p.gpE-bo;
      return `<tr><td>${esc(p.t.name)}<br><span class="pill">${p.g}</span> ${p.t.est?`<span class="pill">${esc(p.t.est)}</span>`:""}</td><td class="l">${dde(p.from)} – ${dde(p.to)}</td><td>${nf(p.kwh)}</td><td>${eur(p.apE)}</td><td>${eur(p.gpE)}</td><td title="${esc(p.t.boniNote)}">−${eur(bo)}</td><td>${eur(sum)}</td><td>${p.kwh?nf(sum/p.kwh,3):"–"}</td></tr>`;}).join("")}</tbody>
    <tfoot><tr><td>Gesamt</td><td></td><td>${nf(tot.kwh)}</td><td>${eur(tot.ap)}</td><td>${eur(tot.gp)}</td><td>−${eur(tot.bo)}</td><td>${eur(tot.ap+tot.gp-tot.bo)}</td><td>${tot.kwh?nf((tot.ap+tot.gp-tot.bo)/tot.kwh,3):"–"}</td></tr></tfoot>` : `<tbody><tr><td class="l" style="color:var(--muted)">Keine Zähler- oder Tarifdaten in diesem Zeitraum.</td></tr></tbody>`;
  let fl="";
  if(ca.unpricedKwh>0) fl+=flag(`Allgemeinstrom: ${kwh(ca.unpricedKwh)} an ${ca.unpricedDays} Tagen ohne hinterlegten Tarif (vor dem ersten hinterlegten Tarif, vermutlich Grund- oder Ersatzversorgung).`);
  if(cw.unpricedKwh>0) fl+=flag(`Wärmepumpe: ${kwh(cw.unpricedKwh)} an ${cw.unpricedDays} Tagen ohne hinterlegten Tarif.`);
  fl+=flag("Boni werden tagesanteilig über das erste Vertragsjahr verteilt. Grundpreis tagesanteilig, nur für Tage mit Zählerdaten.",true);
  if(m.asKwh && m.use){ const effP=m.asEur/m.asKwh, infl=m.use*effP;
    fl+=flag(`<span><b>Grundpreis:</b> enthalten in den Kosten je Tarif, in „€/kWh eff.“ und in den Kacheln Allgemeinstrom und Wärmepumpe. Nicht enthalten in vermiedenen Netzkosten, Wert des Speichers, Amortisation und Autovergleich, weil er mit und ohne PV anfällt. Würde man ihn umlegen (${nf(effP*100,1)} ct/kWh statt Arbeitspreis), käme die PV-Ersparnis im Zeitraum auf ${eur(infl)} statt ${eur(m.sav)} und wäre um ${eur(infl-m.sav)} zu hoch.</span>`,true); }
  $("ct-flags").innerHTML=fl;
  const mm={...m, noPV:m.asEur!=null?m.asEur+m.sav:null}, cc=c?{...c, noPV:c.asEur!=null?c.asEur+c.sav:null}:null;
  $("ct-kpis").innerHTML =
    kpiC(mm,cc,"asEur","eur",-1,"Allgemeinstrom", m.asKwh?`${kwh(m.asKwh)} aus dem Netz, ${nf(m.asEur/m.asKwh*100,1)} ct/kWh inkl. Grundpreis`:"") +
    kpiC(mm,cc,"wpEur","eur",-1,"Wärmepumpe", m.wpKwh?`${kwh(m.wpKwh)}, ${nf(m.wpEur/m.wpKwh*100,1)} ct/kWh inkl. Grundpreis`:"") +
    kpiC(mm,cc,"sav","eur",1,"Vermiedene Netzkosten durch PV",`${kwh(m.use)} Solarstrom genutzt, nur Arbeitspreis`) +
    kpiC(mm,cc,"noPV","eur",-1,"Allgemeinstrom ohne PV","Was du ohne Anlage gezahlt hättest");
  const g=gran(P.from,P.to), mA={}, mW={};
  const det={as:{},wp:{}};   // je Monat: kWh, Arbeitspreis-, Grundpreisanteil
  const add=(grp,out)=>{ const s=groupSeries(grp); for(const [d,k] of Object.entries(s.daily)){ if(d<P.from||d>P.to) continue; const t=tariffAt(grp,d); if(!t) continue; const key=bucketOf(d,g); out[key]=(out[key]||0)+k*t.ap/100+t.gp/365;
    const o=det[grp][key]=det[grp][key]||{k:0,ap:0,gp:0,days:0}; o.k+=k; o.ap+=k*t.ap/100; o.gp+=t.gp/365; o.days++; } };
  add("as",mA); add("wp",mW);
  const ks=[...new Set([...Object.keys(mA),...Object.keys(mW)])].sort();
  chart("ct-month",{type:"bar",data:{labels:ks.map(k=>bucketLabel(k,g)),datasets:[
    {label:"Allgemeinstrom",data:ks.map(k=>mA[k]||0),backgroundColor:css("--grid"),stack:"s"},
    {label:"Wärmepumpe",data:ks.map(k=>mW[k]||0),backgroundColor:css("--heat"),stack:"s"}]},
    options:{plugins:{tooltip:{callbacks:{label:c=>{ const o=det[c.datasetIndex===0?"as":"wp"][ks[c.dataIndex]]; return o?`${c.dataset.label}: ${eur(c.parsed.y,2)} = ${kwh(o.k,0)} × Arbeitspreis (${eur(o.ap,2)}) + Grundpreis ${o.days} Tage (${eur(o.gp,2)})`:`${c.dataset.label}: –`; }}}},scales:{x:{stacked:true,ticks:{maxTicksLimit:14}},y:{stacked:true,title:{display:true,text:"€ ohne Boni"}}}}});
  $("ct-mtitle").textContent = g==="day" ? "Tägliche Kosten" : "Monatliche Kosten";
  renderAbschlag(); renderPayments(); renderBilling(); renderBoni();
  const f=(t,k,type="text",st="")=>`<input type="${type}" ${st} value="${esc(t[k])}" data-tf="${t.id}" data-k="${k}">`;
  $("tf-tbl").innerHTML = `<thead><tr><th>Name</th><th class="l">Zählpunkt</th><th class="l">Von</th><th class="l">Bis</th><th>ct/kWh brutto</th><th>Grundpreis €/Jahr</th><th>Boni €</th><th class="l">Hinweis</th><th></th></tr></thead><tbody>${
    S.tariffs.map(t=>`<tr><td>${f(t,"name")}</td><td class="l"><select data-tf="${t.id}" data-k="group"><option value="as" ${t.group==="as"?"selected":""}>Allgemein</option><option value="wp" ${t.group==="wp"?"selected":""}>Wärmepumpe</option></select></td><td>${f(t,"from","date")}</td><td>${f(t,"to","date")}</td><td>${f(t,"ap","number",'step="0.01" style="width:80px"')}</td><td>${f(t,"gp","number",'step="0.01" style="width:90px"')}</td><td>${f(t,"boni","number",'step="0.01" style="width:80px"')}</td><td>${f(t,"est")}</td><td><button class="x" data-del-tf="${t.id}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`;
}

/* ---------- Kosten & Ersparnisse ---------- */

function renderFinance(){
  const {P,C}=currentPeriods(), f=finData(P.from,P.to), g=C?finData(C.from,C.to):null;
  const flat=x=>({cost:x.cost, net:x.net, sav:x.sav, noPV:x.noPV, battVal:x.battVal, direct:x.direct, boni:x.boni, leon:x.mob.leon, tav:x.mob.tav});
  const a=flat(f), b=g?flat(g):null;
  $("fin-kpis").innerHTML =
    kpiC(a,b,"net","eur",-1,"Stromkosten Allgemeinstrom",`Inkl. Grundpreis, abzüglich ${eur(f.boni)} Boni`) +
    kpiC(a,b,"sav","eur",1,"Ersparnis durch PV",`Davon ${eur(f.battVal)} über den Speicher`) +
    kpiC(a,b,"noPV","eur",-1,"Allgemeinstrom ohne PV","Was du ohne Anlage gezahlt hättest") +
    kpiC(a,b,"leon","eur",-1,"Cupra Leon im Zeitraum",`Leasing ${eur(f.mob.leonLease)}, Sprit ${eur(f.mob.fuel)}${f.mob.fuelIsIst?" (Tankbuch)":" (geschätzt)"}`);
  chart("fin-wf",{type:"bar",data:{labels:["Ohne PV, ohne Boni","Ersparnis PV","Boni","Tatsächlich"],datasets:[
    {label:"Betrag",data:[[0,f.cost+(f.sav||0)],[f.cost,f.cost+(f.sav||0)],[f.net,f.cost],[0,f.net]],
     backgroundColor:[css("--grid-soft"),css("--sun"),css("--feed"),css("--grid")]}]},
    options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{ const v=c.raw; return eur(Math.abs(v[1]-v[0])); }}}},scales:{y:{title:{display:true,text:"€"}}}}});
  const row=(l,va,vb,dir,cls="")=>{ const d=b!=null&&vb!==undefined?deltaHtml(va,vb,"eur",dir):null;
    return `<tr class="${cls}"><td>${l}</td><td>${fmtM(va,"eur")}</td>${g?`<td>${fmtM(vb,"eur")}</td><td style="color:${d.col}">${d.abs}</td>`:""}</tr>`; };
  const G=g||{as:{},wp:{},mob:{}};
  $("fin-tbl").innerHTML = `<thead><tr><th>Position</th><th>${esc(P.label)}</th>${g?`<th>${esc(C.label)}</th><th>Differenz</th>`:""}</tr></thead><tbody>
    <tr><td colspan="4" class="l" style="font-weight:700;padding-top:12px">Stromkosten Allgemeinstrom</td></tr>
    ${row("Allgemeinstrom Arbeitspreis",f.as.ap,G.as.ap,-1)}${row("Allgemeinstrom Grundpreis",f.as.gp,G.as.gp,-1)}
    ${row("Boni (anteilig)",-f.boni,g?-g.boni:undefined,-1)}${row("Allgemeinstrom netto",f.net,g?g.net:undefined,-1)}
    <tr><td colspan="4" class="l" style="font-weight:700;padding-top:12px">Ersparnisse</td></tr>
    ${row("Solarstrom direkt verbraucht",f.direct,g?g.direct:undefined,1)}${row("Solarstrom über den Speicher",f.battVal,g?g.battVal:undefined,1)}
    ${row("Einspeisevergütung",f.feedVal,g?g.feedVal:undefined,1)}${row("Ersparnis gesamt",f.sav,g?g.sav:undefined,1)}
    ${row("Allgemeinstrom ohne PV",f.noPV,g?g.noPV:undefined,-1)}
    <tr><td colspan="4" class="l" style="font-weight:700;padding-top:12px">Mobilität im Zeitraum</td></tr>
    ${row("Cupra Leon Leasing",f.mob.leonLease,g?G.mob.leonLease:undefined,-1)}${row(`Cupra Leon Sprit${f.mob.fuelIsIst?` (Tankbuch, ${f.mob.fuelN} Vorgänge)`:" (geschätzt)"}`,f.mob.fuel,g?G.mob.fuel:undefined,-1)}
    ${row("Cupra Leon Versicherung, Steuer, Sonstiges",f.mob.leonFix,g?G.mob.leonFix:undefined,-1)}${row("Cupra Leon gesamt",f.mob.leon,g?G.mob.leon:undefined,-1)}
    ${row("Zum Vergleich: Tavascan im selben Zeitraum",f.mob.tav,g?G.mob.tav:undefined,-1)}
  </tbody>`;
  // Monatsverlauf
  const gr=gran(P.from,P.to), cA={}, cW={}, sv={};
  const addc=(grp,out)=>{ const s=groupSeries(grp); for(const [d,k] of Object.entries(s.daily)){ if(d<P.from||d>P.to) continue; const t=tariffAt(grp,d); if(!t) continue; const key=bucketOf(d,gr); out[key]=(out[key]||0)+k*t.ap/100+t.gp/365; } };
  addc("as",cA);
  A.dates.forEach((d,i)=>{ if(d<P.from||d>P.to) return; const t=tariffAt("as",d)||currentTariff("as"); const key=bucketOf(d,gr); sv[key]=(sv[key]||0)+A.c.use[i]*t.ap/100; });
  const ks=[...new Set([...Object.keys(cA),...Object.keys(cW),...Object.keys(sv)])].sort();
  chart("fin-month",{type:"bar",data:{labels:ks.map(k=>bucketLabel(k,gr)),datasets:[
    {label:"Allgemeinstrom",data:ks.map(k=>cA[k]||0),backgroundColor:css("--grid"),stack:"s"},
    {type:"line",label:"Ersparnis PV",data:ks.map(k=>sv[k]||0),borderColor:css("--sun"),backgroundColor:css("--sun"),pointRadius:2,tension:.3}]},
    options:{plugins:{tooltip:numTip("€",2)},scales:{x:{stacked:true,ticks:{maxTicksLimit:14}},y:{stacked:true,title:{display:true,text:"€"}}}}});
  // Jahre
  const f0=firstDataDay(), f1=lastDataDay(), yrs=[];
  for(let y=+f0.slice(0,4); y<=+f1.slice(0,4); y++){ const fr=`${y}-01-01`>f0?`${y}-01-01`:f0, tt=`${y}-12-31`<f1?`${y}-12-31`:f1; yrs.push({label:String(y)+(fr!==`${y}-01-01`||tt!==`${y}-12-31`?"*":""), d:finData(fr,tt)}); }
  yrs.push({label:"Gesamt", d:finData(f0,f1), tot:true});
  const yr=(l,fn,cls="")=>`<tr class="${cls}"><td>${l}</td>${yrs.map(y=>`<td style="${y.tot?"font-weight:700":""}">${fmtM(fn(y.d),"eur")}</td>`).join("")}</tr>`;
  $("fin-years").innerHTML = `<thead><tr><th>Position</th>${yrs.map(y=>`<th>${y.label}</th>`).join("")}</tr></thead><tbody>
    ${yr("Allgemeinstrom Arbeitspreis",d=>d.as.ap)}${yr("Allgemeinstrom Grundpreis",d=>d.as.gp)}${yr("Boni (anteilig)",d=>-d.boni)}${yr("Allgemeinstrom netto",d=>d.net)}
    ${yr("Ersparnis direkt verbraucht",d=>d.direct)}${yr("Ersparnis über den Speicher",d=>d.battVal)}${yr("Ersparnis gesamt",d=>d.sav)}${yr("Allgemeinstrom ohne PV",d=>d.noPV)}
    ${yr("Cupra Leon gesamt",d=>d.mob.leon)}</tbody>`;
  $("fin-years").insertAdjacentHTML("afterend", "");
  renderBalance(P, C);
  // Investition
  const inv=S.invest.reduce((x,y)=>x+(+y.cost||0),0), realized=pvSavings(A.dates[0],A.dates[A.n-1]).eur, r12=last12(), base=pvSavings(r12.from,r12.to).eur;
  const items=[...S.invest].sort((x,y)=>(x.date||"9").localeCompare(y.date||"9"));
  const invTbl = `<div class="tbl-wrap"><table><thead><tr><th>Datum</th><th class="l">Position</th><th>Betrag</th></tr></thead><tbody>${
    items.map(x=>`<tr><td>${dde(x.date)}</td><td class="l" style="white-space:normal">${esc(x.name)}</td><td style="color:${+x.cost<0?"var(--ok)":"inherit"}">${eur(+x.cost||0,2)}</td></tr>`).join("")}</tbody><tfoot><tr><td>Summe</td><td></td><td>${eur(inv,2)}</td></tr></tfoot></table></div><p class="note">Bearbeiten unter „Amortisation“. Verkäufe mindern die Investition.</p>`;
  $("fin-inv").innerHTML = invTbl + (inv>0
    ? `<div class="grid g3" style="margin-top:10px">${kpi(eur(inv),"Investition PV")}${kpi(eur(realized),"Bereits erwirtschaftet",pct(realized/inv)+" der Investition")}${(()=>{ const b=breakEven(); return kpi(realized>=inv?"erreicht":b?monthLabel(b.be):"–","Break-even",realized>=inv?"":b?`noch ${nf(b.rest,1)} Jahre bis dahin (Rechnung wie „Amortisation“: Preissteigerung und Leistungsverlust berücksichtigt); aktuell ${eur(base)} Ersparnis pro Jahr`:"Nicht innerhalb der Betrachtungsdauer"); })()}</div>`
    : flag("Investitionskosten fehlen noch. Unter „Amortisation“ eintragen, dann erscheint hier der Stand bis zum Break-even.",true)+`<p class="note">Bereits erwirtschaftet seit ${dde(A.dates[0])}: ${eur(realized)}.</p>`);
}

/* ---------- Amortisation ---------- */
function slider(host, obj, key, label, min, max, step, unit, dec=1){
  const id = "sl-"+Math.random().toString(36).slice(2,8);
  const wrap = document.createElement("div"); wrap.className="slider";
  wrap.innerHTML = `<label for="${id}">${label}</label><output>${nf(obj[key],dec)} ${unit}</output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}">`;
  wrap.querySelector("input").addEventListener("input",e=>{ obj[key]=+e.target.value; wrap.querySelector("output").textContent=`${nf(obj[key],dec)} ${unit}`; persist(); rerender(); });
  host.appendChild(wrap);
}
function renderAmort(first){
  const inv = S.invest.reduce((a,b)=>a+(+b.cost||0),0);
  const {from,to}=last12(), base=pvSavings(from,to).eur, am=S.amort;
  const realized = pvSavings(A.dates[0], to).eur, tl=amortTimeline();
  const beYears = tl.be ? (diffDays(`${tl.startK}-01`,`${tl.be}-01`)/365.25) : null;
  const wb12 = tl.wbFrom ? C.homeCharging([from,tl.wbFrom].sort()[1], to).saving : 0, wbAll = tl.wbFrom ? C.homeCharging(tl.wbFrom, to).saving : 0;
  $("am-kpis").innerHTML =
    kpi(eur(inv,2),"Investition gesamt", `${S.invest.length} Positionen, Verkäufe abgezogen`) +
    kpi(eur(base+wb12),"Ersparnis letzte 12 Monate", tl.wbFrom ? `PV ${eur(base)} zum Arbeitspreis, Wallbox ${eur(wb12)} gegenüber öffentlichem Laden` : "Nur Arbeitspreis") +
    kpi(tl.be?monthLabel(tl.be):"–","Break-even", tl.be?`${nf(beYears,1)} Jahre nach der ersten Investition`:"Nicht innerhalb der Betrachtungsdauer") +
    kpi(eur(realized+wbAll),"Bereits erwirtschaftet",`Seit ${dde(A.dates[0])}${inv?`, ${pct((realized+wbAll)/inv)} der Investition`:""}${tl.wbFrom?`, davon Wallbox ${eur(wbAll)}`:""}`);
  $("am-wb-note").innerHTML = tl.wbFrom ? flag(`Wallbox ab ${dde(tl.wbFrom)}: gemessen aus den Ladevorgängen „zu Hause“ (kWh × öffentlicher Preis − Arbeitspreis), Prognose ${eur(tl.wbYear)} pro Jahr aus dem Auto-Vergleich ab Übergabe des E-Autos. Solarstrom im Auto steckt bereits in der PV-Ersparnis.`, true) : "";
  $("am-inv").innerHTML = `<thead><tr><th class="l">Position</th><th class="l">Kategorie</th><th class="l">Datum</th><th>Kosten €</th><th></th></tr></thead><tbody>${
    S.invest.map((x,i)=>`<tr><td class="l"><input type="text" style="min-width:200px" value="${esc(x.name)}" data-inv="${i}" data-k="name"></td><td class="l"><select data-inv="${i}" data-k="cat" style="width:auto">${INV_CATS.map(([k,l])=>`<option value="${k}" ${(x.cat||"pv")===k?"selected":""}>${l}</option>`).join("")}</select></td><td class="l"><input type="date" value="${esc(x.date)}" data-inv="${i}" data-k="date"></td><td><input type="number" step="0.01" value="${x.cost}" data-inv="${i}" data-k="cost" style="width:110px"></td><td><button class="x" data-del-inv="${i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody><tfoot><tr><td>Summe</td><td></td><td></td><td>${eur(inv,2)}</td><td></td></tr></tfoot>`;
  if(first){
    const h=$("am-sl"); h.innerHTML="";
    slider(h,am,"priceInc","Strompreissteigerung pro Jahr",0,8,0.5,"%");
    slider(h,am,"degr","Leistungsverlust pro Jahr",0,2,0.1,"%");
    slider(h,am,"years","Betrachtungsdauer",5,25,1,"Jahre",0);
    slider(h,am,"feedin","Einspeisevergütung",0,10,0.5,"ct/kWh");
    const l=document.createElement("label"); l.className="f"; l.textContent="Einspeisevergütung gilt ab"; const i=document.createElement("input"); i.type="date"; i.value=am.feedinFrom||"";
    i.addEventListener("change",()=>{ am.feedinFrom=i.value; persist(); rerender(); }); l.appendChild(i); h.appendChild(l);
  }
  const lab=tl.labels.map(monthLabel), li=tl.proj.indexOf(true);
  chart("am-chart",{type:"line",data:{labels:lab,datasets:[
    {label:"Ersparnis gemessen",data:tl.cumS.map((v,j)=>tl.proj[j]?null:v),borderColor:css("--sun"),backgroundColor:css("--sun"),pointRadius:0,borderWidth:2.5},
    {label:"Ersparnis Prognose",data:tl.cumS.map((v,j)=>(tl.proj[j]||j===li-1)?v:null),borderColor:css("--sun"),borderDash:[5,4],backgroundColor:css("--sun"),pointRadius:0,borderWidth:2},
    {label:"Investition kumuliert",data:tl.cumI,borderColor:css("--ink"),backgroundColor:css("--ink"),pointRadius:0,borderWidth:1.5,stepped:true}]},
    options:{plugins:{tooltip:numTip("€")},scales:{x:{ticks:{maxTicksLimit:12}},y:{title:{display:true,text:"€"}}}}});
}

/* ---------- Auto ---------- */

function numField(host,obj,key,label,step="any"){
  const d=document.createElement("label"); d.className="f"; d.textContent=label;
  const inp=document.createElement("input"); inp.type="number"; inp.step=step; inp.value=obj[key];
  inp.addEventListener("input",()=>{ obj[key]=inp.value===""?0:+inp.value; persist(); renderCar(false); });
  d.appendChild(inp); host.appendChild(d);
}
function renderCar(first){
  const i=S.cars.ice, e=S.cars.ev;
  if(first){
    const hi=$("car-ice"); hi.innerHTML="";
    numField(hi,i,"rate","Leasingrate €/Monat","0.01"); numField(hi,i,"km","km pro Jahr","100");
    numField(hi,i,"l100","Verbrauch l/100 km","0.1");
    const sl=document.createElement("label"); sl.className="f"; sl.textContent="Spritpreis-Quelle";
    const ss=document.createElement("select"); ss.innerHTML=`<option value="manual">Manuell</option><option value="all">Ø alle Tankvorgänge</option><option value="lastN">Ø letzte N Tankvorgänge</option>`; ss.value=i.priceSrc;
    ss.addEventListener("change",()=>{ i.priceSrc=ss.value; persist(); renderCar(false); }); sl.appendChild(ss); hi.appendChild(sl);
    numField(hi,i,"priceN","N Tankvorgänge","1"); numField(hi,i,"price","Spritpreis manuell €/l","0.01");
    const info=document.createElement("div"); info.id="car-price-info"; info.style.gridColumn="1/-1"; info.className="note"; info.style.fontSize="13px"; info.style.color="var(--muted)"; hi.appendChild(info);
    numField(hi,i,"ins","Versicherung €/Jahr","1"); numField(hi,i,"tax","Kfz-Steuer €/Jahr","1");
    numField(hi,i,"other","Sonstiges €/Jahr","1");
    const cb=document.createElement("label"); cb.className="f"; cb.style.flexDirection="row"; cb.style.alignItems="center"; cb.style.color="var(--ink)";
    cb.innerHTML=`<input type="checkbox" ${i.useLog?"checked":""}> Verbrauch aus Tankbuch`; cb.querySelector("input").addEventListener("change",ev=>{i.useLog=ev.target.checked;persist();renderCar(false);}); hi.appendChild(cb);
    const cb2=document.createElement("label"); cb2.className="f"; cb2.style.flexDirection="row"; cb2.style.alignItems="center"; cb2.style.color="var(--ink)";
    cb2.innerHTML=`<input type="checkbox" ${i.useLedger?"checked":""}> Versicherung, Steuer, Sonstiges aus Fahrzeugbuch (12 Monate)`; cb2.querySelector("input").addEventListener("change",ev=>{i.useLedger=ev.target.checked;persist();renderCar(false);}); hi.appendChild(cb2);
    const he=$("car-ev"); he.innerHTML="";
    { const l=document.createElement("label"); l.className="f"; l.textContent="Übergabe geplant"; const i=document.createElement("input"); i.type="date"; i.value=e.start||"";
      i.addEventListener("change",()=>{ e.start=i.value; persist(); }); l.appendChild(i); he.appendChild(l); }
    numField(he,e,"rate","Leasingrate €/Monat","0.01"); numField(he,e,"km","km pro Jahr","100");
    numField(he,e,"kwh100","Verbrauch kWh/100 km","0.1"); numField(he,e,"loss","Ladeverluste %","1");
    numField(he,e,"shHome","Anteil Laden zu Hause %","1"); numField(he,e,"shPV","davon aus PV %","1");
    numField(he,e,"pricePublic","Öffentlich €/kWh","0.01"); numField(he,e,"ins","Versicherung €/Jahr","1");
    numField(he,e,"tax","Kfz-Steuer €/Jahr","1"); numField(he,e,"thg","THG-Prämie €/Jahr","1");
    numField(he,e,"transfer","Überführung/Zulassung €","1");
  }
  const r=carCalc(), dI=r.iceCum[36], dE=r.evCum[36];
  const pa=fuelPrice(0), pn=fuelPrice(Math.max(1,+i.priceN||20)), pi=$("car-price-info");
  if(pi) pi.innerHTML = pa.count ? `Tankbuch: Ø alle ${nf(pa.price,3)} €/l (${pa.count} Vorgänge, ${dde(pa.from)} bis ${dde(pa.to)}), Ø letzte ${pn.count}: ${nf(pn.price,3)} €/l. Gewichtet nach Litern.` : "Tankbuch ist noch leer, deshalb gilt der manuelle Preis.";
  $("car-kpis").innerHTML =
    kpi(eur(dI),"Cupra Leon, 36 Monate",`${nf(r.l100,1)} l/100 km${i.useLog&&r.fs.l100?" (Tankbuch)":""}, ${nf(r.ip.v,3)} €/l ${r.ip.label}, Sprit ${eur(r.iceFuelY)}/Jahr`) +
    kpi(eur(dE),"Cupra Tavascan, 36 Monate",`${kwh(r.kwhY)}/Jahr, Strom ${eur(r.evEnergyY)}/Jahr (zu Hause nur Arbeitspreis)`) +
    kpi((dE<dI?"Tavascan ":"Leon ")+eur(Math.abs(dE-dI)),"günstiger über 36 Monate",`${eur(Math.abs(dE-dI)/36)} pro Monat`);
  chart("car-cum",{type:"line",data:{labels:r.iceCum.map((_,m)=>"Monat "+m),datasets:[
    {label:"Vorteil Tavascan",data:r.iceCum.map((v,m)=>v-r.evCum[m]),borderColor:css("--batt"),backgroundColor:"transparent",pointRadius:0,borderWidth:2,fill:{target:"origin",above:css("--batt")+"33",below:css("--warn")+"33"}},
    {label:"Nulllinie",data:r.iceCum.map(()=>0),borderColor:css("--muted"),pointRadius:0,borderWidth:1,borderDash:[4,3]}]},
    options:{plugins:{legend:{display:false},tooltip:numTip("€")},scales:{x:{ticks:{maxTicksLimit:7}},y:{title:{display:true,text:"€"}}}}});
  const keys=Object.keys(r.blocks.ice), cols=["--grid","--sun","--heat","--muted","--loss"];
  chart("car-bar",{type:"bar",data:{labels:["Leon","Tavascan"],datasets:keys.map((k,j)=>({label:k,data:[r.blocks.ice[k],r.blocks.ev[k]],backgroundColor:css(cols[j]),stack:"s"}))},
    options:{indexAxis:"y",plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${eur(c.parsed.x)}`}}},scales:{x:{stacked:true,title:{display:true,text:"€"}},y:{stacked:true}}}});
}

/* ---------- Tanken & Laden ---------- */
function renderLog(){
  if(!$("cl-cat").options.length) $("cl-cat").innerHTML=CAR_CATS.map(c=>`<option>${c}</option>`).join("");
  renderCarAnalytics();
  const fs=fuelStats(), ch=S.charges, kW=ch.reduce((a,b)=>a+(+b.k||0),0), cE=ch.reduce((a,b)=>a+(+b.e||0),0);
  $("lg-kpis").innerHTML =
    kpi(fs.l100?nf(fs.l100,2)+" l":"–","Ø Verbrauch je 100 km",fs.intervals.length?`${fs.intervals.length} Volltank-Intervalle`:"Zwei Volltankungen nötig") +
    kpi(fs.avgPrice?nf(fs.avgPrice,3)+" €/l":"–","Ø Spritpreis, alle",(()=>{ const p=fuelPrice(20); return `${nf(fs.L,1)} l getankt${p.count?`, letzte ${p.count}: ${nf(p.price,3)} €/l`:""}`; })()) +
    kpi(eur(fs.E,2),"Tankkosten gesamt",`${fs.n} Einträge`) +
    kpi(kW?nf(cE/kW,2)+" €/kWh":"–","Ø Ladepreis",`${nf(kW,1)} kWh, ${eur(cE,2)}`);
  const ivMap = new Map(fs.intervals.map(iv=>[iv.to,iv]));
  const fr=S.fuel.map((x,i)=>({...x,i})).sort((a,b)=>b.d.localeCompare(a.d));
  $("fu-tbl").innerHTML = fr.length? `<thead><tr><th>Datum</th><th>km</th><th>Liter</th><th>Betrag</th><th>€/l</th><th class="l">Sorte</th><th>voll</th><th>l/100 km</th><th></th></tr></thead><tbody>${
    fr.map(x=>{ const iv=ivMap.get(S.fuel[x.i]); return `<tr><td>${dde(x.d)}</td><td>${nf(x.km)}</td><td>${nf(x.l,2)}</td><td>${eur(x.e,2)}</td><td>${nf(x.e/x.l,3)}</td><td class="l">${esc(x.s)}</td><td>${x.full?"ja":"nein"}</td><td>${iv?nf(iv.l100,2):""}</td><td><button class="x" data-del-fu="${x.i}" aria-label="Löschen">×</button></td></tr>`;}).join("")}</tbody>` : `<tbody><tr><td class="l" style="color:var(--muted)">Noch keine Tankvorgänge. Der erste Eintrag mit „voll getankt“ ist der Startpunkt für die Verbrauchsrechnung.</td></tr></tbody>`;
  const cr=ch.map((x,i)=>({...x,i})).sort((a,b)=>b.d.localeCompare(a.d));
  $("ch-tbl").innerHTML = cr.length? `<thead><tr><th>Datum</th><th>km</th><th>kWh</th><th>Betrag</th><th>€/kWh</th><th class="l">Ort</th><th></th></tr></thead><tbody>${
    cr.map(x=>`<tr><td>${dde(x.d)}</td><td>${x.km?nf(x.km):"–"}</td><td>${nf(x.k,1)}</td><td>${eur(x.e,2)}</td><td>${x.k?nf(x.e/x.k,3):"–"}</td><td class="l">${esc(x.o)}</td><td><button class="x" data-del-ch="${x.i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>` : `<tbody><tr><td class="l" style="color:var(--muted)">Ladevorgänge erfassen, sobald der Tavascan da ist. Laden zu Hause kommt später aus Wallbox- oder Zählerdaten.</td></tr></tbody>`;
}

/* ---------- Daten ---------- */

const PAGES=[["p-quick","--ok"],["p-overview","--sun"],["p-fin","--ok"],["p-pv","--sun"],["p-batt","--batt"],["p-meter","--heat"],["p-cost","--grid"],["p-tarif","--warn"],["p-amort","--sun"],["p-ausbau","--batt"],["p-car","--warn"],["p-log","--muted"],["p-data","--loss"]];
let current="p-overview"; const rendered={};
function buildNav(){
  const sn=$("snav"), mn=$("mnav");
  PAGES.forEach(([id,c])=>{ const t=document.getElementById(id).dataset.title;
    sn.insertAdjacentHTML("beforeend",`<a href="#${id.slice(2)}" data-p="${id}"><span class="dot" style="background:var(${c})"></span>${t}</a>`);
    mn.insertAdjacentHTML("beforeend",`<a href="#${id.slice(2)}" data-p="${id}">${t}</a>`); });
}
function show(id){
  current=id; PAGES.forEach(([p])=>document.getElementById(p).hidden=p!==id);
  document.querySelectorAll("[data-p]").forEach(a=>{ if(a.dataset.p===id) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  rerender(!rendered[id]); rendered[id]=true; window.scrollTo(0,0);
}
function rerender(first=false){
  try{ renderPeriodBar(); }catch(err){ console.error(err); }
  try{
    ({ "p-quick":renderQuick, "p-overview":()=>{ renderOverview(); renderOvWeather(); }, "p-fin":renderFinance, "p-pv":()=>{ renderPV(); renderWxPv(); }, "p-batt":()=>renderBattery(first), "p-meter":()=>{ renderMeters(); renderHp(); renderWxWp(); }, "p-cost":()=>{ renderCosts(); renderEvHome(); }, "p-tarif":renderTarif,
       "p-amort":()=>renderAmort(first), "p-ausbau":renderAusbau, "p-car":()=>renderCar(first), "p-log":renderLog, "p-data":()=>{ renderData(); renderWxData(); renderHpImport(); } })[current]();
  }catch(err){ console.error(err); $("main").insertAdjacentHTML("afterbegin",flag("Fehler bei der Berechnung: "+esc(err.message))); }
  afterRender();
}
function route(){ const h=location.hash.slice(1)||"overview"; const id="p-"+h; show(PAGES.some(p=>p[0]===id)?id:"p-overview"); }

/* ---------- Daten-Seite: Ereignisse (nur Anzeige) ---------- */
function renderData(){
  $("ev-tbl").innerHTML = `<thead><tr><th>Datum</th><th class="l">Bereich</th><th class="l">Ereignis</th></tr></thead><tbody>${
    S.events.map((e,i)=>`<tr><td><input type="date" value="${e.d}" data-ev="${i}" data-k="d"></td><td class="l">${{wp:"Wärmepumpe",as:"Allgemeinstrom",pv:"PV",car:"Auto"}[e.group]||esc(e.group)}</td><td class="l"><input type="text" value="${esc(e.text)}" data-ev="${i}" data-k="text"></td></tr>`).join("")}</tbody>`;
}

/* ---------- Nach jedem Rendern ---------- */
// Nur lesen (body.ro, ab v0.14 Gastzugang): alle Eingaben in den Seiten sperren, außer Zeitraum und Anzeige-Auswahl
const GUEST_DENY = new Set(["hp-file","csv-file","seed-file","seed-replace"]);   // Importe sind Schreiben
const VIEW_INPUTS = new Set(["hp-file","pb-mode","pb-key","pb-from","pb-to","pb-cmp","pb-cfrom","pb-cto","rd-filter","mt-yoy-g","lg-car","lg-gran","csv-file","seed-file","seed-replace"]);
function afterRender(){
  document.querySelectorAll("[data-sm]").forEach(e=>e.textContent=dde(IMPORT_START()));
  if(!document.body.classList.contains("ro")) return;
  document.querySelectorAll("#main input, #main select, #main button").forEach(el=>{
    if(VIEW_INPUTS.has(el.id) && !GUEST_DENY.has(el.id)) return;
    el.disabled = true;
  });
  document.querySelectorAll("#main button.x").forEach(el=>el.hidden=true);
}

/* ---------- Ansicht: Zeitraum und Auswahl (je Gerät gespeichert) ---------- */
let wired = false;
export function startViews(){
  if(!wired){
    wired = true;
    buildNav();
    $("rd-filter").addEventListener("change",e=>{ S.ui.meterFilter=e.target.value; persist(); rerender(); });
    $("mt-yoy-g").addEventListener("change",e=>{ S.ui.yoyGroup=e.target.value; persist(); rerender(); });
    $("lg-car").addEventListener("change",e=>{ S.ui.logCar=e.target.value; persist(); rerender(); });
    $("lg-gran").addEventListener("change",e=>{ S.ui.logGran=e.target.value; persist(); rerender(); });
    const pbSet=(k,v)=>{ S.view[k]=v; persist(); rerender(); };
    $("pb-mode").addEventListener("change",e=>{ S.view.mode=e.target.value; S.view.key=""; if(e.target.value==="custom"&&!S.view.from){ const p=periodOf("r12"); S.view.from=p.from; S.view.to=p.to; } persist(); rerender(); });
    $("pb-key").addEventListener("change",e=>pbSet("key",e.target.value));
    $("pb-cmp").addEventListener("change",e=>{ S.view.cmp=e.target.value; if(e.target.value==="custom"&&!S.view.cfrom){ const {P}=currentPeriods(); S.view.cfrom=shiftYear(P.from); S.view.cto=shiftYear(P.to); } persist(); rerender(); });
    ["from","to","cfrom","cto"].forEach(k=>$("pb-"+k).addEventListener("change",e=>pbSet(k,e.target.value)));
    wireEditing();
    wireWeather();
    wireHpImport();
    window.addEventListener("hashchange",route);
    if(window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>rerender());
  }
  Object.keys(rendered).forEach(k=>delete rendered[k]);
  route();
}
export { route, rerender };

/* ---------- Bearbeiten (Referenz: Ereignisse-Block), Schreiben nach Supabase ---------- */
function wireEditing(){
  const today=iso(new Date()); ["rd-d","fu-d","ch-d","cl-d"].forEach(i=>$(i).value=today);
  document.addEventListener("click",e=>{
    const t=e.target.closest("#main button"); if(!t) return;
    const del=(key,kind,arr)=>{ const i=+t.dataset[key]; if(confirm("Eintrag löschen?")){ const [x]=arr.splice(i,1); remove(kind,x); rerender(); } };
    if(t.dataset.delRd!==undefined) del("delRd","reading",S.readings);
    else if(t.dataset.delFu!==undefined) del("delFu","fuel",S.fuel);
    else if(t.dataset.delCh!==undefined) del("delCh","charge",S.charges);
    else if(t.dataset.delInv!==undefined) del("delInv","investment",S.invest);
    else if(t.dataset.delCl!==undefined) del("delCl","carlog",S.carlog);
    else if(t.dataset.delPay!==undefined){ if(confirm("Zahlung löschen?")){ const x=S.payments.find(p=>p.id===t.dataset.delPay); S.payments=S.payments.filter(p=>p!==x); remove("payment",x); rerender(); } }
    else if(t.dataset.boniParse!==undefined){ const tf=S.tariffs.find(x=>x.id===t.dataset.boniParse); const its=parseBoniNote(tf.boniNote);
      if(!its.length){ tf.boniItems=[{name:"Bonus",amount:+tf.boni||0}]; } else tf.boniItems=its;
      tf.boni=tf.boniItems.reduce((a,i)=>a+(+i.amount||0),0); write("tariff",tf); rerender(); }
    else if(t.dataset.biAdd!==undefined){ const tf=S.tariffs.find(x=>x.id===t.dataset.biAdd); tf.boniItems=[...(tf.boniItems||[]),{name:"Bonus",amount:0}]; write("tariff",tf); rerender(); }
    else if(t.dataset.biDel!==undefined){ const tf=S.tariffs.find(x=>x.id===t.dataset.biDel); tf.boniItems=tf.boniItems.filter((_,i)=>i!==+t.dataset.i); tf.boni=tf.boniItems.reduce((a,i)=>a+(+i.amount||0),0); write("tariff",tf); rerender(); }
    else if(t.dataset.troDel!==undefined){ S.tarif.offers.splice(+t.dataset.troDel,1); persist(); rerender(); }
    else if(t.dataset.delAb!==undefined){ if(confirm("Abschlag löschen?")){ const x=S.abschlaege.find(x=>x.id===t.dataset.delAb); S.abschlaege=S.abschlaege.filter(y=>y!==x); remove("installment",x); rerender(); } }
    else if(t.dataset.delTf!==undefined){ if(confirm("Tarif löschen?")){ const x=S.tariffs.find(x=>x.id===t.dataset.delTf); S.tariffs=S.tariffs.filter(y=>y!==x); remove("tariff",x); rerender(); } }
  });
  document.addEventListener("change",e=>{
    const el=e.target, d=el.dataset;
    if(!el.closest("#main")) return;
    if(d.tf){ const t=S.tariffs.find(x=>x.id===d.tf); t[d.k]=el.type==="number"?+el.value:el.value; write("tariff",t); rerender(); }
    else if(d.inv!==undefined){ const x=S.invest[+d.inv]; x[d.k]=d.k==="cost"?+el.value:el.value; write("investment",x); rerender(); }
    else if(d.ab){ const a=S.abschlaege.find(x=>x.id===d.ab); a[d.k]=d.k==="amount"?+el.value:el.value; write("installment",a); rerender(); }
    else if(d.ev!==undefined){ const x=S.events[+d.ev]; x[d.k]=el.value; write("event",x); }
    else if(d.bi){ const tf=S.tariffs.find(x=>x.id===d.bi), it=tf.boniItems[+d.i];
      if(d.k==="name") it.name=el.value; else { const v=parseNum(el.value); if(isFinite(v)) it[d.k]=v; else delete it[d.k]; }
      tf.boni=tf.boniItems.reduce((a,i)=>a+(+i.amount||0),0); write("tariff",tf); rerender(); }
    else if(d.tr){ S.tarif=S.tarif||{}; const v=parseNum(el.value); if(isFinite(v)) S.tarif[d.tr]=v; else delete S.tarif[d.tr]; persist(); rerender(); }
    else if(d.wb){ S.ausbau=S.ausbau||{}; const k=d.wb;
      if(el.type==="checkbox") S.ausbau[k]=el.checked; else if(el.tagName==="SELECT"||el.type==="date") S.ausbau[k]=el.value;
      else { const v=parseNum(el.value); if(el.value.trim()==="") delete S.ausbau[k]; else if(isFinite(v)) S.ausbau[k]=v; }
      persist(); rerender(); }
    else if(d.tro!==undefined){ const o=S.tarif.offers[+d.tro]; o[d.k]=["name","grp"].includes(d.k)?el.value:parseNum(el.value); persist(); rerender(); }
  });
  $("rd-add").addEventListener("click",()=>{ const m=$("rd-m").value, d=$("rd-d").value, v=parseFloat($("rd-v").value);
    if(!d||!isFinite(v)){ alert("Datum und Stand angeben."); return; }
    let r=S.readings.find(r=>r.m===m&&r.d===d); if(r) r.v=v; else { r={m,d,v,src:"Eingabe"}; S.readings.push(r); }
    $("rd-v").value=""; write("reading",r); rerender(); });
  $("fu-add").addEventListener("click",()=>{ const x={d:$("fu-d").value,km:+$("fu-km").value,l:+$("fu-l").value,e:+$("fu-e").value,s:$("fu-s").value,full:$("fu-full").checked};
    if(!x.d||!x.km||!x.l||!x.e){ alert("Datum, Kilometerstand, Liter und Betrag angeben."); return; }
    S.fuel.push(x); ["fu-km","fu-l","fu-e"].forEach(i=>$(i).value=""); write("fuel",x); rerender(); });
  $("ch-add").addEventListener("click",()=>{ const x={d:$("ch-d").value,km:+$("ch-km").value||null,k:+$("ch-k").value,e:+$("ch-e").value,o:$("ch-o").value};
    if(!x.d||!x.k){ alert("Datum und kWh angeben."); return; }
    S.charges.push(x); ["ch-km","ch-k","ch-e"].forEach(i=>$(i).value=""); write("charge",x); rerender(); });
  $("am-add").addEventListener("click",()=>{ const x={name:"Neue Position",date:"",cost:0}; S.invest.push(x); write("investment",x); rerender(); });
  $("cl-add").addEventListener("click",()=>{ const x={d:$("cl-d").value, car:$("cl-car").value, cat:$("cl-cat").value, km:+$("cl-km").value||null, e:+$("cl-e").value||0, note:$("cl-n").value};
    if(!x.d || (!x.km && !x.e)){ alert("Datum und Kilometerstand oder Betrag angeben."); return; }
    S.carlog.push(x); ["cl-km","cl-e","cl-n"].forEach(i=>$(i).value=""); write("carlog",x); rerender(); });
  $("ab-add").addEventListener("click",()=>{ const x={group:"as",from:iso(new Date()),amount:0,note:""}; S.abschlaege.push(x); write("installment",x); rerender(); });
  $("pay-g").addEventListener("change",renderPayments); $("pay-k").addEventListener("change",renderPayments);
  $("pay-d").value=today;
  $("pay-add").addEventListener("click",()=>{ const k=$("pay-k").value; let a=parseNum($("pay-a").value); if(!isFinite(a)&&k==="abschlag") a=parseNum($("pay-a").placeholder);
    const d=$("pay-d").value; if(!d||!(a>0)){ alert("Datum und Betrag angeben."); return; }
    const note=k==="bonus"?[$("pay-bonus").value,$("pay-n").value].filter(Boolean).join(" – "):$("pay-n").value;
    const x={group:$("pay-g").value,d,amount:a,kind:k,note}; (S.payments=S.payments||[]).push(x); ["pay-a","pay-n"].forEach(i=>$(i).value=""); write("payment",x); rerender(); });
  $("pay-suggest").addEventListener("click",()=>{ const sug=C.paymentSuggestions(iso(new Date())); if(!sug.length) return;
    if(!confirm(`${sug.length} Abschläge laut Abschlagsplan anlegen (${sug.map(x=>dde(x.d)).slice(0,3).join(", ")}${sug.length>3?" …":""})? Abweichungen danach einzeln korrigieren.`)) return;
    for(const x of sug){ (S.payments=S.payments||[]).push(x); write("payment",x); } rerender(); });
  $("tr-withev").addEventListener("change",e=>{ S.tarif=S.tarif||{}; S.tarif.withEv=e.target.checked; persist(); rerender(); });
  $("tr-add").addEventListener("click",()=>{ S.tarif=S.tarif||{}; (S.tarif.offers=S.tarif.offers||[]).push({name:"Neues Angebot",grp:"as",ap:30,gp:150,boni:0}); persist(); rerender(); });
  $("tf-add").addEventListener("click",()=>{ const x={group:"as",name:"Neuer Tarif",from:iso(new Date()),to:"",ap:30,gp:150,boni:0,boniNote:"",est:""}; S.tariffs.push(x); write("tariff",x); rerender(); });
}

// Für den Seitenvergleich im Test (tests/…/compare): Diagrammdaten lesbar machen
window.__ebCharts = charts;

/* ---------- Schnell erfassen (Handy): Zählerstand, Tanken, Laden, Fahrzeugbuch ---------- */
const Q_KINDS = {
  reading: { title: "Zählerstand", btn: "Zählerstand" },
  fuel: { title: "Tankvorgang", btn: "Tanken" },
  charge: { title: "Ladevorgang", btn: "Laden" },
  carlog: { title: "Fahrzeugbuch", btn: "Fahrzeugbuch" },
  payment: { title: "Zahlung", btn: "Zahlung" },
};
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } };
function lastReading(m, before) {
  return S.readings.filter(r => r.m === m && (!before || r.d < before)).sort((a, b) => b.d.localeCompare(a.d))[0] || null;
}
function lastOdo(car, before) { const o = odoPoints(car).filter(x => !before || x.d <= before); return o.length ? o[o.length - 1] : null; }
function quickSub(kind) {
  if (kind === "reading") { const m = lsGet("eb_q_meter", "wp"), r = lastReading(m); const mm = S.meters.find(x => x.id === m);
    return r ? `${esc(mm?.name || m)}: ${nf(r.v)} kWh am ${dde(r.d)}` : "Noch kein Stand"; }
  if (kind === "fuel") { const f = [...S.fuel].sort((a, b) => b.d.localeCompare(a.d))[0]; return f ? `Zuletzt ${dde(f.d)} · ${nf(f.km)} km` : "Noch kein Tankvorgang"; }
  if (kind === "charge") { const c = [...S.charges].sort((a, b) => b.d.localeCompare(a.d))[0]; return c ? `Zuletzt ${dde(c.d)} · ${nf(c.k, 1)} kWh` : "Noch kein Ladevorgang"; }
  if (kind === "payment") { const q = [...(S.payments || [])].sort((a, b) => b.d.localeCompare(a.d))[0]; return q ? `Zuletzt ${dde(q.d)} · ${KIND_LABEL[q.kind]} ${eur(q.amount, 2)}` : "Abschlag, Erstattung, Bonus"; }
  const l = [...S.carlog].sort((a, b) => b.d.localeCompare(a.d))[0]; return l ? `Zuletzt ${dde(l.d)} · ${esc(l.cat)}` : "Noch kein Eintrag";
}
function renderQuick() {
  if (!$("q-grid").children.length) {
    $("q-grid").innerHTML = Object.entries(Q_KINDS).map(([k, q]) => `<button type="button" class="qbtn" data-q="${k}"><span class="qt">${q.btn}</span><span class="qs" data-qs="${k}"></span></button>`).join("");
    $("q-grid").addEventListener("click", e => { const b = e.target.closest("[data-q]"); if (b) openQuick(b.dataset.q); });
  }
  Object.keys(Q_KINDS).forEach(k => { const el = document.querySelector(`[data-qs="${k}"]`); if (el) el.innerHTML = quickSub(k); });
}
const fld = (label, html, cls = "") => `<label class="f ${cls}">${label}${html}</label>`;
const num = (id, ph = "", mode = "decimal") => `<input type="text" inputmode="${mode}" autocomplete="off" id="${id}" placeholder="${ph}">`;
function openQuick(kind) {
  const f = $("q-form"), today = iso(new Date());
  $("q-msg").innerHTML = "";
  let body = "";
  if (kind === "reading") {
    const m = lsGet("eb_q_meter", "wp");
    body = fld("Zähler", `<select id="q-m">${S.meters.map(x => `<option value="${x.id}" ${x.id === m ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`, "wide")
      + fld("Datum", `<input type="date" id="q-d" value="${today}">`) + fld("Stand in kWh", num("q-v", "z. B. 12530", "decimal"));
  } else if (kind === "fuel") {
    const lastS = ([...S.fuel].sort((a, b) => b.d.localeCompare(a.d))[0] || {}).s || "Super E10";
    body = fld("Datum", `<input type="date" id="q-d" value="${today}">`) + fld("Kilometerstand", num("q-km", "", "numeric"))
      + fld("Liter", num("q-l", "z. B. 38,5")) + fld("Betrag in €", num("q-e", "z. B. 68,40"))
      + fld("Sorte", `<select id="q-s">${["Super E10", "Super E5", "Super Plus", "Diesel"].map(x => `<option ${x === lastS ? "selected" : ""}>${x}</option>`).join("")}</select>`)
      + `<label class="f check-row"><span><input type="checkbox" id="q-full" checked> voll getankt</span></label>`;
  } else if (kind === "charge") {
    const lastO = ([...S.charges].sort((a, b) => b.d.localeCompare(a.d))[0] || {}).o || "zu Hause";
    body = fld("Datum", `<input type="date" id="q-d" value="${today}">`) + fld("kWh", num("q-k", "z. B. 42,5"))
      + fld("Betrag in € (optional)", num("q-e")) + fld("Kilometerstand (optional)", num("q-km", "", "numeric"))
      + fld("Ort", `<select id="q-o">${["zu Hause", "öffentlich AC", "öffentlich DC", "Arbeitgeber"].map(x => `<option ${x === lastO ? "selected" : ""}>${x}</option>`).join("")}</select>`);
  } else if (kind === "payment") {
    body = quickPaymentFields(today);
  } else {
    body = fld("Datum", `<input type="date" id="q-d" value="${today}">`)
      + fld("Fahrzeug", `<select id="q-car">${Object.entries(CARS).map(([k, v]) => `<option value="${k}" ${k === S.ui.logCar ? "selected" : ""}>${v}</option>`).join("")}</select>`)
      + fld("Kategorie", `<select id="q-cat">${CAR_CATS.map(c => `<option>${c}</option>`).join("")}</select>`)
      + fld("Kilometerstand", num("q-km", "", "numeric")) + fld("Betrag in €", num("q-e")) + fld("Notiz", `<input type="text" id="q-n">`, "wide");
  }
  f.innerHTML = `<h2>${Q_KINDS[kind].title}</h2><div class="q-fields">${body}</div><p class="note" id="q-hint"></p><p class="error" id="q-err" hidden></p>
    <div class="q-actions"><button type="button" id="q-save">Speichern</button><button type="button" class="ghost" id="q-cancel">Abbrechen</button></div>`;
  f.hidden = false; f.dataset.kind = kind;
  const hint = () => { $("q-hint").innerHTML = quickHint(kind); };
  f.querySelectorAll("input,select").forEach(el => el.addEventListener("input", hint));
  f.querySelectorAll("select,input[type=date]").forEach(el => el.addEventListener("change", hint));
  hint();
  $("q-cancel").onclick = () => { f.hidden = true; };
  $("q-save").onclick = () => saveQuick(kind);
  f.scrollIntoView({ behavior: "smooth", block: "start" });
  const first = f.querySelector('input[inputmode]'); if (first) first.focus({ preventScroll: true });
}
function quickHint(kind) {
  const d = $("q-d")?.value;
  if (kind === "reading") { const r = lastReading($("q-m").value, d), v = parseNum($("q-v").value);
    if (!r) return "Erster Stand für diesen Zähler.";
    let s = `Vorheriger Stand: ${nf(r.v)} kWh am ${dde(r.d)}.`;
    if (isFinite(v) && d > r.d) s += ` Verbrauch seitdem ${nf(v - r.v)} kWh (${nf((v - r.v) / diffDays(r.d, d), 1)} kWh/Tag).`;
    return s; }
  if (kind === "fuel") { const o = lastOdo("leon", d), l = parseNum($("q-l").value), e = parseNum($("q-e").value), km = parseNum($("q-km").value);
    const parts = []; if (o) parts.push(`Letzter Kilometerstand: ${nf(o.km)} km am ${dde(o.d)}${isFinite(km) && km > o.km ? ` (+${nf(km - o.km)} km)` : ""}.`);
    if (isFinite(l) && isFinite(e) && l > 0) parts.push(`${nf(e / l, 3)} €/l.`); return parts.join(" "); }
  if (kind === "charge") { const k = parseNum($("q-k").value), e = parseNum($("q-e").value), o = lastOdo("tavascan", d);
    const parts = []; if (o) parts.push(`Letzter Kilometerstand: ${nf(o.km)} km am ${dde(o.d)}.`);
    if (isFinite(k) && isFinite(e) && k > 0) parts.push(`${nf(e / k, 3)} €/kWh.`); return parts.join(" "); }
  if (kind === "payment") { const g = $("q-pg").value, a = C.abschlagAt(g, d || today()); if ($("q-pk").value === "abschlag" && !$("q-pa").value) $("q-pa").placeholder = String(a || ""); return $("q-pk").value === "abschlag" ? `Laut Abschlagsplan: ${eur(a, 2)} pro Monat.` : ""; }
  const o = lastOdo($("q-car").value, d); return o ? `Letzter Kilometerstand: ${nf(o.km)} km am ${dde(o.d)}.` : "";
}
async function saveQuick(kind) {
  const err = t => { $("q-err").textContent = t; $("q-err").hidden = false; };
  $("q-err").hidden = true;
  const d = $("q-d").value; if (!d) return err("Datum angeben.");
  let obj, label;
  if (kind === "reading") {
    const m = $("q-m").value, v = parseNum($("q-v").value);
    if (!isFinite(v) || v < 0) return err("Stand als Zahl angeben.");
    const r = lastReading(m, d);
    if (r && v < r.v && !confirm(`Der Stand ist kleiner als der vorherige (${nf(r.v)} kWh am ${dde(r.d)}). Zählertausch oder Tippfehler? Trotzdem speichern?`)) return;
    lsSet("eb_q_meter", m);
    obj = S.readings.find(x => x.m === m && x.d === d);
    if (obj) obj.v = v; else { obj = { m, d, v, src: "Eingabe" }; S.readings.push(obj); }
    label = `${esc(S.meters.find(x => x.id === m)?.name || m)}: ${nf(v)} kWh`;
  } else if (kind === "fuel") {
    const km = parseNum($("q-km").value), l = parseNum($("q-l").value), e = parseNum($("q-e").value);
    if (!(km > 0) || !(l > 0) || !(e > 0)) return err("Kilometerstand, Liter und Betrag angeben.");
    const o = lastOdo("leon", d); if (o && km <= o.km && !confirm(`Kilometerstand ist nicht höher als der letzte (${nf(o.km)} km am ${dde(o.d)}). Trotzdem speichern?`)) return;
    obj = { d, km, l, e, s: $("q-s").value, full: $("q-full").checked }; S.fuel.push(obj);
    label = `Tankvorgang ${nf(l, 2)} l · ${nf(e, 2)} €`;
  } else if (kind === "charge") {
    const k = parseNum($("q-k").value), e = parseNum($("q-e").value), km = parseNum($("q-km").value);
    if (!(k > 0)) return err("kWh angeben.");
    obj = { d, km: km > 0 ? km : null, k, e: isFinite(e) ? e : 0, o: $("q-o").value }; S.charges.push(obj);
    label = `Ladevorgang ${nf(k, 1)} kWh`;
  } else if (kind === "payment") {
    let a = parseNum($("q-pa").value); if (!isFinite(a) && $("q-pk").value === "abschlag") a = parseNum($("q-pa").placeholder);
    if (!(a > 0)) return err("Betrag angeben.");
    obj = { group: $("q-pg").value, d, amount: a, kind: $("q-pk").value, note: $("q-pn").value }; (S.payments = S.payments || []).push(obj);
    label = `${KIND_LABEL[obj.kind]} ${GRP_LABEL[obj.group]} ${nf(a, 2)} €`;
  } else {
    const km = parseNum($("q-km").value), e = parseNum($("q-e").value);
    if (!(km > 0) && !isFinite(e)) return err("Kilometerstand oder Betrag angeben.");
    obj = { d, car: $("q-car").value, cat: $("q-cat").value, km: km > 0 ? km : null, e: isFinite(e) ? e : 0, note: $("q-n").value }; S.carlog.push(obj);
    label = `Fahrzeugbuch: ${esc(obj.cat)}`;
  }
  $("q-save").disabled = true;
  const r = await write(kind, obj);
  $("q-form").hidden = true;
  $("q-msg").innerHTML = r === "error" ? "" : flag(r === "queued" ? `Offline gespeichert: ${label}. Wird gesendet, sobald wieder Netz da ist.` : `Gespeichert: ${label}.`, true);
  renderQuick();
}

/* ---------- v0.7: Zahlungsbuch, Abrechnung prüfen, Boni-Posten, Gesamtbilanz, Tarifrechner, Zähler-Linie ---------- */
const KIND_LABEL = { abschlag: "Abschlag", erstattung: "Erstattung", bonus: "Bonus", nachzahlung: "Nachzahlung" };
const GRP_LABEL = { as: "Allgemeinstrom", wp: "Wärmepumpe" };

// Netzbezug laut Allgemeinstrom-Zähler je Balken der Überblick-Grafik (Tageswerte aus den Ablesungen, siehe Zählerlogik)
function meterGrid(sr, from, to) {
  const out = {}; let any = false;
  for (const [d, k] of Object.entries(C.groupSeries("as").daily)) { if (d < from || d > to) continue; const key = bucketOf(d, sr.g); out[key] = (out[key] || 0) + k; any = true; }
  return sr.ks.map(k => (any && out[k] != null ? out[k] : null));
}

function bonusOptions(g) {
  return S.tariffs.filter(t => t.group === g).flatMap(t => { const its = C.boniInfo(t).items; return (its.length ? its : [{ name: "Bonus" }]).map(i => `${t.name}: ${i.name}`); });
}
function renderPayments() {
  const g = $("pay-g").value || "as", k = $("pay-k").value;
  $("pay-bonus").innerHTML = bonusOptions(g).map(o => `<option>${esc(o)}</option>`).join("");
  $("pay-bonus-wrap").hidden = k !== "bonus";
  $("pay-a").placeholder = k === "abschlag" ? String(C.abschlagAt(g, today()) || "") : "";
  const rows = [...(S.payments || [])].sort((a, b) => b.d.localeCompare(a.d));
  $("pay-tbl").innerHTML = rows.length
    ? `<thead><tr><th>Datum</th><th class="l">Zählpunkt</th><th class="l">Art</th><th>Betrag</th><th class="l">Notiz</th><th></th></tr></thead><tbody>${
      rows.map(p => `<tr><td>${dde(p.d)}</td><td class="l">${GRP_LABEL[p.group] || esc(p.group)}</td><td class="l">${KIND_LABEL[p.kind] || esc(p.kind)}</td><td>${eur(p.amount, 2)}</td><td class="l">${esc(p.note || "")}</td><td><button class="x" data-del-pay="${p.id}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="l" style="color:var(--muted)">Noch keine Zahlungen. „Vorschlag übernehmen“ legt die geplanten Abschläge aus dem Abschlagsplan an; danach nur Abweichungen korrigieren.</td></tr></tbody>`;
  const sug = C.paymentSuggestions(today());
  $("pay-suggest").textContent = sug.length ? `Vorschlag übernehmen (${sug.length} Abschläge, ${eur(sug.reduce((a, x) => a + x.amount, 0))})` : "Keine offenen Vorschläge";
  $("pay-suggest").disabled = !sug.length;
}
function renderBilling() {
  const t0 = today(), rows = [];
  for (const g of ["as", "wp"]) for (const P of C.billingPeriods(g, t0)) rows.push({ g, P });
  const res = P => {
    if (P.settled) { const d = P.diff; return Math.abs(d) < 5 ? `<span class="ok">passt (${d >= 0 ? "+" : "−"}${eur(Math.abs(d), 2)})</span>` : `<span class="warn">${eur(Math.abs(d), 2)} ${d > 0 ? "mehr gezahlt" : "weniger gezahlt"} als berechnet</span>`; }
    if (!P.closed) return "läuft";
    if (!P.nAbschlag) return "Zahlungen fehlen";
    return `erwartet: ${P.expectedSettlement >= 0 ? "Erstattung" : "Nachzahlung"} ${eur(Math.abs(P.expectedSettlement))}`;
  };
  $("bill-tbl").innerHTML = rows.length ? `<thead><tr><th>Abrechnungsjahr</th><th class="l">Vertrag</th><th>kWh</th><th>Kosten</th><th>Boni</th><th>Kosten netto</th><th>Abschläge</th><th>Erstattung</th><th>Nachzahlung</th><th>Boni erhalten</th><th class="l">Ergebnis</th></tr></thead><tbody>${
    rows.map(({ g, P }) => `<tr><td>${dde(P.from)} – ${dde(P.to)}</td><td class="l">${GRP_LABEL[g]}: ${esc(P.t.name)}</td><td>${nf(P.kwh)}</td><td>${eur(P.cost)}</td><td>−${eur(P.boniContract)}</td><td>${eur(P.netCost)}</td><td>${eur(P.abschlag)} (${P.nAbschlag})</td><td>${P.erstattung ? eur(P.erstattung) : "–"}</td><td>${P.nachzahlung ? eur(P.nachzahlung) : "–"}</td><td>${P.bonus ? eur(P.bonus) : "–"}</td><td class="l">${res(P)}</td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="l" style="color:var(--muted)">Keine Tarife hinterlegt.</td></tr></tbody>`;
}
function renderBoni() {
  const ts = [...S.tariffs].sort((a, b) => a.group.localeCompare(b.group) || a.from.localeCompare(b.from));
  const got = (t, i) => (S.payments || []).filter(p => p.kind === "bonus" && p.group === t.group && (p.note || "").startsWith(`${t.name}: ${i.name}`));
  const inp = (t, k, key, v, w, mode = "decimal", ph = "") => `<input type="text" inputmode="${mode}" value="${esc(v ?? "")}" data-bi="${t.id}" data-i="${k}" data-k="${key}" style="width:${w}px" placeholder="${ph}">`;
  $("boni-tbl").innerHTML = `<thead><tr><th class="l">Vertrag</th><th class="l">Bonus</th><th>Betrag €</th><th class="l">Bedingung im 1. Vertragsjahr</th><th>Wirksam</th><th class="l">Erhalten</th><th></th></tr></thead><tbody>${ts.map(t => {
    const bi = C.boniInfo(t);
    if (!bi.items.length) return `<tr><td class="l">${esc(t.name)}</td><td class="l" style="white-space:normal">${esc(t.boniNote || "–")}</td><td>${eur(+t.boni || 0, 2)}</td><td class="l">–</td><td>${eur(bi.effective, 2)}</td><td class="l">–</td><td><button type="button" class="ghost" data-boni-parse="${t.id}">In Posten aufteilen</button></td></tr>`;
    return bi.items.map((i, k) => { const r = got(t, i), sum = r.reduce((a, p) => a + p.amount, 0);
      return `<tr><td class="l">${k === 0 ? esc(t.name) : ""}</td><td class="l"><input type="text" value="${esc(i.name)}" data-bi="${t.id}" data-i="${k}" data-k="name" style="min-width:150px"></td><td>${inp(t, k, "amount", i.amount, 80)}</td>
        <td class="l">ab ${inp(t, k, "minKwh", i.minKwh || "", 70, "numeric", "–")} kWh, sonst ${inp(t, k, "amountBelow", i.amountBelow ?? "", 60, "decimal", "–")} €${i.cond ? ` <span class="pill">${i.met ? "erfüllt" : "nicht erfüllt"}: ${nf(bi.kwh)} kWh</span>` : ""}</td>
        <td>${eur(i.effective, 2)}</td><td class="l">${r.length ? `${eur(sum, 2)} am ${r.map(p => dde(p.d)).join(", ")}` : "offen"}</td><td><button type="button" class="x" data-bi-del="${t.id}" data-i="${k}" aria-label="Löschen">×</button></td></tr>`; }).join("")
      + `<tr><td></td><td class="l" colspan="6"><button type="button" class="ghost" data-bi-add="${t.id}">Posten hinzufügen</button> <span class="note">Summe ${eur(bi.total, 2)}, wirksam ${eur(bi.effective, 2)}</span></td></tr>`;
  }).join("")}</tbody>`;
}
function renderBalance(P, Cp) {
  const a = C.energyBalance(P.from, P.to), b = Cp ? C.energyBalance(Cp.from, Cp.to) : null;
  const rows = [["Ersparnis durch PV (vermiedene Netzkosten)", "pv"], ["Tarifwechsel Allgemeinstrom (ggü. Vorvertrag)", "switchAs"], ["Tarifwechsel Wärmepumpe (ggü. Vorvertrag)", "switchWp"],
    ["Boni Allgemeinstrom (anteilig)", "boniAs"], ["Boni Wärmepumpe (anteilig)", "boniWp"], ["Gesamt", "total"]];
  $("bal-tbl").innerHTML = `<thead><tr><th>Position</th><th>${esc(P.label)}</th>${b ? `<th>${esc(Cp.label)}</th>` : ""}</tr></thead><tbody>${
    rows.map(([l, k]) => `<tr${k === "total" ? ' style="font-weight:700"' : ""}><td>${l}</td><td>${fmtM(a[k], "eur")}</td>${b ? `<td>${fmtM(b[k], "eur")}</td>` : ""}</tr>`).join("")}</tbody>`;
}

const TR_FIELDS = [["m1Eur", "Modul 1: Pauschale €/Jahr"], ["neAp", "Netzentgelt Arbeitspreis ct/kWh (Modul 2)"], ["m2MeterEur", "Modul 2: Kosten eigener Zähler €/Jahr"],
  ["neHt", "Modul 3: Netzentgelt Hochtarif ct/kWh"], ["neSt", "Modul 3: Standardtarif ct/kWh"], ["neNt", "Modul 3: Niedertarif ct/kWh"],
  ["shNt", "Anteil Laden im Niedertarif %"], ["shHt", "Anteil Laden im Hochtarif %"], ["imsysNew", "Intelligentes Messsystem €/Jahr"], ["imsysOld", "Bisheriger Zähler €/Jahr"]];
function renderTarif() {
  const p = S.tarif = S.tarif || {}; if (p.withEv === undefined) p.withEv = true; p.offers = p.offers || [];
  const base = C.tariffBase(), cur = { as: C.currentTariff("as"), wp: C.currentTariff("wp") }, r = tarifRechner(base, cur, p), ev = S.cars.ev || {};
  $("tr-base").innerHTML = kpi(kwh(base.asKwh), "Allgemeinstrom aus dem Netz", base.to ? `365 Tage bis ${dde(base.to)}` : "")
    + kpi(kwh(base.wpKwh), "Wärmepumpe", "365 Tage laut Zähler")
    + kpi(kwh(base.evGrid), "E-Auto zu Hause aus dem Netz", `aus „Auto-Vergleich“: ${kwh(base.evYear)} im Jahr, ${nf(+ev.shHome || 0)} % zu Hause, davon ${nf(+ev.shPV || 0)} % aus PV`);
  $("tr-withev").checked = !!p.withEv;
  const row = (g, o, isCur) => `<tr><td class="l">${isCur ? `<b>${esc(o.name)}</b> <span class="pill">aktuell</span>` : `<input type="text" value="${esc(o.name || "")}" data-tro="${o.idx}" data-k="name" style="min-width:150px">`}</td>
    <td class="l">${isCur ? GRP_LABEL[g] : `<select data-tro="${o.idx}" data-k="grp"><option value="as" ${g === "as" ? "selected" : ""}>Allgemeinstrom</option><option value="wp" ${g === "wp" ? "selected" : ""}>Wärmepumpe</option></select>`}</td>
    ${["ap", "gp", "boni"].map(k => `<td>${isCur ? nf(+cur[g][k] || 0, 2) : `<input type="text" inputmode="decimal" value="${esc(o[k] ?? "")}" data-tro="${o.idx}" data-k="${k}" style="width:80px">`}</td>`).join("")}
    <td>${eur(o.y1)}</td><td>${eur(o.y2)}</td><td>${isCur ? "–" : `<span style="color:${o.diffY2 < 0 ? "var(--ok)" : "var(--warn)"}">${o.diffY2 < 0 ? "−" : "+"}${eur(Math.abs(o.diffY2))}</span>`}</td>
    <td>${isCur ? "" : `<button type="button" class="x" data-tro-del="${o.idx}" aria-label="Löschen">×</button>`}</td></tr>`;
  $("tr-offers").innerHTML = `<thead><tr><th class="l">Tarif</th><th class="l">Zählpunkt</th><th>ct/kWh</th><th>Grundpreis €/Jahr</th><th>Boni €</th><th>Jahr 1 (mit Boni)</th><th>ab Jahr 2</th><th>ggü. aktuell ab Jahr 2</th><th></th></tr></thead><tbody>${
    ["as", "wp"].map(g => { const G = r.groups[g]; return (G.current ? row(g, { ...G.current, idx: -1 }, true) : "") + G.offers.map(o => row(g, o, false)).join(""); }).join("")}</tbody>`;
  $("tr-note").textContent = `Verbrauchsbasis: Allgemeinstrom ${kwh(r.kwh.as)}${p.withEv ? " inkl. E-Auto" : ""}, Wärmepumpe ${kwh(r.kwh.wp)} pro Jahr. Boni zählen nur im ersten Jahr.`;
  if (!$("tr-params").children.length) $("tr-params").innerHTML = TR_FIELDS.map(([k, l]) => `<label class="f">${l}<input type="text" inputmode="decimal" data-tr="${k}"></label>`).join("");
  $("tr-params").querySelectorAll("[data-tr]").forEach(el => { if (document.activeElement !== el) el.value = p[el.dataset.tr] ?? ""; });
  $("tr-wallbox").innerHTML = `<thead><tr><th class="l">Variante</th><th>Kosten Laden €/Jahr</th><th>ggü. ohne §14a</th><th class="l">Hinweis</th></tr></thead><tbody>${
    r.wallbox.map(w => `<tr${w.key === r.best.key ? ' style="font-weight:700"' : ""}><td class="l">${w.name}${w.key === r.best.key ? ' <span class="pill">günstigste</span>' : ""}</td><td>${eur(w.eur)}</td><td>${w.key === "none" ? "–" : Math.abs(w.vsNone) < 0.5 ? "±0 €" : `${w.vsNone < 0 ? "−" : "+"}${eur(Math.abs(w.vsNone))}`}</td><td class="l" style="white-space:normal">${w.note}</td></tr>`).join("")}</tbody>`;
  const missing = ["m1Eur", "neAp", "neSt", "neNt"].some(k => !+p[k]);
  $("tr-hint").innerHTML = (missing ? flag("Für ein belastbares Ergebnis die Werte deines Netzbetreibers eintragen (Preisblatt „Netzentgelte“, Abschnitt steuerbare Verbrauchseinrichtungen nach §14a EnWG). Solange Felder leer sind, zählen sie als 0.", true) : "")
    + (r.imsysBreakEven != null ? `<p class="note">Das intelligente Messsystem kostet ${eur(r.imsysExtra)} pro Jahr mehr; Modul 3 spart durch zeitvariable Netzentgelte ${eur(r.m3Shift)} pro Jahr.</p>` : "");
}

/* Zahlung auf der Seite „Erfassen“ */
function quickPaymentFields(today) {
  return `<label class="f">Zählpunkt<select id="q-pg"><option value="as">Allgemeinstrom</option><option value="wp">Wärmepumpe</option></select></label>`
    + `<label class="f">Art<select id="q-pk">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>`
    + `<label class="f">Datum<input type="date" id="q-d" value="${today}"></label>`
    + `<label class="f">Betrag in €<input type="text" inputmode="decimal" autocomplete="off" id="q-pa"></label>`
    + `<label class="f wide">Notiz<input type="text" id="q-pn"></label>`;
}

/* ---------- Ausbau-Szenario „Weg B“ (v0.8) ---------- */
const WB_FIELDS = {
  "wb-cost": [["hwTotal", "Hardware gesamt € (inkl. Wallbox)"], ["hwWallbox", "davon Wallbox €"], ["craftPv", "Handwerker PV/Speicher €"],
    ["craftWallbox", "Handwerker Wallbox inkl. Anmeldung €"], ["start", "Inbetriebnahme", "date"],
    ["alt", "Alternative ohne Wallbox", [["public", "Öffentlich laden"], ["socket", "Steckdose in der Garage"]]], ["socketEur", "Kosten Steckdose € (nur Alternative Steckdose)"]],
  "wb-plant": [["pvAddWp", "Zusätzliche PV-Leistung Wp"], ["yieldPct", "Ertrag neue Module % (Ausrichtung)"], ["storeAddKwh", "Zusätzlicher Speicher kWh"],
    ["storeUsablePct", "Davon nutzbar %"]],
  "wb-use": [["acKwh", "Klimaanlage kWh pro Sommer (Jun–Aug)"], ["feedCt", "Einspeisevergütung ct/kWh"],
    ["apPvCt", "Wert Solarstrom im Haus ct/kWh (leer = aktueller Arbeitspreis)"], ["apEvCt", "Preis Laden zu Hause ct/kWh (leer = aktueller Arbeitspreis; dynamisch: Ø der Ladestunden)"],
    ["evDayPct", "Auto tagsüber zu Hause: Anteil Laden aus Überschuss %"], ["battEv", "Auto abends aus dem Speicher laden (Phasenumschaltung, Speicher-Steuerung)", "check"],
    ["dayLoadPct", "Anteil Hauslast tagsüber %"], ["years", "Betrachtungsdauer Jahre"]],
  "wb-14a": [["s14a", "§14a einrechnen", "check"], ["s14aMod", "Quelle", [["manual", "Eigener Betrag"], ["m1", "Modul 1 aus Tarifrechner"], ["m2", "Modul 2 aus Tarifrechner"], ["m3", "Modul 1 + 3 aus Tarifrechner"]]],
    ["s14aEur", "Eigener Betrag €/Jahr"]],
};
function renderAusbau() {
  const p = S.ausbau = S.ausbau || {}, today = iso(new Date()), base = C.ausbauBase(), v = k => (p[k] ?? AUSBAU_DEFAULTS[k]);
  for (const [host, fields] of Object.entries(WB_FIELDS)) {
    const h = $(host);
    if (!h.children.length) h.innerHTML = fields.map(([k, l, t]) => t === "check" ? `<label class="f check wide"><input type="checkbox" data-wb="${k}"> ${l}</label>`
      : Array.isArray(t) ? `<label class="f">${l}<select data-wb="${k}">${t.map(([o, ol]) => `<option value="${o}">${ol}</option>`).join("")}</select></label>`
      : `<label class="f">${l}<input type="${t === "date" ? "date" : "text"}" ${t === "date" ? "" : 'inputmode="decimal"'} data-wb="${k}"></label>`).join("");
    h.querySelectorAll("[data-wb]").forEach(el => { if (document.activeElement === el) return; const k = el.dataset.wb;
      if (el.type === "checkbox") el.checked = !!v(k); else if (el.type === "date") el.value = v(k) || today;
      else if (el.tagName === "SELECT") el.value = v(k); else { const x = v(k); el.value = x === "" || x == null ? "" : nf(+x, +x % 1 ? 2 : 0).replace(/\./g, ""); } });
  }
  $("wb-cost").querySelector('[data-wb="socketEur"]').closest("label").hidden = v("alt") !== "socket";
  $("wb-14a").querySelectorAll('[data-wb="s14aMod"],[data-wb="s14aEur"]').forEach(el => el.closest("label").hidden = !v("s14a"));
  $("wb-14a").querySelector('[data-wb="s14aEur"]').closest("label").hidden = !v("s14a") || v("s14aMod") !== "manual";
  // §14a-Ersparnis je Modul mit dem Netzladen des Szenarios (Werte des Netzbetreibers aus dem Tarifrechner)
  const r0 = ausbauRechner(base, p, today);
  const tr = tarifRechner({ ...C.tariffBase(), evGrid: r0.kwh.evGrid }, { as: C.currentTariff("as"), wp: C.currentTariff("wp") }, S.tarif || {});
  const m14a = Object.fromEntries(tr.wallbox.filter(w => w.key !== "none").map(w => [w.key, -w.vsNone]));
  const r = ausbauRechner(base, p, today, m14a), y = r.year, nc = r.noCar, N = +v("years") || 20;
  const pb = (h, inv) => h ? `${nf(h.years, 1)} Jahre` : "–";
  const pbSub = (h, inv) => h ? `${monthLabel(h.date.slice(0, 7))}, Investition ${eur(inv)}` : `nicht innerhalb von ${N} Jahren (Investition ${eur(inv)})`;
  $("wb-kpis").innerHTML = kpi(pb(r.payback.total), "Paket amortisiert nach", pbSub(r.payback.total, r.invest.total))
    + kpi(eur(y.total), "Vorteil pro Jahr mit E-Auto", `vor Übergabe des Autos ${eur(nc.total)} pro Jahr`)
    + kpi(pb(r.payback.pv), "Anteil PV und Speicher", pbSub(r.payback.pv, r.invest.pv))
    + kpi(pb(r.payback.wallbox), "Anteil Wallbox", pbSub(r.payback.wallbox, r.invest.wallbox));
  const alt = v("alt") === "public" ? "öffentlich" : "per Steckdose";
  const rows = [
    ["Solarstrom im Haus (inkl. Klimaanlage)", r.kwh.house, nc.houseKwh, nc.house, y.house],
    ["E-Auto lädt Solarstrom", r.kwh.pvEv, null, null, y.carPv],
    [`Wallbox: zu Hause statt ${alt} laden`, r.kwh.evHome, null, null, y.wallbox],
    ["§14a Netzentgelt-Reduzierung", null, null, null, y.s14a],
    ["Mehr Einspeisung", r.kwh.feed, nc.feedKwh, nc.feed, y.feed],
  ];
  const k0 = x => x == null ? "–" : kwh(x);
  $("wb-tbl").innerHTML = `<thead><tr><th>Posten</th><th>kWh/Jahr mit Auto</th><th>vor Übergabe Auto</th><th>mit E-Auto</th></tr></thead><tbody>${
    rows.map(([l, k, , a, b]) => `<tr><td>${l}</td><td>${k0(k)}</td><td>${a == null ? "–" : eur(a)}</td><td>${eur(b)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Gesamt</td><td></td><td>${eur(nc.total)}</td><td>${eur(y.total)}</td></tr></tfoot>`;
  const fl = [];
  if (!(r.invest.total > 0)) fl.push(flag("Noch keine Kosten eingetragen: unten unter „Kosten“ Hardware und Handwerker aus dem Angebot eintragen, sonst ist die Amortisation 0 Jahre."));
  if (v("s14a") && v("s14aMod") !== "manual" && !(m14a[v("s14aMod")] > 0)) fl.push(flag("§14a: Im Tarifrechner fehlen die Werte deines Netzbetreibers, deshalb zählt das Modul mit 0 €. Werte dort eintragen oder „Eigener Betrag“ wählen."));
  if (v("s14a") && v("s14aMod") === "manual") fl.push(flag("§14a mit eigenem Betrag: Schätzwert, bis die Werte des Netzbetreibers im Tarifrechner stehen.", true));
  if (v("alt") === "socket") fl.push(flag("Alternative Steckdose: Laden zu Hause wäre auch ohne Wallbox möglich, der Wallbox-Anteil bringt dann nur noch §14a. Die Kosten der Steckdose sind von der Wallbox-Investition abgezogen.", true));
  fl.push(flag("Nach dem Einbau verfolgt die Seite „Amortisation“ die echten Werte: Rechnungen dort mit Kategorie PV/Speicher bzw. Wallbox eintragen, Laden zu Hause unter „Erfassen → Laden“ (Ort „zu Hause“).", true));
  $("wb-flags").innerHTML = fl.join("");
  const lab = r.months.map(m => monthLabel(m.d.slice(0, 7)));
  const line = (label, data, c, dash, w = 2) => ({ label, data, borderColor: css(c), backgroundColor: css(c), pointRadius: 0, borderWidth: w, ...(dash ? { borderDash: [5, 4] } : {}) });
  chart("wb-chart", { type: "line", data: { labels: lab, datasets: [
    line("Vorteil Paket", r.months.map(m => m.cum), "--sun", false, 2.5), line("Investition Paket", lab.map(() => r.invest.total), "--ink", false, 1.5),
    line("Vorteil PV/Speicher", r.months.map(m => m.cumPv), "--batt", false), line("Investition PV/Speicher", lab.map(() => r.invest.pv), "--batt", true, 1.5),
    line("Vorteil Wallbox", r.months.map(m => m.cumWb), "--grid", false), line("Investition Wallbox", lab.map(() => r.invest.wallbox), "--grid", true, 1.5)] },
    options: { plugins: { tooltip: numTip("€") }, scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: "€" } } } } });
  $("wb-method").innerHTML = `<p class="note">Grundlage: ${dde(base.from)} bis ${dde(base.to)}. Tageslast = genutzter Solarstrom + Netzbezug Allgemeinstrom laut Zähler; ${nf(+v("dayLoadPct"))} % davon tagsüber, der Rest abends und nachts.
    Solarstrom geht zuerst ins Haus, dann in die Klimaanlage (Juni–August), dann ins Auto, dann in den Speicher (Wirkungsgrad ${pct(r.eta)} aus den Anker-Daten), der Rest wird eingespeist.
    PV-Erzeugung skaliert mit Faktor ${nf(r.scale, 2)}, nutzbarer Speicher ${nf(r.usable, 1)} kWh. Das Modell der heutigen Anlage liegt um ${pct(Math.abs(1 - r.K))} ${r.K < 1 ? "über" : "unter"} dem gemessenen genutzten Solarstrom; alle Mehrwerte sind damit korrigiert (Faktor ${nf(r.K, 2)}).</p>
    <p class="note">Nicht abgebildet: Stundenverläufe (es gibt nur Tageswerte), Abregelung bei hoher Leistung, negative Börsenpreise (Solarspitzengesetz: keine Vergütung, ohne Smart Meter Einspeisung auf 60 % begrenzt), Alterung des Speichers, Ladeverluste. Die Wallbox braucht einphasiges Laden bzw. Phasenumschaltung, damit der Speicher mit seiner begrenzten Ausgangsleistung das Auto nennenswert laden kann. THG-Prämie nicht enthalten.</p>`;
}

/* ---------- E-Auto zu Hause und Abschlag-Hinweis (v0.9) ---------- */
const INV_CATS = [["pv", "PV/Speicher"], ["wallbox", "Wallbox"], ["other", "Sonstiges"]];
function renderEvHome() {
  const tb = C.tariffBase(), e = S.cars.ev || {}, h = tb.to ? C.homeCharging(tb.from, tb.to) : { kwh: 0, saving: 0 }, all = C.homeCharging("0000", "9999");
  $("evh-kpis").innerHTML = kpi(kwh(h.kwh), "Geladen zu Hause", tb.to ? `365 Tage bis ${dde(tb.to)}, laut Ladebuch` : "")
    + kpi(kwh(tb.homeGrid), "davon aus dem Netz (geschätzt)", `PV-Anteil ${nf(+e.shPV || 0)} % laut Auto-Vergleich`)
    + kpi(kwh(tb.asKwh), "Allgemeinstrom ohne E-Auto", `Zähler ${kwh(tb.asMeter)} minus Netzanteil Auto`)
    + kpi(eur(all.saving), "Ersparnis gegenüber öffentlich", `alle ${kwh(all.kwh)} zu Hause, ${nf(+e.pricePublic || 0, 2)} €/kWh öffentlich`);
  const hint = C.evAbschlagHint();
  $("ab-ev").innerHTML = hint ? flag(`E-Auto ab ${dde(hint.from)}: Es lädt über den Allgemeinstrom, voraussichtlich etwa ${kwh(hint.kwhMonth)} pro Monat aus dem Netz, rund ${eur(hint.eurMonth)} pro Monat mehr. Die Hochrechnung oben enthält das erst, wenn Zählerstände nach der Übergabe vorliegen – Abschlag rechtzeitig um diesen Betrag erhöhen.`) : "";
}

/* ---------- Wetter (v0.10) ---------- */
const deg = (v, d = 1) => v == null ? "–" : nf(v, d) + " °C";
let wxMsg = "", wxAutoDone = false, wxHits = [];
function renderWxData() {
  const c = S.wx || {}, w = S.weather || [];
  if (document.activeElement !== $("wx-q")) $("wx-q").value = c.name || "";
  [["wx-hl", "heatLimit", 15], ["wx-room", "room", 20]].forEach(([id, k, d]) => { if (document.activeElement !== $(id)) $(id).value = nf(c[k] ?? d, 1).replace(/,0$/, ""); });
  $("wx-pick-wrap").hidden = !wxHits.length;
  $("wx-status").innerHTML = (S.weatherError ? flag("Wetter-Tabelle fehlt noch in Supabase: bitte <b>docs/UPDATE_V10.sql</b> im SQL Editor ausführen. Bis dahin läuft die App ohne Wetter.") : "")
    + `<p class="note">${c.lat != null ? `Standort: <b>${esc(c.name || "")}</b> (${nf(c.lat, 2)} / ${nf(c.lon, 2)}). ` : "Noch kein Standort gewählt. "}${w.length ? `${nf(w.length)} Wettertage gespeichert, ${dde(w[0].d)} bis ${dde(w[w.length - 1].d)}.` : "Noch keine Wetterdaten."}</p>`
    + (wxMsg ? `<p class="note">${wxMsg}</p>` : "");
}
function wireWeather() {
  $("wx-search").addEventListener("click", async () => {
    const q = $("wx-q").value.trim(); if (!q) return;
    try { wxHits = await geocode(q); wxMsg = wxHits.length ? "" : "Kein Ort gefunden."; }
    catch (e) { wxHits = []; wxMsg = "Ortssuche fehlgeschlagen: " + esc(e.message); }
    $("wx-pick").innerHTML = `<option value="">Bitte wählen …</option>` + wxHits.map((h, i) => `<option value="${i}">${esc(h.name)}</option>`).join("");
    renderWxData();
  });
  $("wx-pick").addEventListener("change", e => { const h = wxHits[+e.target.value]; if (!h) return;
    S.wx = { ...(S.wx || {}), name: h.name, lat: h.lat, lon: h.lon }; wxHits = []; persist(); rerender(); syncWeather(false); });
  [["wx-hl", "heatLimit"], ["wx-room", "room"]].forEach(([id, k]) => $(id).addEventListener("change", e => {
    const v = parseNum(e.target.value); S.wx = S.wx || {}; if (isFinite(v)) S.wx[k] = v; else delete S.wx[k]; persist(); rerender(); }));
  $("wx-sync").addEventListener("click", () => syncWeather(false));
}
// Fehlende Tage seit dem frühesten Datum (Anker oder Zählerstand Wärmepumpe) bis gestern holen und speichern
export async function syncWeather(auto) {
  if (!S || !store?.saveWeather) return;
  const c = S.wx || {}; if (c.lat == null || S.weatherError || document.body.classList.contains('ro')) return;
  if (auto && wxAutoDone) return; wxAutoDone = true;
  const today = iso(new Date()), yest = addDaysIso(today, -1);
  const wpFirst = C.groupSeries("wp").first, first = [A.dates[0], wpFirst].filter(Boolean).sort()[0];
  const have = new Set((S.weather || []).map(w => w.d)), recent = addDaysIso(today, -10);
  let from = null; for (let d = first; d <= yest; d = addDaysIso(d, 1)) if (!have.has(d) || d >= recent) { from = d; break; }
  if (!from) return;
  wxMsg = "Wetter wird geladen …"; if (current === "p-data") renderWxData();
  try {
    const rows = await fetchDays(c.lat, c.lon, from, yest, today);
    if (rows.length) await store.saveWeather(rows);
    const map = new Map((S.weather || []).map(w => [w.d, w]));
    rows.forEach(r => map.set(r.day, { d: r.day, t: +r.temp_mean, rad: +r.rad_kwh, sun: r.sun_h == null ? null : +r.sun_h }));
    S.weather = [...map.values()].sort((a, b) => a.d.localeCompare(b.d));
    wxMsg = `${nf(rows.length)} Tage aktualisiert (${dde(from)} bis ${dde(yest)}).`;
    refreshCalc(); rerender();
  } catch (e) { wxMsg = (e.message === "offline" ? "Offline – Wetter wird beim nächsten Öffnen ergänzt." : "Wetter konnte nicht geladen werden: " + esc(e.message)); if (current === "p-data") renderWxData(); }
}
const addDaysIso = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const noWx = () => flag("Noch keine Wetterdaten: unter „Daten → Wetter“ den Standort wählen.", true);

function renderWxWp() {
  const r = C.wpWeather();
  if (!r) { $("wx-wp").innerHTML = noWx(); $("wx-wp-tbl").innerHTML = ""; chart("wx-wp-chart", { type: "bar", data: { labels: [], datasets: [] } }); return; }
  const G = r.groups, lab = { alt: "Alte Wärmepumpe", neu: "Neue Wärmepumpe", alle: "Wärmepumpe" };
  const kp = Object.entries(G).map(([k, g]) => g ? kpi(kwh(g.year), `${lab[k]}: Jahresverbrauch bei gleichem Wetter`, `Grundlast ${nf(g.base, 1)} kWh/Tag, ${nf(g.k, 2)} kWh je Gradtag, ${g.n} Intervalle${g.r2 != null ? `, R² ${nf(g.r2, 2)}` : ""}`)
    : kpi("–", `${lab[k]}`, "Zu wenige Ableseintervalle mit Wetterdaten (mindestens 3 mit unterschiedlichem Wetter)")).join("");
  const cmp = G.alt?.year && G.neu?.year ? kpi(`${G.neu.year < G.alt.year ? "−" : "+"}${pct(Math.abs(G.neu.year / G.alt.year - 1))}`, "Neu gegenüber alt, wetterbereinigt", `Heizarbeit je Gradtag ${G.neu.k < G.alt.k ? "−" : "+"}${pct(Math.abs(G.neu.k / G.alt.k - 1))}, Grundlast ${G.neu.base < G.alt.base ? "−" : "+"}${pct(Math.abs(G.neu.base / G.alt.base - 1))}`) : "";
  $("wx-wp").innerHTML = `<div class="grid g3" style="margin-top:10px">${kp}${cmp}</div><p class="note">Bezugswetter: ${nf(r.ref.gt)} Gradtage vom ${dde(r.ref.from)} bis ${dde(r.ref.to)} (Heizgrenze ${nf(+r.cfg.heatLimit, 1)} °C, Raum ${nf(+r.cfg.room, 1)} °C).</p>`;
  const { P: WP } = currentPeriods(), inP = x => x.to > WP.from && x.from <= WP.to;   // v0.13: Anzeige im Zeitraum, Modell mit allen Daten
  const iv = r.intervals.filter(x => x.ok && inP(x));
  chart("wx-wp-chart", { type: "bar", data: { labels: iv.map(x => dde(x.to)), datasets: [
    { label: "Verbrauch kWh/Tag", data: iv.map(x => x.kwh / x.days), backgroundColor: css("--heat"), yAxisID: "y" },
    { type: "line", label: "Gradtage je Tag", data: iv.map(x => x.gt / x.days), borderColor: css("--grid"), backgroundColor: css("--grid"), pointRadius: 2, yAxisID: "y1" }] },
    options: { plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.parsed.y, 1)}` } } }, scales: { y: { title: { display: true, text: "kWh/Tag" } }, y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Gradtage/Tag" } } } } });
  const model = x => { const g = G[x.side] || G.alle; return g ? g.base * x.days + g.k * x.gt : null; };
  $("wx-wp-tbl").innerHTML = `<thead><tr><th>Zeitraum</th><th>Tage</th><th>kWh</th><th>kWh/Tag</th><th>Gradtage</th><th>Ø Temperatur</th><th>Modell kWh</th><th class="l">Gerät</th></tr></thead><tbody>${
    [...r.intervals].filter(inP).reverse().map(x => `<tr><td>${dde(x.from)} – ${dde(x.to)}</td><td>${nf(x.days)}</td><td>${nf(x.kwh)}</td><td>${nf(x.kwh / x.days, 1)}</td><td>${x.ok ? nf(x.gt) : "–"}</td><td>${x.ok ? deg(x.tMean) : "–"}</td><td>${x.ok && model(x) != null ? nf(model(x)) : "–"}</td><td class="l">${{ alt: "alt", neu: "neu", gemischt: "Tausch im Intervall", alle: "" }[x.side]}</td></tr>`).join("")}</tbody>`;
}

function renderWxPv() {
  if (!S.weather?.length) { $("wx-pv").innerHTML = noWx(); $("wx-pv-odd").innerHTML = ""; chart("wx-pv-chart", { type: "bar", data: { labels: [], datasets: [] } }); return; }
  const { P } = currentPeriods(), r = C.pvWeather(P.from, P.to), n = C.weatherNote(), y = n?.yoy;
  const sg = v => `${v < 0 ? "−" : "+"}${pct(Math.abs(v))}`;
  $("wx-pv").innerHTML = `<div class="grid g3" style="margin-top:10px">`
    + kpi(r.factor != null ? nf(r.factor, 2) : "–", "Ertragsfaktor im Zeitraum", `kWh je kWp (${nf(r.kwp, 2)}) und kWh/m² Einstrahlung, ${nf(r.days)} Tage`)
    + (y ? kpi(sg(y.gen), "Erzeugung letzte 365 Tage ggü. Vorjahr", `Sonne ${sg(y.rad)}, Anlage (Ertragsfaktor) ${sg(y.f)}`) : kpi("–", "Jahresvergleich", "Braucht zwei volle Jahre mit Anker- und Wetterdaten"))
    + kpi(nf(r.odd.length), "Auffällige Sonnentage", "Sonnig, aber Ertrag unter 75 % des Monatsüblichen")
    + `</div>`;
  // bis 62 Tage je Tag (wie die übrigen Grafiken), sonst je Monat
  const byDay = diffDaysIso(P.from, P.to) <= 62, pts = byDay ? r.list : r.months;
  const lab = byDay ? r.list.map(x => dde(x.d).slice(0, 6)) : r.months.map(m => monthLabel(m.k));
  $("wx-pv-gran").textContent = byDay ? "je Tag" : "je Monat";
  chart("wx-pv-chart", { type: "bar", data: { labels: lab, datasets: [
    { label: "Erzeugung kWh", data: pts.map(m => m.gen), backgroundColor: css("--sun"), yAxisID: "y" },
    { type: "line", label: "Einstrahlung kWh/m²", data: pts.map(m => m.rad), borderColor: css("--grid"), backgroundColor: css("--grid"), pointRadius: 2, yAxisID: "y1" },
    { type: "line", label: "Ertragsfaktor × 100", data: pts.map(m => m.f * 100), borderColor: css("--batt"), backgroundColor: css("--batt"), borderDash: [5, 4], pointRadius: 2, yAxisID: "y1" }] },
    options: { plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.parsed.y, c.datasetIndex === 2 ? 0 : 1)}` } } }, scales: { y: { title: { display: true, text: "kWh" } }, y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "kWh/m² bzw. Faktor × 100" } } } } });
  const top = r.odd.slice(0, 8);
  $("wx-pv-odd").innerHTML = top.length ? `<h2 style="margin-top:18px;font-size:15px">Auffällige Sonnentage</h2><div class="tbl-wrap"><table><thead><tr><th>Tag</th><th>Einstrahlung</th><th>Erzeugung</th><th>Erwartet</th><th>Fehlt</th><th class="l">Hinweis</th></tr></thead><tbody>${
    top.map(x => `<tr><td>${dde(x.d)}</td><td>${nf(x.rad, 1)} kWh/m²</td><td>${kwh(x.gen, 1)}</td><td>${kwh(x.expected, 1)}</td><td>${kwh(x.lost, 1)}</td><td class="l">${x.full ? "Speicher voll – vermutlich Abregelung" : "Wolkenlücken, Verschattung oder Ausfall prüfen"}</td></tr>`).join("")}</tbody></table></div>` : "";
}

function renderOvWeather() {
  const n = C.weatherNote(); if (!n || !n.cur.n) { $("ov-weather").textContent = ""; return; }
  const m = monthLabel(n.month);
  $("ov-weather").textContent = n.prev ? `${m} bis ${dde(A.dates[A.n - 1])}: ${n.cur.rad >= n.prev.rad ? pct(n.cur.rad / n.prev.rad - 1) + " mehr" : pct(1 - n.cur.rad / n.prev.rad) + " weniger"} Sonne als im Vorjahreszeitraum (${nf(n.cur.rad)} gegenüber ${nf(n.prev.rad)} kWh/m²), Ø ${deg(n.cur.t)} (Vorjahr ${deg(n.prev.t)}).`
    : `${m}: ${nf(n.cur.rad)} kWh/m² Sonneneinstrahlung, Ø ${deg(n.cur.t)}.`;
}

const diffDaysIso = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

/* ---------- Wärmepumpe laut Gerät (v0.11) ---------- */
let hpParsed = null, hpMsg = "";
function renderHpImport() {
  const n = (S.hp || []).length, rng = g => { const r = C.hpRows(g); return r.length ? `${r.length} (${r[0].ts.replace("T", " ")} bis ${r[r.length - 1].ts.replace("T", " ")})` : "0"; };
  $("hp-result").innerHTML = (S.hpError ? flag("Tabelle fehlt noch in Supabase: bitte <b>docs/UPDATE_V11.sql</b> im SQL Editor ausführen.") : "")
    + (hpParsed ? `<p class="note">Datei gelesen: ${hpParsed.month.n} Monate, ${hpParsed.day.n} Tage, ${hpParsed.hour.n} Stunden${hpParsed.skipped.empty ? `, ${hpParsed.skipped.empty} leere Zeilen übersprungen` : ""}.</p>
        <div class="row"><button type="button" id="hp-save">${nf(hpParsed.rows.length)} Zeilen speichern</button><button type="button" class="ghost" id="hp-cancel">Abbrechen</button></div>` : "")
    + (hpMsg ? `<p class="note">${hpMsg}</p>` : "")
    + `<p class="note">Gespeichert: Monate ${rng("month")}, Tage ${rng("day")}, Stunden ${rng("hour")}.</p>`;
}
function wireHpImport() {
  $("hp-file").addEventListener("change", async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try { hpParsed = parseHpCsv(await f.text()); hpMsg = ""; } catch (err) { hpParsed = null; hpMsg = esc(err.message); }
    renderHpImport();
  });
  $("hp-result").addEventListener("click", async e => {
    if (e.target.id === "hp-cancel") { hpParsed = null; $("hp-file").value = ""; renderHpImport(); }
    if (e.target.id !== "hp-save" || !hpParsed) return;
    e.target.disabled = true; hpMsg = "Speichert …"; 
    try {
      await store.saveHp(hpParsed.rows);
      const key = r => r.grain + "|" + r.ts, map = new Map((S.hp || []).map(r => [key(r), r]));
      hpParsed.rows.forEach(r => map.set(key(r), r)); S.hp = [...map.values()];
      hpMsg = `${nf(hpParsed.rows.length)} Zeilen gespeichert.`; hpParsed = null; $("hp-file").value = "";
      refreshCalc(); rerender();
    } catch (err) { hpMsg = "Speichern fehlgeschlagen: " + esc(err.message); renderHpImport(); }
  });
}
function renderHp() {
  // v0.13: Kennzahlen, Grafiken und Tabelle für den oben gewählten Zeitraum, Vergleich falls gewählt
  const { P, C: Cp } = currentPeriods(), all = C.hpMonths();
  const noData = () => { $("hp-kpis").innerHTML = ""; $("hp-tbl").innerHTML = ""; $("hp-day-note").textContent = "";
    chart("hp-month", { type: "bar", data: { labels: [], datasets: [] } }); chart("hp-day", { type: "bar", data: { labels: [], datasets: [] } }); };
  if (!all.length) { $("hp-flags").innerHTML = flag("Noch keine Gerätedaten: unter „Daten → Wärmepumpe: App-Export importieren“ die CSV-Datei hochladen.", true); noData(); return; }
  const p = C.hpPeriod(P.from, P.to), c = Cp ? C.hpPeriod(Cp.from, Cp.to) : null;
  if (!p) { $("hp-flags").innerHTML = flag(`Keine Gerätedaten im gewählten Zeitraum. Vorhanden: ${monthLabel(all[0].k)} bis ${monthLabel(all[all.length - 1].k)}.`, true); noData(); return; }
  const cov = q => q.days < q.total || q.estDays ? `Gerätedaten für ${nf(q.days)} von ${nf(q.total)} Tagen${q.estDays ? `, davon ${nf(q.estDays)} aus Monatswerten gleichmäßig verteilt` : ""}.` : "";
  $("hp-flags").innerHTML = [cov(p), c ? (cov(c) ? `Vergleich: ${cov(c)}` : "") : ""].filter(Boolean).map(t => flag(t, true)).join("")
    + (Cp && !c ? flag(`Für den Vergleichszeitraum (${esc(Cp.label)}) gibt es keine Gerätedaten.`, true) : "");
  const dhwDay = q => q.days ? q.elDhw / q.days : null, sh = q => q.el ? q.elDhw / q.el : null;
  const vs = (a, b, f, rel = true) => (c && b != null && a != null) ? ` · ${esc(Cp.label)}: ${f(b)}${rel && b ? ` (${a >= b ? "+" : "−"}${pct(Math.abs(a / b - 1))})` : ""}` : "";
  $("hp-kpis").innerHTML = kpi(kwh(p.el), "Strom Wärmepumpe", `${esc(P.label)}${p.aux ? `, davon Zuheizer ${kwh(p.aux)}` : ""}${vs(p.el, c?.el, kwh)}`)
    + kpi(kwh(p.heat), "Erzeugte Wärme", `Heizung ${kwh(p.heatHeat)}, Warmwasser ${kwh(p.heatDhw)}${vs(p.heat, c?.heat, kwh)}`)
    + kpi(p.cop != null ? nf(p.cop, 2) : "–", "Arbeitszahl", `Wärme ÷ Strom (ohne Kühlung)${vs(p.cop, c?.cop, v => nf(v, 2))}`)
    + kpi(nf(dhwDay(p), 1) + " kWh", "Warmwasser-Strom pro Tag", `Anteil am Strom ${pct(sh(p))}${vs(dhwDay(p), c ? dhwDay(c) : null, v => nf(v, 1) + " kWh")}`);
  const mFrom = P.from.slice(0, 7), mTo = P.to.slice(0, 7), months = all.filter(m => m.k >= mFrom && m.k <= mTo);
  const lab = months.map(m => monthLabel(m.k));
  chart("hp-month", { type: "bar", data: { labels: lab, datasets: [
    { label: "Heizung", data: months.map(m => m.elHeat), backgroundColor: css("--heat"), stack: "s", yAxisID: "y" },
    { label: "Warmwasser", data: months.map(m => m.elDhw), backgroundColor: css("--grid"), stack: "s", yAxisID: "y" },
    { label: "Kühlung", data: months.map(m => m.elCool), backgroundColor: css("--batt"), stack: "s", yAxisID: "y" },
    { type: "line", label: "Zähler", data: months.map(m => m.meter), borderColor: css("--ink"), backgroundColor: css("--ink"), borderDash: [2, 3], pointRadius: 2, yAxisID: "y" },
    { type: "line", label: "Arbeitszahl", data: months.map(m => m.cop), borderColor: css("--sun"), backgroundColor: css("--sun"), pointRadius: 2, yAxisID: "y1" }] },
    options: { plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.parsed.y, c.dataset.yAxisID === "y1" ? 2 : 0)}${c.dataset.yAxisID === "y1" ? "" : " kWh"}` } } },
      scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: "kWh" } }, y1: { position: "right", min: 0, grid: { drawOnChartArea: false }, title: { display: true, text: "Arbeitszahl" } } } } });
  // Tage: ganzer Zeitraum bis 92 Tage, sonst die letzten 90 Tage des Zeitraums mit Daten
  const dEnd = p.to < P.to ? p.to : P.to, dFrom = diffDaysIso(P.from, P.to) <= 92 ? P.from : addDaysIso(dEnd, -89);
  const days = C.hpDayRows(dFrom, dEnd);
  $("hp-day-note").textContent = days.length ? `(${dde(days[0].d)} bis ${dde(days[days.length - 1].d)}${days.some(x => x.est) ? ", teils aus Monatswerten" : ""})` : "(keine Tageswerte)";
  const one = x => ({ ...x, s: hpSumOne(x) });
  const dd = days.map(one);
  chart("hp-day", { type: "bar", data: { labels: dd.map(x => dde(x.d).slice(0, 6)), datasets: [
    { label: "Heizung", data: dd.map(x => x.s.elHeat), backgroundColor: dd.map(x => x.est ? css("--loss") : css("--heat")), stack: "s", yAxisID: "y" },
    { label: "Warmwasser", data: dd.map(x => x.s.elDhw), backgroundColor: dd.map(x => x.est ? css("--grid-soft") : css("--grid")), stack: "s", yAxisID: "y" },
    { type: "line", label: "Außentemperatur", data: dd.map(x => C.W[x.d]?.t ?? x.t_out), borderColor: css("--sun"), backgroundColor: css("--sun"), pointRadius: 0, yAxisID: "y1" }] },
    options: { plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.parsed.y, 1)} ${c.dataset.yAxisID === "y1" ? "°C" : "kWh"}`,
      footer: items => dd[items[0]?.dataIndex]?.est ? "aus Monatswert gleichmäßig verteilt" : "" } } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 12 } }, y: { stacked: true, title: { display: true, text: "kWh" } }, y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "°C" } } } } });
  $("hp-tbl").innerHTML = `<thead><tr><th>Monat</th><th>Strom</th><th>Heizung</th><th>Warmwasser</th><th>Zuheizer</th><th>Wärme</th><th>Arbeitszahl</th><th>Gradtage</th><th>Heizung je Gradtag</th><th>Zähler</th><th>Ø außen</th></tr></thead><tbody>${
    [...months].reverse().map(m => `<tr><td>${monthLabel(m.k)}${m.partial ? " <span class=\"pill\">bis " + dde(C.hpRows("day").filter(d => d.ts.startsWith(m.k)).pop()?.ts || "") + "</span>" : ""}</td><td>${kwh(m.el)}</td><td>${nf(m.elHeat)}</td><td>${nf(m.elDhw)}</td><td>${m.aux ? nf(m.aux, 1) : "–"}</td><td>${kwh(m.heat)}</td><td>${m.cop != null ? nf(m.cop, 2) : "–"}</td><td>${m.gt != null ? nf(m.gt) : "–"}</td><td>${m.heatPerGt != null ? nf(m.heatPerGt, 2) + " kWh" : "–"}</td><td>${m.meter != null ? kwh(m.meter) : "–"}</td><td>${deg(m.tOut)}</td></tr>`).join("")}</tbody>`;
}
