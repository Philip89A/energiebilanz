# Energiebilanz

Private PWA für Balkon-PV mit Speicher, Stromkosten, Amortisation und Autokosten.
Hosting auf GitHub Pages, Daten in Supabase (Login per E-Mail + Passwort, Row Level Security).

- `supabase/schema.sql` – Tabellen, RLS, Rechte (im Supabase SQL Editor ausführen)
- `config.js` – Supabase-URL und Publishable-Key (öffentlich, Schutz über RLS)
- `docs/ANLEITUNG_PHASE1.md` – Einrichtung GitHub + Supabase
- `CHANGELOG.md` – Versionen

Nicht im Repo (siehe `.gitignore`): `data/` (Seed, Anker-Exporte) und `reference/` (Referenz-HTML mit
eingebetteten Messdaten). Beides liegt nur lokal.
