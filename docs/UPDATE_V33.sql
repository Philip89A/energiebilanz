-- Energiebilanz v0.33: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neue Tabelle für das Raumklima je Raum und Tag (Govee-Thermometer: Temperatur und relative Luftfeuchte), mit Row Level
-- Security wie die übrigen Tabellen (Eigentümer schreibt, Gast liest). Die Warnung „destructive operations“ kommt von
-- „drop … if exists“ und betrifft nur Regeln und Trigger dieser neuen Tabelle. Mehrfaches Ausführen ist unschädlich.
create table if not exists room_climate (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  room text not null,                -- id aus settings.data.rooms (= Raumname beim ersten Import)
  day date not null,
  n int not null,                    -- Anzahl Messwerte an diesem Tag (alle 15 min: 96 = vollständig)
  t numeric, rh numeric,             -- Tagesmittel Temperatur °C und relative Feuchte %
  rh_min numeric, rh_max numeric,
  h_dry numeric, h_wet numeric,      -- Stunden mit Feuchte unter 40 % bzw. ab 60 % (Stundenmittel)
  hours jsonb,                       -- 24 × [Temperatur, Feuchte] als Stundenmittel, null für Stunden ohne Wert
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, room, day)
);
alter table room_climate enable row level security;
drop policy if exists eb_read on room_climate;
drop policy if exists eb_insert on room_climate;
drop policy if exists eb_update on room_climate;
drop policy if exists eb_delete on room_climate;
create policy eb_read on room_climate for select to authenticated using (public.eb_can_read(user_id));
create policy eb_insert on room_climate for insert to authenticated with check (public.eb_can_write(user_id));
create policy eb_update on room_climate for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id));
create policy eb_delete on room_climate for delete to authenticated using (public.eb_can_write(user_id));
revoke all on room_climate from anon;
grant select, insert, update, delete on room_climate to authenticated;
drop trigger if exists set_updated_at on room_climate;
create trigger set_updated_at before update on room_climate for each row execute function set_updated_at();
notify pgrst, 'reload schema';
-- Kontrolle: „room_climate | true“ und vier Regeln
select tablename, rowsecurity, (select count(*) from pg_policies p where p.tablename = 'room_climate') as regeln
from pg_tables where schemaname = 'public' and tablename = 'room_climate';
