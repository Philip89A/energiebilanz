// Seiten der Energiebilanz. Die render*-Funktionen sind aus reference/energiebilanz_v0.14.html übernommen
// (zweiter <script>-Block), die Rechenfunktionen kommen aus calc.js. Geändert gegenüber der Referenz:
//  - S/A kommen aus setModel(), Ansicht und UI-Auswahl (S.view, S.ui) je Gerät im localStorage
//  - private Details in Texten (Anbieter, Daten, Geräteaufbau) durch Werte aus den Daten oder neutral ersetzt
//  - Bearbeiten (v0.5): Handler der Referenz, jede Änderung wird als einzelner Datensatz nach Supabase geschrieben
import { createCalc, shiftYear, weekKey, carBucket, toDb, tarifRechner, parseBoniNote, ausbauRechner, AUSBAU_DEFAULTS, movingAvgN, movingAvg, offerSums, offerShare, offerBookingRows, OFFER_DUES, OFFER_ALLOC } from './calc.js?v=0.27.0';
import { parseNum } from './queue.js?v=0.27.0';
import { geocode, fetchDays, fetchForecast } from './weather.js?v=0.27.0';
import { parseHpCsv, hpSum } from './hp.js?v=0.27.0';
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
const waterStatsOf = (f, t) => C.waterStats(f, t);   // v0.25; in renderFinance ist C überdeckt
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

const PERIOD_PAGES = ["p-overview","p-fin","p-pv","p-batt","p-meter","p-cost","p-tarif","p-ausbau","p-log"];
// v0.16: Zeitraum für Listen und Fahrzeugdaten; „Gesamter Zeitraum“ filtert nicht (Einträge können außerhalb der Energiedaten liegen)
function periodSel(){ const {P,C:Cp}=currentPeriods(), all=S.view.mode==="all"; return {P,Cp,all,inP:d=>all||(d>=P.from&&d<=P.to),inC:d=>!!Cp&&d>=Cp.from&&d<=Cp.to}; }
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

const CAR_CATS=["Kilometerstand","Versicherung","Kfz-Steuer","Räderwechsel","Räder/Reifen","Wartung/Reparatur","Pflege","Überführung","Sonstiges"];
const CARS={leon:"Cupra Leon", tavascan:"Cupra Tavascan"};

function carBucketLabel(k,g){ if(g==="week") return "Wo. "+k.slice(8,10)+"."+k.slice(5,7)+"."+k.slice(2,4); if(g==="month") return monthLabel(k); if(g==="quarter") return `Q${k.slice(6)} ${k.slice(0,4)}`; return k; }

