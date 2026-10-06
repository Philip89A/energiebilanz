# Changelog

## v0.1 – Phase 1: Grundlage
- Repo angelegt, `.gitignore` schließt `data/` und `reference/` aus (Referenz-HTML enthält alle Messdaten).
- `supabase/schema.sql` v2: Fremdschlüssel Zählerstände → Zähler; `created_at`/`updated_at` mit Trigger;
  Prüfregeln wie in der Referenz; ein Abschlag je Gruppe und Startdatum; `events.note` statt `events.text`;
  `anker_daily.smart_plug`; Policies mit `(select auth.uid())`; `anon` ohne Rechte.
- Login per E-Mail + Passwort statt Magic Link (wie M&M-Tracker; Magic Link landet auf dem iPhone in Safari
  statt in der installierten App). Registrierung in Supabase geschlossen.
- `view`/`ui` werden je Gerät im localStorage gehalten, nicht in `settings` (sonst springt die Ansicht
  auf allen Geräten um). `abschlag` und `version` aus dem Seed entfallen (Altbestand).
- `config.js` mit Supabase-URL und Publishable-Key.

## v0.1.1 – CLAUDE.md aufgeteilt
- Öffentliche `CLAUDE.md`: Arbeitsweise, Phasen, Mapping (auf Schema v2 aktualisiert), Rechenregeln.
- Referenzwerte, Tarife, Verträge, Zählerstände, Fahrzeugkonditionen und offene Punkte nach `data/REFERENZ.md`
  (nur lokal). Grund: öffentliches Repo, Mess- und Vertragsdaten gehören nicht hinein.

## v0.2 – Phase 2: Import
- Login-Seite (E-Mail + Passwort, „Passwort vergessen“) und Seite „Daten“ mit Datenstand je Tabelle.
- Startdaten-Import (`seed_state.json`): Vorschau mit Mengen und Kontrollsummen, Schreiben in fester Reihenfolge,
  Rückprüfung durch Zurücklesen. Tabellen ohne natürlichen Schlüssel nur in leere Tabellen oder mit
  „Vorhandene ersetzen“ (ersetzt nur Tabellen, für die der Seed Daten mitbringt; Tankbuch bleibt unberührt).
- Anker-CSV-Import: erkennt Spalten über normalisierte Namen (Anker nutzt U+2011 und U+202F in den Köpfen),
  Komma- und Semikolon-Format, zeigt neue / geänderte / ergänzte Tage vor dem Übernehmen. Leere Zellen
  überschreiben keine vorhandenen Werte.
- Zählabfragen brechen ab, wenn Supabase keine Anzahl liefert (sonst könnte ein zweiter Import doppeln).
- Summen exakt in Tausendsteln (Wh bzw. 0,1 ct).
- Tests: `node --test tests/*.test.mjs` (synthetisch im Repo; Referenztests lesen `data/`, sonst übersprungen).
- supabase-js 2.117.2 lokal unter `vendor/`.

## v0.3 – Phase 3: Rechenlogik
- `js/calc.js`: alle Kennzahlen der Referenz als reine Funktionen (Anker-Kennzahlen, Zeiträume und Vergleich,
  Zählerverteilung mit Zählertausch, Stromkosten nach Tagestarif mit Boni, PV-Ersparnis, Wert des Speichers,
  Amortisation mit Break-even, Abschlag-Check, Auto-Vergleich, Kilometer, Kosten & Ersparnisse je Jahr,
  Zählerabgleich, Wärmepumpe vorher/nachher). Nah am Original gehalten, damit Zeile für Zeile prüfbar.
- `stateFromDb`: Supabase-Zeilen → Rechenmodell; getestet, dass beide Wege identische Ergebnisse liefern.
- `sumRange` summiert exakt in Wh (Referenz: Fließkomma), Unterschied < 1e-9, trifft aber exakte ,x5-Werte.
- „Heute“ als Parameter statt `new Date()` (nur Fahrzeugbuch betroffen) – Tests bleiben stabil.
- `scripts/golden.mjs` + Differenztest über 35 Zeiträume gegen die Referenz-HTML, alle Referenzwerte getroffen.

## v0.4 – Phase 4a: Seiten (nur Anzeige)
- Alle Seiten der Referenz: Überblick, Kosten & Ersparnisse, PV-Anlage, Batterie, Zähler & Wärmepumpe, Stromkosten
  mit Abschlag-Check, Amortisation, Auto-Vergleich, Tanken & Laden, Daten. Zeitraum und Vergleich wie in der
  Referenz, Auswahl je Gerät gespeichert.
- `js/views.js`: Anzeige-Code der Referenz übernommen, Rechnung aus calc.js, Daten aus Supabase (`loadAll`).
- Eingaben vorerst gesperrt (Bearbeiten folgt in 4b); Import-Karten auf der Seite „Daten“.
- Private Details aus Seitentexten entfernt (Anbieter, feste Daten, Geräteaufbau, Laufleistung); das
  Smart-Meter-Datum kommt aus den Ereignissen.
