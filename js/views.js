// Seiten der Energiebilanz. Die render*-Funktionen sind aus reference/energiebilanz_v0.14.html übernommen
// (zweiter <script>-Block), die Rechenfunktionen kommen aus calc.js. Geändert gegenüber der Referenz:
//  - S/A kommen aus setModel(), Ansicht und UI-Auswahl (S.view, S.ui) je Gerät im localStorage
//  - private Details in Texten (Anbieter, Daten, Geräteaufbau) durch Werte aus den Daten oder neutral ersetzt
//  - v0.4: nur Anzeige – Eingabefelder gesperrt, Bearbeiten folgt in 4b
import { createCalc, shiftYear, weekKey, carBucket } from './calc.js';

let S = null, A = null, C = null;
const VIEW_KEY = 'eb_view_v1';
const VIEW_DEFAULTS = { view: { mode: 'all', key: '', from: '', to: '', cmp: 'none', cfrom: '', cto: '' },
  ui: { meterFilter: 'all', yoyGroup: 'wp', logCar: 'leon', logGran: 'month' } };
function loadView() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch (e) { v = {}; }
  return { view: { ...VIEW_DEFAULTS.view, ...(v.view || {}) }, ui: { ...VIEW_DEFAULTS.ui, ...(v.ui || {}) } };
}
// Referenz: persist() speicherte alles; hier nur die Ansicht (Daten schreibt db.js)
function persist() { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: S.view, ui: S.ui })); } catch (e) { /* privat/voll */ } }

export function setModel(state) {
  const v = loadView();
  S = { ...state, view: v.view, ui: v.ui };
  C = createCalc(S);
  A = C.A;
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
const abschlagCheck = g => C.abschlagCheck(g);
const odoPoints = car => C.odoPoints(car);
const kmDaily = car => C.kmDaily(car);
const carCostItems = car => C.carCostItems(car);
const fuelStats = () => C.fuelStats();
const fuelPrice = n => C.fuelPrice(n);
const carCalc = () => C.carCalc(today());
const finData = (f, t) => C.finData(f, t, today());

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

const PERIOD_PAGES = ["p-overview","p-fin","p-pv","p-batt","p-cost"];
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
  const mo={}; groups.forEach(([g])=>{ for(const [d,k] of Object.entries(groupSeries(g).daily)){ const key=monthKey(d); mo[key]=mo[key]||{}; mo[key][g]=(mo[key][g]||0)+k; } });
  const ks=Object.keys(mo).sort();
  chart("mt-month",{type:"bar",data:{labels:ks.map(monthLabel),datasets:groups.map(([g,l,c])=>({label:l,data:ks.map(k=>mo[k][g]||0),backgroundColor:css(c)}))},
    options:{plugins:{tooltip:numTip("kWh")},scales:{y:{title:{display:true,text:"kWh"}}}}});
  const yg=S.ui.yoyGroup||"wp"; $("mt-yoy-g").value=yg;
  const ser=groupSeries(yg).daily, yy={}; for(const [d,k] of Object.entries(ser)){ const y=d.slice(0,4), m=+d.slice(5,7)-1; yy[y]=yy[y]||Array(12).fill(null); yy[y][m]=(yy[y][m]||0)+k; }
  const pal=["--loss","--grid","--sun","--heat"];
  chart("mt-yoy",{type:"bar",data:{labels:MON,datasets:Object.keys(yy).sort().map((y,i)=>({label:y,data:yy[y],backgroundColor:css(pal[i%pal.length])}))},
    options:{plugins:{tooltip:numTip("kWh")},scales:{y:{title:{display:true,text:"kWh"}}}}});
}

