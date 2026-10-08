-- Energiebilanz v0.27: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für gespeicherte PV-Prognosen (je Prognosetag und Erstellungstag), mit Row Level Security wie die übrigen
-- Tabellen (Eigentümer schreibt, Gast liest). Die Warnung „destructive operations“ kommt von „drop … if exists“ und
-- betrifft nur Regeln und Trigger dieser neuen Tabelle. Mehrfaches Ausführen ist unschädlich.
create table if not exists pv_forecast (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,                 -- Tag, für den die Prognose gilt
  made_on date not null,             -- Tag, an dem sie erstellt wurde
  kwh numeric not null,              -- erwartete Erzeugung
  lo numeric, hi numeric,            -- Band aus der gemessenen Streuung
  rad_kwh numeric,                   -- vorhergesagte Einstrahlung kWh/m²
  factor numeric,                    -- verwendeter Ertragsfaktor (kWh je kWh/m²)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, made_on)
);
alter table pv_forecast enable row level security;
drop policy if exists eb_read on pv_forecast;
drop policy if exists eb_insert on pv_forecast;
drop policy if exists eb_update on pv_forecast;
drop policy if exists eb_delete on pv_forecast;
create policy eb_read on pv_forecast for select to authenticated using (public.eb_can_read(user_id));
create policy eb_insert on pv_forecast for insert to authenticated with check (public.eb_can_write(user_id));
create policy eb_update on pv_forecast for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id));
create policy eb_delete on pv_forecast for delete to authenticated using (public.eb_can_write(user_id));
revoke all on pv_forecast from anon;
grant select, insert, update, delete on pv_forecast to authenticated;
drop trigger if exists set_updated_at on pv_forecast;
create trigger set_updated_at before update on pv_forecast for each row execute function set_updated_at();

-- Kontrolle: „pv_forecast | true“ und vier Regeln
select tablename, rowsecurity, (select count(*) from pg_policies p where p.tablename = 'pv_forecast') as regeln
from pg_tables where schemaname = 'public' and tablename = 'pv_forecast';
