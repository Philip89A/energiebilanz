-- Energiebilanz v0.46: einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Neues Feld „read_at“ (Datum und Uhrzeit der Ablesung) bei den Zählerständen. Bisherige Werte, die am selben Tag
-- eingetragen wurden, bekommen die Uhrzeit ihrer letzten Änderung (so wie sie in der App gespeichert wurden); ältere
-- Werte (z. B. aus dem Import) bleiben leer und zählen wie bisher als 00:00 Uhr. Mehrfaches Ausführen ist unschädlich.
alter table meter_readings add column if not exists read_at timestamptz;
update meter_readings set read_at = updated_at
 where read_at is null and (updated_at at time zone 'Europe/Berlin')::date = day;
notify pgrst, 'reload schema';
-- Kontrolle: Anzahl Ablesungen mit Uhrzeit und ohne
select count(*) filter (where read_at is not null) as mit_uhrzeit, count(*) filter (where read_at is null) as ohne
from meter_readings;
