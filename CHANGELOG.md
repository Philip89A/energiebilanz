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
