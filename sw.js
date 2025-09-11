// sw.js — 같은 출처 정적만 캐시 (CSV/Ads 등 교차출처는 무시)
const CACHE = 'emoji-v3';
const ASSETS = ['/', '/index.html']; // 필요시 같은 출처 파일 추가

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin || e.request.method !== 'GET') return; // 교차출처/비GET은 무시
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
    ).catch(() => caches.match('/index.html'))
  );
});
