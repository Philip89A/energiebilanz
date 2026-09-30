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
- Tests: synthetische Fixtures im Repo; Tests gegen echte Referenzwerte lesen `data/` und werden
  übersprungen, wenn die Dateien fehlen.
- Versionen mit Changelog (`CHANGELOG.md`, vX.Y), jede Änderung kurz begründet.

## Phasen
1. ✅ Supabase-Projekt, `schema.sql` v2, RLS, Login per E-Mail + Passwort (v0.1).
2. Einmaliger Import von `data/seed_state.json` über eine Import-Seite in der App (eingeloggt, kein
   service_role-Key), danach Anker-CSV-Import mit Upsert über (user_id, day).
3. Rechenlogik aus der Referenz in `js/calc.js` übernehmen, reine Funktionen, Tests gegen die Referenzwerte.
   Summen intern in ganzen Wh/Cent bilden (Fließkomma-Summen runden exakte ,x5-Werte sonst falsch ab).
4. Seiten portieren: Überblick, Kosten & Ersparnisse, PV-Anlage, Batterie, Zähler & Wärmepumpe, Stromkosten
   (inkl. Abschlag-Check), Amortisation, Auto-Vergleich, Tanken & Laden (inkl. Fahrzeugbuch), Daten.
5. PWA: Manifest, Service Worker, Offline-Cache, schnelle Eingabemasken für das Handy
   (Zählerstand, Tankvorgang, Ladevorgang, Fahrzeugbuch-Eintrag) als eigene, große Startbuttons.
6. Später: Zahlungsbuch (Tabelle `payments` existiert), Tarifrechner (Fix vs. dynamisch, §14a Modul 1/3,
   Kosten intelligentes Messsystem), Wetterbereinigung Wärmepumpe (DWD-Gradtagzahlen),
   Einstrahlungsdaten zur Trennung Wetter vs. Abregelung, Ausbau-Szenarien (Speicher, Module, Wallbox).

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
- **Abschlag-Check** je laufendem Vertrag: gezahlt (12 Abschläge/Jahr, erster 1 Monat nach Lieferbeginn, Beträge aus
  `installments` nach Gültigkeit) vs. verbraucht bis heute; Rest des Abrechnungsjahres aus denselben Kalendertagen
  des Vorjahres; beim Allgemeinstrom E-Auto-Laden ab Übergabedatum (`cars.ev.start`) addieren; Ergebnis ohne und
  mit Boni; „passender Abschlag ab jetzt“ = (Jahreskosten − gezahlt) ÷ verbleibende Abschläge.
- **Auto-Vergleich**: Laufzeit je Fahrzeug, Leasing + Energie + Versicherung + Steuer + Sonstiges (optional aus
  Fahrzeugbuch der letzten 12 Monate) − THG-Prämie + Überführung. Spritpreis wählbar: manuell, Ø alle, Ø letzte N
  Tankvorgänge, jeweils nach Litern gewichtet. Verbrauch optional aus Volltank-Intervallen.
- **Kilometer**: aus allen Kilometerständen (Tanken, Laden, Fahrzeugbuch), zwischen zwei Ständen gleichmäßig je Tag.
- **Zeiträume**: Gesamter Zeitraum (Standard), rollierende 12 Monate, Jahr, Quartal, Monat, frei; Vergleich mit
  Vorperiode, Vorjahr oder frei. Bis 62 Tage Tageswerte, sonst Monatswerte. Nicht gemessene Werte als „–“, nie als 0.
