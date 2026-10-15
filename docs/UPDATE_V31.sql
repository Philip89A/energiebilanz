-- Energiebilanz v0.31: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Spalte für die Netzladung des Speichers („Netzstrom zu Speicher“ im Anker-Export des neuen Heimsystems),
-- wichtig für einen späteren dynamischen Tarif. Bestehende Zeilen bleiben unverändert (leer). Mehrfaches Ausführen
-- ist unschädlich.
alter table anker_daily add column if not exists netz_zu_speicher numeric;
notify pgrst, 'reload schema';
select column_name from information_schema.columns where table_name = 'anker_daily' and column_name = 'netz_zu_speicher';
