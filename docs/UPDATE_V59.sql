-- Energiebilanz v0.59: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Spalte in den Anker-Tageswerten: Wallbox („Ladesäulen-Verbrauch“ im Export „Home Gesamt“ mit Power Dock).
-- Bestehende Werte bleiben unverändert, die neue Spalte ist leer. Mehrfaches Ausführen ist unschädlich.
alter table anker_daily add column if not exists wallbox numeric;
notify pgrst, 'reload schema';
-- Kontrolle: „wallbox | numeric“
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'anker_daily' and column_name = 'wallbox';
