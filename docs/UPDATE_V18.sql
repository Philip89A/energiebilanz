-- Energiebilanz v0.18: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Erlaubt die Investitions-Kategorie „refund“ (Erstattung/Gutschrift). Die Warnung „destructive operations“ kommt von
-- „drop constraint if exists“ und betrifft nur diese Prüfregel, keine Daten. Mehrfaches Ausführen ist unschädlich.
alter table investments drop constraint if exists investments_category_check;
alter table investments add constraint investments_category_check check (category in ('pv','wallbox','other','refund'));

-- Kontrolle: zeigt die Prüfregel mit 'refund'
select pg_get_constraintdef(oid) from pg_constraint where conname = 'investments_category_check';
