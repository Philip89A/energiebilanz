-- Energiebilanz v0.10: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für Wetter-Tageswerte (Open-Meteo), mit Row Level Security wie alle anderen Tabellen.
-- Mehrfaches Ausführen ist unschädlich.
create table if not exists weather_daily (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  temp_mean numeric not null,        -- Tagesmitteltemperatur °C
  rad_kwh numeric not null,          -- Globalstrahlung kWh/m² (horizontal)
  sun_h numeric,                     -- Sonnenstunden
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table weather_daily enable row level security;
drop policy if exists own_rows on weather_daily;
create policy own_rows on weather_daily for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on weather_daily from anon;
grant select, insert, update, delete on weather_daily to authenticated;
drop trigger if exists set_updated_at on weather_daily;
create trigger set_updated_at before update on weather_daily for each row execute function set_updated_at();

-- Kontrolle: muss „weather_daily | true“ zeigen
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'weather_daily';
