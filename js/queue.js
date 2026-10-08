// Offline-Warteschlange und lokaler Datenstand (reine Funktionen + dünne localStorage-Hülle).
// Eine Operation ist { op: 'save' | 'delete', kind, row } oder { op: 'settings', data }.
// kind wie in db.js (reading, tariff, installment, investment, fuel, charge, carlog, event).

export const TABLE = {
  reading: 'meter_readings', tariff: 'tariffs', installment: 'installments', investment: 'investments',
  fuel: 'fuel_log', charge: 'charge_log', carlog: 'car_log', event: 'events', payment: 'payments', meter: 'meters',
};
const sameRow = (kind, a, b) => (kind === 'reading' ? a.meter_id === b.meter_id && a.day === b.day : a.id === b.id);

// Wendet Operationen auf einen Datenstand (Form wie db.loadAll) an und liefert eine Kopie.
export function applyOps(db, ops) {
  const out = { ...db };
  for (const o of ops) {
    if (o.op === 'settings') { out.settings = { ...(out.settings || {}), data: o.data.data ?? o.data }; continue; }
    const t = TABLE[o.kind];
    const rows = [...(out[t] || [])];
    const i = rows.findIndex(r => sameRow(o.kind, r, o.row));
    if (o.op === 'save') { if (i >= 0) rows[i] = { ...rows[i], ...o.row }; else rows.push({ ...o.row }); }
    else if (o.op === 'delete' && i >= 0) rows.splice(i, 1);
    out[t] = rows;
  }
  return out;
}

// Neue Operation anhängen: Einstellungen nur einmal (die neueste), sonst Reihenfolge erhalten
export function enqueue(ops, op) {
  if (op.op === 'settings') return [...ops.filter(o => o.op !== 'settings'), op];
  return [...ops, op];
}

// Netzwerkfehler (dann warten) von Serverfehlern (dann verwerfen und melden) unterscheiden
export function isNetworkError(err, online = true) {
  if (!online) return true;
  const m = String(err?.message || err || '');
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|ERR_INTERNET|timeout/i.test(m);
}

// Zahl aus deutscher Eingabe: „1.234,5“ → 1234.5, „42,5“ → 42.5, „42.5“ → 42.5
export function parseNum(s) {
  let t = String(s ?? '').trim().replace(/\s/g, '');
  if (t === '') return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// localStorage-Hülle je Nutzer
export function localStore(uid, storage = globalThis.localStorage) {
  const k = { snap: `eb_snap_${uid}`, queue: `eb_queue_${uid}` };
  const read = (key, def) => { try { const v = storage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const write = (key, v) => { try { storage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } };
  return {
    snapshot: () => read(k.snap, null),                                  // { db, savedAt }
    saveSnapshot: db => write(k.snap, { db, savedAt: new Date().toISOString() }),
    queue: () => read(k.queue, []),
    saveQueue: q => write(k.queue, q),
    clear: () => { try { storage.removeItem(k.snap); storage.removeItem(k.queue); } catch (e) { /* egal */ } },
  };
}
