-- Energiebilanz v0.25: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Erlaubt die Zählergruppe „water“ (Wasserzähler, Stände in m³). Die Warnung „destructive operations“ kommt von
-- „drop constraint if exists“ und betrifft nur diese Prüfregel, keine Daten. Mehrfaches Ausführen ist unschädlich.
alter table meters drop constraint if exists meters_grp_check;
alter table meters add constraint meters_grp_check check (grp in ('as','wp','feed','water'));

-- Kontrolle: zeigt die Prüfregel mit 'water'
select pg_get_constraintdef(oid) from pg_constraint where conname = 'meters_grp_check';
