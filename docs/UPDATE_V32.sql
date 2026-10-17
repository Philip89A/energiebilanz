-- Energiebilanz v0.32: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für den Verbrauch einzelner Geräte je Tag (Messsteckdosen, Waschmaschine), mit Row Level Security wie
-- die übrigen Tabellen (Eigentümer schreibt, Gast liest). Die Warnung „destructive operations“ kommt von „drop … if
-- exists“ und betrifft nur Regeln und Trigger dieser neuen Tabelle. Mehrfaches Ausführen ist unschädlich.
create table if not exists device_daily (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,           -- id aus settings.data.devices
  day date not null,
  kwh numeric,                       -- Strom an diesem Tag
  water_l numeric,                   -- Wasser in Litern (Waschmaschine), sonst leer
  runs numeric,                      -- Anzahl Programme/Waschgänge (bei Monatswerten anteilig je Tag)
  src text not null default 'day' check (src in ('day', 'month')),   -- month = Monatssumme gleichmäßig auf die Tage verteilt
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, day)
);
alter table device_daily enable row level security;
drop policy if exists eb_read on device_daily;
drop policy if exists eb_insert on device_daily;
drop policy if exists eb_update on device_daily;
drop policy if exists eb_delete on device_daily;
create policy eb_read on device_daily for select to authenticated using (public.eb_can_read(user_id));
create policy eb_insert on device_daily for insert to authenticated with check (public.eb_can_write(user_id));
create policy eb_update on device_daily for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id));
create policy eb_delete on device_daily for delete to authenticated using (public.eb_can_write(user_id));
revoke all on device_daily from anon;
grant select, insert, update, delete on device_daily to authenticated;
drop trigger if exists set_updated_at on device_daily;
create trigger set_updated_at before update on device_daily for each row execute function set_updated_at();
notify pgrst, 'reload schema';
-- Kontrolle: „device_daily | true“ und vier Regeln
select tablename, rowsecurity, (select count(*) from pg_policies p where p.tablename = 'device_daily') as regeln
from pg_tables where schemaname = 'public' and tablename = 'device_daily';
