-- Energiebilanz v0.14: Gastzugang (nur lesen). Einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Die Warnung „destructive operations“ kommt von „drop policy/function … if exists“: Die alten Zugriffsregeln werden
-- durch getrennte Regeln für Lesen und Schreiben ersetzt. Daten werden nicht gelöscht. Mehrfaches Ausführen ist unschädlich.

-- 1) Freigaben: owner_id gibt seine Daten für viewer_id zum Lesen frei
create table if not exists shares (
  owner_id uuid not null references auth.users on delete cascade,
  viewer_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
alter table shares enable row level security;
drop policy if exists shares_read on shares;
create policy shares_read on shares for select to authenticated
  using (owner_id = (select auth.uid()) or viewer_id = (select auth.uid()));
revoke all on shares from anon;
revoke all on shares from authenticated;
grant select on shares to authenticated;          -- Freigaben nur per SQL Editor anlegen oder löschen

-- 2) Hilfsfunktionen (security definer, damit die Regeln nicht rekursiv auf shares prüfen)
create or replace function public.eb_can_read(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select owner = (select auth.uid())
      or exists (select 1 from public.shares s where s.owner_id = owner and s.viewer_id = (select auth.uid()));
$$;
create or replace function public.eb_can_write(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select owner = (select auth.uid())
     and not exists (select 1 from public.shares s where s.viewer_id = (select auth.uid()));
$$;
revoke all on function public.eb_can_read(uuid) from public, anon;
revoke all on function public.eb_can_write(uuid) from public, anon;
grant execute on function public.eb_can_read(uuid) to authenticated;
grant execute on function public.eb_can_write(uuid) to authenticated;

-- 3) Regeln je Tabelle: Lesen eigene oder freigegebene Zeilen; Schreiben nur eigene und nur ohne Gast-Rolle
do $$
declare t text;
begin
  foreach t in array array['anker_daily','meters','meter_readings','events','tariffs','installments','payments',
                           'investments','fuel_log','charge_log','car_log','settings','weather_daily','hp_energy']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists own_rows on %I', t);
    execute format('drop policy if exists eb_read on %I', t);
    execute format('drop policy if exists eb_insert on %I', t);
    execute format('drop policy if exists eb_update on %I', t);
    execute format('drop policy if exists eb_delete on %I', t);
    execute format('create policy eb_read on %I for select to authenticated using (public.eb_can_read(user_id))', t);
    execute format('create policy eb_insert on %I for insert to authenticated with check (public.eb_can_write(user_id))', t);
    execute format('create policy eb_update on %I for update to authenticated using (public.eb_can_write(user_id)) with check (public.eb_can_write(user_id))', t);
    execute format('create policy eb_delete on %I for delete to authenticated using (public.eb_can_write(user_id))', t);
  end loop;
end $$;

-- 4) Gast eintragen (E-Mail-Adressen anpassen; Zeile ggf. mehrfach für weitere Gäste)
-- insert into shares (owner_id, viewer_id)
--   select o.id, v.id from auth.users o, auth.users v
--   where o.email = 'BESITZER@BEISPIEL.DE' and v.email = 'GAST@BEISPIEL.DE'
--   on conflict do nothing;

-- Kontrolle: je Tabelle vier Regeln eb_read/eb_insert/eb_update/eb_delete, keine own_rows mehr
select tablename, string_agg(policyname, ', ' order by policyname) as regeln
  from pg_policies where schemaname = 'public' group by tablename order by tablename;
