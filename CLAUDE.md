# Energiebilanz – Projektanweisung für Claude Code

Private Web-App (PWA) zur Auswertung von Balkon-PV mit Speicher, Stromkosten, Amortisation und Autokosten.
Nutzer: Philip. Antworten auf Deutsch, UI auf Deutsch.

**Diese Datei ist öffentlich.** Konkrete Werte (Referenzkennzahlen, Tarife, Verträge, Zählerstände,
Fahrzeugkonditionen, offene Punkte) stehen in `data/REFERENZ.md` – nur lokal, nie committen.
Liegt die Datei nicht vor, Philip danach fragen, bevor Kennzahlen als geprüft gelten.

## Ziel dieses Repos
Die Einzeldatei `reference/energiebilanz_v0.14.html` (lokal, nicht im Repo; speichert im Browser) wird zu einer
PWA mit externer Datenbank umgebaut, damit Einträge vom Handy (Zählerstände, Tanken, Laden, Fahrzeugbuch,
Abschläge, Anker-Import) auf allen Geräten verfügbar sind.

Stack wie beim Miles-&-More-Tracker: **Supabase** (Postgres + Auth per **E-Mail + Passwort**) und
**GitHub Pages** (`https://philip89a.github.io/energiebilanz/`), Vanilla JS (ES-Module) + Chart.js (UMD)
+ optional SheetJS. Kein Build-Zwang. Bibliotheken lokal unter `vendor/` (Offline-Cache).

## Arbeitsweise (verbindlich)
- Erst abstimmen, dann bauen: Konzept zeigen, Rückfrage, dann EINE Version. Untersuchen ist frei, Bauen braucht Freigabe.
- Jede Kennzahl gegen die Referenzwerte in `data/REFERENZ.md` prüfen, bevor ein Schritt als fertig gilt. Die
  Referenz-HTML ist die fachliche Wahrheit, bis eine Abweichung begründet und mit Philip abgestimmt ist.
- Keine persönlichen Daten im Repo oder im ausgelieferten Code: keine Adresse, Zählernummern, Vertrags- oder
  Kundennummern, IBAN, Geburtsdatum, keine Mess-, Tarif- oder Vertragswerte. Diese liegen nur in Supabase
  bzw. lokal in `data/`. `data/` und `reference/` sind per `.gitignore` ausgeschlossen.
- **Row Level Security zuerst.** Vor dem ersten echten Datensatz muss `supabase/schema.sql` laufen und die
  Prüfungen aus `docs/ANLEITUNG_PHASE1.md` Teil C bestehen. Der Publishable-Key liegt im Frontend
  (`config.js`), deshalb ist RLS Pflicht. Registrierung in Supabase ist geschlossen, der einzige Nutzer
  wurde im Dashboard angelegt.
- Tests: `node --test tests/*.test.mjs`. Synthetische Fixtures im Repo; Tests gegen echte Werte lesen `data/`
  (seed_state.json, anker_energiedetails.csv, expected.json, golden.json) und werden übersprungen, wenn sie fehlen.
  Keine echten Zahlen in Testdateien, Doku oder Commit-Texten.
- Zählerstand eines Tages gilt als Stand am Tagesanfang (Verbrauch des Ablesetags gehört zum Folgeintervall).
- Versionen mit Changelog (`CHANGELOG.md`, vX.Y), jede Änderung kurz begründet.
- Vor jedem Release `node scripts/set-version.mjs X.Y.Z` ausführen: setzt `?v=` in index.html und allen Imports,
  sonst mischen Browser nach einem Update alte und neue Dateien (GitHub Pages cacht bis zu 10 Minuten).