- Layout-Korrektur: Hauptspalte wächst nicht mehr mit breiten Tabellen (Referenz scrollte am Handy seitlich).
- Chart.js 4.4.1 lokal (`vendor/`), Systemschrift statt Google Fonts (offline, keine Anfrage an Google).
- `scripts/compare.mjs`: Seitenvergleich Referenz ↔ App, 1.626 Textblöcke und 136 Diagramme identisch bis auf
  die gewollten Textänderungen.

## v0.4.1 – Fehlerbehebung Laden nach Update
- Problem: Nach dem Update auf v0.4 kombinierte der Browser die neue Seite mit zwischengespeicherten Dateien aus
  v0.2 (Styles, Skript). Ergebnis: keine Navigation, keine Kennzahlen, „Lade Daten …“ blieb stehen.
- Versionskennung `?v=` an allen Dateiverweisen und Modul-Imports (`scripts/set-version.mjs`), damit ein Update
  immer vollständig neue Dateien lädt.
- Lade- und Laufzeitfehler erscheinen als Hinweis am unteren Rand statt als halb leere Seite.
- Versionsanzeige in der Navigation.

## v0.5.0 – Phase 4b: Bearbeiten
- Erfassen, Ändern und Löschen wie in der Referenz: Zählerstände, Tarife, Abschläge, Investitionen, Tankvorgänge,
  Ladevorgänge, Fahrzeugbuch, Ereignisse. Jede Änderung schreibt genau einen Datensatz nach Supabase.
- Parameter (Batterie, PV-Offset, Amortisations-Regler, Autos) werden 0,7 s nach der letzten Änderung als
  Einstellungen gespeichert, damit beim Ziehen eines Reglers nicht jede Zwischenstellung geschrieben wird.
- Nach jeder Änderung rechnet die App neu; Speicherstatus in der Navigation („Speichert …“, „Gespeichert“).
- Scheitert ein Speichern (z. B. doppelter Abschlag am selben Tag), erscheint ein Hinweis und der Stand wird aus
  Supabase neu geladen – Anzeige und Datenbank laufen nicht auseinander.
- `scripts/edit-check.mjs`: 25 Prüfungen gegen ein simuliertes Supabase, alle grün. Nach Bearbeitungen stimmen
  die Kennzahlen weiter mit der Referenz überein (gleiche Änderungen dort gesetzt).
- Korrektur zu v0.4: Der Seitenvergleich zählte versteckte, leere Blöcke mit. Tatsächlich verglichen wurden
  210 sichtbare Textblöcke und 136 Diagramme; Ergebnis unverändert (nur gewollte Textabweichungen).
  `scripts/compare.mjs` berücksichtigt jetzt nur sichtbare Elemente.

## v0.6.0 – Phase 5: Handy-App und offline
- Installierbar („Zum Home-Bildschirm“): Manifest, Icons, Start auf der neuen Seite „Erfassen“.
- „Erfassen“: vier große Knöpfe für Zählerstand, Tanken, Laden und Fahrzeugbuch mit letztem Stand als Hilfe,
  Datum vorausgefüllt, Zahlentastatur, deutsche Zahlen („40,2“, „12.531,5“), Plausibilitätsprüfung (Stand oder
  Kilometerstand kleiner als zuvor → Rückfrage), €/l bzw. €/kWh und Verbrauch seit letztem Stand live.
- Offline: Service Worker hält die App vor, der letzte Datenstand liegt je Nutzer im Gerät. Ohne Netz erfasste
  Einträge werden vorgemerkt und bei Netz in Reihenfolge gesendet; Hinweise „Offline – Stand vom …“ und
  „n Einträge warten auf Senden“. Lehnt Supabase einen vorgemerkten Eintrag ab, wird er verworfen und gemeldet.
- Start zeigt sofort den lokalen Stand und aktualisiert dann aus Supabase (schneller Start am Handy).
- Abmelden fragt nach, wenn noch Einträge warten, und löscht den lokalen Stand.
- iOS: Eingabefelder mit 16 px Schrift (sonst zoomt Safari beim Antippen hinein).
- `scripts/offline-check.mjs`: 21 Prüfungen (Service Worker, Erfassen, offline vormerken, Neustart offline,
  Senden bei Netz, Serverfehler, Offline-Start ohne Sitzung) grün.

## v0.7.0 – Zahlungsbuch, Tarifrechner, Korrekturen
- **Zahlungsbuch** (Stromkosten und „Erfassen“): Abschläge, Erstattungen, Boni, Nachzahlungen; „Vorschlag übernehmen“
  legt die geplanten Abschläge aus dem Abschlagsplan an. Erfasste Abschläge ersetzen im Abschlag-Check die Annahme.
- **Abrechnung prüfen**: je Abrechnungsjahr Kosten laut Verbrauch × Tarif (abzüglich Boni) gegen den netto
  geflossenen Betrag; Erstattung/Nachzahlung gehört zum zuletzt beendeten Jahr.
- **Boni als Einzelposten** je Vertrag, optional mit Mengenbedingung (z. B. voller Neukundenbonus erst ab einer
  Jahresmenge); „In Posten aufteilen“ übernimmt die bisherige Notiz. Erhaltene Boni aus dem Zahlungsbuch.
  Braucht das Datenbank-Update `docs/UPDATE_V07.sql`.
