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
