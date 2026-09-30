# Energiebilanz – Anleitung Phase 1

Ziel: `https://philip89a.github.io/energiebilanz/` wie beim M&M-Tracker. Die Seite selbst ist öffentlich
erreichbar, **die Daten** gibt es nur nach Login mit E-Mail + Passwort (Supabase Auth + Row Level Security).

Dauer: ca. 20 Minuten. Reihenfolge einhalten.

---

## Teil A – GitHub (5 Min.)

1. **Repo anlegen:** github.com → oben rechts „+“ → *New repository*
   - Name: `energiebilanz`
   - Sichtbarkeit: **Public** (GitHub Pages ist im Gratis-Plan nur für öffentliche Repos verfügbar;
     im Repo landet nur Code, keine Daten)
   - Haken bei *Add a README file* setzen → *Create repository*
2. **Claude Zugriff geben:** github.com → Settings → Applications → *Claude* → Configure →
   unter *Repository access* `energiebilanz` hinzufügen (falls dort „Only select repositories“ steht).
3. **Nichts hochladen.** Die Dateien `data/…` und `reference/energiebilanz_v0.14.html` bleiben nur auf
   deinem Rechner. Die Referenz-HTML enthält alle Messdaten.
4. GitHub Pages schalten wir erst ein, wenn es eine `index.html` gibt (Phase 4/5):
   Repo → Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.

---

## Teil B – Supabase-Projekt (5 Min.)

1. supabase.com/dashboard → *New project*
   - Name: `energiebilanz`
   - Database Password: *Generate*, im Passwortmanager speichern (brauchst du im Alltag nicht)
   - Region: **Central EU (Frankfurt)**
   - *Create new project*, ca. 2 Min. warten
2. Links **SQL Editor** → *New query* → kompletten Inhalt von `supabase/schema.sql` einfügen → **Run**.
   Unten erscheint eine Tabelle mit 12 Zeilen, Spalte `rowsecurity` überall `true`.

---

## Teil C – Sicherheit prüfen (3 Min.)

Im SQL Editor jeweils einfügen und *Run*:

```sql
-- 1) 12 Zeilen, alle true
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;

-- 2) 12 Zeilen, roles = {authenticated}, cmd = ALL
select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by 1;

-- 3) muss LEER sein (anon darf nichts)
select table_name, privilege_type from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';
```

4. Links **Advisors → Security Advisor**: kein Eintrag „RLS disabled in public“.

Wenn eine Prüfung nicht passt: nicht weitermachen, Ergebnis an Claude schicken.

---

## Teil D – Login mit E-Mail + Passwort (5 Min.)

1. **Authentication → Sign In / Providers → Email**
   - *Enable Email provider*: an
   - Magic Link brauchen wir nicht, Passwort-Login ist Standard
2. **Deinen Nutzer direkt anlegen:** Authentication → **Users** → *Add user* → *Create new user*
   - E-Mail + Passwort eintragen (Passwortmanager, mind. 12 Zeichen)
   - **Auto Confirm User: an**
3. **Registrierung schließen:** Authentication → Sign In / Providers → *Allow new users to sign up*: **aus**.
   Damit kann niemand außer dir ein Konto anlegen. Die App bekommt keinen Registrieren-Knopf.
4. **URLs für „Passwort vergessen“:** Authentication → **URL Configuration**
   - Site URL: `https://philip89a.github.io/energiebilanz/`
   - Redirect URLs (*Add URL*):
     - `https://philip89a.github.io/energiebilanz/**`
     - `http://localhost:8000/**` (für lokale Tests)

Menünamen ändert Supabase gelegentlich – im Zweifel nach dem Begriff suchen.

---

## Teil E – Zugangsdaten an Claude geben (1 Min.)

Project Settings → **API Keys** (bzw. *Data API*):

- **Project URL** (`https://xxxx.supabase.co`) → an Claude schicken
- **anon / publishable key** (`eyJ…` oder `sb_publishable_…`) → an Claude schicken

Diese beiden sind **nicht geheim**, sie stehen später sichtbar im App-Code (wie beim M&M-Tracker).

**Niemals weitergeben:** `service_role`-Key, `sb_secret_…`-Key, Datenbank-Passwort.

---

## iPhone – was du wissen musst

- Die installierte Home-Bildschirm-App hat einen **eigenen Speicher**, getrennt von Safari.
  Du loggst dich also einmal in Safari und einmal in der installierten App ein. Danach bleibt die
  Sitzung bestehen (Supabase erneuert sie automatisch).
- Das Passwort füllt der iCloud-Schlüsselbund mit Face ID aus (Formular nutzt `autocomplete`).
- **Passwort vergessen:** Der Link aus der Mail öffnet Safari. Neues Passwort dort setzen, danach in der
  App normal einloggen.

---

## Danach

Schick Claude: „Repo angelegt, Supabase fertig, Prüfungen 1–4 ok“ + Project URL + anon/publishable key.
Dann folgen: Repo-Grundgerüst (Phase 1 abschließen) und Konzept für Phase 2 (Import).
