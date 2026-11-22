-- Energiebilanz v0.60: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für die Day-Ahead-Börsenpreise Deutschland/Luxemburg je Tag (Tagesmittel und 24 Stundenmittel, €/MWh),
-- abgerufen von Energy-Charts (Fraunhofer ISE) für die Simulation „Dynamischer Tarif“. Row Level Security wie die übrigen
-- Tabellen (Eigentümer schreibt, Gast liest). Die Warnung „destructive operations“ kommt von „drop … if exists“ und
-- betrifft nur Regeln und Trigger dieser neuen Tabelle. Mehrfaches Ausführen ist unschädlich.
create table if not exists grid_price (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  eur_mwh numeric not null,                      -- Tagesmittel €/MWh (kann negativ sein)
  hours jsonb not null,                          -- 24 Stundenmittel (Ortszeit) €/MWh
  src text not null default 'energy-charts',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table grid_price enable row level security;
drop policy if exists eb_read on grid_price;
drop policy if exists eb_insert on grid_price;
drop policy if exists eb_update on grid_price;
drop policy if exists eb_delete on grid_price;
create policy eb_read on grid_price for select to authenticated using (public.eb_can_read(user_id));
create policy eb_insert on grid_price for insert to authenticated with check (public.eb_can_write(user_id));
create policy eb_update on grid_price for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id));
create policy eb_delete on grid_price for delete to authenticated using (public.eb_can_write(user_id));
revoke all on grid_price from anon;
grant select, insert, update, delete on grid_price to authenticated;
drop trigger if exists set_updated_at on grid_price;
create trigger set_updated_at before update on grid_price for each row execute function set_updated_at();
notify pgrst, 'reload schema';
-- Kontrolle: „grid_price | true | 4“
select tablename, rowsecurity, (select count(*) from pg_policies p where p.tablename = 'grid_price') as regeln
from pg_tables where schemaname = 'public' and tablename = 'grid_price';
