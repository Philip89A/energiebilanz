# Updates einspielen (v0.9 und v0.10)

Reihenfolge einhalten: erst Datenbank, dann App. Sonst schlägt das Speichern einer Investitions-Kategorie fehl
(v0.9) bzw. die App läuft ohne Wetter (v0.10, nur Hinweis, kein Fehler).

## 1. Datenbank (Supabase)
1. Supabase öffnen → Projekt → links **SQL Editor** → **New query**.
2. Inhalt von `docs/UPDATE_V09.sql` einfügen → **Run**. Kontrolle: Ergebnis zeigt `category | text`.
3. Neue Abfrage, Inhalt von `docs/UPDATE_V10.sql` einfügen → **Run**. Kontrolle: `weather_daily | true`.

Beide Skripte kann man gefahrlos mehrfach ausführen.

## 2. App (GitHub)
1. Pull Request öffnen → **Merge pull request** → **Confirm merge**.
2. 2–10 Minuten warten (GitHub Pages), dann die App neu laden. Am iPhone: App schließen und neu öffnen;
   in der Seitenleiste muss die neue Versionsnummer stehen.

## 3. Wetter einrichten (einmalig)
1. In der App **Daten → Wetter**: Ort eingeben → **Ort suchen** → Treffer wählen.
2. Die App lädt die Wetterdaten automatisch (einige Sekunden). Danach erscheinen die Auswertungen unter
   „Zähler & Wärmepumpe“ und „PV-Anlage“.
3. Klappt der Abruf nicht: Screenshot der Meldung unter „Wetter“ an Claude.

# Update v0.11 (Wärmepumpe laut Gerät)
1. Supabase SQL Editor → New query → Inhalt von `docs/UPDATE_V11.sql` einfügen → **Run**.
   Die Warnung „destructive operations“ bestätigen: Sie betrifft nur Regel und Trigger der neuen Tabelle.
   Kontrolle: `hp_energy | true`.
2. Pull Request mergen, App neu laden (Version v0.11.0 in der Seitenleiste).
3. Daten → „Wärmepumpe: App-Export importieren“ → CSV aus der Wärmepumpen-App wählen → Zeilen speichern.
   Regelmäßig (z. B. monatlich) wiederholen: Die App exportiert Stunden nur für wenige Tage und Tage nur für
   wenige Monate.

# Update v0.14 (Gastzugang, nur lesen)
1. Gast-Account anlegen: Supabase → Authentication → Users → Add user → Create new user (E-Mail, Passwort,
   „Auto Confirm User“).
2. SQL Editor → New query → Inhalt von `docs/UPDATE_V14.sql` einfügen. Unten im Abschnitt 4 die Zeile für den Gast
   einkommentieren und beide E-Mail-Adressen eintragen → **Run**. Die Warnung „destructive operations“ bestätigen
   (betrifft nur die Zugriffsregeln, keine Daten). Kontrolle: je Tabelle `eb_delete, eb_insert, eb_read, eb_update`.
3. Pull Request mergen, App neu laden (v0.14.0). Der Gast meldet sich mit seinen Zugangsdaten an und sieht oben
   „Gastzugang – nur lesen“.
4. Gast entfernen: `delete from shares where viewer_id = (select id from auth.users where email = 'GAST@…');`
   und den Account unter Authentication → Users löschen.
