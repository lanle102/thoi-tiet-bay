const CACHE = 'ttb-v13';
const SHELL = ['./', 'index.html', 'styles.css?v=9', 'calc.js?v=7', 'app.js?v=8', 'extras.js?v=7', 'map.js?v=8', 'names.js?v=7', 'wx2.js?v=8', 'track.js?v=10', 'tools.js?v=7', 'laws.js?v=7', 'airports.json', 'manifest.webmanifest', 'laws/index.json',
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
  // Tile bản đồ: network-first, cache ngắn có giới hạn — không để bản lỗi/cũ trong SW làm nền xám.
  if (/basemaps\.cartocdn\.com$|arcgisonline\.com$|openstreetmap\.org$|earthdata\.nasa\.gov$|rainviewer\.com$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open('ttb-tiles');
      try {
        const r = await fetch(e.request);
        if (r.ok) {
          await cache.put(e.request, r.clone());
          const keys = await cache.keys();
          if (keys.length > 80) await Promise.all(keys.slice(0, keys.length - 80).map(k => cache.delete(k)));
        }
        return r;
      } catch (err) {
        return (await cache.match(e.request)) || Response.error();
      }
    })());
    return;
  }
  if (url.pathname.includes('/api/') || url.pathname.includes('/thoi-tiet-bay/notams/')) {
    if (/\/api\/(sync|push|adsb)/.test(url.pathname)) return; // không lưu tạm dữ liệu thời gian thực
    // Dữ liệu thời tiết: ưu tiên mạng, mất mạng thì dùng bản đã lưu
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(async () => {
      const hit = await caches.match(e.request); if (!hit) return Response.error();
      const h = new Headers(hit.headers); h.set('x-ttb-offline', '1');
      return new Response(await hit.text(), { status: 200, headers: h });
    }));
    return;
  }
  // Kho luật/NOTAM tĩnh trên GitHub Pages (khi app chạy ở Vercel): dùng bản lưu, cập nhật nền
  if (url.origin !== location.origin && !/^https:\/\/lanle102\.github\.io\/thoi-tiet-bay\/(laws|notams)\//.test(url.href)) return;
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
