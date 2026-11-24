const cacheName = 'wavebox-iphone-shell-v1';
const urls = ['./', './setup.js', './crypto.js', './manifest.webmanifest', './icon-192.png', './icon-512.png']
  .map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(urls);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

async function fromNetworkOrCache(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(url, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(url, { cacheName });
    return cached || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  url.search = '';
  if (event.request.method !== 'GET' || !urls.includes(url.href)) return;
  event.respondWith(fromNetworkOrCache(event.request, url.href));
});
