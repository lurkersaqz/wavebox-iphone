const cacheName = 'wavebox-iphone-shell-v2';
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
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('wavebox-iphone-shell-') && key !== cacheName)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
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
  if (event.request.method !== 'GET' || event.request.headers.has('range')) return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  url.search = '';
  if (!urls.includes(url.href)) return;
  event.respondWith(fromNetworkOrCache(event.request, url.href));
});
