-- Energiebilanz v0.36: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für Programme je Monat (z. B. Monatsanalyse der Waschmaschinen-App), mit Row Level Security wie die
-- übrigen Tabellen (Eigentümer schreibt, Gast liest). Die Warnung „destructive operations“ kommt von „drop … if
-- exists“ und betrifft nur Regeln und Trigger dieser neuen Tabelle. Mehrfaches Ausführen ist unschädlich.
create table if not exists device_programs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,                 -- id aus settings.data.devices
  month date not null,                     -- erster Tag des Monats
  program text not null,                   -- z. B. Pflegeleicht, Baumwolle, smartFinish
  temp smallint not null default 0,        -- °C, 0 = ohne Angabe
  rpm smallint not null default 0,         -- Schleuderdrehzahl, 0 = ohne Angabe
  extra text not null default '',          -- Zusatz, z. B. Miniload
  runs integer not null check (runs >= 0), -- Anzahl im Monat
  kwh_run numeric check (kwh_run >= 0),    -- kWh je Gang
  l_run numeric check (l_run >= 0),        -- Liter je Gang
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, month, program, temp, rpm, extra)
);
alter table device_programs enable row level security;
drop policy if exists eb_read on device_programs;
drop policy if exists eb_insert on device_programs;
drop policy if exists eb_update on device_programs;
drop policy if exists eb_delete on device_programs;
create policy eb_read on device_programs for select to authenticated using (public.eb_can_read(user_id));
create policy eb_insert on device_programs for insert to authenticated with check (public.eb_can_write(user_id));
create policy eb_update on device_programs for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id));
create policy eb_delete on device_programs for delete to authenticated using (public.eb_can_write(user_id));
revoke all on device_programs from anon;
grant select, insert, update, delete on device_programs to authenticated;
drop trigger if exists set_updated_at on device_programs;
create trigger set_updated_at before update on device_programs for each row execute function set_updated_at();
notify pgrst, 'reload schema';
-- Kontrolle: „device_programs | true | 4“
select tablename, rowsecurity, (select count(*) from pg_policies p where p.tablename = 'device_programs') as regeln
from pg_tables where schemaname = 'public' and tablename = 'device_programs';
