// sw.js v10 — HTML: 네트워크 우선(최신 유지), 같은 출처 정적: 캐시 퍼스트
const CACHE = 'emoji-v10';
const PRECACHE = []; // 필요시 같은 출처 정적 경로를 넣어 선캐시

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
  const accepts = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accepts.includes('text/html');

  // 1) HTML은 네트워크 우선
  if (isHTML) {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // 2) 같은 출처 정적은 캐시 퍼스트 (sprites/data 포함)
  if (sameOrigin && req.method === 'GET') {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
  // 3) 교차 출처(구글시트/CDN)는 캐시 제어하지 않음
});