/* ---------- Charts ---------- */
const charts = {};
function chart(id, cfg){
  if(charts[id]) charts[id].destroy();
  const ctx = $(id); if(!ctx || typeof Chart==="undefined") return;
  Chart.defaults.font.family = '"Public Sans", system-ui, sans-serif';
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--line");
  cfg.options = Object.assign({responsive:true, maintainAspectRatio:false, locale:"de-DE", animation:{duration:250}, interaction:{mode:"index",intersect:false},
    plugins:{legend:{position:"bottom",labels:{boxWidth:10,boxHeight:10}}}}, cfg.options||{});
  charts[id] = new Chart(ctx, cfg);
}
const numTip = (unit,d=0) => ({callbacks:{label:c=>`${c.dataset.label}: ${nf(c.parsed.y,d)} ${unit}`}});

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
    kpi(inv>0 ? nf(inv/sav12,1)+" Jahre" : "offen","Einfache Amortisation", inv>0?`Investition ${eur(inv)}, Basis letzte 12 Monate`:"Investitionskosten fehlen noch");
  const sr = ankerSeries(["gen","use","imp","feed"],from,to), is=IMPORT_START();
  chart("ov-month",{type:"bar",data:{labels:sr.labels,datasets:[
    {label:"Erzeugung",data:sr.rows.map(r=>r.gen),backgroundColor:css("--sun-soft"),borderColor:css("--sun"),borderWidth:1,order:3},
    {type:"line",label:"Genutzt",data:sr.rows.map(r=>r.use),borderColor:css("--sun"),backgroundColor:css("--sun"),pointRadius:0,tension:.3,order:1},
    {type:"line",label:"Netzbezug",data:sr.ks.map((k,j)=>(sr.g==="day"?k:monthKey(k))>=(sr.g==="day"?is:monthKey(is))?sr.rows[j].imp:null),borderColor:css("--grid"),backgroundColor:css("--grid"),pointRadius:0,tension:.3,order:1},
    {label:"Einspeisung",data:sr.rows.map(r=>r.feed),backgroundColor:css("--feed"),order:2}]},
    options:{plugins:{tooltip:numTip("kWh",1)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh"}}}}});
  $("ov-mtitle").textContent = sr.g==="day" ? "Tagesbilanz PV-Messkreis" : "Monatsbilanz PV-Messkreis";
  $("ov-cmp-panel").hidden = !C;
  if(C){
    const g=gran(from,to), a=ankerSeries(["gen","use"],from,to,g), b=ankerSeries(["gen","use"],C.from,C.to,g);
    const n=Math.max(a.ks.length,b.ks.length);
    $("ov-cmp-note").textContent = `Erzeugung und genutzter Solarstrom je ${g==="day"?"Tag":"Monat"}, nach Position im Zeitraum ausgerichtet.`;
    chart("ov-cmp",{type:"bar",data:{labels:[...Array(n).keys()].map(i=>a.labels[i]||b.labels[i]),datasets:[
      {label:"Erzeugung "+P.label,data:a.rows.map(r=>r.gen),backgroundColor:css("--sun")},
      {label:"Erzeugung Vergleich",data:b.rows.map(r=>r.gen),backgroundColor:css("--sun-soft")},
      {type:"line",label:"Genutzt "+P.label,data:a.rows.map(r=>r.use),borderColor:css("--batt"),backgroundColor:css("--batt"),pointRadius:0,tension:.3},
      {type:"line",label:"Genutzt Vergleich",data:b.rows.map(r=>r.use),borderColor:css("--batt"),borderDash:[4,3],backgroundColor:css("--batt"),pointRadius:0,tension:.3}]},
      options:{plugins:{tooltip:numTip("kWh",1)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh"}}}}});
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
    options:{plugins:{legend:{display:false},tooltip:numTip("%")},scales:{x:{ticks:{maxTicksLimit:14}},y:{max:100,title:{display:true,text:"%"}}}}});
  const cols=["--sun","--batt","--grid","--heat"];
  chart("pv-str",{type:"line",data:{labels:sr.labels,datasets:["pv1","pv2","pv3","pv4"].map((p,i)=>({label:"Strang "+(i+1),data:sr.rows.map(r=>r[p]),borderColor:css(cols[i]),backgroundColor:css(cols[i]),pointRadius:sr.g==="day"?0:2,tension:.3}))},
    options:{plugins:{tooltip:numTip("kWh",1)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh"}}}}});
  chart("pv-yield",{type:"bar",data:{labels:sr.labels,datasets:[{label:"kWh je kWp",data:sr.rows.map(r=>r.gen/kwp),backgroundColor:css("--sun")}]},
    options:{plugins:{legend:{display:false},tooltip:numTip("kWh/kWp",1)},scales:{x:{ticks:{maxTicksLimit:14}},y:{title:{display:true,text:"kWh je kWp"}}}}});
  chart("pv-use",{type:"bar",data:{labels:sr.labels,datasets:[
    {label:"Direkt ins Haus",data:sr.rows.map(r=>r.s2h),backgroundColor:css("--sun"),stack:"s"},
    {label:"In den Speicher",data:sr.rows.map(r=>r.s2b),backgroundColor:css("--batt"),stack:"s"},
    {label:"Eingespeist",data:sr.rows.map(r=>r.feed),backgroundColor:css("--feed"),stack:"s"}]},
    options:{plugins:{tooltip:numTip("kWh",1)},scales:{x:{stacked:true,ticks:{maxTicksLimit:14}},y:{stacked:true,title:{display:true,text:"kWh"}}}}});
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
    ${row("Bisher gezahlt",r=>`${eur(r.paid)} (${r.nPaid} Abschläge)`)}
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
  const add=(grp,out)=>{ const s=groupSeries(grp); for(const [d,k] of Object.entries(s.daily)){ if(d<P.from||d>P.to) continue; const t=tariffAt(grp,d); if(!t) continue; const key=bucketOf(d,g); out[key]=(out[key]||0)+k*t.ap/100+t.gp/365; } };
  add("as",mA); add("wp",mW);
  const ks=[...new Set([...Object.keys(mA),...Object.keys(mW)])].sort();
  chart("ct-month",{type:"bar",data:{labels:ks.map(k=>bucketLabel(k,g)),datasets:[
    {label:"Allgemeinstrom",data:ks.map(k=>mA[k]||0),backgroundColor:css("--grid"),stack:"s"},
    {label:"Wärmepumpe",data:ks.map(k=>mW[k]||0),backgroundColor:css("--heat"),stack:"s"}]},
    options:{plugins:{tooltip:numTip("€",2)},scales:{x:{stacked:true,ticks:{maxTicksLimit:14}},y:{stacked:true,title:{display:true,text:"€ ohne Boni"}}}}});
  $("ct-mtitle").textContent = g==="day" ? "Tägliche Kosten" : "Monatliche Kosten";
  renderAbschlag();
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
  // Investition
  const inv=S.invest.reduce((x,y)=>x+(+y.cost||0),0), realized=pvSavings(A.dates[0],A.dates[A.n-1]).eur, r12=last12(), base=pvSavings(r12.from,r12.to).eur;
  const items=[...S.invest].sort((x,y)=>(x.date||"9").localeCompare(y.date||"9"));
  const invTbl = `<div class="tbl-wrap"><table><thead><tr><th>Datum</th><th class="l">Position</th><th>Betrag</th></tr></thead><tbody>${
    items.map(x=>`<tr><td>${dde(x.date)}</td><td class="l" style="white-space:normal">${esc(x.name)}</td><td style="color:${+x.cost<0?"var(--ok)":"inherit"}">${eur(+x.cost||0,2)}</td></tr>`).join("")}</tbody><tfoot><tr><td>Summe</td><td></td><td>${eur(inv,2)}</td></tr></tfoot></table></div><p class="note">Bearbeiten unter „Amortisation“. Verkäufe mindern die Investition.</p>`;
  $("fin-inv").innerHTML = invTbl + (inv>0
    ? `<div class="grid g3" style="margin-top:10px">${kpi(eur(inv),"Investition PV")}${kpi(eur(realized),"Bereits erwirtschaftet",pct(realized/inv)+" der Investition")}${kpi(realized>=inv?"erreicht":nf((inv-realized)/base,1)+" Jahre","Bis zum Break-even",realized>=inv?"":`Noch ${eur(inv-realized)} bei ${eur(base)} pro Jahr`)}</div>`
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
  $("am-kpis").innerHTML =
    kpi(eur(inv,2),"Investition gesamt", `${S.invest.length} Positionen, Verkäufe abgezogen`) +
    kpi(eur(base),"Ersparnis letzte 12 Monate","Nur Arbeitspreis") +
    kpi(tl.be?monthLabel(tl.be):"–","Break-even", tl.be?`${nf(beYears,1)} Jahre nach der ersten Investition`:"Nicht innerhalb der Betrachtungsdauer") +
    kpi(eur(realized),"Bereits erwirtschaftet",`Seit ${dde(A.dates[0])}${inv?`, ${pct(realized/inv)} der Investition`:""}`);
  $("am-inv").innerHTML = `<thead><tr><th class="l">Position</th><th class="l">Datum</th><th>Kosten €</th><th></th></tr></thead><tbody>${
    S.invest.map((x,i)=>`<tr><td class="l"><input type="text" style="min-width:320px" value="${esc(x.name)}" data-inv="${i}" data-k="name"></td><td class="l"><input type="date" value="${esc(x.date)}" data-inv="${i}" data-k="date"></td><td><input type="number" step="0.01" value="${x.cost}" data-inv="${i}" data-k="cost" style="width:110px"></td><td><button class="x" data-del-inv="${i}" aria-label="Löschen">×</button></td></tr>`).join("")}</tbody><tfoot><tr><td>Summe</td><td></td><td>${eur(inv,2)}</td><td></td></tr></tfoot>`;
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

const PAGES=[["p-overview","--sun"],["p-fin","--ok"],["p-pv","--sun"],["p-batt","--batt"],["p-meter","--heat"],["p-cost","--grid"],["p-amort","--sun"],["p-car","--warn"],["p-log","--muted"],["p-data","--loss"]];
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
    ({ "p-overview":renderOverview, "p-fin":renderFinance, "p-pv":renderPV, "p-batt":()=>renderBattery(first), "p-meter":renderMeters, "p-cost":renderCosts,
       "p-amort":()=>renderAmort(first), "p-car":()=>renderCar(first), "p-log":renderLog, "p-data":renderData })[current]();
  }catch(err){ console.error(err); $("main").insertAdjacentHTML("afterbegin",flag("Fehler bei der Berechnung: "+esc(err.message))); }
  afterRender();
}
function route(){ const h=location.hash.slice(1)||"overview"; const id="p-"+h; show(PAGES.some(p=>p[0]===id)?id:"p-overview"); }

/* ---------- Daten-Seite: Ereignisse (nur Anzeige) ---------- */
function renderData(){
  $("ev-tbl").innerHTML = `<thead><tr><th>Datum</th><th class="l">Bereich</th><th class="l">Ereignis</th></tr></thead><tbody>${
    [...S.events].sort((a,b)=>a.d.localeCompare(b.d)).map(e=>`<tr><td>${dde(e.d)}</td><td class="l">${{wp:"Wärmepumpe",as:"Allgemeinstrom",pv:"PV",car:"Auto"}[e.group]||esc(e.group)}</td><td class="l">${esc(e.text)}</td></tr>`).join("")}</tbody>`;
}

/* ---------- Nach jedem Rendern ---------- */
// v0.4 nur Anzeige: alle Eingaben in den Seiten sperren, außer Zeitraum, Anzeige-Auswahl und Import
const VIEW_INPUTS = new Set(["pb-mode","pb-key","pb-from","pb-to","pb-cmp","pb-cfrom","pb-cto","rd-filter","mt-yoy-g","lg-car","lg-gran","csv-file","seed-file","seed-replace"]);
function afterRender(){
  document.querySelectorAll("[data-sm]").forEach(e=>e.textContent=dde(IMPORT_START()));
  if(!document.body.classList.contains("ro")) return;
  document.querySelectorAll("#main input, #main select, #main button").forEach(el=>{
    if(VIEW_INPUTS.has(el.id) || el.closest("#csv-result, #seed-result")) return;
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
    window.addEventListener("hashchange",route);
    if(window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>rerender());
  }
  Object.keys(rendered).forEach(k=>delete rendered[k]);
  route();
}
export { route, rerender };

// Für den Seitenvergleich im Test (tests/…/compare): Diagrammdaten lesbar machen
window.__ebCharts = charts;
