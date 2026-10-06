// Einstieg: Anmeldung (E-Mail + Passwort, wie M&M-Tracker), Laden der Daten, Seiten (views.js), Importe,
// Offline-Betrieb (Datenstand und Warteschlange je Nutzer im localStorage, js/queue.js) und Service Worker.
import { client, fetchAll, upsertRows, tableCounts, importSeed, seedConflicts, loadAll, saveRow, deleteRow, saveSettings, saveWeather, saveHp } from './db.js?v=0.21.0';
import { validateSeed, mapSeed, seedSummary, parseAnkerCsv, diffAnker } from './import.js?v=0.21.0';
import { stateFromDb } from './calc.js?v=0.21.0';
import { setModel, startViews, setStore, syncWeather } from './views.js?v=0.21.0';
import { applyOps, enqueue, isNetworkError, localStore } from './queue.js?v=0.21.0';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 1) => (v == null ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const kwhFromMilli = m => nf(m / 1000, 1) + ' kWh';
const eurFromMilli = m => nf(m / 1000, 2) + ' €';
const deDate = iso => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');
const deTime = iso => { const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const APP_VERSION = document.querySelector('meta[name=app-version]').content;

const TABLE_LABELS = {
  anker_daily: 'Anker-Tage', meters: 'Zähler', meter_readings: 'Zählerstände', events: 'Ereignisse',
  tariffs: 'Tarife', installments: 'Abschläge', investments: 'Investitionen', fuel_log: 'Tankvorgänge',
  charge_log: 'Ladevorgänge', car_log: 'Fahrzeugbuch', payments: 'Zahlungen', settings: 'Einstellungen',
};
const FIELD_LABELS = {
  eigenverbrauch: 'Eigenverbrauch', netzimport: 'Netzimport', netz_zu_haus: 'Netz zu Haus',
  solar_zu_haus: 'Solar zu Haus', solar_zu_speicher: 'Solar zu Speicher', speicher_ladung: 'Ladung',
  speicher_entladung: 'Entladung', speicher_zu_haus: 'Speicher zu Haus', genutzt: 'genutzt',
  erzeugung: 'Erzeugung', einspeisung: 'Einspeisung', pv1: 'PV1', pv2: 'PV2', pv3: 'PV3', pv4: 'PV4',
  smart_plug: 'Smart Plug',
};

/* ---------- Offline: Datenstand und Warteschlange ---------- */

let local = null;          // localStore(uid)
let offlineMode = false;   // ohne gültige Sitzung aus dem lokalen Stand gestartet
const online = () => navigator.onLine && !offlineMode;

async function exec(o) {
  if (o.op === 'save') return saveRow(o.kind, o.row);
  if (o.op === 'delete') return deleteRow(o.kind, o.row);
  return saveSettings(o.data);
}
function snapApply(o) { const s = local?.snapshot(); if (s) local.saveSnapshot(applyOps(s.db, [o])); }
function queueOp(o) { local.saveQueue(enqueue(local.queue(), o)); updatePending(); }
// Schreiben für views.js: sofort senden, sonst vormerken. Reihenfolge bleibt erhalten (wartet schon etwas, hinten anstellen).
let readOnly = false;      // Gastzugang: nichts senden, nichts vormerken
async function send(o) {
  if (readOnly) return 'readonly';
  if (!local) { await exec(o); return 'saved'; }
  if (local.queue().length || !online()) { queueOp(o); return 'queued'; }
  try { await exec(o); snapApply(o); return 'saved'; }
  catch (err) { if (isNetworkError(err, navigator.onLine)) { queueOp(o); return 'queued'; } throw err; }
}
setStore({
  saveRow: (kind, row) => send({ op: 'save', kind, row }),
  deleteRow: (kind, row) => send({ op: 'delete', kind, row }),
  saveSettings: data => send({ op: 'settings', data }),
  reload: () => { shownJson = null; loadModel(); },   // nach Fehler immer neu anzeigen (Speicher ≠ Datenbank)
  saveWeather: rows => (readOnly ? Promise.resolve('readonly') : online() ? saveWeather(rows) : Promise.reject(new Error('offline'))),
  saveHp: rows => (readOnly ? Promise.reject(new Error('Gastzugang – nur lesen.')) : online() ? saveHp(rows) : Promise.reject(new Error('Offline – bitte mit Netz erneut hochladen.'))),
});

let flushing = false;
async function flushQueue() {
  if (!local || flushing || !online() || !local.queue().length) return;
  flushing = true;
  const dropped = [];
  try {
    for (;;) {
      const q = local.queue(); if (!q.length) break;
      try { await exec(q[0]); snapApply(q[0]); }
      catch (err) { if (isNetworkError(err, navigator.onLine)) break; dropped.push(err.message); }
      local.saveQueue(local.queue().slice(1));
    }
  } finally { flushing = false; updatePending(); }
  if (dropped.length) {
    $('main').insertAdjacentHTML('afterbegin', `<p class="flag">Offline erfasste Einträge konnten nicht gespeichert werden und wurden verworfen: ${esc(dropped.join('; '))}</p>`);
    shownJson = null; loadModel();
  }
}
function updatePending() {
  const n = local ? local.queue().length : 0, el = $('pending-banner');
  el.hidden = !n;
  el.textContent = n === 1 ? '1 Eintrag wartet auf Senden.' : `${n} Einträge warten auf Senden.`;
  const ss = $('save-state'); if (ss && n) ss.textContent = `${n} wartend`;
}
function setOfflineBanner(on, savedAt) {
  const el = $('offline-banner');
  el.hidden = !on;
  if (on) el.textContent = `Offline – Stand vom ${deTime(savedAt)}. Neue Einträge werden gesendet, sobald wieder Netz da ist.`;
}
window.addEventListener('online', async () => {
  if (offlineMode) {                     // Sitzung prüfen, dann normal weiter
    const { data: { session } } = await client.auth.getSession();
    if (session) { offlineMode = false; loadedFor = null; enter(session); } else show('auth');
    return;
  }
  setOfflineBanner(false); flushQueue(); loadModel();
});
window.addEventListener('offline', () => { if (local) setOfflineBanner(true, local.snapshot()?.savedAt); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
setInterval(flushQueue, 60000);

/* ---------- Anmeldung ---------- */

function show(screen) {
  $('auth-screen').hidden = screen !== 'auth';
  $('recovery-screen').hidden = screen !== 'recovery';
  $('app-shell').hidden = screen !== 'app';
}

// Nur bei echter Anmeldung neu laden, nicht bei jedem TOKEN_REFRESHED
let loadedFor = null;
function enter(session) {
  show('app');
  if (loadedFor !== session.user.id) {
    loadedFor = session.user.id;
    try { localStorage.setItem('eb_last_uid', session.user.id); } catch (e) { /* egal */ }
    local = localStore(session.user.id);
    updatePending();
    loadModel();
  }
}
function enterOffline(uid) {
  offlineMode = true; loadedFor = uid; local = localStore(uid);
  show('app'); updatePending(); loadModel();
}

// Datenstand anzeigen (wartende Einträge eingerechnet). Ohne Anker-Daten nur die Seite „Daten“.
let shownJson = null;
function showDb(db) {
  const d = local ? applyOps(db, local.queue()) : db;
  const json = JSON.stringify(d);
  if (json === shownJson) return;
  shownJson = json;
  readOnly = !!d.readOnly;
  document.body.classList.toggle('ro', readOnly);
  $('guest-banner').hidden = !readOnly;
  const empty = !d.anker_daily?.length;
  $('empty-hint').hidden = !empty;
  if (empty) {
    document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== 'p-data'; });
    $('period-bar').hidden = true;
  } else {
    setModel(stateFromDb(d));
    $('brand-sub').textContent = `v${APP_VERSION}`;
    startViews();
  }
  addLogout();
}

// Zuerst sofort den lokalen Stand zeigen, dann aus Supabase aktualisieren; offline beim lokalen Stand bleiben.
async function loadModel() {
  $('loading').hidden = false;
  const snap = local?.snapshot();
  if (snap) showDb(snap.db);
  try {
    if (!online()) throw new Error('offline');
    const db = await loadAll();
    local?.saveSnapshot(db);
    showDb(db);
    setOfflineBanner(false);
    $('loading').hidden = true;
    refreshStatus();
    flushQueue();
    syncWeather(true);
  } catch (err) {
    $('loading').hidden = true;
    if (snap && (err.message === 'offline' || isNetworkError(err, navigator.onLine))) setOfflineBanner(true, snap.savedAt);
    else $('main').insertAdjacentHTML('afterbegin', `<p class="flag">Laden fehlgeschlagen: ${esc(err.message)}</p>`);
  }
}

let logoutAdded = false;
function addLogout() {
  if (logoutAdded) return;
  logoutAdded = true;
  for (const nav of [$('snav'), $('mnav')]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ghost logout'; b.textContent = 'Abmelden';
    b.addEventListener('click', async () => {
      const n = local ? local.queue().length : 0;
      if (n && !confirm(`${n} Einträge sind noch nicht gesendet und gehen beim Abmelden verloren. Trotzdem abmelden?`)) return;
      local?.clear();
      try { localStorage.removeItem('eb_last_uid'); } catch (e) { /* egal */ }
      await client.auth.signOut();
      location.reload();
    });
    nav.appendChild(b);
  }
}

client.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') return show('recovery');
  if (event === 'SIGNED_OUT') { if (!offlineMode) { loadedFor = null; show('auth'); } return; }
  if (session) enter(session);
});

