-- Energiebilanz v0.56: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für Stundenwerte der Messsteckdosen (Excel-Export, Blatt „Tag“): je Gerät und Tag 24 Werte in kWh,
-- mit Row Level Security wie die übrigen Tabellen (Eigentümer schreibt, Gast liest). Die Warnung „destructive operations“
-- kommt von „drop … if exists“ und betrifft nur Regeln und Trigger dieser neuen Tabelle. Mehrfaches Ausführen ist unschädlich.
create table if not exists device_hourly (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,           -- id aus settings.data.devices
  day date not null,
  hours numeric[] not null check (array_length(hours, 1) between 23 and 25),   -- kWh je Stunde 0–23 (Ortszeit), null = fehlt
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, day)
);
alter table device_hourly enable row level security;
drop policy if exists eb_read on device_hourly;
drop policy if exists eb_insert on device_hourly;
drop policy if exists eb_update on device_hourly;
drop policy if exists eb_delete on device_hourly;
create policy eb_read on device_hourly for select to authenticated using (public.eb_can_read(user_id));
create policy eb_insert on device_hourly for insert to authenticated with check (public.eb_can_write(user_id));
create policy eb_update on device_hourly for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id));
create policy eb_delete on device_hourly for delete to authenticated using (public.eb_can_write(user_id));
revoke all on device_hourly from anon;
grant select, insert, update, delete on device_hourly to authenticated;
drop trigger if exists set_updated_at on device_hourly;
create trigger set_updated_at before update on device_hourly for each row execute function set_updated_at();
notify pgrst, 'reload schema';
-- Kontrolle: „device_hourly | true | 4“
select tablename, rowsecurity, (select count(*) from pg_policies p where p.tablename = 'device_hourly') as regeln
from pg_tables where schemaname = 'public' and tablename = 'device_hourly';
