// sw.js — 같은 출처 정적만 캐시. HTML(문서)는 네트워크 우선으로 받아 새 코드 즉시 반영.
const CACHE = 'emoji-v7';
const PRECACHE = [ /* 필요시 같은 출처 정적 자산 추가 (index.html은 캐시 X) */ ];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  // 1) HTML 문서: 네트워크 우선 (오프라인시만 캐시 폴백)
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    e.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2) 그 외 같은 출처 정적: Cache-First
  if (sameOrigin && req.method === 'GET') {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
  // 3) 교차 출처(구글시트/광고/CDN)는 SW에서 건드리지 않음
});