(async () => {
  let session = null;
  try { ({ data: { session } } = await client.auth.getSession()); } catch (e) { /* offline */ }
  if (session) return enter(session);
  let last = null; try { last = localStorage.getItem('eb_last_uid'); } catch (e) { /* egal */ }
  if (last && !navigator.onLine && localStore(last).snapshot()) enterOffline(last); else show('auth');
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service Worker nicht registriert:', err));
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('login-error').hidden = true;
  const { error } = await client.auth.signInWithPassword({
    email: $('login-email').value, password: $('login-password').value,
  });
  if (error) { $('login-error').textContent = 'Anmeldung fehlgeschlagen: ' + error.message; $('login-error').hidden = false; }
});

$('forgot-password-btn').addEventListener('click', async () => {
  const email = $('login-email').value;
  if (!email) { alert('Bitte zuerst die E-Mail-Adresse eintragen.'); return; }
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
  alert(error ? 'Fehler: ' + error.message
              : 'Falls ein Konto existiert, ist eine E-Mail unterwegs. Der Link öffnet sich in Safari – '
                + 'dort das neue Passwort setzen, danach in der App normal anmelden.');
});

$('recovery-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { error } = await client.auth.updateUser({ password: $('recovery-password').value });
  if (error) { $('recovery-error').textContent = 'Fehler: ' + error.message; $('recovery-error').hidden = false; return; }
  alert('Passwort geändert.');
  const { data: { session } } = await client.auth.getSession();
  if (session) enter(session);
});


