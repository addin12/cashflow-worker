// Service worker: makes the site installable and shows the app's notifications.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cashflow', {
    body: d.body || '', icon: '/icon-192.png', badge: '/badge-96.png', tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: typeof d.url === 'string' && /^\/(?!\/)/.test(d.url) ? d.url : '/' }, // only this site's own paths
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(new URL(e.notification.data.url, self.location.origin).href));
});
