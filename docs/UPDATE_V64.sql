-- Energiebilanz v0.64: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Spalte „Gruppe“ in den Investitionen: Kauf, Verkauf, Erstattung und Rücksendekosten mit gleichem Gruppennamen werden
-- in „Was ist schon abbezahlt?“ miteinander verrechnet. Bestehende Werte bleiben unverändert. Mehrfaches Ausführen ist unschädlich.
alter table investments add column if not exists grp text;
notify pgrst, 'reload schema';
-- Kontrolle: „grp | text“
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'investments' and column_name = 'grp';