/* ---------- Datenstand ---------- */

async function ankerRange() {
  const first = await client.from('anker_daily').select('day').order('day', { ascending: true }).limit(1);
  const last = await client.from('anker_daily').select('day').order('day', { ascending: false }).limit(1);
  return { from: first.data?.[0]?.day, to: last.data?.[0]?.day };
}

async function refreshStatus() {
  const el = $('status');
  if (!online()) { el.innerHTML = '<p class="note">Offline – Datenstand nicht abrufbar.</p>'; return; }
  try {
    const [counts, range] = await Promise.all([tableCounts(), ankerRange()]);
    el.innerHTML = `<div class="table-wrap"><table><tbody>${
      Object.entries(counts).map(([t, n]) => `<tr><td>${TABLE_LABELS[t]}</td><td class="num">${n}</td></tr>`).join('')
    }</tbody></table></div>
    <p class="hint">Anker-Daten: ${range.from ? `${deDate(range.from)} bis ${deDate(range.to)}` : 'noch keine'}</p>`;
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function readFile(input) {
  const f = input.files[0];
  input.value = '';            // dieselbe Datei erneut wählbar
  return f ? { name: f.name, text: await f.text() } : null;
}

/* ---------- Anker-CSV ---------- */

$('csv-file').addEventListener('change', async e => {
  const out = $('csv-result');
  const file = await readFile(e.target);
  if (!file) return;
  out.innerHTML = '<p class="hint">Lese Datei …</p>';
  try {
    const parsed = parseAnkerCsv(file.text);
    if (!parsed.rows.length) {
      out.innerHTML = `<p class="error">${esc(parsed.errors.join('\n'))}</p>`;
      return;
    }
    const existing = await fetchAll('anker_daily', { from: parsed.from, to: parsed.to });
    const diff = diffAnker(existing, parsed.rows);
    renderCsvDiff(out, file.name, parsed, diff);
  } catch (err) {
    out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
});

function renderCsvDiff(out, name, parsed, diff) {
  const changed = diff.geaendert.slice(0, 50).flatMap(g => g.changes.map(c =>
    `<tr><td>${deDate(g.day)}</td><td>${FIELD_LABELS[c.field]}</td><td class="num">${nf(c.alt, 2)}</td><td class="num">${nf(c.neu, 2)}</td></tr>`));
  out.innerHTML = `
    <p><b>${esc(name)}</b>: ${parsed.rows.length} Tage, ${deDate(parsed.from)} bis ${deDate(parsed.to)}</p>
    <ul class="msgs">
      <li>${diff.neu.length} neue Tage</li>
      <li class="${diff.geaendert.length ? 'warn' : ''}">${diff.geaendert.length} Tage mit geänderten Werten</li>
      <li>${diff.ergaenzt.length} Tage nur ergänzt (bisher leere Felder, z. B. Smart Plug)</li>
      <li>${diff.gleich} Tage unverändert</li>
    </ul>
    ${parsed.errors.length ? `<p class="error">${esc(parsed.errors.slice(0, 10).join('\n'))}${parsed.errors.length > 10 ? `\n… und ${parsed.errors.length - 10} weitere` : ''}</p>` : ''}
    ${changed.length ? `<div class="table-wrap"><table><thead><tr><th>Tag</th><th>Wert</th><th class="num">bisher</th><th class="num">neu</th></tr></thead>
      <tbody>${changed.join('')}</tbody></table></div>
      ${diff.geaendert.length > 50 ? `<p class="hint">Nur die ersten 50 geänderten Tage angezeigt.</p>` : ''}` : ''}
    <div class="row">
      <button class="primary" id="csv-apply" ${diff.write.length ? '' : 'disabled'}>${diff.write.length} Tage übernehmen</button>
      <span id="csv-progress" class="hint"></span>
    </div>`;
  $('csv-apply').addEventListener('click', async ev => {
    ev.target.disabled = true;
    try {
      await upsertRows('anker_daily', diff.write, 'user_id,day',
                       (n, total) => { $('csv-progress').textContent = `${n}/${total}`; });
      $('csv-progress').innerHTML = '<span class="ok">Übernommen.</span>';
      loadModel();
    } catch (err) {
      $('csv-progress').innerHTML = `<span class="error">${esc(err.message)}</span>`;
      ev.target.disabled = false;
    }
  });
}

/* ---------- Startdaten (seed_state.json) ---------- */

$('seed-file').addEventListener('change', async e => {
  const out = $('seed-result');
  const file = await readFile(e.target);
  if (!file) return;
  let seed;
  try { seed = JSON.parse(file.text); } catch { out.innerHTML = '<p class="error">Keine gültige JSON-Datei.</p>'; return; }
  const errors = validateSeed(seed);
  if (errors.length) { out.innerHTML = `<p class="error">${esc(errors.join('\n'))}</p>`; return; }

  const mapped = mapSeed(seed);
  const sum = seedSummary(mapped);
  let conflicts = [];
  try { conflicts = await seedConflicts(mapped); } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }

  out.innerHTML = `
    <div class="table-wrap"><table><tbody>
      ${Object.entries(sum.counts).map(([t, n]) => `<tr><td>${TABLE_LABELS[t]}</td><td class="num">${n}</td></tr>`).join('')}
      <tr><td>Anker-Zeitraum</td><td class="num">${deDate(sum.anker_from)} – ${deDate(sum.anker_to)}</td></tr>
      <tr><td>Σ Erzeugung</td><td class="num">${kwhFromMilli(sum.erzeugung_wh)}</td></tr>
      <tr><td>Σ genutzt</td><td class="num">${kwhFromMilli(sum.genutzt_wh)}</td></tr>
      <tr><td>Σ Investitionen</td><td class="num">${eurFromMilli(sum.invest_milli_eur)}</td></tr>
    </tbody></table></div>
    <p class="hint">Nicht übernommen: Ansicht und UI-Einstellungen (bleiben je Gerät), alter Einzel-Abschlag.</p>
    ${conflicts.length ? `<p class="warn">Bereits vorhanden: ${conflicts.map(t => TABLE_LABELS[t]).join(', ')}.</p>
      <label class="check"><input type="checkbox" id="seed-replace"> Vorhandene ersetzen (löscht diese Tabellen vorher)</label>` : ''}
    <p class="hint">Zähler, Zählerstände und Anker-Tage werden zusammengeführt (vorhandene Tage aktualisiert).</p>
    <div class="row">
      <button class="primary" id="seed-apply">Importieren</button>
      <span id="seed-progress" class="hint"></span>
    </div>
    <div id="seed-verify"></div>`;

  $('seed-apply').addEventListener('click', async ev => {
    const replace = $('seed-replace')?.checked || false;
    if (conflicts.length && !replace) { $('seed-progress').innerHTML = '<span class="warn">Erst „Vorhandene ersetzen“ wählen.</span>'; return; }
    ev.target.disabled = true;
    try {
      const res = await importSeed(mapped, { replace, onStep: s => { $('seed-progress').textContent = s + ' …'; } });
      $('seed-progress').textContent = '';
      $('seed-verify').innerHTML = res.diffs.length
        ? `<p class="error">Rückprüfung mit Abweichungen:\n${esc(res.diffs.join('\n'))}</p>`
        : `<p class="ok">Import vollständig. Rückprüfung: alle Mengen und Kontrollsummen stimmen
             (Erzeugung ${kwhFromMilli(res.got.erzeugung_wh)}, Investitionen ${eurFromMilli(res.got.invest_milli_eur)}).</p>`;
      loadModel();
    } catch (err) {
      $('seed-progress').innerHTML = `<span class="error">${esc(err.message)}</span>`;
      ev.target.disabled = false;
    }
  });
});
