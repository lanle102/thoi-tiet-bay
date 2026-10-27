const CACHE = 'ttb-v3';
const SHELL = ['./', 'index.html', 'styles.css?v=3', 'app.js?v=3', 'extras.js?v=3', 'map.js?v=3', 'names.js?v=3', 'airports.json', 'manifest.webmanifest',
  'vendor/tz.js', 'vendor/qrcode.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.includes('/api/')) {
    if (url.pathname.includes('/api/sync') || url.pathname.includes('/api/push')) return;
    // Dữ liệu thời tiết: ưu tiên mạng, mất mạng thì dùng bản đã lưu
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  if (url.origin !== location.origin) return;
  // Vỏ ứng dụng + dữ liệu tĩnh: dùng cache, cập nhật nền
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const c2 = r.clone(); caches.open(CACHE).then(c => c.put(e.request, c2)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Thời Tiết Bay', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Thời Tiết Bay', { body: d.body || '', tag: 'ttb-push', renotify: true, data: { id: d.id }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { c.focus(); if (id) c.postMessage({ open: id }); return; }
    return self.clients.openWindow('./' + (id ? '#' + id : ''));
  }));
});