## Phasen
1. ✅ Supabase-Projekt, `schema.sql` v2, RLS, Login per E-Mail + Passwort (v0.1).
2. ✅ Import (v0.2).
3. ✅ Rechenlogik in `js/calc.js` (v0.3): `createCalc(state)` mit den Funktionen der Referenz (gleiche Namen,
   gleiche Rechenschritte), `stateFromDb(db)` wandelt Supabase-Zeilen um. `sumRange` summiert exakt in Wh.
   Prüfung: `scripts/golden.mjs` führt die Referenz-HTML mit dem Seed im Browser aus und schreibt alle Kennzahlen
   für 35 Zeiträume nach `data/golden.json`; `tests/calc.reference.test.mjs` vergleicht calc.js damit
   (Toleranz 1e-9) und mit den von Hand übertragenen Referenzwerten in `data/expected.json` → `kennzahlen`.
   „Heute“ ist Parameter (`today`) für Fahrzeugbuch-Auswertungen; der Abschlag-Check rechnet bis letzter
   Zählerstand − 1 Tag, nicht bis zum Kalenderdatum.
4. Seiten portieren: Überblick, Kosten & Ersparnisse, PV-Anlage, Batterie, Zähler & Wärmepumpe, Stromkosten
   (inkl. Abschlag-Check), Amortisation, Auto-Vergleich, Tanken & Laden (inkl. Fahrzeugbuch), Daten.
   - ✅ 4a Anzeige (v0.4): `js/views.js` enthält die render*-Funktionen der Referenz, verbunden mit calc.js;
     Eingaben gesperrt (`body.ro`, `.edit-only`). `scripts/compare.mjs` vergleicht Referenz und App (Texte und
     Diagrammdaten, 9 Seiten × 6 Ansichten); gewollte Abweichungen stehen im Kopf des Skripts.
   - ✅ 4b Bearbeiten (v0.5): Handler der Referenz; jede Änderung schreibt genau einen Datensatz (`toDb` in
     calc.js, `saveRow`/`deleteRow` in db.js), Parameter (battery, pv, amort, cars) verzögert als `settings`.
     Danach neues Rechenmodell (`refreshCalc`). Bei Fehlern Hinweis und Neuladen aus Supabase.
     Prüfung: `scripts/edit-check.mjs` (25 Prüfungen) und `scripts/compare.mjs`.
   - Texte ohne private Details (Anbieter, Daten, Geräteaufbau): aus den Daten füllen (`data-sm` = Smart-Meter-
     Datum aus `events`) oder neutral formulieren.
5. ✅ PWA (v0.6): `manifest.webmanifest` (Start `./#quick`), `sw.js` (Seite netzwerk-zuerst, versionierte Dateien
   cache-zuerst, Supabase nie aus dem Cache), Seite „Erfassen“ mit vier großen Knöpfen (Zählerstand, Tanken,
   Laden, Fahrzeugbuch; deutsche Zahlen per `parseNum`, Plausibilitätsprüfung gegen letzten Stand).
   Offline (`js/queue.js`): letzter Datenstand und Warteschlange je Nutzer im localStorage; Schreiben ohne Netz
   wird vorgemerkt und bei Netz in Reihenfolge gesendet; Serverfehler beim Nachsenden → verwerfen und melden.
   Prüfung: `scripts/offline-check.mjs` (21 Prüfungen). Icons: `icons/icon.svg` → `scripts/icons.mjs`.
6. Erweiterungen
   - ✅ v0.7: Zahlungsbuch (`payments`, Vorschlag aus Abschlagsplan, Abrechnung prüfen), Boni als Einzelposten
     (`tariffs.boni_items`, schema v3 / `docs/UPDATE_V07.sql`), Gesamtbilanz Energie, Tarifrechner Stufe A
     (Angebote, Wallbox §14a Modul 1/2/1+3, iMSys; Werte des Netzbetreibers als Eingabe, `settings.data.tarif`),
     einheitlicher Break-even, Zähler-Linie im Überblick. Prüfung: `scripts/v07-check.mjs` (20 Prüfungen).
   - Offen: Tarifrechner Stufe B (dynamischer Tarif, nur als Schätzung über Lastprofil – es gibt nur Tageswerte),
     Wetterbereinigung Wärmepumpe (DWD-Gradtagzahlen), Einstrahlungsdaten zur Trennung Wetter vs. Abregelung,
     Ausbau-Szenarien (Speicher, Module, Wallbox).

