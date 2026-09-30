-- Energiebilanz v0.7: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Ergänzt die Tarife um Boni-Einzelposten. Mehrfaches Ausführen ist unschädlich.
alter table tariffs add column if not exists boni_items jsonb;
create index if not exists payments_day on payments (user_id, grp, day);

-- Kontrolle: muss eine Zeile „boni_items | jsonb“ zeigen
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'tariffs' and column_name = 'boni_items';
