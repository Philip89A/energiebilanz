-- Energiebilanz v0.9: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Ergänzt die Investitionen um eine Kategorie (PV/Speicher, Wallbox, Sonstiges). Mehrfaches Ausführen ist unschädlich.
alter table investments add column if not exists category text;
alter table investments drop constraint if exists investments_category_check;
alter table investments add constraint investments_category_check check (category in ('pv','wallbox','other'));

-- Kontrolle: muss eine Zeile „category | text“ zeigen
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'investments' and column_name = 'category';