## Mapping seed_state.json → Tabellen
- `anker` {start, n, c:{ev, imp, n2h, s2h, s2b, bch, bdis, b2h, use, gen, feed, pv1..pv4}} → `anker_daily`
  (Tag i = start + i; ev→eigenverbrauch, imp→netzimport, n2h→netz_zu_haus, s2h→solar_zu_haus, s2b→solar_zu_speicher,
  bch→speicher_ladung, bdis→speicher_entladung, b2h→speicher_zu_haus, use→genutzt, gen→erzeugung, feed→einspeisung).
  Rohwerte unverändert speichern (Nullen vor dem Smart Meter bleiben 0).
- `meters` (id, name, group, order) → `meters` (id, name, grp, sort); `readings` (m, d, v, src) → `meter_readings`
- `events` (d, group, type, text) → `events` (day, grp, type, note)
- `tariffs` (group, name, from, to, ap, gp, boni, boniNote, est) → `tariffs`; leeres `to` → NULL; alte IDs entfallen
- `abschlaege` → `installments`; `invest` (name, date, cost) → `investments`
- `fuel` (d, km, l, e, s, full) → `fuel_log`; `charges` (d, km, k, e, o) → `charge_log`;
  `carlog` (d, car, cat, km, e, note) → `car_log`
- `battery`, `pv`, `amort`, `cars` → `settings.data` (+ `schema_version`)
- `view`, `ui` → **nicht** in Supabase, je Gerät im localStorage
- `abschlag`, `version` → entfallen (Altbestand, durch `abschlaege` ersetzt)

## Datenquellen und Besonderheiten
- **Anker-CSV „Energiedetails“**: erste Zeile Titel, zweite Zeile Kopf, Datum `dd/mm/yyyy`, Spaltennamen mit
  geschütztem Bindestrich (U+2011). Tageswerte in kWh. PV1–PV4 = vier Stränge. Spalte „Verbrauch über Smart
  Plug“ → `smart_plug`.
- **Smart-Meter-Start**: Datum aus `events` (grp `pv`, type `daten`). Netzimport und Einspeisung sind davor
  immer 0 (nicht gemessen, nicht „kein Bezug“). Autarkie, Einspeisung und „Speicher voll“ nur auswerten, wenn
  mindestens die Hälfte des Zeitraums danach liegt.
- Vor dem Smart Meter lief die Solarbank mit fester Ausgangsleistung; ungemessene Einspeisung steckt in „genutzt“.
  Eigenverbrauch davor ist dadurch leicht geschönt.
- **Allgemeinstrom**: Zählertausch mit Folgezähler (Endstand alt = Startstand neu am selben Tag). Zähler misst
  nur Netzbezug; ein Einspeisezähler (Gruppe `feed`) existiert.
- **Wärmepumpe**: eigener Zähler, eigener WP-Tarif, nicht am PV-Kreis.
- Anlagen- und Fahrzeugparameter stehen in `settings.data` (Werte siehe `data/REFERENZ.md`).

## Rechenregeln (fachlich verbindlich)
- **Zählerverbrauch**: Wärmepumpe zwischen zwei Ablesungen gleichmäßig je Tag. Allgemeinstrom: Delta zwischen zwei
  Ablesungen nach dem täglichen Anker-Netzbezug verteilt (Tage ab Smart Meter), Rest gleichmäßig auf Tage davor.
  Zählertausch: Folgezähler mit Offset verketten (Endstand alt = Startstand neu am selben Tag).
- **Stromkosten**: Tagesverbrauch × Arbeitspreis des an dem Tag gültigen Tarifs + Grundpreis/365 je Tag mit Zählerdaten.
  Tage ohne Tarif als „ohne Tarif“ ausweisen. Boni tagesanteilig über das erste Vertragsjahr.
  Boni-Posten mit Mengenbedingung (`minKwh`, `amountBelow`): maßgeblich ist die Menge im ersten Vertragsjahr, im
  laufenden Jahr die Prognose des Abschlag-Checks (v0.7; ohne Posten gilt die Summe wie in der Referenz).
  Erstattungen zu viel gezahlter Abschläge sind KEINE Kostensenkung (sonst Doppelzählung).
- **Grundpreis**: enthalten in allen Stromkosten; NICHT in vermiedenen Netzkosten, Wert des Speichers, Amortisation,
  Ladekosten zu Hause (Grenzkosten = Arbeitspreis).
