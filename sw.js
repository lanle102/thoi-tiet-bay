const CACHE = 'ttb-v1';
const SHELL = ['./', 'index.html', 'styles.css?v=1', 'app.js?v=1', 'airports.json', 'manifest.webmanifest',
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
    // Dữ liệu thời tiết: ưu tiên mạng, mất mạng thì dùng bản đã lưu
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  if (url.origin !== location.origin) return;
  // Vỏ ứng dụng: dùng cache, cập nhật nền
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const c2 = r.clone(); caches.open(CACHE).then(c => c.put(e.request, c2)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
