// Losbuch Service Worker: Offline-Shell, Push-Anzeige
const VERSION = 'losbuch-v2.0.0';
const SHELL = ['./', 'index.html', 'app.js', 'rules.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  if (url.origin !== location.origin) { // Fonts: cache-first
    e.respondWith(caches.open(VERSION + '-ext').then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => new Response('', { status: 504 }))));
    return;
  }
  // Shell + Vendor: stale-while-revalidate
  e.respondWith(caches.open(VERSION).then(async c => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return cached || (await net) || c.match('index.html');
  }));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { title: 'Losbuch', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Losbuch', { body: d.body || '', icon: 'icon-180.png', badge: 'icon-180.png', data: { url: d.url || './' }, tag: d.tag || 'losbuch', renotify: true }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.postMessage('sync'); return c.focus(); } return self.clients.openWindow(target); }));
});
