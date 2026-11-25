const CACHE_NAME = 'darkchat-cache-v17';
const META_CACHE = 'darkchat-meta'; // เก็บเลขข้อความที่ยังไม่ได้อ่าน (ใช้กับป้ายบนไอคอน)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './extensions.css',
  './extensions.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
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

// เปิดเร็ว (stale-while-revalidate): ส่งไฟล์จากเครื่องทันที แล้วโหลดตัวใหม่เก็บไว้เบื้องหลัง
// (ครั้งหน้าที่เปิดได้ไฟล์ใหม่) · ไม่มีในเครื่อง = โหลดจากเน็ต · ออฟไลน์ = ใช้ของในเครื่อง
// อัปเดตแอป: เปลี่ยนเลข CACHE_NAME ทุกครั้งที่อัปโหลดไฟล์ใหม่
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const nav = req.mode === 'navigate';
  if (nav && !/\/(index\.html)?$/.test(url.pathname)) return;   // หน้าอื่น (ไม่ใช่ตัวแอป) โหลดจากเน็ตตามปกติ
  const key = nav ? './index.html' : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(key, { ignoreSearch: nav });
    const net = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
      return res;
    });
    if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
    try { return await net; }
    catch (e) { return (await cache.match('./index.html')) || Response.error(); }
  })());
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

// แอปบอกว่าห้องนี้อ่านแล้ว (อาจอ่านจากเครื่องอื่น): ปิดการแจ้งเตือนของห้องนั้นที่ค้างอยู่
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type !== 'clear-chat' || !d.chatId) return;
  event.waitUntil((async () => {
    try {
      const list = await self.registration.getNotifications();
      let closed = 0;
      list.forEach((n) => { if (n.data && n.data.chatId === d.chatId) { n.close(); closed++; } });
      if (closed) {
        const left = (await self.registration.getNotifications()).length;
        const cache = await caches.open(META_CACHE);
        await cache.put('badge', new Response(String(left)));
      }
    } catch (e) { /* อุปกรณ์ไม่รองรับ */ }
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
