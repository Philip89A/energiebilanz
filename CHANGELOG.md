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
