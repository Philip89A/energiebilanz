-- Energiebilanz v0.41: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für die CO₂-Intensität des deutschen Stromnetzes je Tag (Tagesmittel und 24 Stundenwerte, g CO₂ je kWh),
-- abgerufen von Energy-Charts (Fraunhofer ISE). Row Level Security wie die übrigen Tabellen (Eigentümer schreibt, Gast
-- liest). Die Warnung „destructive operations“ kommt von „drop … if exists“ und betrifft nur Regeln und Trigger dieser
-- neuen Tabelle. Mehrfaches Ausführen ist unschädlich.
create table if not exists grid_co2 (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  g_mean numeric not null check (g_mean >= 0),  -- Tagesmittel g CO₂ je kWh
  hours jsonb,                                   -- 24 Stundenmittel (Ortszeit), null wenn unvollständig
  n integer,                                     -- Anzahl Messwerte des Tages
  src text not null default 'energy-charts',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table grid_co2 enable row level security;
drop policy if exists eb_read on grid_co2;
drop policy if exists eb_insert on grid_co2;
drop policy if exists eb_update on grid_co2;
drop policy if exists eb_delete on grid_co2;
create policy eb_read on grid_co2 for select to authenticated using (public.eb_can_read(user_id));
create policy eb_insert on grid_co2 for insert to authenticated with check (public.eb_can_write(user_id));
create policy eb_update on grid_co2 for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id));
create policy eb_delete on grid_co2 for delete to authenticated using (public.eb_can_write(user_id));
revoke all on grid_co2 from anon;
grant select, insert, update, delete on grid_co2 to authenticated;
drop trigger if exists set_updated_at on grid_co2;
create trigger set_updated_at before update on grid_co2 for each row execute function set_updated_at();
notify pgrst, 'reload schema';
-- Kontrolle: „grid_co2 | true | 4“
select tablename, rowsecurity, (select count(*) from pg_policies p where p.tablename = 'grid_co2') as regeln
from pg_tables where schemaname = 'public' and tablename = 'grid_co2';