- **Korrektur Abschlag-Check** (Abweichung von der Referenz): Offene Abschläge zählen mit dem Betrag, der an ihrem
  Fälligkeitstag gilt. Vorher wurde ein ab einem späteren Datum geänderter Abschlag ignoriert und das erwartete
  Ergebnis zu hoch ausgewiesen. Neue Zeilen „Nächster Abschlag“ und Quelle „laut Zahlungsbuch“/„angenommen“.
- **Break-even einheitlich**: Überblick und Kosten & Ersparnisse zeigen denselben Monat wie die Amortisation
  (vorher: Investition ÷ Jahresersparnis bzw. lineare Restlaufzeit – drei verschiedene Zahlen).
- **Gesamtbilanz Energie** (Kosten & Ersparnisse): PV-Ersparnis, Tarifwechsel gegenüber dem Vorvertrag und Boni
  getrennt – bewusst nicht in der Amortisation, weil Boni und Tarifwechsel auch ohne PV angefallen wären.
- **Tarifrechner** (neue Seite): Angebote mit dem Verbrauch der letzten 365 Tage (optional inkl. E-Auto), Jahr 1 mit
  Boni und ab Jahr 2; Wallbox nach §14a EnWG (ohne, Modul 1, Modul 2, Modul 1+3) und intelligentes Messsystem.
  Werte des Netzbetreibers als Eingabe, keine geschätzten Standardwerte.
- **Überblick**: Monatsgrafik ohne Vergleich über die volle Breite; gepunktete Linie „Netzbezug laut Zähler“ auch vor
  dem Smart Meter (Genauigkeit hängt an der Zahl der Ablesungen); Vergleichsgrafik mit kräftigeren Farben,
  Zeitraum in der Legende und beiden Zeiträumen im Tooltip.
- **Stromkosten**: Erklärung der monatlichen Kosten; Tooltip mit kWh, Arbeitspreis- und Grundpreisanteil.
- „Erfassen“: fünfter Knopf „Zahlung“ (Betrag aus dem Abschlagsplan vorausgefüllt).
- Tests: 39 Unit-Tests; `scripts/v07-check.mjs` 20 Prüfungen; Seitenvergleich zählt Diagramme jetzt als gleich,
  wenn alle Datenreihen der Referenz unverändert enthalten sind (zusätzliche Reihen erlaubt).

## v0.8.0 – Ausbau-Szenario „Weg B“
- **Neue Seite „Ausbau (Weg B)“**: grobe Amortisation für PV-Erweiterung, Zusatzspeicher und Wallbox gegenüber der
  heutigen Anlage, mit dem E-Auto ausdrücklich eingerechnet. Grund: Wallbox und PV-Erweiterung werden für das Auto
  angeschafft, eine Rechnung ohne Auto unterschätzt den Nutzen.
- Tagesmodell über die letzten 365 Tage (Anker + Netzbezug Allgemeinstrom laut Zähler), Reihenfolge Haus →
  Klimaanlage → Auto → Speicher → Einspeisung, optional abends Speicher → Auto. Kalibriert auf den gemessenen
  genutzten Solarstrom der heutigen Anlage (Faktor wird angezeigt).
- Ergebnis getrennt nach Paket, Anteil PV/Speicher und Anteil Wallbox; Auto-Anteile erst ab Übergabe des E-Autos
  (Startdatum aus dem Auto-Vergleich). Alternative ohne Wallbox umschaltbar: öffentlich laden oder Steckdose
  (deren Kosten mindern dann die Wallbox-Investition).
- **§14a EnWG an/aus**: eigener Betrag oder Modul 1, 2 bzw. 1+3 aus dem Tarifrechner (mit dem Netzladen des Szenarios).
- Kosten ohne Vorgabewerte (Angebotswerte gehören nicht ins öffentliche Repo); Hinweis, solange sie fehlen.
  Parameter in `settings.data.ausbau`, kein Schema-Update nötig.
- Bewusst unverändert: Der Auto-Vergleich bleibt wie in der Referenz. Die Seite weist darauf hin, dass der
  Wallbox-Vorteil nicht zusätzlich zum Auto-Vergleich gezählt werden darf.
- THG-Prämie nicht enthalten (gehört zum Auto, fällt mit jeder Lademöglichkeit an).
- Tests: 49 Unit-Tests (neu `tests/ausbau.test.mjs`), `scripts/v08-check.mjs` 24 Prüfungen; Seitenvergleich,
  Bearbeiten, Offline und v0.7 unverändert bestanden.

## v0.9.0 – Investition verfolgen (Wallbox, E-Auto zu Hause)
- **Schema v4** (`docs/UPDATE_V09.sql`, vor dem ersten Speichern einer Kategorie ausführen): `investments.category`
  (PV/Speicher, Wallbox, Sonstiges; leer = PV/Speicher). Ohne gesetzte Kategorie wird die Spalte nicht gesendet.