- **Vermiedene Netzkosten (PV-Ersparnis)**: Σ Tag „genutzt“ × Arbeitspreis Allgemeinstrom des Tages
  + Einspeisung × Vergütung (nur ab `amort.feedinFrom`).
- **Wert des Speichers**: Σ Tag „Speicher zu Haushalt“ × Arbeitspreis. Bruttowert, Anschaffung nicht abgezogen.
- **Speicherwirkungsgrad**: Entladung ÷ Ladung im Zeitraum; nur Monats- oder längere Ansicht.
- **Verlust im Speicher**: Ladung − Entladung (Umwandlung inkl. Wechselrichter, Eigenverbrauch, Messdifferenz).
- **Speicher voll**: Tag mit Einspeisung ≥ Schwelle (`battery.fullThresh`), nur ab Smart Meter. Tagesladung ist
  kein Füllstand.
- **Eigenverbrauchsquote**: genutzt ÷ Erzeugung. Die Anker-App rechnet (Erzeugung − Einspeisung) ÷ Erzeugung und
  zählt damit Speicherverluste als genutzt → im Dashboard nur als Vergleich zeigen.
- **Autarkie (Anker-Messkreis)**: genutzt ÷ (genutzt + Netzimport), nur Zeitraum ab Smart Meter. Die App rechnet über
  alle Tage und wird durch die Nullen vor dem Smart Meter zu hoch (App-Wert muss trotzdem reproduzierbar sein).
- **Amortisation**: monatlich ab erster Investition; Investitionslinie stufig zu den Kaufdaten (Verkäufe negativ);
  gemessene Ersparnis bis zum letzten Datenmonat (angefangener Monat hochgerechnet), danach Prognose aus den letzten
  12 Monaten je Kalendermonat mit Strompreissteigerung und Leistungsverlust. Kein Kalkulationszins.
  Break-even überall (Überblick, Kosten & Ersparnisse, Amortisation) aus dieser Rechnung (v0.7).
  Boni und Tarifwechsel gehören NICHT in die Amortisation (hätte es auch ohne PV gegeben) – nur in die
  getrennte „Gesamtbilanz Energie“ (Tarifwechsel = Preise des Vorvertrags derselben Gruppe fortgeschrieben).
- **Abschlag-Check** je laufendem Vertrag: gezahlt (12 Abschläge/Jahr, erster 1 Monat nach Lieferbeginn, Beträge aus
  `installments` nach Gültigkeit) vs. verbraucht bis heute; Rest des Abrechnungsjahres aus denselben Kalendertagen
  des Vorjahres; beim Allgemeinstrom E-Auto-Laden ab Übergabedatum (`cars.ev.start`) addieren; Ergebnis ohne und
  mit Boni; „passender Abschlag ab jetzt“ = (Jahreskosten − gezahlt) ÷ verbleibende Abschläge.
  Abweichungen von der Referenz (v0.7, mit Philip abgestimmt): offene Abschläge mit dem Betrag, der an ihrem
  Fälligkeitstag gilt (Referenz: Betrag vom Rechenstand, künftige Änderungen wurden ignoriert); „aktueller Abschlag“
  zum Kalendertag; sind im Abrechnungsjahr Abschläge im Zahlungsbuch erfasst, zählen diese statt der Annahme.
- **Auto-Vergleich**: Laufzeit je Fahrzeug, Leasing + Energie + Versicherung + Steuer + Sonstiges (optional aus
  Fahrzeugbuch der letzten 12 Monate) − THG-Prämie + Überführung. Spritpreis wählbar: manuell, Ø alle, Ø letzte N
  Tankvorgänge, jeweils nach Litern gewichtet. Verbrauch optional aus Volltank-Intervallen.
- **Kilometer**: aus allen Kilometerständen (Tanken, Laden, Fahrzeugbuch), zwischen zwei Ständen gleichmäßig je Tag.
- **Zeiträume**: Gesamter Zeitraum (Standard), rollierende 12 Monate, Jahr, Quartal, Monat, frei; Vergleich mit
  Vorperiode, Vorjahr oder frei. Bis 62 Tage Tageswerte, sonst Monatswerte. Nicht gemessene Werte als „–“, nie als 0.
