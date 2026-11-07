-- Energiebilanz v0.50: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Ladevorgänge: Ort „Sonstiges“ erlaubt, neues Feld „note“ (Kommentar, höchstens 500 Zeichen). Mehrfaches Ausführen ist unschädlich.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.charge_log'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%location%' loop
    execute format('alter table charge_log drop constraint %I', c);
  end loop;
end $$;
alter table charge_log add constraint charge_log_location_check
  check (location in ('zu Hause','öffentlich AC','öffentlich DC','Arbeitgeber','Sonstiges'));
alter table charge_log add column if not exists note text check (note is null or char_length(note) <= 500);
notify pgrst, 'reload schema';
-- Kontrolle: erlaubte Orte und neue Spalte
select pg_get_constraintdef(oid) as regel from pg_constraint where conrelid = 'public.charge_log'::regclass and conname = 'charge_log_location_check';
select column_name, data_type from information_schema.columns where table_name = 'charge_log' and column_name = 'note';