- **Amortisation**: Kategorie je Investition. Ab der ersten Wallbox-Investition zählt Laden zu Hause (Ladebuch, Ort
  „zu Hause“) als Ersparnis gegenüber öffentlichem Laden: kWh × (öffentlicher Preis − Arbeitspreis). Prognose
  ab Übergabe des E-Autos aus dem Auto-Vergleich (kWh zu Hause pro Jahr). Solarstrom im Auto steckt schon in der
  PV-Ersparnis (Anker „genutzt“) und wird nicht doppelt gezählt. Grund: Die Wallbox ist mehr als die Hälfte des
  Nutzens des Ausbaus; ohne sie sähe die Amortisation nach dem Einbau deutlich zu schlecht aus.
  Ohne Wallbox-Investition bleibt alles wie in der Referenz (Break-even in Überblick und Kosten & Ersparnisse
  rechnet mit, weil alle drei dieselbe Zeitleiste nutzen).
- **Stromkosten**: Block „E-Auto zu Hause“ (geladen zu Hause, geschätzter Netzanteil, Allgemeinstrom ohne E-Auto,
  Ersparnis gegenüber öffentlich) und Hinweis zum Abschlag ab Übergabe des E-Autos (erwartete kWh und € pro Monat),
  weil die Hochrechnung aus Zählerständen den neuen Verbrauch erst nach einigen Wochen kennt.
- **Tarifrechner**: Der Netzanteil des Ladens zu Hause wird aus dem Allgemeinstrom herausgerechnet, damit
  „inkl. E-Auto“ nicht doppelt zählt.
- **Ausbau (Weg B)**: Hinweis auf Doppelzählung mit dem Auto-Vergleich entfernt (der Auto-Vergleich ist ein
  allgemeiner Vergleich E-Auto gegen Verbrenner), stattdessen Verweis auf die Amortisation.
- Beispielwerte in Kommentaren (Boni-Posten) durch neutrale Zahlen ersetzt.
- Tests: 55 Unit-Tests (neu `tests/v09.test.mjs`), `scripts/v09-check.mjs` 13 Prüfungen; Seitenvergleich,
  Bearbeiten, Offline, v0.7 und v0.8 unverändert bestanden.

## v0.10.0 – Wetter
- **Schema v5** (`docs/UPDATE_V10.sql`): Tabelle `weather_daily` (Tagesmitteltemperatur, Globalstrahlung kWh/m²,
  Sonnenstunden) mit RLS wie alle Tabellen. Fehlt sie, läuft die App ohne Wetter weiter und zeigt einen Hinweis.
- **Datenquelle Open-Meteo** (`js/weather.js`, frei, ohne Schlüssel): Archiv bis etwa 6 Tage vor heute, die letzten
  Tage aus der Vorhersage-API. Ortssuche über Open-Meteo, Koordinaten auf 0,01° gerundet und nur in
  `settings.data.wx` gespeichert. Fehlende Tage werden beim Öffnen ergänzt, die letzten 10 Tage immer neu geholt.
- **Wärmepumpe wetterbereinigt** (Zähler & Wärmepumpe): Gradtage nach VDI 3807 (Raum 20 °C, Heizgrenze 15 °C,
  einstellbar) je Ableseintervall; Modell „Grundlast je Tag + Heizarbeit je Gradtag“ (kleinste Quadrate), getrennt
  vor und nach dem Gerätetausch; Jahresverbrauch auf das Wetter der letzten 365 Tage umgerechnet. Grund: Der
  bisherige Vergleich alt/neu hängt stark davon ab, wie kalt der jeweilige Winter war.
- **PV und Wetter** (PV-Anlage): Erzeugung gegen Einstrahlung je Monat, Ertragsfaktor (kWh je kWp und kWh/m²),
  Jahresvergleich getrennt nach Sonne und Anlage, auffällige Sonnentage (Hinweis auf Abregelung bei vollem Speicher).
- **Überblick**: Satz zur Sonne im laufenden Monat gegenüber dem Vorjahreszeitraum.
- Service Worker cacht `js/weather.js`; Open-Meteo geht wie Supabase immer direkt ins Netz.
- Anleitung für Updates: `docs/ANLEITUNG_UPDATES.md`.
- Tests: 62 Unit-Tests (neu `tests/v10.test.mjs`), `scripts/v10-check.mjs` 22 Prüfungen mit simuliertem Open-Meteo;
  alle bisherigen Prüfungen unverändert bestanden. Der echte Abruf ließ sich in der Entwicklungsumgebung nicht
  testen (Netzsperre), er läuft erstmals im Browser.

## v0.11.0 – Wärmepumpe laut Gerät, Wetter je Tag
- **Schema v6** (`docs/UPDATE_V11.sql`): Tabelle `hp_energy` (Auflösung Stunde/Tag/Monat, Strom nach Heizung,
  Warmwasser, Kühlung und Zuheizer, erzeugte Wärme, Außen-, Vorlauf- und Warmwassertemperatur) mit RLS.
