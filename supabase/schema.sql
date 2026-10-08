-- Energiebilanz: Supabase-Schema v2 mit Row Level Security
-- Jede Tabelle gehört genau einem Nutzer (user_id = auth.uid()).
-- Im Supabase SQL-Editor komplett ausführen. Mehrfaches Ausführen ist unschädlich.
--
-- Änderungen gegenüber v1:
--  - meter_readings: Fremdschlüssel auf meters (user_id, meter_id)
--  - created_at / updated_at + Trigger auf allen Tabellen (Offline-Sync, "zuletzt geändert")
--  - Prüfregeln (check) wie die Eingabeprüfungen der Referenz
--  - installments: unique (user_id, grp, valid_from)
--  - events.text -> events.note, grp mit Prüfregel
--  - anker_daily: smart_plug (CSV-Spalte "Verbrauch über Smart Plug"), imported_at
--  - Policies mit (select auth.uid()), explizite Rechte: anon nichts, authenticated CRUD
--  - settings.data enthält nur battery, pv, amort, cars, schema_version
--    (view/ui bleiben je Gerät im localStorage)
--  - IDs erzeugt der Client (crypto.randomUUID()), Default bleibt als Rückfall

create extension if not exists pgcrypto;

-- Tägliche Anker-Werte (Import aus CSV „Energiedetails“), Upsert über (user_id, day)
-- Rohwerte unverändert: Nullen vor dem Smart Meter bleiben 0, calc.js blendet sie aus.
create table if not exists anker_daily (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  eigenverbrauch numeric, netzimport numeric, netz_zu_haus numeric,
  solar_zu_haus numeric, solar_zu_speicher numeric,
  speicher_ladung numeric, speicher_entladung numeric, speicher_zu_haus numeric,
  genutzt numeric, erzeugung numeric, einspeisung numeric,
  pv1 numeric, pv2 numeric, pv3 numeric, pv4 numeric,
  smart_plug numeric,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists meters (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,                 -- as_alt, as_neu, wp, as_feed
  name text not null,
  grp text not null check (grp in ('as','wp','feed','water')),   -- water ab v0.25 (m³)
  sort int not null default 0,      -- Reihenfolge bei Zählertausch innerhalb einer Gruppe
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists meter_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  meter_id text not null,
  day date not null,
  value numeric not null check (value >= 0),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meter_id, day),
  foreign key (user_id, meter_id) references meters (user_id, id) on update cascade on delete cascade
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  grp text check (grp in ('as','wp','pv','car')),
  type text,                        -- geraet, zaehler, daten, ...
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tariffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  grp text not null check (grp in ('as','wp')),
  name text not null,
  valid_from date not null, valid_to date,
  ap_ct numeric not null check (ap_ct >= 0),             -- Arbeitspreis brutto ct/kWh
  gp_eur_year numeric not null check (gp_eur_year >= 0), -- Grundpreis brutto €/Jahr
  boni_eur numeric not null default 0 check (boni_eur >= 0),
  boni_note text, estimate_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

create table if not exists installments (   -- Abschläge, je Änderung eine Zeile
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  grp text not null check (grp in ('as','wp')),
  valid_from date not null,
  amount numeric not null check (amount >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, grp, valid_from)
);

create table if not exists payments (       -- Zahlungsbuch (tatsächliche Geldflüsse), UI folgt
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  grp text not null check (grp in ('as','wp')),
  day date not null, amount numeric not null,
  kind text not null check (kind in ('abschlag','erstattung','bonus','nachzahlung')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date, name text not null,
  cost numeric not null,            -- Verkäufe negativ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fuel_log (       -- Tankvorgänge (Cupra Leon)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  odometer numeric not null check (odometer > 0),
  liters numeric not null check (liters > 0),
  amount numeric not null check (amount > 0),
  fuel_type text,                   -- Super E10, Super E5, Super Plus, Diesel
  full_tank boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists charge_log (     -- Ladevorgänge (Cupra Tavascan)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  odometer numeric check (odometer is null or odometer > 0),
  kwh numeric not null check (kwh > 0),
  amount numeric check (amount is null or amount >= 0),
  location text check (location in ('zu Hause','öffentlich AC','öffentlich DC','Arbeitgeber')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists car_log (        -- Fahrzeugbuch
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  car text not null check (car in ('leon','tavascan')),
  category text not null,
  odometer numeric check (odometer is null or odometer > 0),
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (odometer is not null or amount <> 0)  -- Kilometerstand oder Betrag Pflicht
);

create table if not exists settings (       -- Parameter als JSON: battery, pv, amort, cars, schema_version
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists weather_daily (   -- v5 (App v0.10): Wetter-Tageswerte von Open-Meteo
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  temp_mean numeric not null,        -- Tagesmitteltemperatur °C
  rad_kwh numeric not null,          -- Globalstrahlung kWh/m² (horizontal)
  sun_h numeric,                     -- Sonnenstunden
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists hp_energy (       -- v6 (App v0.11): Energie-Export der Wärmepumpen-App
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

-- v3 (App v0.7): Boni als Einzelposten je Tarif, z. B.
-- [{"name":"Sofortbonus","amount":100},{"name":"Neukundenbonus","amount":80,"minKwh":2000,"amountBelow":50}]
alter table tariffs add column if not exists boni_items jsonb;
create index if not exists payments_day on payments (user_id, grp, day);

-- v4 (App v0.9): Kategorie je Investition für die Amortisation (leer = PV/Speicher)
alter table investments add column if not exists category text;
alter table investments drop constraint if exists investments_category_check;
alter table investments add constraint investments_category_check check (category in ('pv','wallbox','other','refund'));   -- refund ab v0.18

-- Indizes für Abfragen nach Zeitraum
create index if not exists meter_readings_day on meter_readings (user_id, meter_id, day);
create index if not exists fuel_log_day   on fuel_log   (user_id, day);
create index if not exists charge_log_day on charge_log (user_id, day);
create index if not exists car_log_day    on car_log    (user_id, car, day);
create index if not exists tariffs_grp    on tariffs    (user_id, grp, valid_from);

-- v7 (App v0.14): Gastzugang. Die Regeln own_rows unten werden durch docs/UPDATE_V14.sql ersetzt
-- (Tabelle shares, Funktionen eb_can_read/eb_can_write, Regeln eb_read/eb_insert/eb_update/eb_delete).
-- Bei einer Neuinstallation zuerst dieses Schema, danach docs/UPDATE_V14.sql ausführen.

-- updated_at automatisch setzen
create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Row Level Security, Rechte und Trigger für alle Tabellen
do $$
declare t text;
begin
  foreach t in array array['anker_daily','meters','meter_readings','events','tariffs','installments',
                           'payments','investments','fuel_log','charge_log','car_log','settings','weather_daily','hp_energy']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists own_rows on %I', t);
    execute format('create policy own_rows on %I for all to authenticated '
                   'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format('create trigger set_updated_at before update on %I '
                   'for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- Kontrolle 1: muss 14 Zeilen zeigen, alle rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
