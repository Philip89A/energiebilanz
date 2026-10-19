// v0.38: Deutung der Karten „Zusammenhänge“ in Alltagssprache. Rein und testbar: Eingabe sind die Karten aus
// calc.relations() und Preise; Ausgabe je Karte vier Zeilen (Ergebnis, Wie sicher, Was es ausmacht, Was tun) plus
// eine Lesehilfe, dazu eine Zusammenfassung der Karten mit der größten Wirkung in Euro (nur belastbare).

const nf = (v, d = 0) => (v == null || !isFinite(v) ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const kwh = (v, d) => `${nf(v, d ?? (Math.abs(v) < 1 ? 2 : Math.abs(v) < 10 ? 1 : 0))} kWh`;
const eur = v => `${nf(v, Math.abs(v) < 10 ? 1 : 0)} €`;
const pct = v => `${nf(v * 100)} %`;
const sgn = (v, f) => (v >= 0 ? '+' : '−') + f(Math.abs(v));
const more = (v, f) => `${f(Math.abs(v))} ${v >= 0 ? 'mehr' : 'weniger'}`;

export const NEED = { hint: 10, solid: 30 };

// R² in Worten: wie viel der Schwankung erklärt die waagrechte Größe?
export function sureText(f, unit = 'Tage', xName = null) {
  if (!f || f.r2 == null) return `Erst ${nf(f?.n || 0)} ${unit} mit allen Werten – noch keine Aussage möglich.`;
  const r = f.r2, word = r >= 0.6 ? 'stark' : r >= 0.3 ? 'deutlich' : r >= 0.1 ? 'schwach' : 'kaum';
  const verdict = f.n >= NEED.solid && r >= 0.3 ? 'Das Ergebnis ist belastbar.' : f.n >= NEED.hint && r >= 0.1 ? 'Das ist ein Hinweis, noch kein sicheres Ergebnis.' : 'Das reicht noch nicht für eine Aussage.';
  return `Der Zusammenhang ist ${word}: ${xName ? `„${xName}“` : 'die waagrechte Größe'} erklärt etwa ${pct(r)} der Schwankung. Grundlage: ${nf(f.n)} ${unit}. ${verdict}`;
}

// Wie lange noch, bis eine Karte eine Einschätzung liefert (bei einem neuen Punkt je Tag)
export function waitText(n, unit = 'Tage') {
  if (n >= NEED.solid) return null;
  const goal = n < NEED.hint ? NEED.hint : NEED.solid, rest = goal - n;
  return `Noch etwa ${nf(rest)} ${unit} mit Werten, dann gibt es ${goal === NEED.hint ? 'eine erste Einschätzung' : 'ein belastbares Ergebnis'}.`;
}

const HELP = {
  scatter: (c) => `Jeder Punkt ist ein ${c.monthly ? 'Monat' : 'Tag'}: waagrecht „${c.x}“, senkrecht „${c.y}“. Die gestrichelte Linie ist die Gerade, die am besten durch die Punkte passt; ihre Steigung sagt, wie stark die senkrechte Größe mitwandert. Farben trennen Gruppen (Jahreszeit, Phase nach einer Einstellungsänderung oder Sonderfälle). Liegen die Punkte eng an der Linie, ist der Zusammenhang stark (R² nahe 1); eine Wolke ohne Richtung heißt: kein erkennbarer Zusammenhang. Ein Zusammenhang ist noch keine bewiesene Ursache.`,
  bars: () => 'Jeder Balken ist der Durchschnitt eines Wochentags: Allgemeinstrom des Haushalts minus die Geräte mit Messsteckdose. Was übrig bleibt, ist Grundlast plus alles Ungemessene (Licht, Kochen, Router, Laden).',
};

function phaseCompare(list, key) {
  const ok = (list || []).filter(p => p.n >= 3 && p[key] != null);
  if (ok.length < 2) return null;
  const a = ok[ok.length - 2], b = ok[ok.length - 1];
  return { a, b, diff: b[key] - a[key], rel: a[key] ? b[key] / a[key] - 1 : null };
}

// Je Karte: { result, sure, effect, todo, help, euro } – euro = Wirkung im Jahr (für die Rangfolge), sonst null
export function explainCard(c, { pAs = null, pWp = null } = {}) {
  const f = c.f || {}, e = c.extra || {}, out = { id: c.id, result: null, sure: null, effect: null, todo: null, help: c.bars ? HELP.bars() : HELP.scatter(c), euro: null };
  const has = f.slope != null && f.n >= NEED.hint, wait = c.bars ? null : waitText(f.n || 0, c.monthly ? 'Monate' : 'Tage');
  if (!c.bars) out.sure = sureText(f, c.monthly ? 'Monate' : 'Tage', (c.x || '').replace(/ \(.*\)$/, ''));
  switch (c.id) {
    case 'freezer': {
      if (has) {
        const rel = f.my ? f.slope / f.my : null, yr = f.slope * 3 * 365;
        out.result = `Ist es ${c.x.replace(/ °C$/, '').replace(/^Temperatur /, 'im Raum ').replace(/^Außentemperatur$/, 'draußen')} 1 °C wärmer, braucht der Gefrierschrank ${more(f.slope, v => kwh(v, 3))} am Tag${rel != null ? ` (${sgn(rel, pct)})` : ''}.`;
        const ws = e.wash != null ? ` An Wäschetagen (${nf(e.nWash)}) braucht er im Schnitt ${more(e.wash - e.dry, v => kwh(v, 3))}${Math.abs(e.wash / e.dry - 1) < 0.03 ? ' – praktisch kein Unterschied' : ''}.` : '';
        if (f.slope > 0) { out.euro = pAs ? yr * pAs : null; out.effect = `3 °C kühler am Standort wären etwa ${kwh(yr, 0)}${pAs ? ` oder ${eur(yr * pAs)}` : ''} im Jahr weniger.${ws}`; }
        else out.effect = `Kein Mehrverbrauch bei Wärme erkennbar.${ws}`;
        out.todo = f.slope > 0 && out.euro != null && out.euro >= 15 ? 'Lohnt sich: Gefrierschrank kühler stellen oder Lüftungsgitter freihalten, Wäsche nicht direkt daneben trocknen.' : 'Der Hebel ist klein – nichts ändern, außer ein Ersatz steht ohnehin an (neue Geräte brauchen oft die Hälfte).';
      } else out.todo = c.need || wait;
      break;
    }
    case 'vent': {
      if (has) out.result = `Läuft die Lüftung 0,1 kWh am Tag weniger (etwa 2–3 Stunden), ${f.slope <= 0 ? 'steigt' : 'sinkt'} die Feuchte im Schlafzimmer nachts um ${nf(Math.abs(f.slope * 0.1), 1)} Prozentpunkte stärker über das Tagesmittel.`;
      if (e.night != null) {
        out.effect = `Nachts im Schnitt ${nf(e.night)} % Luftfeuchte; in ${pct(e.highShare)} der Nächte über 60 %.`;
        out.todo = e.night >= 60 || e.highShare >= 0.3 ? 'Nachts die Lüftung auf kleinster Stufe laufen lassen statt aus; ab 60 % steigt das Schimmelrisiko an kalten Ecken.' : e.night < 40 ? 'Nachts eher zu trocken: die Lüftung darf nachts aus bleiben.' : 'Feuchte im grünen Bereich (40–60 %) – keine Änderung nötig.';
      } else out.todo = c.need || wait;
      if (!has && !out.todo) out.todo = wait;
      break;
    }
    case 'heat': {
      const pc = phaseCompare(e.phases, 'perGt');
      if (has) out.result = `Jeder Gradtag kostet ${kwh(f.slope, 2)} Heizstrom (ein Tag mit 5 °C draußen hat ${nf(e.tRoom - 5)} Gradtage).`;
      if (pc) {
        const yr = e.gtYear ? pc.diff * e.gtYear : null;
        out.result = (out.result ? out.result + ' ' : '') + `Seit „${pc.b.g}“: ${kwh(pc.b.perGt, 2)} je Gradtag statt ${kwh(pc.a.perGt, 2)} (${sgn(pc.rel, pct)}, ${nf(pc.b.n)} gegen ${nf(pc.a.n)} Tage).`;
        if (yr != null) { out.euro = pWp ? -yr * pWp : null; out.effect = `Hochgerechnet auf ein Heizjahr (${nf(e.gtYear)} Gradtage): ${sgn(yr, v => kwh(v, 0))}${pWp ? ` oder ${sgn(yr * pWp, eur)}` : ''}.`; }
      }
      if (e.rooms && e.rooms.length) {
        const cold = e.rooms.filter(r => r.t != null && r.t < 19.5), warm = e.rooms.filter(r => r.t != null && r.t > 22.5);
        out.effect = (out.effect ? out.effect + ' ' : '') + (cold.length ? `Zu kühl: ${cold.map(r => r.name).join(', ')}.` : warm.length ? `Wärmer als nötig: ${warm.map(r => r.name).join(', ')} – jedes Grad weniger spart etwa 6 % Heizenergie.` : 'Die Räume erreichen ihre Temperatur.');
      }
      out.todo = pc && pc.b.n < 14 ? `Die neue Phase hat erst ${nf(pc.b.n)} Tage – ab 14 Tagen ist der Vergleich aussagekräftiger.` : !has ? (c.need || wait) : pc && pc.rel < -0.05 ? 'Die Änderung wirkt – beibehalten.' : pc && pc.rel > 0.05 ? 'Seit der Änderung mehr Strom je Gradtag – Einstellung prüfen.' : 'Einstellung halten und nach dem nächsten Kälteeinbruch wieder ansehen.';
      break;
    }
    case 'dhw': {
      const pc = phaseCompare(e.phases, 'kwhDay');
      if (has && f.slope > 0) out.result = `Je 100 Liter Wasser am Tag steigt der Warmwasser-Strom um ${kwh(f.slope * 100, 2)}.`;
      if (has && e.base != null) {
        const b = Math.max(0, e.base), yr = b * 365;
        out.effect = `Ohne Zapfung blieben ${kwh(b, 2)} am Tag – das ist die Bereitschaft (Speicher, Leitungen, Zirkulation), ${kwh(yr, 0)}${pWp ? ` oder ${eur(yr * pWp)}` : ''} im Jahr.`;
      }
      if (pc) {
        const yr = pc.diff * 365;
        out.result = (out.result ? out.result + ' ' : '') + `Seit „${pc.b.g}“: ${kwh(pc.b.kwhDay, 2)} Warmwasser-Strom am Tag statt ${kwh(pc.a.kwhDay, 2)} (${sgn(pc.rel, pct)}, ${nf(pc.b.n)} gegen ${nf(pc.a.n)} Tage).`;
        out.euro = pWp ? -yr * pWp : null;
        out.effect = (out.effect ? out.effect + ' ' : '') + `Aufs Jahr: ${sgn(yr, v => kwh(v, 0))}${pWp ? ` oder ${sgn(yr * pWp, eur)}` : ''} (ohne Bereinigung um den Wasserverbrauch).`;
      }
      out.todo = pc && pc.b.n < 7 ? `Die aktuelle Phase hat erst ${nf(pc.b.n)} Tage – eine volle Woche abwarten, Wasserzähler zu Beginn und Ende ablesen.` : !has && !pc ? (c.need || wait || 'Wasserzähler wöchentlich ablesen, dann trennt die Karte Zapfung und Bereitschaft.') : !has ? 'Wasserzähler wöchentlich ablesen, dann lässt sich die Bereitschaft von der Zapfung trennen.' : 'Bereitschaft senken: Zirkulation nur zu Nutzungszeiten, Speichertemperatur nicht höher als nötig.';
      break;
    }
    case 'ventheat': {
      if (has) out.result = f.slope < 0 ? `Läuft die Lüftung mehr, braucht die Heizung je Gradtag ${kwh(-f.slope * 0.1, 3)} weniger je 0,1 kWh Lüftung – die Wärmerückgewinnung zeigt Wirkung.` : `Mehr Lüftung geht nicht mit weniger Heizstrom einher (${sgn(f.slope * 0.1, v => kwh(v, 3))} je Gradtag und 0,1 kWh Lüftung).`;
      out.todo = !has ? (c.need || wait || 'Erst im Winter mit vielen Gradtagen aussagekräftig.') : f.slope < 0 ? 'Lüftung im Winter durchlaufen lassen; Fenster zu.' : 'Kein Spareffekt messbar – Lüftung nach Luftqualität und Feuchte einstellen, nicht nach Heizstrom.';
      break;
    }
    case 'wash': {
      if (e.share != null) out.result = `Die Waschmaschine braucht etwa ${pct(e.share)} des Wassers im Haus.`;
      if (e.lPerWash != null) out.effect = `${nf(e.lPerWash)} Liter je Wäsche; moderne Maschinen liegen bei 40–60 Litern${e.lPerWash > 60 ? ' – eher viel, oft wegen vieler heißer Programme oder kleiner Ladungen' : ''}.`;
      out.sure = e.share != null ? `Grundlage ${nf(f.n)} Monate mit Wasserzähler-Werten; zwischen zwei Ablesungen ist das Wasser gleichmäßig verteilt.` : out.sure;
      out.todo = e.share == null ? (c.need || 'Wasserzähler monatlich ablesen, dann vergleicht die Karte echte Monate.') : e.share > 0.25 ? 'Volle Ladungen und Eco-Programme nutzen.' : 'Unauffällig – nichts zu tun.';
      break;
    }
    case 'base': {
      const v = (c.bars || []).filter(x => x != null);
      if (v.length) {
        const avg = v.reduce((a, b) => a + b, 0) / v.length, mx = Math.max(...v), mi = c.bars.indexOf(mx), mn = Math.min(...v);
        out.result = `Ohne die gemessenen Geräte bleiben im Schnitt ${kwh(avg, 1)} am Tag; am meisten am ${['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][mi]} (${kwh(mx, 1)}, ${sgn(mx / avg - 1, pct)}).`;
        out.effect = pAs ? `Das sind ${eur(avg * 365 * pAs)} im Jahr; der Unterschied zwischen stärkstem und schwächstem Tag beträgt ${kwh(mx - mn, 1)}.` : null;
        out.sure = `Grundlage: ${nf(c.f.n)} Tage.${c.f.n < 28 ? ' Unter vier Wochen kann ein einzelner Tag den Wochentag verzerren.' : ''}`;
        out.todo = mx / avg > 1.3 ? 'Am auffälligen Wochentag nach Gewohnheiten suchen (Wäschetrockner, Backen, Laden) – oder dort eine weitere Messsteckdose setzen.' : 'Gleichmäßig über die Woche. Nächster Schritt: die größten ungemessenen Verbraucher mit einer Messsteckdose finden.';
      } else out.todo = 'Allgemeinstrom-Ablesungen und Anker-Daten fehlen für den Zeitraum.';
      break;
    }
    case 'pv': {
      if (has) out.result = `Jede kWh PV am Tag senkt den Netzbezug um ${kwh(-f.slope, 2)}${e.sunny != null ? `; an den sonnigsten Tagen bleiben trotzdem ${kwh(e.sunny, 1)} Netzbezug (Abend und Nacht, wenn der Speicher leer ist)` : ''}.`;
      if (e.fullShare != null) out.effect = `An ${pct(e.fullShare)} der Tage war der Speicher voll und speiste ein (Netzbezug dann ${kwh(e.full ?? 0, 1)} statt ${kwh(e.notFull ?? 0, 1)}).`;
      out.todo = !has ? (c.need || wait) : e.fullShare != null && e.fullShare >= 0.3 && e.sunny != null && e.sunny >= 1 ? 'Mehr Speicher würde helfen: an vielen Tagen läuft er voll, und abends kommt trotzdem Netzstrom.' : e.fullShare != null && e.fullShare < 0.1 ? 'Der Speicher wird selten voll – mehr Speicher brächte wenig; mehr PV (Ausbau) wirkt stärker.' : 'Speicher und PV passen zueinander; große Verbraucher in die Sonnenstunden legen.';
      break;
    }
  }
  if (!out.result && !c.bars) out.result = f.n ? 'Noch kein erkennbares Ergebnis.' : 'Noch keine Tage mit allen nötigen Werten.';
  return out;
}

export function explainAll(cards, prices) {
  const list = cards.map(c => explainCard(c, prices));
  const top = list.map((x, i) => ({ ...x, c: cards[i] })).filter(x => x.c.v === 'belastbar' && x.euro != null && Math.abs(x.euro) >= 1)
    .sort((a, b) => Math.abs(b.euro) - Math.abs(a.euro)).slice(0, 3)
    .map(x => ({ id: x.id, title: x.c.title, euro: x.euro, text: x.result }));
  return { list, top };
}
