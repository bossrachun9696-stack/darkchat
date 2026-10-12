const CACHE_NAME = 'darkchat-cache-v3';
const META_CACHE = 'darkchat-meta'; // เก็บเลขข้อความที่ยังไม่ได้อ่าน (ใช้กับป้ายบนไอคอน)
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
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== META_CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// network-first: ได้ไฟล์ล่าสุดเสมอ ถ้าออฟไลน์ค่อยใช้แคช
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

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

// ---------- Web Push ----------
async function bumpBadge() {
  try {
    const cache = await caches.open(META_CACHE);
    const hit = await cache.match('badge');
    const n = (hit ? parseInt(await hit.text(), 10) || 0 : 0) + 1;
    await cache.put('badge', new Response(String(n)));
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
  } catch (e) { /* อุปกรณ์ไม่รองรับป้าย */ }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appVisible = wins.some((c) => c.visibilityState === 'visible');
    const isIOS = /iPhone|iPad|iPod/i.test(self.navigator.userAgent);
    // แอปเปิดอยู่ตรงหน้าแล้ว: ไม่ต้องเด้งซ้ำ (iOS ต้องแสดงทุกครั้ง ไม่งั้นระบบอาจยกเลิกสิทธิ์)
    if (appVisible && !isIOS) return;

    await self.registration.showNotification(data.title || 'DarkChat', {
      body: data.body || 'มีข้อความใหม่',
      tag: data.tag || 'darkchat',
      renotify: true,
      data: { chatId: data.chatId || null }
    });
    await bumpBadge();
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data && event.notification.data.chatId;

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const win = wins[0];
      await win.focus();
      if (chatId) win.postMessage({ type: 'open-chat', chatId });
      return;
    }
    const target = new URL(chatId ? './?chat=' + encodeURIComponent(chatId) : './', self.registration.scope);
    await self.clients.openWindow(target.href);
  })());
});