- **Import des App-Exports der Wärmepumpe** (Daten → „Wärmepumpe: App-Export importieren“, `js/hp.js`): Vorschau,
  dann Speichern; vorhandene Zeitpunkte werden überschrieben, nichts gelöscht. Erzeugte Wärme = Strom-Anteil +
  Umgebungs-Anteil laut Export. Abgleich mit dem Zähler: Gerät und Zähler liegen über elf Monate auf etwa 1 %.
- **Zähler & Wärmepumpe → „Wärmepumpe laut Gerät“**: Strom, Wärme, Arbeitszahl (ohne Kühlung), Anteil
  Warmwasser für die letzten 12 Monate; Monatsgrafik (Heizung, Warmwasser, Kühlung, Zähler, Arbeitszahl),
  Tagesgrafik der letzten 90 Tage mit Außentemperatur, Monatstabelle mit Gradtagen und Heizstrom je Gradtag
  (nur Monate ab 100 Gradtagen).
- **PV und Wetter je Tag** bei Zeiträumen bis 62 Tage (wie die übrigen Grafiken), sonst je Monat.
- **Wetter im Tooltip** der Tagesgrafiken (Überblick Tagesbilanz, PV: Autarkie, Ertrag, Verwendung).
- Bewusst unverändert: Die Verteilung des Wärmepumpen-Zählers auf Tage bleibt gleichmäßig (Referenz). Eine
  Verteilung nach dem Geräteprofil wäre genauer und ist als eigener Schritt vorgeschlagen.
- Tests: 66 Unit-Tests (neu `tests/v11.test.mjs`, synthetische `tests/fixture_hp.csv`), `scripts/v11-check.mjs`
  17 Prüfungen; alle bisherigen Prüfungen unverändert bestanden.

## v0.12.0 – Wärmepumpen-Zähler nach Geräteprofil verteilt
- Zwischen zwei Ablesungen verteilt die App den Verbrauch der Wärmepumpe jetzt nach dem Profil aus der
  Wärmepumpen-App: Tageswerte, sonst Monatswert (abzüglich vorhandener Tageswerte) gleichmäßig auf die übrigen
  Tage des Monats. Nur wenn jeder Tag des Intervalls einen Wert hat; die Zählersumme je Intervall bleibt exakt.
  Grund: Die gleichmäßige Verteilung verschob Verbrauch zwischen Monaten (z. B. Februar/März und April um
  40–60 kWh); mit Profil liegen die Monate auf wenige kWh am Gerät. Abgestimmte Abweichung von der Referenz,
  wirkt nur mit importierten Gerätedaten (Seed und Seitenvergleich unverändert).
- Gerätedaten gelten erst ab dem Tauschtag (Ereignis Wärmepumpe/Gerät); im Tauschmonat wird der Monatswert nur
  auf die Tage ab dem Tausch verteilt, Intervalle der alten Wärmepumpe bleiben gleichmäßig.
- Wirkt überall, wo Tageswerte der Wärmepumpe genutzt werden (Monatsverbrauch, Jahresvergleich, Kosten je Monat,
  Zeiträume); Abschlag-Check und Intervallwerte ändern sich nicht (Summen je Ablesung bleiben gleich).
- Tests: 68 Unit-Tests (2 neue in `tests/v11.test.mjs`); alle Browser-Prüfungen und der Seitenvergleich bestanden.

## v0.13.0 – Zeitraum auf „Zähler & Wärmepumpe“
- Die Zeitraumleiste (gesamter Zeitraum, 12 Monate, Jahr, Quartal, Monat, frei, mit Vergleich) erscheint jetzt auch auf
  „Zähler & Wärmepumpe“; die Auswahl gilt wie bisher für alle Seiten gemeinsam.
- **Wärmepumpe laut Gerät**: Kennzahlen (Strom, Wärme, Arbeitszahl, Warmwasser-Strom pro Tag) für den Zeitraum, mit
  Vergleichswert und Abweichung; Monatsgrafik und Tabelle nur mit den Monaten im Zeitraum; Tagesgrafik für den
  ganzen Zeitraum bis 92 Tage, sonst die letzten 90 Tage. Fehlende Tageswerte werden aus dem Monatswert gleichmäßig
  verteilt (`hpDayRows`, ab dem Tauschtag) und hell dargestellt; der Hinweis nennt die Abdeckung.
  Grund: Vergleiche wie „Oktober 2026 gegen Oktober 2025“ für die neuen Warmwasser-Zeitfenster.
- **Verbrauch pro Monat** (Zähler) folgt dem Zeitraum, bis 62 Tage je Tag. Abgestimmte Abweichung von der Referenz
  (Diagramm mt-month, „Gesamter Zeitraum“ unverändert), im Kopf von `scripts/compare.mjs` vermerkt.
- **Wärmepumpe wetterbereinigt**: Grafik und Tabelle zeigen die Ableseintervalle im Zeitraum; das Modell rechnet
  weiterhin mit allen Daten.
- Unverändert: Zählerstände, Abgleich Hauptzähler, alt gegen neu, Monate im Jahresvergleich.
- Tests: 69 Unit-Tests, `scripts/v13-check.mjs` 15 Prüfungen; `v11-check` an die Tauschtag-Regel angepasst.

