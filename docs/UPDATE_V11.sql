-- Energiebilanz v0.11: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für den Energie-Export der Wärmepumpen-App (Stunden, Tage, Monate), mit Row Level Security.
-- Die Warnung „destructive operations“ kommt von „drop … if exists“: betrifft nur Regel und Trigger dieser neuen Tabelle.
-- Mehrfaches Ausführen ist unschädlich.
create table if not exists hp_energy (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  grain text not null check (grain in ('hour','day','month')),
  ts text not null,                  -- 2026-09-28T01:00 | 2026-09-28 | 2026-09
  el_hp numeric, el_heat numeric, el_cool numeric, el_dhw numeric,      -- Strom Wärmepumpe kWh
  el_aux numeric, el_aux_heat numeric, el_aux_dhw numeric,              -- Strom Zuheizer kWh
  heat_heat numeric, heat_dhw numeric, heat_cool numeric,               -- erzeugte Wärme bzw. Kälte kWh
  t_out numeric, t_flow numeric, t_dhw numeric,                         -- Sensoren °C
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, grain, ts)
);
alter table hp_energy enable row level security;
drop policy if exists own_rows on hp_energy;
create policy own_rows on hp_energy for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on hp_energy from anon;
grant select, insert, update, delete on hp_energy to authenticated;
drop trigger if exists set_updated_at on hp_energy;
create trigger set_updated_at before update on hp_energy for each row execute function set_updated_at();

-- Kontrolle: muss „hp_energy | true“ zeigen
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'hp_energy';