function renderCarAnalytics(){
  const car=S.ui.logCar, g=S.ui.logGran, PS=periodSel();
  $("lg-car").value=car; $("lg-gran").value=g;
  const kd=kmDaily(car), b={}; Object.entries(kd).forEach(([d,v])=>{ if(!PS.inP(d)) return; const k=carBucket(d,g); b[k]=(b[k]||0)+v; });
  const ks=Object.keys(b).sort();
  chart("lg-km",{type:"bar",data:{labels:ks.map(k=>carBucketLabel(k,g)),datasets:[{label:"Kilometer",data:ks.map(k=>b[k]),backgroundColor:css("--grid")}]},
    options:{plugins:{legend:{display:false},tooltip:numTip("km")},scales:{x:{ticks:{maxTicksLimit:16}},y:{title:{display:true,text:"km"}}}}});
  $("lg-km-note").textContent = ks.length ? `Aus ${odoPoints(car).length} Kilometerständen (Tanken, Laden und Fahrzeugbuch), zwischen zwei Ständen gleichmäßig verteilt.` : "Mindestens zwei Kilometerstände nötig (Tankvorgang, Ladevorgang oder Eintrag „Kilometerstand“ im Fahrzeugbuch).";
  const items=carCostItems(car), cats=[...new Set(items.map(x=>x.cat))], cb={};
  items.forEach(x=>{ if(!PS.inP(x.d)) return; const k=carBucket(x.d,g); cb[k]=cb[k]||{}; cb[k][x.cat]=(cb[k][x.cat]||0)+x.e; });
  const ck=Object.keys(cb).sort(), pal=["--sun","--grid","--heat","--batt","--warn","--muted","--loss","--feed"];
  chart("lg-cost",{type:"bar",data:{labels:ck.map(k=>carBucketLabel(k,g)),datasets:cats.map((c,i)=>({label:c,data:ck.map(k=>cb[k][c]||0),backgroundColor:css(pal[i%pal.length]),stack:"s"}))},
    options:{plugins:{tooltip:numTip("€",2)},scales:{x:{stacked:true,ticks:{maxTicksLimit:16}},y:{stacked:true,title:{display:true,text:"€"}}}}});
  const fs=PS.all?fuelStats():C.fuelStatsIn(PS.P.from,PS.P.to);
  // v0.22: Spritpreis je Tankvorgang (auch Teilbetankungen, hohler Punkt), Ø im Zeitraum; l/100 km je Volltank-Intervall.
  // v0.24: gleitender Ø über die letzten 5 Tankvorgänge (Liter-gewichtet) bzw. 3 Volltank-Intervalle (km-gewichtet),
  // gerechnet über das ganze Tankbuch, damit das Fenster am Zeitraumbeginn nicht leer ist.
  const allFills=S.fuel.filter(x=>+x.l>0).sort((x,y)=>x.d.localeCompare(y.d)||x.km-y.km), allIv=fuelStats().intervals;
  const maP=movingAvgN(allFills.map(x=>({y:(+x.e||0)/(+x.l),w:+x.l})),5,3), maC=movingAvgN(allIv.map(iv=>({y:iv.l100,w:iv.km})),3,2);
  const fills=allFills.filter(x=>PS.inP(x.d));
  const L=fills.reduce((a,x)=>a+(+x.l),0), avgP=L?fills.reduce((a,x)=>a+(+x.e||0),0)/L:null;
  const pP=fills.map(x=>({x:x.d,y:(+x.e||0)/(+x.l),full:!!x.full})), pC=fs.intervals.map(iv=>({x:iv.to.d,y:iv.l100}));
  const mP=allFills.map((x,i)=>({x:x.d,y:maP[i],i})).filter(q=>q.y!=null&&PS.inP(q.x)), ivIdx=new Map(allIv.map((iv,i)=>[iv.to,i]));
  const mC=fs.intervals.map(iv=>{ const i=ivIdx.get(iv.to); return {x:iv.to.d,y:maC[i],i}; }).filter(q=>q.y!=null);
  const fD=[...new Set([...pP,...pC].map(q=>q.x))].sort();
  const dot=(data,label,c,axis,unit)=>data.length?[{label,unit,data,borderColor:css(c),backgroundColor:css(c),yAxisID:axis,pointRadius:0,borderWidth:1.5,borderDash:[2,3]}]:[];
  chart("lg-fuel",{type:"line",data:{datasets:[
    {label:"l/100 km",unit:"l/100 km",data:pC,borderColor:css("--warn"),backgroundColor:css("--warn"),yAxisID:"y",pointRadius:3},
    {label:"€/l je Tankvorgang",unit:"€/l",data:pP,borderColor:css("--grid"),backgroundColor:css("--grid"),yAxisID:"y1",borderWidth:1.5,pointRadius:3.5,
      pointBackgroundColor:pP.map(q=>q.full?css("--grid"):css("--panel")),pointBorderColor:css("--grid"),pointBorderWidth:1.5},
    ...(avgP&&fD.length>1?[{label:"Ø €/l im Zeitraum",unit:"€/l",data:[{x:fD[0],y:avgP},{x:fD[fD.length-1],y:avgP}],borderColor:css("--grid"),backgroundColor:css("--grid"),yAxisID:"y1",pointRadius:0,borderWidth:1,borderDash:[6,4]}]:[]),
    ...dot(mC,"Ø 3 Volltank-Intervalle l/100 km","--warn","y","l/100 km"), ...dot(mP,"Ø 5 Tankvorgänge €/l","--grid","y1","€/l")]},
    options:{parsing:true,interaction:{mode:"x",intersect:false},
      plugins:{tooltip:{callbacks:{title:c=>dde(c[0].raw.x),label:c=>`${c.dataset.label}: ${nf(c.parsed.y,c.dataset.unit==="€/l"?3:2)} ${c.dataset.unit}${c.dataset.label==="€/l je Tankvorgang"?(c.raw.full?" (voll)":" (Teilbetankung)"):""}`}}},
      scales:{x:{type:"category",labels:fD,ticks:{maxTicksLimit:10,callback:function(v){return dde(this.getLabelForValue(v));}}},
        y:{title:{display:true,text:"l/100 km"}},y1:{position:"right",grid:{drawOnChartArea:false},title:{display:true,text:"€/l"}}}}});
  const chg=(a,b)=>a!=null&&b?` (${a>=b?"+":"−"}${pct(Math.abs(a/b-1))})`:"";
  const lastP=mP[mP.length-1], prevP=lastP&&lastP.i>=5?maP[lastP.i-5]:null, lastC=mC[mC.length-1], prevC=lastC&&lastC.i>=3?maC[lastC.i-3]:null;
  const maTxt=(lastP?` Gepunktet, gleitender Ø: Spritpreis ${nf(lastP.y,3)} €/l (letzte 5 Tankvorgänge${prevP!=null?`, 5 Tankvorgänge davor ${nf(prevP,3)}${chg(lastP.y,prevP)}`:""})`:"")
    +(lastC?`${lastP?";":" Gepunktet, gleitender Ø:"} Verbrauch ${nf(lastC.y,2)} l/100 km (letzte 3 Volltank-Intervalle${prevC!=null?`, davor ${nf(prevC,2)}${chg(lastC.y,prevC)}`:""})`:"")+(lastP||lastC?".":"");
  $("lg-fuel-note").innerHTML = fills.length ? `<p class="note">${nf(fills.length)} ${fills.length===1?"Tankvorgang":"Tankvorgänge"}${(()=>{ const k=fills.filter(x=>!x.full).length; return k?`, davon ${nf(k)} ${k===1?"Teilbetankung":"Teilbetankungen"} (hohler Punkt)`:""; })()}; Ø ${nf(avgP,3)} €/l im Zeitraum (nach Litern gewichtet, gestrichelt).${maTxt} Verbrauch nur zwischen zwei Volltankungen.</p>` : `<p class="note">Keine Tankvorgänge im Zeitraum.</p>`;
  // Fahrzeugbuch-Tabelle
  const rows=S.carlog.map((x,i)=>({...x,i})).filter(x=>PS.inP(x.d)).sort((a,b)=>b.d.localeCompare(a.d));
  $("cl-tbl").innerHTML = rows.length ? `<thead><tr><th>Datum</th><th class="l">Fahrzeug</th><th class="l">Kategorie</th><th>km</th><th>Betrag</th><th class="l">Notiz</th><th></th></tr></thead><tbody>${
    rows.map(x=>`<tr><td>${dde(x.d)}</td><td class="l">${CARS[x.car]||x.car}</td><td class="l">${esc(x.cat)}</td><td>${x.km?nf(x.km):"–"}</td><td>${x.e?eur(x.e,2):"–"}</td><td class="l">${esc(x.note||"")}</td><td><button class="x" data-del-cl="${x.i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="l" style="color:var(--muted)">Noch keine Einträge. Hier landen Kilometerstände ohne Tanken, Versicherung, Steuer, Räderwechsel und alles Weitere mit Datum.</td></tr></tbody>`;
  // KPIs Fahrzeug: gesamter Zeitraum → letzte 12 Monate (wie bisher), sonst der gewählte Zeitraum mit Vergleich
  if(!PS.all){ renderCarPeriodKpis(car,kd,items,PS); return; }
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

/* ---------- Wasser (v0.25) ---------- */
const WT_FIELDS=[["persons","Personen im Haushalt"],["priceM3","Wasserpreis €/m³"],["sewageM3","Abwasser €/m³ (nach Frischwasser)"],["baseYear","Grundgebühr €/Jahr (optional)"]];
const meterUnit = id => (S.meters.find(m=>m.id===id)?.group==="water" ? "m³" : "kWh");
function renderWater(){
  const wm=S.meters.find(m=>m.group==="water"), w=S.water=S.water||{};
  $("wt-create").hidden=!!wm;
  const f=$("wt-form");
  if(!f.children.length) f.innerHTML=WT_FIELDS.map(([k,l])=>`<label class="f">${l}<input type="text" inputmode="decimal" data-wt="${k}"></label>`).join("");
  f.querySelectorAll("[data-wt]").forEach(el=>{ if(document.activeElement===el) return; const v=w[el.dataset.wt]; el.value=v===""||v==null?"":nf(+v,+v%1?2:0).replace(/\./g,""); });
  const RS=periodSel(), g=groupSeries("water");
  if(!wm||g.intervals.length===0){
    $("wt-flags").innerHTML=flag(wm?"Noch keine zwei Wasserstände: unter „Erfassen → Zählerstand“ den Zähler „Wasser“ wählen und den Stand in m³ eintragen.":"Noch kein Wasserzähler: „Wasserzähler anlegen“ (vorher das SQL-Update v0.25 ausführen, siehe docs/ANLEITUNG_UPDATES.md).",true);
    $("wt-kpis").innerHTML=""; $("wt-note").innerHTML=""; $("wt-chart-wrap").hidden=true; return; }
  $("wt-chart-wrap").hidden=false;
  const last=g.intervals[g.intervals.length-1].to, P0=RS.all?{from:g.intervals[0].from,to:addDaysIso(last,-1)}:RS.P;
  const a=C.waterStats(P0.from,P0.to), c=RS.Cp?C.waterStats(RS.Cp.from,RS.Cp.to):null, L=RS.Cp?RS.Cp.label:"";
  const cv=c&&c.days?c:null;
  $("wt-kpis").innerHTML=kpi(`${nf(a.m3,a.m3<100?2:1)} m³`,"Wasser im Zeitraum",`${nf(a.days)} Tage mit Ablesungen`+(cv?vsTxt(a.m3,cv.m3,v=>nf(v,2)+" m³",L):""))
    +kpi(a.lpd!=null?`${nf(a.lpd)} l`:"–","pro Tag",cv?vsTxt(a.lpd,cv.lpd,v=>nf(v)+" l",L).replace(/^ · /,""):"")
    +kpi(a.lpp!=null?`${nf(a.lpp)} l`:"–","pro Person und Tag",`${nf(a.persons)} Personen; bundesweit üblich etwa 125 l`)
    +kpi(a.cost!=null?eur(a.cost):"–","Kosten (geschätzt)",a.cost!=null?`${nf(a.priceM3,2)} €/m³ Wasser und Abwasser${+w.baseYear?", Grundgebühr anteilig":""}`+(cv&&cv.cost!=null?vsTxt(a.cost,cv.cost,v=>eur(v),L):""):"Preise unten eintragen");
  const fl=[];
  if(a.high.length) fl.push(flag(`Auffällig hoher Verbrauch: ${a.high.map(iv=>`${dde(iv.from)}–${dde(iv.to)} ${nf(iv.rate*1000)} l/Tag`).join(", ")} (über 150 % des üblichen Werts von ${nf(a.median*1000)} l/Tag). Ohne erklärenden Anlass (Besuch, Gartenbewässerung, Pool): WC-Spülung und tropfende Hähne prüfen; bei geschlossenen Hähnen darf sich der Zähler nicht drehen.`));
  $("wt-flags").innerHTML=fl.join("");
  // Liter pro Tag je Ableseintervall (am Zeitraum abgeschnitten) und gleitender 30-Tage-Durchschnitt
  const end=addDaysIso(P0.to,1), ivs=g.intervals.filter(iv=>iv.to>P0.from&&iv.from<=P0.to);
  const step=ivs.flatMap(iv=>{ const x0=iv.from<P0.from?P0.from:iv.from, x1=iv.to>end?end:iv.to; return [{x:x0,y:iv.rate*1000},{x:x1,y:iv.rate*1000}]; });
  const lastD=Object.keys(g.daily).sort().pop(), days=[]; for(let d=P0.from; d<=(lastD<P0.to?lastD:P0.to); d=addDaysIso(d,1)) days.push(d);
  const dl=Object.fromEntries(Object.entries(g.daily).map(([d,v])=>[d,v*1000])), ma=movingAvg(dl,days,30,15);
  const maPts=days.map((d,i)=>({x:d,y:ma[i]})).filter(q=>q.y!=null);
  const lab=[...new Set([...step,...maPts].map(q=>q.x))].sort();
  chart("wt-rate",{type:"line",data:{datasets:[
    {label:"Liter pro Tag",data:step,borderColor:css("--grid"),backgroundColor:css("--grid"),pointRadius:0,borderWidth:2},
    ...(maPts.length?[{label:"Ø 30 Tage",data:maPts,borderColor:css("--grid"),backgroundColor:css("--grid"),pointRadius:0,borderWidth:1.5,borderDash:[2,3]}]:[])]},
    options:{parsing:true,interaction:{mode:"nearest",axis:"x",intersect:false},scales:{x:{type:"category",labels:lab,ticks:{maxTicksLimit:8,callback:function(v){return dde(this.getLabelForValue(v));}}},y:{beginAtZero:true,title:{display:true,text:"Liter pro Tag"}}},
      plugins:{tooltip:{callbacks:{title:c=>dde(c[0].raw.x),label:c=>`${c.dataset.label}: ${nf(c.parsed.y)} l`}}}}});
  const nR=S.readings.filter(r=>r.m===wm.id).length;
  $("wt-note").innerHTML=`<p class="note">${nf(nR)} Ablesungen insgesamt, letzte am ${dde(last)}. Bei Ablesungen alle 1–2 Wochen zeigt die Grafik Wochendurchschnitte, keine einzelnen Tage.</p>`;
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
  // v0.21: Zeitraum und Vergleich. Intervalle am Rand werden abgeschnitten; der Wert bleibt der Tagesdurchschnitt des
  // ganzen Ableseintervalls. Vergleich gestrichelt, auf die Tage des Zeitraums verschoben.
  const RS = periodSel(), sh = RS.Cp ? diffDays(RS.Cp.from, RS.P.from) : 0;
  const ivIn = (g, from, to) => RS.all ? g.intervals : g.intervals.filter(iv => iv.to > from && iv.from <= to);
  const step = (g, from, to, shift = 0) => ivIn(g, from, to).flatMap(iv => {
    const a = RS.all || iv.from >= from ? iv.from : from, b = RS.all || iv.to <= addDaysIso(to, 1) ? iv.to : addDaysIso(to, 1);
    const cap = x => shift && x > addDaysIso(RS.P.to, 1) ? addDaysIso(RS.P.to, 1) : x;   // Vergleich nicht über das Zeitraumende hinaus
    return [{ x: cap(addDaysIso(a, shift)), y: iv.rate, ...(shift ? { o: a } : {}) }, { x: cap(addDaysIso(b, shift)), y: iv.rate, ...(shift ? { o: b } : {}) }]; }).filter((q, i, arr) => !shift || q.x <= addDaysIso(RS.P.to, 1));
  const rateDs = [["as", as, "Allgemeinstrom", "--grid"], ["wp", wp, "Wärmepumpe", "--heat"]];
  const ds = rateDs.map(([, g, l, c]) => ({ label: l, data: step(g, RS.P.from, RS.P.to), borderColor: css(c), backgroundColor: css(c), pointRadius: 0, borderWidth: 2 }));
  // v0.23: gleitender 30-Tage-Durchschnitt je Zählpunkt (Tageswerte wie „Verbrauch pro Monat“), gepunktet
  const lastDaily = g => Object.keys(g.daily).sort().pop();
  const mas = rateDs.map(([gk, g, l, c], i) => {
    const pts = ds[i].data; if (pts.length < 2) return null;
    const d0 = RS.all ? pts[0].x : RS.P.from, d1 = [RS.all ? pts[pts.length - 1].x : RS.P.to, lastDaily(g)].filter(Boolean).sort()[0];
    const days = []; for (let d = d0; d <= d1; d = addDaysIso(d, 1)) days.push(d);
    const v = movingAvg(g.daily, days, 30, 15);
    ds.push({ label: `Ø 30 Tage ${l}`, data: days.map((d, j) => ({ x: d, y: v[j] })).filter(q => q.y != null), borderColor: css(c), backgroundColor: css(c), pointRadius: 0, borderWidth: 1.5, borderDash: [2, 3] });
    const ma1 = t => movingAvg(g.daily, [t], 30, 15)[0];
    return { gk, l, now: ma1(d1), prev: ma1(addDaysIso(d1, -30)), end: d1 };
  }).filter(Boolean);
  if (!RS.all && RS.Cp) rateDs.forEach(([, g, l, c]) => ds.push({ label: `${l} ${RS.Cp.label}`, data: step(g, RS.Cp.from, RS.Cp.to, sh), borderColor: css(c), backgroundColor: css(c), pointRadius: 0, borderWidth: 1.5, borderDash: [5, 4] }));
  const allD = [...new Set(ds.flatMap(d => d.data.map(p => p.x)))].sort();
  chart("mt-rate",{type:"line",data:{datasets:ds},
    options:{parsing:true,scales:{x:{type:"category",labels:allD,ticks:{maxTicksLimit:8,callback:function(v){return dde(this.getLabelForValue(v));}}},y:{title:{display:true,text:"kWh pro Tag"}}},
      plugins:{tooltip:{callbacks:{title:c=>dde(c[0].raw.o||c[0].raw.x),label:c=>`${c.dataset.label}: ${nf(c.parsed.y,1)} kWh/Tag (${dde(c.raw.o||c.raw.x)})`}}}}});
  const rn = [];
  if (!RS.all) rateDs.forEach(([gk, g, l]) => {
    const iv = ivIn(g, RS.P.from, RS.P.to), nR = S.readings.filter(r => S.meters.find(m => m.id === r.m)?.group === gk && r.d >= RS.P.from && r.d <= addDaysIso(RS.P.to, 1)).length;
    const edge = iv.filter(x => x.from < RS.P.from || x.to > addDaysIso(RS.P.to, 1));
    rn.push(`${l}: ${nR ? `${nf(nR)} Ablesung${nR === 1 ? "" : "en"} im Zeitraum` : "keine Ablesung im Zeitraum"}${edge.length ? `; ${edge.map(x => `Intervall ${dde(x.from)}–${dde(x.to)} reicht über den Rand, Wert = Durchschnitt über ${nf(x.days)} Tage`).join("; ")}` : ""}.`); });
  const chg = (a, b) => a != null && b ? ` (${a >= b ? "+" : "−"}${pct(Math.abs(a / b - 1))})` : "";
  const maTxt = mas.length ? `<p class="note">Gepunktet: gleitender Durchschnitt der letzten 30 Tage. ${mas.map(m => `${m.l}: ${m.now != null ? `${nf(m.now, 1)} kWh/Tag bis ${dde(m.end)}` : "–"}${m.prev != null ? `, 30 Tage davor ${nf(m.prev, 1)}${chg(m.now, m.prev)}` : ""}`).join("; ")}.</p>` : "";
  const wEnd = mas.find(m => m.gk === "wp")?.end, wd = wEnd ? C.wpDegreeDay(addDaysIso(wEnd, -29), wEnd) : null, wdp = wEnd ? C.wpDegreeDay(addDaysIso(wEnd, -59), addDaysIso(wEnd, -30)) : null;
  const wdTxt = !S.weather?.length ? "" : wd ? `<p class="note">Wärmepumpe wetterbereinigt (letzte 30 Tage bis ${dde(wEnd)}): ${wd.perGt != null
      ? `Heizung ${nf(wd.perGt, 2)} kWh je Gradtag bei ${nf(wd.gt)} Gradtagen${wd.base != null ? `, Grundlast ${nf(wd.base, 1)} kWh/Tag laut Wetter-Modell abgezogen` : ", ohne Abzug einer Grundlast (Wetter-Modell fehlt)"}${wdp?.perGt != null ? `; 30 Tage davor ${nf(wdp.perGt, 2)}${chg(wd.perGt, wdp.perGt)}` : ""}. Weniger kWh je Gradtag = effizienter, unabhängig vom Wetter.`
      : `nur ${nf(wd.gt)} Gradtage – außerhalb der Heizzeit ist der Wert nicht aussagekräftig.`}</p>` : "";
  $("mt-rate-note").innerHTML = rn.length ? `<p class="note">${rn.join("<br>")}${RS.Cp ? `<br>Gestrichelt: ${esc(RS.Cp.label)}, auf die Tage des Zeitraums verschoben.` : ""} Tageswerte innerhalb eines Intervalls: Grafik „Verbrauch pro Monat“ (bis 62 Tage je Tag).</p>` : "";
  $("mt-rate-note").innerHTML += maTxt + wdTxt;
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
  const rdCur = $("rd-m").value; $("rd-m").innerHTML = mOpts; if (rdCur && S.meters.some(m => m.id === rdCur)) $("rd-m").value = rdCur;   // v0.25: Auswahl beim Neuzeichnen behalten
  renderMeterExtras();
  const RP = periodSel();   // v0.16: Ablesungen im Zeitraum, einschließlich des Stands am Tag nach dem Ende
  const rs = S.readings.map((r,i)=>({...r,i})).filter(r=>(S.ui.meterFilter||"all")==="all"||r.m===S.ui.meterFilter).filter(r=>RP.all||(r.d>=RP.P.from&&r.d<=addDaysIso(RP.P.to,1))).sort((a,b)=>b.d.localeCompare(a.d)||a.m.localeCompare(b.m));
  $("rd-tbl").innerHTML = `<thead><tr><th>Datum</th><th class="l">Zähler</th><th>Stand</th><th class="l">Quelle</th><th></th></tr></thead><tbody>${
    rs.map(r=>`<tr><td>${dde(r.d)}</td><td class="l">${esc(S.meters.find(m=>m.id===r.m)?.name||r.m)}</td><td>${nf(r.v,meterUnit(r.m)==="m³"?3:1)} ${meterUnit(r.m)}</td><td class="l">${esc(r.src||"Eingabe")}</td><td><button class="x" data-del-rd="${r.i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`;
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
    ${(()=>{ if(!S.meters.some(m=>m.group==="water")) return ""; const wa=waterStatsOf(P.from,P.to), wc=C?waterStatsOf(C.from,C.to):null;
      if(wa.cost==null||!wa.days) return "";
      return `<tr><td colspan="4" class="l" style="font-weight:700;padding-top:12px">Wasser (in den Nebenkosten)</td></tr>${row(`Wasser und Abwasser (geschätzt, ${nf(wa.m3,1)} m³)`,wa.cost,C?(wc&&wc.days?wc.cost:null):undefined,-1)}`; })()}
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
  const inv = C.investTotal(), nInv = S.invest.filter(x=>x.cat!=="refund").length;   // v0.18: Erstattungen zählen als Ersparnis
  const {from,to}=last12(), base=pvSavings(from,to).eur, am=S.amort;
  const realized = pvSavings(A.dates[0], to).eur, tl=amortTimeline();
  const beYears = tl.be ? (diffDays(`${tl.startK}-01`,`${tl.be}-01`)/365.25) : null;
  const wb12 = tl.wbFrom ? C.homeCharging([from,tl.wbFrom].sort()[1], to).saving : 0, wbAll = tl.wbFrom ? C.homeCharging(tl.wbFrom, to).saving : 0;
  const refIn = (f,t)=>tl.refunds.filter(x=>x.date>=f&&x.date<=t).reduce((a,x)=>a+(+x.cost||0),0), ref12=refIn(from,to), refAll=refIn("0000",to);
  $("am-kpis").innerHTML =
    kpi(eur(inv,2),"Investition gesamt", `${nInv} Positionen, Verkäufe abgezogen${openOffers()?`; offen aus Angeboten ${eur(openOffers(),2)} (zählt erst nach Buchung)`:""}`) +
    kpi(eur(base+wb12+ref12),"Ersparnis letzte 12 Monate", (tl.wbFrom ? `PV ${eur(base)} zum Arbeitspreis, Wallbox ${eur(wb12)} gegenüber öffentlichem Laden` : "Nur Arbeitspreis")+(ref12?`, Erstattungen ${eur(ref12)}`:"")) +
    kpi(tl.be?monthLabel(tl.be):"–","Break-even", tl.be?`${nf(beYears,1)} Jahre nach der ersten Investition`:"Nicht innerhalb der Betrachtungsdauer") +
    kpi(eur(realized+wbAll+refAll),"Bereits erwirtschaftet",`Seit ${dde(A.dates[0])}${inv?`, ${pct((realized+wbAll+refAll)/inv)} der Investition`:""}${tl.wbFrom?`, davon Wallbox ${eur(wbAll)}`:""}${refAll?`, davon Erstattungen ${eur(refAll)}`:""}`);
  const fc=[tl.s14K?`§14a-Gutschrift ${eur(tl.s14Year)} pro Jahr ab ${monthLabel(tl.s14K)} (Wert der Ausbau-Seite)`:"", tl.thgK?`THG-Prämie ${eur(tl.thgYear)} pro Jahr ab ${monthLabel(tl.thgK)} – nicht durch die Investition verursacht, sie gibt es für jedes E-Auto`:""].filter(Boolean);
  $("am-wb-note").innerHTML = (fc.length ? flag(`Prognose enthält ${fc.join("; ")}. Abschaltbar unter „Annahmen“. Gebuchte Gutschriften (Kategorie „Erstattung/Gutschrift“, Name mit „14a“ bzw. „THG“) ersetzen die Prognose für die folgenden 12 Monate.`, true) : "") + (tl.wbFrom ? flag(`Wallbox ab ${dde(tl.wbFrom)}: gemessen aus den Ladevorgängen „zu Hause“ (kWh × öffentlicher Preis − Arbeitspreis), Prognose ${eur(tl.wbYear)} pro Jahr aus dem Auto-Vergleich ab Übergabe des E-Autos. Solarstrom im Auto steckt bereits in der PV-Ersparnis.`, true) : "");
  $("am-inv").innerHTML = `<thead><tr><th class="l">Position</th><th class="l">Kategorie</th><th class="l">Datum</th><th>Kosten €</th><th></th></tr></thead><tbody>${
    S.invest.map((x,i)=>`<tr><td class="l"><input type="text" style="min-width:200px" value="${esc(x.name)}" data-inv="${i}" data-k="name"></td><td class="l"><select data-inv="${i}" data-k="cat" style="width:auto">${INV_CATS.map(([k,l])=>`<option value="${k}" ${(x.cat||"pv")===k?"selected":""}>${l}</option>`).join("")}</select></td><td class="l"><input type="date" value="${esc(x.date)}" data-inv="${i}" data-k="date"></td><td><input type="number" step="0.01" value="${x.cost}" data-inv="${i}" data-k="cost" style="width:110px"></td><td><button class="x" data-del-inv="${i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody><tfoot><tr><td>Summe Investition</td><td></td><td></td><td>${eur(inv,2)}</td><td></td></tr>${tl.refunds.length?`<tr><td>Erstattungen/Gutschriften (als Ersparnis)</td><td></td><td></td><td>${eur(tl.refunds.reduce((a,x)=>a+(+x.cost||0),0),2)}</td><td></td></tr>`:""}</tfoot>`;
  renderOffers();
  if(first){
    const h=$("am-sl"); h.innerHTML="";
    slider(h,am,"priceInc","Strompreissteigerung pro Jahr",0,8,0.5,"%");
    slider(h,am,"degr","Leistungsverlust pro Jahr",0,2,0.1,"%");
    slider(h,am,"years","Betrachtungsdauer",5,25,1,"Jahre",0);
    slider(h,am,"feedin","Einspeisevergütung",0,10,0.5,"ct/kWh");
    const l=document.createElement("label"); l.className="f"; l.textContent="Einspeisevergütung gilt ab"; const i=document.createElement("input"); i.type="date"; i.value=am.feedinFrom||"";
    i.addEventListener("change",()=>{ am.feedinFrom=i.value; persist(); rerender(); }); l.appendChild(i); h.appendChild(l);
    // v0.18: Prognose von Gutschriften an/aus
    [["s14aFc","§14a-Gutschrift in der Prognose (Wert der Ausbau-Seite)"],["thg","THG-Prämie in der Prognose (nicht durch die Investition verursacht)"]].forEach(([k,t])=>{
      const c=document.createElement("label"); c.className="f check"; c.style.gridColumn="1/-1";
      c.innerHTML=`<input type="checkbox" data-amc="${k}" ${am[k]!==false?"checked":""}> ${t}`;
      c.querySelector("input").addEventListener("change",ev=>{ am[k]=ev.target.checked; persist(); rerender(); }); h.appendChild(c); });
  }
  const lab=tl.labels.map(monthLabel), li=tl.proj.indexOf(true);
  chart("am-chart",{type:"line",data:{labels:lab,datasets:[
    {label:"Ersparnis gemessen",data:tl.cumS.map((v,j)=>tl.proj[j]?null:v),borderColor:css("--sun"),backgroundColor:css("--sun"),pointRadius:0,borderWidth:2.5},
    {label:"Ersparnis Prognose",data:tl.cumS.map((v,j)=>(tl.proj[j]||j===li-1)?v:null),borderColor:css("--sun"),borderDash:[5,4],backgroundColor:css("--sun"),pointRadius:0,borderWidth:2},
    {label:"Investition kumuliert",data:tl.cumI,borderColor:css("--ink"),backgroundColor:css("--ink"),pointRadius:0,borderWidth:1.5,stepped:true}]},
    options:{plugins:{tooltip:numTip("€")},scales:{x:{ticks:{maxTicksLimit:12}},y:{title:{display:true,text:"€"}}}}});
}

/* ---------- Angebote mit Positionen (v0.20) ---------- */
function openOffers(){ return (S.offers||[]).reduce((a,o)=>{ const s=offerSums(o); return a+Object.entries(s.due).filter(([d])=>!(o.paid||{})[d]).reduce((b,[,D])=>b+D.total,0); },0); }
function renderOffers(){
  const os=S.offers=S.offers||[], today=iso(new Date()), num=v=>v===""||v==null||!isFinite(+v)?"":nf(+v,+v%1?2:0).replace(/\./g,"");
  const opts=(list,cur)=>list.map(([k,l])=>`<option value="${k}" ${cur===k?"selected":""}>${l}</option>`).join("");
  $("of-list").innerHTML = os.length ? os.map((o,i)=>{
    const s=offerSums(o), at=(j,k)=>`data-of="${i}" data-ofi="${j}" data-k="${k}"`;
    const items=(o.items||[]).map((it,j)=>`<tr><td><input type="text" inputmode="decimal" value="${num(it.qty)}" ${at(j,"qty")} style="width:60px"></td>
      <td class="l"><input type="text" value="${esc(it.name||"")}" ${at(j,"name")} style="width:100%;min-width:280px"></td>
      <td><input type="text" inputmode="decimal" value="${num(it.price)}" ${at(j,"price")} style="width:90px"></td>
      <td>${eur((+it.qty||0)*(+it.price||0),2)}</td>
      <td class="l"><select ${at(j,"alloc")} style="width:auto">${opts(OFFER_ALLOC,it.alloc==="pv"||it.alloc==="wallbox"?it.alloc:"shared")}</select></td>
      <td class="l"><select ${at(j,"due")} style="width:auto">${opts(OFFER_DUES,it.due==="anmeldung"?"anmeldung":"montage")}</select></td>
      <td class="edit-only"><button class="x" data-of-del-item="${i}" data-i="${j}" aria-label="Position löschen">×</button></td></tr>`).join("");
    const inv=new Map(S.invest.map(x=>[x.id,x])), fl=[];
    const book=OFFER_DUES.filter(([d])=>s.due[d]).map(([d,l])=>{ const D=s.due[d], P=(o.paid||{})[d];
      if(P){ const got=(P.ids||[]).reduce((a,id)=>a+(+(inv.get(id)||{}).cost||0),0); if(Math.abs(got-D.total)>0.005) fl.push(flag(`${l}: gebucht sind ${eur(got,2)}, die Positionen ergeben ${eur(D.total,2)}. Buchung zurücknehmen und neu buchen, damit die Investitionen stimmen.`,true)); }
      return `<tr><td class="l">${l}</td><td>${eur(D.total,2)}</td><td>${eur(D.pv,2)}</td><td>${eur(D.wallbox,2)}</td><td class="l">${P
        ?`gebucht am ${dde(P.date)} <button class="ghost edit-only" data-of-unbook="${i}" data-due="${d}">Buchung zurücknehmen</button>`
        :`offen <span class="edit-only"><input type="date" value="${today}" id="of-bd-${i}-${d}" style="width:auto"> <button class="ghost" data-of-book="${i}" data-due="${d}">Als bezahlt buchen</button></span>`}</td></tr>`; }).join("");
    return `<div style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px">
      <div class="form">
        <label class="f">Angebotsnummer<input type="text" value="${esc(o.no||"")}" data-of="${i}" data-k="no"></label>
        <label class="f">Datum<input type="date" value="${esc(o.date||"")}" data-of="${i}" data-k="date"></label>
        <label class="f">Firma<input type="text" value="${esc(o.vendor||"")}" data-of="${i}" data-k="vendor"></label>
        <label class="f">PV-Anteil gemeinsamer Positionen %<input type="text" inputmode="decimal" value="${num(offerShare(o))}" data-of="${i}" data-k="sharePv"></label>
        <label class="f check wide"><input type="checkbox" data-of="${i}" data-k="ausbau" ${o.ausbau?"checked":""}> Für die Ausbau-Seite verwenden (Handwerkerkosten)</label>
      </div>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Menge</th><th class="l">Artikel</th><th>Einzelpreis €</th><th>Summe</th><th class="l">Zuordnung</th><th class="l">Fällig</th><th class="edit-only"></th></tr></thead>
        <tbody>${items}</tbody><tfoot><tr><td></td><td class="l">Summe brutto</td><td></td><td>${eur(s.total,2)}</td><td colspan="3"></td></tr></tfoot></table></div>
      <div class="row edit-only" style="margin-top:8px"><button class="ghost" data-of-add-item="${i}">Position hinzufügen</button><button class="ghost" data-of-del="${i}">Angebot löschen</button></div>
      <p class="note">Aufteilung: PV/Speicher ${eur(s.pvAll,2)}, Wallbox ${eur(s.wbAll,2)}${s.shared?` (gemeinsame Positionen ${eur(s.shared,2)}, davon ${nf(offerShare(o))} % PV/Speicher)`:""}.</p>
      <div class="tbl-wrap"><table><thead><tr><th class="l">Fällig</th><th>Betrag</th><th>PV/Speicher</th><th>Wallbox</th><th class="l">Status</th></tr></thead><tbody>${book}</tbody></table></div>${fl.join("")}
    </div>`; }).join("") : `<p class="note">Noch kein Angebot erfasst.</p>`;
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
    cb2.innerHTML=`<input type="checkbox" ${i.useLedger?"checked":""}> Versicherung, Steuer, Räder, Sonstiges aus Fahrzeugbuch (12 Monate)`; cb2.querySelector("input").addEventListener("change",ev=>{i.useLedger=ev.target.checked;persist();renderCar(false);}); hi.appendChild(cb2);
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
  const keys=Object.keys(r.blocks.ice), cols=["--grid","--sun","--heat","--muted","--batt","--loss","--feed","--ok"];   // v0.17: Räder, Überführung, THG-Prämie getrennt
  chart("car-bar",{type:"bar",data:{labels:["Leon","Tavascan"],datasets:keys.map((k,j)=>({label:k,data:[r.blocks.ice[k],r.blocks.ev[k]],backgroundColor:css(cols[j]),stack:"s"}))},
    options:{indexAxis:"y",plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${eur(c.parsed.x)}`}}},scales:{x:{stacked:true,title:{display:true,text:"€"}},y:{stacked:true}}}});
}

/* ---------- Tanken & Laden ---------- */
function renderLog(){
  if(!$("cl-cat").options.length) $("cl-cat").innerHTML=CAR_CATS.map(c=>`<option>${c}</option>`).join("");
  renderCarAnalytics();
  const PS=periodSel();
  if(!PS.all){ renderLogPeriod(PS); return; }
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
    ({ "p-quick":renderQuick, "p-overview":()=>{ renderOverview(); renderOvWeather(); }, "p-fin":renderFinance, "p-pv":()=>{ renderPV(); renderWxPv(); renderPvForecast(); }, "p-batt":()=>renderBattery(first), "p-meter":()=>{ renderMeters(); renderHp(); renderHpDay(); renderWxWp(); renderWater(); }, "p-cost":()=>{ renderCosts(); renderEvHome(); }, "p-tarif":renderTarif,
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
const VIEW_INPUTS = new Set(["hpd-a","hpd-b","hp-file","pb-mode","pb-key","pb-from","pb-to","pb-cmp","pb-cfrom","pb-cto","rd-filter","mt-yoy-g","lg-car","lg-gran","csv-file","seed-file","seed-replace"]);
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
    $("hpd-a").addEventListener("change",e=>{ hpdSel.a=e.target.value; renderHpDay(); });
    $("hpd-b").addEventListener("change",e=>{ hpdSel.b=e.target.value; renderHpDay(); });
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
    else if(t.dataset.ofAddItem!==undefined){ const o=S.offers[+t.dataset.ofAddItem]; (o.items=o.items||[]).push({qty:1,name:"",price:0,alloc:"shared",due:"montage"}); persist(); rerender(); }
    else if(t.dataset.ofDelItem!==undefined){ S.offers[+t.dataset.ofDelItem].items.splice(+t.dataset.i,1); persist(); rerender(); }
    else if(t.dataset.ofDel!==undefined){ const o=S.offers[+t.dataset.ofDel];
      if(Object.values(o.paid||{}).some(Boolean)){ alert("Erst die Buchungen zurücknehmen."); return; }
      if(confirm("Angebot löschen?")){ S.offers.splice(+t.dataset.ofDel,1); persist(); rerender(); } }
    else if(t.dataset.ofBook!==undefined){ const i=+t.dataset.ofBook, o=S.offers[i], due=t.dataset.due, date=$(`of-bd-${i}-${due}`).value;
      if(!date){ alert("Zahlungsdatum angeben."); return; }
      const rows=offerBookingRows(o,due,date); rows.forEach(x=>{ x.id=crypto.randomUUID(); S.invest.push(x); write("investment",x); });
      o.paid={...(o.paid||{}),[due]:{date,ids:rows.map(x=>x.id)}}; persist(); rerender(); }
    else if(t.dataset.ofUnbook!==undefined){ const o=S.offers[+t.dataset.ofUnbook], due=t.dataset.due, P=(o.paid||{})[due];
      if(!P||!confirm("Buchung zurücknehmen? Die dabei angelegten Investitionen werden gelöscht.")) return;
      const ids=new Set(P.ids||[]), del=S.invest.filter(x=>ids.has(x.id)); S.invest=S.invest.filter(x=>!ids.has(x.id)); del.forEach(x=>remove("investment",x));
      delete o.paid[due]; persist(); rerender(); }
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
    else if(d.wt){ S.water=S.water||{}; const v=parseNum(el.value); if(el.value.trim()==="") delete S.water[d.wt]; else if(isFinite(v)&&v>=0) S.water[d.wt]=v; persist(); rerender(); }
    else if(d.of!==undefined){ const o=S.offers[+d.of];
      if(d.ofi!==undefined){ const it=o.items[+d.ofi]; if(d.k==="qty"||d.k==="price"){ const v=parseNum(el.value); it[d.k]=isFinite(v)?v:0; } else it[d.k]=el.value; }
      else if(d.k==="ausbau") o.ausbau=el.checked;
      else if(d.k==="sharePv"){ const v=parseNum(el.value); if(el.value.trim()==="") delete o.sharePv; else if(isFinite(v)) o.sharePv=Math.min(100,Math.max(0,v)); }
      else o[d.k]=el.value;
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
  $("wt-create").addEventListener("click",()=>{ if(S.meters.some(m=>m.group==="water")) return;
    const m={id:"water",name:"Wasser",group:"water",order:0}; S.meters.push(m); refreshCalc(); track(store.saveRow("meter",toDb.meter(m))); rerender(); });
  $("of-add").addEventListener("click",()=>{ (S.offers=S.offers||[]).push({id:crypto.randomUUID(),no:"",date:iso(new Date()),vendor:"",ausbau:false,items:[{qty:1,name:"",price:0,alloc:"shared",due:"montage"}],paid:{}}); persist(); rerender(); });
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
      + fld("Datum", `<input type="date" id="q-d" value="${today}">`) + fld(`Stand in <span id="q-unit">${meterUnit(m)}</span>`, num("q-v", meterUnit(m) === "m³" ? "z. B. 123,456" : "z. B. 12530", "decimal"));
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
    const u = meterUnit($("q-m").value); if ($("q-unit")) $("q-unit").textContent = u;
    if (u === "m³") { let s = `Vorheriger Stand: ${nf(r.v, 3)} m³ am ${dde(r.d)}.`;
      if (isFinite(v) && d > r.d) s += ` Verbrauch seitdem ${nf((v - r.v) * 1000)} l (${nf((v - r.v) * 1000 / diffDays(r.d, d))} l/Tag).`; return s; }
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
    if (r && v < r.v && !confirm(`Der Stand ist kleiner als der vorherige (${nf(r.v)} ${meterUnit(m)} am ${dde(r.d)}). Zählertausch oder Tippfehler? Trotzdem speichern?`)) return;
    lsSet("eb_q_meter", m);
    obj = S.readings.find(x => x.m === m && x.d === d);
    if (obj) obj.v = v; else { obj = { m, d, v, src: "Eingabe" }; S.readings.push(obj); }
    label = `${esc(S.meters.find(x => x.id === m)?.name || m)}: ${nf(v, meterUnit(m) === "m³" ? 3 : 0)} ${meterUnit(m)}`;
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
  const PS = periodSel(), rows = [...(S.payments || [])].filter(x => PS.inP(x.d)).sort((a, b) => b.d.localeCompare(a.d));
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
  // v0.16: Jahr, Quartal, Monat, frei → Verbrauch des Zeitraums aufs Jahr hochgerechnet; gesamt/12 Monate → letzte 365 Tage
  const { P: TP } = currentPeriods(), useP = !["all", "r12"].includes(S.view.mode);
  const base = useP ? C.tariffBase(TP.from, TP.to) : C.tariffBase(), cur = { as: C.currentTariff("as"), wp: C.currentTariff("wp") }, r = tarifRechner(base, cur, p), ev = S.cars.ev || {};
  const basisTxt = useP ? `${esc(TP.label)}, aufs Jahr hochgerechnet (${nf(base.days)} Tage)` : (base.to ? `365 Tage bis ${dde(base.to)}` : "");
  $("tr-base").innerHTML = (useP && base.days < 300 ? flag(`Hochgerechnet aus ${nf(base.days)} Tagen: Winter und Sommer verzerren das Ergebnis. Für Tarifvergleiche besser ein ganzes Jahr oder „12 Monate“ wählen.`, true) : "")
    + kpi(kwh(base.asKwh), "Allgemeinstrom aus dem Netz pro Jahr", basisTxt)
    + kpi(kwh(base.wpKwh), "Wärmepumpe pro Jahr", useP ? basisTxt : "365 Tage laut Zähler")
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
  "wb-cost": [["hwSrc", "Hardware aus", [["manual", "Eigene Werte"], ["invest", "Gebuchte Investitionen ab Datum"]]], ["hwFrom", "Investitionen ab", "date"],
    ["craftSrc", "Handwerker aus", [["manual", "Eigene Werte"], ["offer", "Angeboten (Seite Amortisation)"]]],
    ["hwTotal", "Hardware gesamt € (inkl. Wallbox)"], ["hwWallbox", "davon Wallbox €"], ["craftPv", "Handwerker PV/Speicher €"],
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
  // v0.16: Basisjahr – bei „Jahr“ das gewählte Kalenderjahr, wenn es vollständig in den Anker-Daten liegt, sonst die letzten 365 Tage
  const yk = S.view.mode === "year" ? S.view.key : null, yFull = yk && A.dates[0] <= `${yk}-01-01` && A.dates[A.n - 1] >= `${yk}-12-31`;
  const p = S.ausbau = S.ausbau || {}, today = iso(new Date()), base = yFull ? C.ausbauBase(`${yk}-01-01`, `${yk}-12-31`) : C.ausbauBase(), v = k => (p[k] ?? AUSBAU_DEFAULTS[k]);
  for (const [host, fields] of Object.entries(WB_FIELDS)) {
    const h = $(host);
    if (!h.children.length) h.innerHTML = fields.map(([k, l, t]) => t === "check" ? `<label class="f check wide"><input type="checkbox" data-wb="${k}"> ${l}</label>`
      : Array.isArray(t) ? `<label class="f">${l}<select data-wb="${k}">${t.map(([o, ol]) => `<option value="${o}">${ol}</option>`).join("")}</select></label>`
      : `<label class="f">${l}<input type="${t === "date" ? "date" : "text"}" ${t === "date" ? "" : 'inputmode="decimal"'} data-wb="${k}"></label>`).join("");
    h.querySelectorAll("[data-wb]").forEach(el => { if (document.activeElement === el) return; const k = el.dataset.wb;
      if (el.type === "checkbox") el.checked = !!v(k); else if (el.type === "date") el.value = v(k) || (k === "hwFrom" ? "" : today);
      else if (el.tagName === "SELECT") el.value = v(k); else { const x = v(k); el.value = x === "" || x == null ? "" : nf(+x, +x % 1 ? 2 : 0).replace(/\./g, ""); } });
  }
  $("wb-cost").querySelector('[data-wb="socketEur"]').closest("label").hidden = v("alt") !== "socket";
  // v0.20: Kosten aus gebuchten Investitionen bzw. Angeboten statt eigener Werte
  const cst = C.ausbauCosts(p), pe = { ...p, hwTotal: cst.hwTotal, hwWallbox: cst.hwWallbox, craftPv: cst.craftPv, craftWallbox: cst.craftWallbox };
  const hide = (k, h) => $("wb-cost").querySelector(`[data-wb="${k}"]`).closest("label").hidden = h;
  hide("hwFrom", v("hwSrc") !== "invest"); ["hwTotal", "hwWallbox"].forEach(k => hide(k, !!cst.hw)); ["craftPv", "craftWallbox"].forEach(k => hide(k, !!cst.craft));
  $("wb-cost-src").innerHTML = [
    v("hwSrc") === "invest" && !v("hwFrom") ? flag("Datum „Investitionen ab“ fehlt: bis dahin gelten die eigenen Werte.", true) : "",
    cst.hw ? `<p class="note">Hardware aus ${nf(cst.hw.n)} Investitionen ab ${dde(cst.hw.from)}: ${eur(cst.hwTotal, 2)}, davon Wallbox ${eur(cst.hwWallbox, 2)} (ohne Erstattungen und ohne Buchungen aus Angeboten).</p>` : "",
    cst.craft ? (cst.craft.n ? `<p class="note">Handwerker aus ${cst.craft.n === 1 ? "Angebot" : `${nf(cst.craft.n)} Angeboten`} ${esc(cst.craft.nos.join(", "))}: PV/Speicher ${eur(cst.craftPv, 2)}, Wallbox ${eur(cst.craftWallbox, 2)}.</p>`
      : flag("Kein Angebot für die Ausbau-Rechnung markiert (Seite „Amortisation“ → Angebote → „Für die Ausbau-Seite verwenden“).", true)) : ""].join("");
  $("wb-14a").querySelectorAll('[data-wb="s14aMod"],[data-wb="s14aEur"]').forEach(el => el.closest("label").hidden = !v("s14a"));
  $("wb-14a").querySelector('[data-wb="s14aEur"]').closest("label").hidden = !v("s14a") || v("s14aMod") !== "manual";
  // §14a-Ersparnis je Modul mit dem Netzladen des Szenarios (Werte des Netzbetreibers aus dem Tarifrechner)
  const r0 = ausbauRechner(base, pe, today);
  const tr = tarifRechner({ ...C.tariffBase(), evGrid: r0.kwh.evGrid }, { as: C.currentTariff("as"), wp: C.currentTariff("wp") }, S.tarif || {});
  const m14a = Object.fromEntries(tr.wallbox.filter(w => w.key !== "none").map(w => [w.key, -w.vsNone]));
  const r = ausbauRechner(base, pe, today, m14a), y = r.year, nc = r.noCar, N = +v("years") || 20;
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
  if (S.view.mode !== "all" && S.view.mode !== "r12" && !yFull) fl.push(flag(`Das Modell braucht ein ganzes Jahr: ${yk ? `das Jahr ${yk} ist in den Anker-Daten nicht vollständig, daher` : "gerechnet wird mit"} den letzten 365 Tagen. Ein vollständiges Kalenderjahr lässt sich über „Jahr“ wählen.`, true));
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
const INV_CATS = [["pv", "PV/Speicher"], ["wallbox", "Wallbox"], ["other", "Sonstiges"], ["refund", "Erstattung/Gutschrift"]];
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

/* ---------- PV-Prognose (v0.27) ---------- */
// Vorhersage einmal je Tag und Gerät holen; gespeichert wird die Prognose je Tag (Erstellungstag heute) für die Trefferquote
const pvFc = { day: null, rows: [], err: "", loading: false };
async function loadPvForecast() {
  const c = S.wx || {}, today = iso(new Date());
  if (c.lat == null || pvFc.loading || pvFc.day === today) return;
  pvFc.loading = true;
  try {
    pvFc.rows = await fetchForecast(c.lat, c.lon, 14); pvFc.day = today; pvFc.err = "";
    const r = C.pvForecast(pvFc.rows, today);
    if (r.days.length && !document.body.classList.contains("ro") && store?.savePvForecast && !S.pvForecastError) {
      const rows = r.days.map(x => ({ day: x.d, made_on: today, kwh: +x.kwh.toFixed(3), lo: x.lo == null ? null : +x.lo.toFixed(3), hi: x.hi == null ? null : +x.hi.toFixed(3), rad_kwh: x.rad, factor: +x.f.toFixed(4) }));
      try { const res = await store.savePvForecast(rows);
        if (res !== "readonly") { const keep = (S.pvForecasts || []).filter(s => s.made !== today); S.pvForecasts = [...keep, ...rows.map(x => ({ d: x.day, made: today, kwh: x.kwh, lo: x.lo, hi: x.hi, rad: x.rad_kwh, f: x.factor }))]; refreshCalc(); } }
      catch (e) { pvFc.err = e.message === "offline" ? "" : "Prognose konnte nicht gespeichert werden: " + e.message; }
    }
  } catch (e) { pvFc.err = "Wettervorhersage nicht verfügbar: " + e.message; }
  pvFc.loading = false;
  if (current === "p-pv") renderPvForecast();
}
function renderPvForecast() {
  if (S.wx?.lat == null) { $("pvf-flags").innerHTML = noWx(); ["pvf-kpis", "pvf-months", "pvf-acc-note", "pvf-method"].forEach(id => $(id).innerHTML = "");
    chart("pvf-days", { type: "bar", data: { labels: [], datasets: [] } }); chart("pvf-acc", { type: "bar", data: { labels: [], datasets: [] } }); return; }
  const today = iso(new Date()), ro = document.body.classList.contains("ro");
  // Gast (v0.14: kein Wetter-Abruf aus dem Gast-Browser): zuletzt gespeicherte Vorhersage des Eigentümers
  let rows = pvFc.rows;
  if (ro) { const last = (S.pvForecasts || []).map(x => x.made).sort().pop();
    rows = last ? (S.pvForecasts || []).filter(x => x.made === last && x.d >= today && x.rad != null).map(x => ({ day: x.d, rad_kwh: x.rad })).sort((a, b) => a.day.localeCompare(b.day)) : []; }
  else if (pvFc.day !== today) loadPvForecast();
  const r = C.pvForecast(rows, today), F = r.F, d0 = r.days.find(x => x.d === today), d1 = r.days.find(x => x.d === addDaysIso(today, 1));
  const w7 = r.days.filter(x => x.d >= today && x.d <= addDaysIso(today, 6)), s7 = w7.reduce((a, x) => a + x.kwh, 0);
  const fl = [];
  if (pvFc.err) fl.push(flag(esc(pvFc.err), true));
  if (pvFc.loading && !r.days.length) fl.push(flag("Wettervorhersage wird geladen …", true));
  if (ro) fl.push(flag(r.days.length ? "Gastzugang: Vorhersage vom letzten Öffnen durch den Eigentümer." : "Gastzugang: noch keine gespeicherte Vorhersage.", true));
  if (S.pvForecastError) fl.push(flag("Prognosen werden noch nicht gespeichert: SQL-Update v0.27 ausführen (docs/UPDATE_V27.sql). Die Anzeige funktioniert trotzdem.", true));
  if (!F.overall) fl.push(flag("Zu wenige Tage mit Anker- und Wetterdaten für einen Ertragsfaktor (mindestens 10).", true));
  $("pvf-flags").innerHTML = fl.join("");
  const band = x => x && x.lo != null ? `${nf(x.lo, 1)}–${nf(x.hi, 1)} kWh` : "";
  const acc = r.acc;
  $("pvf-kpis").innerHTML = kpi(d0 ? kwh(d0.kwh, 1) : "–", "Heute erwartet", d0 ? `${band(d0)}, ${nf(d0.rad, 1)} kWh/m² vorhergesagt` : "")
    + kpi(d1 ? kwh(d1.kwh, 1) : "–", "Morgen erwartet", d1 ? `${band(d1)}, ${nf(d1.rad, 1)} kWh/m²` : "")
    + kpi(w7.length ? kwh(s7) : "–", "Nächste 7 Tage", w7.length ? `Ø ${nf(s7 / w7.length, 1)} kWh pro Tag` : "")
    + kpi(acc.mape != null ? `± ${pct(acc.mape)}` : "–", "Trefferquote (Ø Abweichung)", acc.n ? `${nf(acc.n)} Tage der letzten 30, Prognose insgesamt ${acc.bias >= 0 ? "+" : "−"}${pct(Math.abs(acc.bias))} gegenüber Messung` : "ab dem ersten Tag mit gespeicherter Prognose und Messung");
  const lab = r.days.map(x => `${["So","Mo","Di","Mi","Do","Fr","Sa"][new Date(x.d + "T12:00:00Z").getUTCDay()]} ${dde(x.d).slice(0, 6)}`);
  chart("pvf-days", { type: "bar", data: { labels: lab, datasets: [
    { label: "Erwartet kWh", data: r.days.map(x => x.kwh), backgroundColor: css("--sun"), order: 1 },
    { label: "Bandbreite", data: r.days.map(x => x.lo != null ? [x.lo, x.hi] : null), backgroundColor: `color-mix(in srgb, ${css("--sun")} 25%, transparent)`, grouped: false, order: 2 }] },
    options: { plugins: { tooltip: { callbacks: { label: c => c.datasetIndex === 1 ? `Bandbreite: ${nf(c.raw[0], 1)}–${nf(c.raw[1], 1)} kWh` : `Erwartet: ${nf(c.parsed.y, 1)} kWh (${nf(r.days[c.dataIndex].rad, 1)} kWh/m²)` } } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "kWh" } } } } });
  const P = acc.pairs.slice(-30);
  chart("pvf-acc", { type: "bar", data: { labels: P.map(x => dde(x.d).slice(0, 6)), datasets: [
    { label: "Gemessen kWh", data: P.map(x => x.act), backgroundColor: css("--sun"), order: 2 },
    { type: "line", label: "Prognose kWh", data: P.map(x => x.fc), borderColor: css("--panel"), backgroundColor: css("--grid"), pointRadius: 5, pointBorderWidth: 1.5, showLine: false, order: 0 }] },
    options: { plugins: { ebTotals: false, tooltip: numTip("kWh", 1) }, scales: { y: { beginAtZero: true, title: { display: true, text: "kWh" } } } } });
  $("pvf-acc-note").innerHTML = P.length ? `<p class="note">Je Tag die letzte Prognose, die vor dem Tag erstellt wurde (meist vom Vortag). Tage unter 0,5 kWh zählen für die Trefferquote nicht. Messung bis ${dde(r.lastData)} (Anker-Daten).</p>`
    : `<p class="note">Noch keine gespeicherte Prognose mit Messung. Ab morgen füllt sich der Vergleich, sobald die Anker-Daten des Tages im Tool sind.</p>`;
  $("pvf-months").innerHTML = `<thead><tr><th class="l">Monat</th><th>Erwartet</th><th class="l">davon</th><th>Ertragsfaktor</th><th>typ. Einstrahlung/Tag</th><th>Vorjahr gemessen</th></tr></thead><tbody>${
    r.months.map(m => `<tr><td class="l">${monthLabel(m.k)}</td><td>${m.kwh != null ? kwh(m.kwh) : "–"}</td><td class="l" style="white-space:normal">${[m.measured ? `${kwh(m.measured)} gemessen` : "", m.fc ? `${kwh(m.fc)} Vorhersage` : "", m.typical ? `${kwh(m.typical)} typisch (${nf(m.nTyp)} Tage)` : ""].filter(Boolean).join(", ") || "–"}</td><td>${m.f != null ? nf(m.f, 2) : "–"}</td><td>${m.typDay != null ? `${nf(m.typDay, 2)} kWh/m²` : "–"}</td><td>${m.prevYear != null ? kwh(m.prevYear) : "–"}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td class="l">12 Monate</td><td>${kwh(r.months.reduce((a, m) => a + (m.kwh || 0), 0))}</td><td colspan="4"></td></tr></tfoot>`;
  const f30 = F.f30, mNow = F.month[today.slice(5, 7)];
  $("pvf-method").innerHTML = `<p class="note">Ertragsfaktor (kWh je kWh/m² Einstrahlung) diesen Monat ${mNow ? `${nf(mNow.f, 2)} aus ${nf(mNow.n)} gemessenen Tagen, Streuung ± ${pct(mNow.cv)}` : "noch ohne eigene Daten"}${f30 ? `; letzte 30 Tage ${nf(f30.f, 2)}` : ""}. Bandbreite = ± Streuung des Monats.
    Typische Einstrahlung: Ø der vollständigen Monate in deinen Wetterdaten. Nicht berücksichtigt: Abregelung bei vollem Speicher, Schnee, der geplante Ausbau (folgt später).</p>`;
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

/* ---------- Tanken & Laden im gewählten Zeitraum (v0.16) ---------- */
const vsTxt = (a, b, f, label) => (b == null || a == null) ? "" : ` · ${esc(label)}: ${f(b)}${b ? ` (${a >= b ? "+" : "−"}${pct(Math.abs(a / b - 1))})` : ""}`;
function renderLogPeriod(PS) {
  const { P, Cp } = PS, fs = C.fuelStatsIn(P.from, P.to), fc = Cp ? C.fuelStatsIn(Cp.from, Cp.to) : null;
  const chIn = (f, t) => S.charges.filter(x => x.d >= f && x.d <= t), ch = chIn(P.from, P.to), chc = Cp ? chIn(Cp.from, Cp.to) : null;
  const kW = ch.reduce((a, b) => a + (+b.k || 0), 0), cE = ch.reduce((a, b) => a + (+b.e || 0), 0);
  const kWc = chc ? chc.reduce((a, b) => a + (+b.k || 0), 0) : null, cEc = chc ? chc.reduce((a, b) => a + (+b.e || 0), 0) : null;
  $("lg-kpis").innerHTML =
    kpi(fs.l100 ? nf(fs.l100, 2) + " l" : "–", "Ø Verbrauch je 100 km", (fs.intervals.length ? `${fs.intervals.length} Volltank-Intervalle im Zeitraum` : "Keine Volltank-Intervalle im Zeitraum") + (Cp ? vsTxt(fs.l100, fc.l100, v => nf(v, 2) + " l", Cp.label) : "")) +
    kpi(fs.avgPrice ? nf(fs.avgPrice, 3) + " €/l" : "–", "Ø Spritpreis im Zeitraum", `${nf(fs.L, 1)} l getankt` + (Cp ? vsTxt(fs.avgPrice, fc.avgPrice, v => nf(v, 3) + " €/l", Cp.label) : "")) +
    kpi(eur(fs.E, 2), "Tankkosten im Zeitraum", `${fs.n} Einträge, ${esc(P.label)}` + (Cp ? vsTxt(fs.E, fc.E, v => eur(v, 2), Cp.label) : "")) +
    kpi(kW ? nf(cE / kW, 2) + " €/kWh" : "–", "Ø Ladepreis im Zeitraum", `${nf(kW, 1)} kWh, ${eur(cE, 2)}` + (Cp ? vsTxt(cE, cEc, v => eur(v, 2), Cp.label) : ""));
  const all = fuelStats(), ivMap = new Map(all.intervals.map(iv => [iv.to, iv]));
  const fr = S.fuel.map((x, i) => ({ ...x, i })).filter(x => PS.inP(x.d)).sort((a, b) => b.d.localeCompare(a.d));
  $("fu-tbl").innerHTML = fr.length ? `<thead><tr><th>Datum</th><th>km</th><th>Liter</th><th>Betrag</th><th>€/l</th><th class="l">Sorte</th><th>voll</th><th>l/100 km</th><th></th></tr></thead><tbody>${
    fr.map(x => { const iv = ivMap.get(S.fuel[x.i]); return `<tr><td>${dde(x.d)}</td><td>${nf(x.km)}</td><td>${nf(x.l, 2)}</td><td>${eur(x.e, 2)}</td><td>${nf(x.e / x.l, 3)}</td><td class="l">${esc(x.s)}</td><td>${x.full ? "ja" : "nein"}</td><td>${iv ? nf(iv.l100, 2) : ""}</td><td><button class="x" data-del-fu="${x.i}" aria-label="Löschen">×</button></td></tr>`; }).join("")}</tbody>`
    : `<tbody><tr><td class="l" style="color:var(--muted)">Keine Tankvorgänge im Zeitraum.</td></tr></tbody>`;
  const cr = S.charges.map((x, i) => ({ ...x, i })).filter(x => PS.inP(x.d)).sort((a, b) => b.d.localeCompare(a.d));
  $("ch-tbl").innerHTML = cr.length ? `<thead><tr><th>Datum</th><th>km</th><th>kWh</th><th>Betrag</th><th>€/kWh</th><th class="l">Ort</th><th></th></tr></thead><tbody>${
    cr.map(x => `<tr><td>${dde(x.d)}</td><td>${x.km ? nf(x.km) : "–"}</td><td>${nf(x.k, 1)}</td><td>${eur(x.e, 2)}</td><td>${x.k ? nf(x.e / x.k, 3) : "–"}</td><td class="l">${esc(x.o)}</td><td><button class="x" data-del-ch="${x.i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="l" style="color:var(--muted)">Keine Ladevorgänge im Zeitraum.</td></tr></tbody>`;
}
function renderCarPeriodKpis(car, kd, items, PS) {
  const { P, Cp } = PS, lease = car === "leon" ? S.cars.ice.rate : S.cars.ev.rate;
  const sum = (f, t) => { const km = Object.entries(kd).filter(([d]) => d >= f && d <= t).reduce((s, [, v]) => s + v, 0);
    const span = Object.keys(kd).filter(d => d >= f && d <= t).length, cost = items.filter(x => x.d >= f && x.d <= t).reduce((s, x) => s + x.e, 0);
    return { km, span, cost, perKm: km ? cost / km * 100 : null, perKmL: km ? (cost + lease * span / 30.4375) / km * 100 : null }; };
  const a = sum(P.from, P.to), c = Cp ? sum(Cp.from, Cp.to) : null, L = Cp ? Cp.label : "";
  $("lg-car-kpis").innerHTML =
    kpi(a.km ? nf(a.km) + " km" : "–", "Gefahren im Zeitraum", (a.km ? esc(P.label) : "Kilometerstände fehlen") + (c ? vsTxt(a.km, c.km, v => nf(v) + " km", L) : "")) +
    kpi(eur(a.cost, 0), "Kosten ohne Leasing", "Sprit bzw. Laden und Fahrzeugbuch" + (c ? vsTxt(a.cost, c.cost, v => eur(v, 0), L) : "")) +
    kpi(a.perKm != null ? nf(a.perKm, 1) + " ct" : "–", "Je km ohne Leasing", c ? vsTxt(a.perKm, c.perKm, v => nf(v, 1) + " ct", L).replace(/^ · /, "") : "") +
    kpi(a.perKmL != null ? nf(a.perKmL, 1) + " ct" : "–", "Je km mit Leasing", `Leasing ${eur(lease, 2)} pro Monat, anteilig für ${nf(a.span)} Tage mit Kilometerdaten`);
}

/* ---------- Tagesprofil Wärmepumpe aus Stundenwerten (v0.19) ---------- */
// v0.26: Auswahl nur bis zum nächsten App-Start; beim Start der neueste Tag mit Stundenwerten, ohne Vergleich
const hpdSel = { a: null, b: "" };
function renderHpDay() {
  const days = C.hpHourDays();
  if (!days.length) { $("hpd-a").innerHTML = ""; $("hpd-b").innerHTML = ""; $("hpd-tbl").innerHTML = "";
    $("hpd-flags").innerHTML = flag("Noch keine Stundenwerte: in der Wärmepumpen-App den Export „letzte 3 Tage“ wählen und unter „Daten“ hochladen.", true);
    chart("hp-hours", { type: "bar", data: { labels: [], datasets: [] } }); return; }
  const a = days.includes(hpdSel.a) ? hpdSel.a : days[days.length - 1], b = days.includes(hpdSel.b) && hpdSel.b !== a ? hpdSel.b : "";
  const opt = d => `<option value="${d}">${dde(d)}</option>`;
  $("hpd-a").innerHTML = [...days].reverse().map(opt).join(""); $("hpd-a").value = a;
  $("hpd-b").innerHTML = `<option value="">kein Vergleich</option>` + [...days].reverse().filter(d => d !== a).map(opt).join(""); $("hpd-b").value = b;
  const A_ = C.hpDayProfile(a), B_ = b ? C.hpDayProfile(b) : null;
  // v0.26: Referenz Ø der letzten 7 vollständigen Tage vor dem gewählten Tag (ohne Desinfektionstage), gleiche Stunden wie der Tag
  const hrsA = A_.n < 24 ? new Set(A_.hours.map((r, h) => r ? h : null).filter(h => h != null)) : null, R_ = C.hpDayAverage(a, 7, hrsA);
  $("hpd-flags").innerHTML = [A_, B_].filter(Boolean).filter(x => x.n < 24).map(x => flag(`${dde(x.d)}: nur ${x.n} von 24 Stunden im Export.`, true)).join("");
  const lab = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")} h`), val = (p, f) => p.hours.map(r => r ? (+r[f] || 0) : null);
  const ds = [];
  const bars = (p, st, alpha) => [["Heizung", r => r ? (+r.el_heat || 0) : null, "--heat"], ["Warmwasser", r => r ? (+r.el_dhw || 0) : null, "--grid"], ["Zuheizer", r => r ? (+r.el_aux || 0) : null, "--warn"]]
    .forEach(([l, f, c]) => ds.push({ label: `${l} ${dde(p.d).slice(0, 6)}`, data: p.hours.map(f), backgroundColor: alpha ? `color-mix(in srgb, ${css(c)} 45%, transparent)` : css(c), stack: st, yAxisID: "y" }));
  bars(A_, "a", false); if (B_) bars(B_, "b", true);
  const line = (p, f, l, c, dash, hidden) => ds.push({ type: "line", label: `${l} ${dde(p.d).slice(0, 6)}`, data: p.hours.map(r => r && r[f] != null ? +r[f] : null), borderColor: css(c), backgroundColor: css(c), pointRadius: 0, borderWidth: 2, yAxisID: "y1", spanGaps: true, ...(dash ? { borderDash: [5, 4] } : {}), ...(hidden ? { hidden: true } : {}) });
  line(A_, "t_dhw", "Warmwasser °C", "--batt", false); line(A_, "t_out", "Außen °C", "--sun", false); line(A_, "t_flow", "Vorlauf °C", "--muted", false, true);
  if (B_) { line(B_, "t_dhw", "Warmwasser °C", "--batt", true); line(B_, "t_out", "Außen °C", "--sun", true); }
  if (R_) { const g = css("--muted");
    ds.push({ type: "line", label: `Ø Strom (${R_.n} Tage)`, data: R_.elH, borderColor: g, backgroundColor: g, pointRadius: 0, borderWidth: 2, borderDash: [6, 4], yAxisID: "y", stack: "avg", spanGaps: true });
    ds.push({ type: "line", label: `Ø Warmwasser °C (${R_.n} Tage)`, data: R_.tDhwH, borderColor: g, backgroundColor: g, pointRadius: 0, borderWidth: 1.5, borderDash: [2, 3], yAxisID: "y1", spanGaps: true }); }
  chart("hp-hours", { type: "bar", data: { labels: lab, datasets: ds },
    options: { plugins: { ebTotals: false, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.parsed.y, 1)} ${c.dataset.yAxisID === "y1" ? "" : "kWh"}` } } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 12 } }, y: { stacked: true, title: { display: true, text: "kWh Strom" } }, y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "°C" } } } } });
  const hh = h => `${String(h).padStart(2, "0")}:00`;
  const loads = p => p.loads.length ? p.loads.map(l => `${hh(l.from)}${l.to > l.from ? "–" + hh(l.to + 1) : ""} (${nf(l.kwh, 1)} kWh)`).join(", ") : "keine";
  const rows = [
    ["Strom gesamt", p => kwh(p.el, 1)], ["davon Heizung", p => kwh(p.elHeat, 1)], ["davon Warmwasser", p => kwh(p.elDhw, 1)],
    ["Zuheizer", p => p.aux >= 0.05 ? `<b>${kwh(p.aux, 1)}</b>` : "nein"], ["Erzeugte Wärme", p => kwh(p.heat, 1)], ["Arbeitszahl", p => p.cop != null ? nf(p.cop, 2) : "–"],
    ["Warmwasser-Ladungen", p => `${p.loads.length}: ${loads(p)}`],
    ["Höchste Warmwassertemperatur", p => p.peakDhw ? `${nf(p.peakDhw.t, 1)} °C um ${hh(p.peakDhw.h)}${p.disinfection ? " – Desinfektion/Hochtemperatur" : ""}` : "–"],
    ["Laufstunden", p => `${p.runH} h`], ["Außentemperatur", p => p.tOutMin != null ? `${nf(p.tOutMin, 1)} bis ${nf(p.tOutMax, 1)} °C` : "–"],
    ["Stunden im Export", p => `${p.n} von 24`]];
  const avg = R_ ? [kwh(R_.el, 1), kwh(R_.elHeat, 1), kwh(R_.elDhw, 1), R_.aux >= 0.05 ? kwh(R_.aux, 1) : "nein", kwh(R_.heat, 1), R_.cop != null ? nf(R_.cop, 2) : "–",
    R_.loads != null ? `Ø ${nf(R_.loads, 1)}` : "–", R_.peak != null ? `Ø ${nf(R_.peak, 1)} °C` : "–", R_.runH != null ? `Ø ${nf(R_.runH, 1)} h` : "–",
    R_.tOutMin != null ? `${nf(R_.tOutMin, 1)} bis ${nf(R_.tOutMax, 1)} °C` : "–", hrsA ? `gleiche ${A_.n} Stunden` : "24 von 24"] : null;
  $("hpd-tbl").innerHTML = `<thead><tr><th class="l">Auswertung</th><th class="l">${dde(a)}</th>${B_ ? `<th class="l">${dde(b)}</th>` : ""}${R_ ? `<th class="l">Ø ${R_.n} Tage</th>` : ""}</tr></thead><tbody>${
    rows.map(([l, f], i) => `<tr><td class="l">${l}</td><td class="l" style="white-space:normal">${f(A_)}</td>${B_ ? `<td class="l" style="white-space:normal">${f(B_)}</td>` : ""}${avg ? `<td class="l" style="white-space:normal;color:var(--muted)">${avg[i]}</td>` : ""}</tr>`).join("")}</tbody>`;
  $("hpd-ref").innerHTML = R_ ? `<p class="note">Ø (grau gestrichelt): ${R_.n} vollständige Tage vor dem ${dde(a)} (${dde(R_.days[R_.days.length - 1])}–${dde(R_.days[0])})${R_.skipped.length ? `, ohne Desinfektionstage ${R_.skipped.map(dde).join(", ")}` : ""}${hrsA ? `; Tabelle nur für die ${A_.n} Stunden, die der ${dde(a)} enthält` : ""}.</p>`
    : `<p class="note">Für einen Durchschnitt fehlen vollständige Tage (24 Stunden) vor dem ${dde(a)}.</p>`;
}
