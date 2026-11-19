-- Energiebilanz v0.58: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Ladebuch: Spalte „guest“ für Fremdladungen (Gast lädt an der Wallbox, Betrag = erhaltene Erstattung).
-- Bestehende Ladevorgänge bleiben eigene Ladungen (false). Mehrfaches Ausführen ist unschädlich.
alter table charge_log add column if not exists guest boolean not null default false;
notify pgrst, 'reload schema';
-- Kontrolle: „guest | boolean“
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'charge_log' and column_name = 'guest';
