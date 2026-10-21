// Energiebilanz v0.43: CO2-Intensitaet des deutschen Stromnetzes von Energy-Charts (Fraunhofer ISE) holen und mit
// CORS-Freigabe an die App weiterreichen. Nur angemeldete Nutzer (verify_jwt). Feste Zieladresse, kein offener Proxy,
// schreibt nichts in die Datenbank. Aufruf: GET ?start=YYYY-MM-DD&end=YYYY-MM-DD (hoechstens 40 Tage).
// Eingerichtet am 21.10.2026 (Version 1, verify_jwt = true). Neu einrichten: Supabase CLI
//   supabase functions deploy grid-co2 --project-ref iweelkcxmqdycmotchxh
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Nur GET' }, 405);
  const u = new URL(req.url), start = u.searchParams.get('start') || '', end = u.searchParams.get('end') || '';
  if (!DAY.test(start) || !DAY.test(end) || end < start) return json({ error: 'start und end als YYYY-MM-DD angeben' }, 400);
  if ((Date.parse(end) - Date.parse(start)) / 864e5 > 40) return json({ error: 'hoechstens 40 Tage je Abruf' }, 400);
  const src = `https://api.energy-charts.info/co2eq?country=de&start=${start}&end=${end}`;
  try {
    const r = await fetch(src, { headers: { accept: 'application/json' } });
    const text = await r.text();
    if (!r.ok) return json({ error: `Energy-Charts: HTTP ${r.status}`, detail: text.slice(0, 300), src }, 502);
    let body: unknown; try { body = JSON.parse(text); } catch { return json({ error: 'Energy-Charts: keine JSON-Antwort', detail: text.slice(0, 300), src }, 502); }
    return new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=3600' } });
  } catch (e) {
    return json({ error: `Energy-Charts nicht erreichbar: ${(e as Error).message}`, src }, 502);
  }
});
