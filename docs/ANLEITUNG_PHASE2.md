# Energiebilanz – Anleitung Phase 2 (Import)

## 1. Pull Request mergen und GitHub Pages einschalten
1. GitHub → Repo `energiebilanz` → *Pull requests* → den PR „v0.1–v0.2 …“ öffnen → *Merge pull request* → *Confirm*.
2. Repo → *Settings* → *Pages* → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)` → *Save*.
3. Nach 1–2 Minuten ist die App erreichbar: `https://philip89a.github.io/energiebilanz/`
   (Status unter *Actions* bzw. oben auf der Pages-Seite).

## 2. Startdaten importieren (einmalig, am Rechner)
1. App öffnen, mit E-Mail + Passwort anmelden.
2. Karte „Startdaten importieren“ → Datei `data/seed_state.json` wählen.
3. Vorschau prüfen: Mengen und Summen müssen zu `data/REFERENZ.md` bzw. `data/expected.json` passen.
4. *Importieren*. Am Ende muss grün stehen: „Import vollständig. Rückprüfung: alle Mengen und Kontrollsummen stimmen“.
   Bei rotem Text: Screenshot an Claude, nichts weiter importieren.

## 3. Anker-CSV importieren (Smart Plug ergänzen, danach laufend)
1. Karte „Anker-Export importieren“ → `data/anker_energiedetails.csv` wählen.
2. Erwartet beim ersten Mal: 0 neue, 0 geänderte Tage; alle Tage „nur ergänzt“ (Smart-Plug-Werte fehlen im Seed).
3. *… Tage übernehmen*.
4. Künftig: in der Anker-App exportieren, Datei in „Dateien“ sichern, in der App auswählen. Geänderte Tage werden
   mit altem und neuem Wert angezeigt, bevor etwas geschrieben wird.

## 4. Kontrolle
Karte „Datenstand“ zeigt je Tabelle die Anzahl. Optional im Supabase SQL Editor:
```sql
select count(*), min(day), max(day), round(sum(erzeugung), 2) from anker_daily;
```
