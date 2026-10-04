// Service Worker: App offline verfügbar machen. Supabase-Anfragen laufen nie über den Cache
// (Daten hält die App selbst im localStorage vor, siehe js/queue.js).
// VERSION setzt scripts/set-version.mjs; neue Version = neuer Cache, alter wird beim Aktivieren gelöscht.
const VERSION = '0.16.0';
const CACHE = 'energiebilanz-' + VERSION;
const V = '?v=' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './css/style.css' + V, './vendor/supabase.js' + V, './vendor/chart.umd.js' + V, './config.js' + V,
  './js/app.js' + V, './js/db.js' + V, './js/import.js' + V, './js/calc.js' + V, './js/views.js' + V, './js/queue.js' + V, './js/weather.js' + V, './js/hp.js' + V];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('energiebilanz-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // Supabase & Co. direkt ins Netz
  if (req.mode === 'navigate') {
    // Seite: immer zuerst frisch aus dem Netz (Updates), offline aus dem Cache
    event.respondWith(fetch(req, { cache: 'no-store' })
      .then(res => { if (res.ok) caches.open(CACHE).then(c => c.put('./index.html', res.clone())); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Dateien mit Versionskennung ändern sich nie: zuerst Cache, sonst Netz (und merken)
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
