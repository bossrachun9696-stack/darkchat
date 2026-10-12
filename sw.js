const CACHE_NAME = 'darkchat-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch((err) => console.log('SW precache error:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ไม่แตะ request ที่ไม่ใช่ GET หรือข้ามโดเมน (เช่น Supabase API, CDN)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // network-first: ได้ไฟล์ล่าสุดเสมอ ถ้าออฟไลน์ค่อยใช้แคช (แก้ปัญหาแก้โค้ดแล้วไม่อัปเดต)
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