## v0.14.0 – Gastzugang (nur lesen)
- **Schema v7** (`docs/UPDATE_V14.sql`): Tabelle `shares` (Besitzer gibt Gast frei, nur per SQL Editor änderbar),
  Funktionen `eb_can_read`/`eb_can_write` und je Tabelle getrennte Regeln: Lesen eigene oder freigegebene Zeilen,
  Schreiben/Ändern/Löschen nur eigene und nur, wenn man nirgends Gast ist. Ersetzt die Regel `own_rows`.
  Grund: „nur lesen“ muss die Datenbank durchsetzen, weil der Schlüssel der App öffentlich ist.
  Lokal mit PostgreSQL 16 geprüft (Schema v2 bis v7, zweimal ausgeführt): Gast liest alles, Einfügen, Ändern,
  Löschen und neue Freigaben scheitern; Fremde sehen nichts; Besitzer schreibt wie bisher; anon hat keinen Zugriff.
- **App**: erkennt den Gast über `shares` und schaltet in den Nur-Lese-Modus (`body.ro`): Hinweis oben, Eingaben,
  Erfassen, Importe und Bearbeiten gesperrt, kein Wetter-Abruf, keine Schreibanfragen; Zeitraum und Ansicht bleiben
  wählbar (nur auf dem Gerät gespeichert).
- Tests: `scripts/v14-check.mjs` 15 Prüfungen; alle bisherigen Prüfungen und Seitenvergleich unverändert.

## v0.15.0 – Stundenexporte der Wärmepumpe, Summen über den Balken
- **Wärmepumpe:** Exporte, die nur Stundenwerte enthalten, werden jetzt ausgewertet. Vollständige Tage (mindestens
  23 Stunden) werden aus den Stunden gebildet, Monate ohne Monatszeile aus den Tagen (in der Tabelle mit „bis …“
  als unvollständig markiert). Echte Tages- und Monatszeilen haben Vorrang; abgeleitete Monate werden nicht auf
  fehlende Tage verteilt. Grund: Ein Export vom 04.10. enthielt nur Stunden, die Anzeige endete deshalb am 01.10.
- **Summen über den Balken** in allen Balkendiagrammen (gestapelt: Gesamtwert über dem Stapel), sobald die Balken
  breit genug sind (mindestens 14 px – am Handy bei vielen Tagen daher ausgeblendet). Abschaltbar je Diagramm.
- Tests: 70 Unit-Tests; `v13-check` prüft die Summen; `v08-check` wartet nach dem Verkleinern auf die Diagramme.

## v0.16.0 – Zeitraum für das ganze Tool (außer Amortisation und Auto-Vergleich)
- Die Zeitraumleiste erscheint zusätzlich auf **Tanken & Laden**, **Tarifrechner** und **Ausbau (Weg B)**; sie gilt
  weiterhin gemeinsam für alle Seiten. Ohne Leiste: Amortisation (ganze Laufzeit), Auto-Vergleich (Prognose),
  Erfassen und Daten.
- **Tanken & Laden:** Kennzahlen (Verbrauch, Spritpreis, Tankkosten, Ladepreis), Fahrzeug-Kennzahlen (km, Kosten,
  ct/km), Grafiken und Listen im Zeitraum, mit Vergleichswert und Abweichung. „Gesamter Zeitraum“ zeigt alles wie
  bisher (Fahrzeug-Kennzahlen dann weiter für die letzten 12 Monate).
- **Tarifrechner:** bei Jahr, Quartal, Monat oder frei der Verbrauch des Zeitraums aufs Jahr hochgerechnet, mit
  Hinweis unter 300 Tagen (Winter/Sommer verzerren); bei „Gesamt“ und „12 Monate“ wie bisher die letzten 365 Tage.
- **Ausbau (Weg B):** bei „Jahr“ das gewählte Kalenderjahr als Basisjahr, wenn es vollständig in den Anker-Daten
  liegt; sonst die letzten 365 Tage mit Hinweis.
- **Stromkosten:** Zahlungsbuch-Liste im Zeitraum; **Zähler:** Liste der Ablesungen im Zeitraum (inklusive des Stands
  am Tag nach dem Ende). Abschlag-Check, Abrechnung prüfen und Boni bleiben vertragsbezogen und sagen das jetzt dazu.
- Seitenvergleich: neue, gewollte Abweichungen nur bei gewähltem Zeitraum (im Kopf von `compare.mjs` vermerkt).
- Tests: `scripts/v16-check.mjs` 14 Prüfungen; `v08-check` wartet bis zu 4 s auf stabile Handybreite.

## v0.17.0 – Auto-Vergleich: Räder, Überführung, THG-Prämie getrennt
- Neue Fahrzeugbuch-Kategorien **„Räder/Reifen“** und **„Überführung“**. Die beiden bisher unter „Sonstiges“
  gebuchten Einträge (Überführungskosten, Winterräder) wurden auf Wunsch in Supabase umgebucht.
- **Auto-Vergleich:** Balken „Kosten über 36 Monate“ zeigt Räder (Räderwechsel + Räder/Reifen aus dem Fahrzeugbuch),
  Überführung und **THG-Prämie (als Gutschrift, negativ)** getrennt statt in „Sonstiges“. Die Summen ändern sich
  nicht. Die Überführung des Leon ist bereits bezahlt und zählt für die 36 Monate nicht mit.

