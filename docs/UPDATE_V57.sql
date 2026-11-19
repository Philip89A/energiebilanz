-- Energiebilanz v0.57: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Vier neue Spalten in den Anker-Tageswerten: PV5–PV8 = Eingänge PV1–PV4 der Solarbank 2 ab dem 14.11.2026.
-- Bestehende Werte bleiben unverändert, neue Spalten sind leer. Mehrfaches Ausführen ist unschädlich.
alter table anker_daily add column if not exists pv5 numeric;
alter table anker_daily add column if not exists pv6 numeric;
alter table anker_daily add column if not exists pv7 numeric;
alter table anker_daily add column if not exists pv8 numeric;
notify pgrst, 'reload schema';
-- Kontrolle: „pv5 | pv6 | pv7 | pv8“
select string_agg(column_name, ' | ' order by column_name) as spalten
from information_schema.columns where table_schema = 'public' and table_name = 'anker_daily' and column_name in ('pv5','pv6','pv7','pv8');
