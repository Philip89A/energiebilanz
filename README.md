# Energiebilanz

Private PWA für Balkon-PV mit Speicher, Stromkosten, Amortisation und Autokosten.
Hosting auf GitHub Pages, Daten in Supabase (Login per E-Mail + Passwort, Row Level Security).

- `supabase/schema.sql` – Tabellen, RLS, Rechte (im Supabase SQL Editor ausführen)
- `config.js` – Supabase-URL und Publishable-Key (öffentlich, Schutz über RLS)
- `docs/ANLEITUNG_PHASE1.md` – Einrichtung GitHub + Supabase
- `docs/ANLEITUNG_PHASE2.md` – GitHub Pages einschalten, Startdaten und Anker-CSV importieren
- `js/views.js` – Seiten (aus der Referenz übernommen), `js/calc.js` – Rechenlogik (reine Funktionen), `js/import.js` – Import-Logik (reine Funktionen), `js/db.js` – Supabase-Zugriff, `js/app.js` – Oberfläche
- `sw.js`, `manifest.webmanifest`, `icons/` – installierbare App mit Offline-Betrieb; `js/queue.js` – Offline-Warteschlange
- `docs/ANLEITUNG_IPHONE.md` – App auf dem iPhone installieren
- `CHANGELOG.md` – Versionen

Tests: `node --test tests/*.test.mjs` (Vergleichswerte neu erzeugen: `npx -y -p playwright node scripts/golden.mjs`; Seitenvergleich Referenz ↔ App: `scripts/compare.mjs`; Bearbeiten: `scripts/edit-check.mjs`; Offline: `scripts/offline-check.mjs`; Version setzen: `node scripts/set-version.mjs X.Y.Z`). Lokal starten: `python3 -m http.server 8000`, dann http://localhost:8000

Nicht im Repo (siehe `.gitignore`): `data/` (Seed, Anker-Exporte) und `reference/` (Referenz-HTML mit
eingebetteten Messdaten). Beides liegt nur lokal.