## v0.18.0 – Erstattungen und Gutschriften in der Amortisation
- **Schema** (`docs/UPDATE_V18.sql`): Investitions-Kategorie `refund` erlaubt.
- Neue Kategorie **„Erstattung/Gutschrift“**: Betrag positiv mit Datum des Geldeingangs (§14a-Gutschrift, Förderung,
  THG-Prämie). Zählt als **Ersparnis** im Monat des Eingangs, nicht als Investition; Kennzahlen nennen den Anteil,
  die Investitionstabelle zeigt die Summe getrennt. Abschlags-Erstattungen aus dem Zahlungsbuch zählen weiterhin nicht
  (eigenes Geld zurück).
- **Prognose:** §14a-Gutschrift (Wert der Ausbau-Seite, nur mit Wallbox-Investition, ab Übergabe des E-Autos) und
  THG-Prämie (Auto-Vergleich, ab Übergabe), jeweils als Jahresbetrag. Gebuchte Gutschriften mit „14a“ bzw. „THG“ im
  Namen ersetzen die Prognose für die folgenden 12 Monate. Beide unter „Annahmen“ abschaltbar.
- Die THG-Prämie ist auf Wunsch enthalten (Standard: an), wird aber ausdrücklich als „nicht durch die Investition
  verursacht“ gekennzeichnet: Sie fällt für jedes E-Auto an und verschiebt den Break-even spürbar nach vorn.
- Tests: 73 Unit-Tests (neu `tests/v18.test.mjs`), `scripts/v18-check.mjs` 10 Prüfungen; alles Übrige unverändert.

## v0.19.0 – Tagesprofil Wärmepumpe
- Neuer Abschnitt **„Tagesprofil (Stundenwerte)“** unter „Wärmepumpe laut Gerät“ (Seite Zähler & Wärmepumpe):
  ein Tag je Stunde als gestapelte Balken Heizung/Warmwasser/Zuheizer, dazu Linien Warmwasser-, Außen- und
  Vorlauftemperatur (Vorlauf ausgeblendet, per Legende zuschaltbar). Keine Summen über den Stundenbalken.
- **Vergleichstag:** zweiter Tag als eigener, halbtransparenter Stapel, Temperaturlinien gestrichelt; Tabelle mit
  beiden Tagen nebeneinander. Auswahl wird je Gerät gespeichert.
- Auswertung je Tag: Strom gesamt / Heizung / Warmwasser, Zuheizer, erzeugte Wärme, Arbeitszahl,
  **Warmwasser-Ladungen** mit Uhrzeit und kWh (zusammenhängende Stunden), höchste Warmwassertemperatur mit Uhrzeit
  und Kennzeichnung ab 58 °C (Desinfektion/Hochtemperatur), Laufstunden, Außentemperatur, Stunden im Export.
- Unabhängig von der Zeitraumleiste (es gibt nur wenige Tage mit Stundenwerten); Tage mit weniger als 24 Stunden
  werden markiert. Ohne Stundenwerte erscheint ein Hinweis auf den Export „letzte 3 Tage“.
- Kein Datenbank-Update nötig (Stundenwerte liegen seit v0.11 in `hp_energy`).
- Tests: 74 Unit-Tests, neu `scripts/v19-check.mjs` 23 Prüfungen; alles Übrige unverändert.

## v0.20.0 – Angebote mit Positionen
- **Amortisation → Angebote:** Handwerker-Angebote mit Nummer, Datum, Firma und Positionen (Menge, Artikel,
  Einzelpreis, Summe). Jede Position wird **PV/Speicher**, **Wallbox** oder **gemeinsam** zugeordnet; gemeinsame
  Positionen werden nach einem einstellbaren PV-Anteil aufgeteilt (Vorgabe 75 %). Fälligkeit je Position
  „nach Montage“ oder „nach Anmeldung“.
- **Buchen:** „Als bezahlt buchen“ legt je Fälligkeit Investitionen für PV/Speicher und Wallbox mit dem
  Zahlungsdatum an; „Buchung zurücknehmen“ löscht sie wieder. Bis dahin zählt ein Angebot nicht als Investition,
  die Kennzahl nennt den offenen Betrag. Ändern sich Positionen nach dem Buchen, erscheint ein Hinweis.
- **Ausbau-Seite:** Kosten wahlweise aus Quellen statt von Hand: Handwerker aus Angeboten mit „Für die
  Ausbau-Seite verwenden“, Hardware aus gebuchten Investitionen ab einem Datum (ohne Erstattungen und ohne
  Buchungen aus Angeboten, damit nichts doppelt zählt; Wallbox-Anteil = Kategorie Wallbox).
- Angebote liegen in `settings.data.offers`: **kein Datenbank-Update nötig.** Keine Angebotswerte im Repo.
- Rundung auf Cent kaufmännisch ohne Gleitkomma-Fehler.
- Tests: 79 Unit-Tests (neu `tests/v20.test.mjs`), neu `scripts/v20-check.mjs` 26 Prüfungen; alles Übrige unverändert.

