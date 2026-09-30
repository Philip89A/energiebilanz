// Supabase-Zugang. URL und Publishable-Key sind absichtlich öffentlich:
// sie stehen ohnehin im ausgelieferten Browser-Code. Den Schutz der Daten
// übernimmt Row Level Security (supabase/schema.sql), nicht dieser Key.
// Niemals hier eintragen: service_role- oder sb_secret-Key, DB-Passwort.
export const SUPABASE_URL = 'https://iweelkcxmqdycmotchxh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_mLIE3SYdFR_ed158sVYkbA_qpFINJgF';