## v0.21.0 – Zeitraum für „Verbrauch pro Tag zwischen den Ablesungen“
- Die Grafik auf „Zähler & Wärmepumpe“ folgt jetzt der Zeitraumleiste: Achse nur im gewählten Zeitraum, Intervalle
  am Rand abgeschnitten (der Wert bleibt der Tagesdurchschnitt des ganzen Ableseintervalls).
- Mit Vergleichszeitraum: zusätzliche gestrichelte Linien, auf die Tage des Zeitraums verschoben; der Tooltip nennt
  das Originaldatum.
- Hinweis unter der Grafik: Ablesungen im Zeitraum je Zählpunkt und Intervalle, die über den Rand reichen.
- „Gesamter Zeitraum“ unverändert. Kein Datenbank-Update nötig.
- Tests: 79 Unit-Tests, neu `scripts/v21-check.mjs` 12 Prüfungen; Seitenvergleich: mt-rate als gewollte Abweichung.

## v0.22.0 – Trendlinien und Spritpreis je Tankvorgang
- **Tanken & Laden → „Verbrauch und Spritpreis“:** €/l für **jeden** Tankvorgang auf seinem Datum (Teilbetankungen
  als hohler Punkt), gestrichelte Linie mit dem Ø-Preis im Zeitraum (nach Litern gewichtet). Verbrauch l/100 km
  weiterhin je Volltank-Intervall. Datumsachse für beide Reihen; Zeitraum oben gilt.
- **Trendlinien** (gepunktet, lineare Ausgleichsgerade) für Spritpreis und Verbrauch sowie in „Verbrauch pro Tag
  zwischen den Ablesungen“ je Zählpunkt (nach Tagen gewichtet). Steigung je Monat im Hinweis unter der Grafik; bei
  Zeiträumen über mehrere Jahreszeiten der Hinweis, dass der Trend vor allem die Jahreszeit zeigt.
- Rechenkern: `linTrend` (reine Funktion). Kein Datenbank-Update nötig.
- Tests: 82 Unit-Tests (neu `tests/v22.test.mjs`), neu `scripts/v22-check.mjs` 16 Prüfungen; alles Übrige unverändert.

## v0.23.0 – Gleitender Durchschnitt statt Trendgerade beim Strom
- „Verbrauch pro Tag zwischen den Ablesungen“: Die Trendgerade aus v0.22 lief bei Daten über mehrere Jahreszeiten
  rechnerisch gegen 0. Ersetzt durch den **gleitenden Durchschnitt der letzten 30 Tage** je Zählpunkt (gepunktet,
  Tageswerte wie in „Verbrauch pro Monat“, mindestens 15 Tage mit Wert). Das Fenster reicht vor den Zeitraumbeginn,
  damit die Linie am Anfang nicht fehlt. Hinweis: Ø der letzten 30 Tage gegenüber den 30 Tagen davor.
- **Wärmepumpe wetterbereinigt:** Heizung in kWh je Gradtag für die letzten 30 Tage (Grundlast laut Wetter-Modell
  abgezogen, passende Seite des Gerätetauschs), Vergleich mit den 30 Tagen davor. Unter 20 Gradtagen (Sommer) kein
  Wert, sondern ein Hinweis. Ohne Wetterdaten entfällt die Zeile.
- Tanken: Trendgeraden für Spritpreis und Verbrauch bleiben (keine Jahreszeit-Abhängigkeit wie beim Strom).
- Rechenkern: `movingAvg` (reine Funktion), `wpDegreeDay` in createCalc. Kein Datenbank-Update nötig.
- Tests: 83 Unit-Tests, neu `scripts/v23-check.mjs` 12 Prüfungen; alles Übrige unverändert.

## v0.24.0 – Gleitender Durchschnitt auch beim Tanken
- „Verbrauch und Spritpreis“: Die Trendgeraden aus v0.22 entfallen (Spritpreise verlaufen nicht linear). Stattdessen
  gepunktet der **gleitende Ø über die letzten 5 Tankvorgänge** (€/l, nach Litern gewichtet = Kosten ÷ Liter,
  Teilbetankungen eingeschlossen, ab 3 Tankvorgängen) und über die **letzten 3 Volltank-Intervalle** (l/100 km, nach
  km gewichtet = Liter ÷ km, ab 2 Intervallen). Gerechnet über das ganze Tankbuch, damit das Fenster am Zeitraumbeginn
  nicht leer ist. Die gestrichelte Ø-Linie des Zeitraums bleibt.
- Hinweis: aktueller gleitender Wert gegenüber dem Wert 5 Tankvorgänge bzw. 3 Intervalle davor.
- Rechenkern: `movingAvgN` (reine Funktion) ersetzt `linTrend`. Kein Datenbank-Update nötig.
- Tests: 81 Unit-Tests (`tests/v24.test.mjs` ersetzt `tests/v22.test.mjs`), `scripts/v22-check.mjs` angepasst
  (18 Prüfungen); alles Übrige unverändert.
