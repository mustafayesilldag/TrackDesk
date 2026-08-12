const CACHE_NAME = 'trackdesk-v2';
const APP_ASSETS = [
  './manifest.json',
  './app-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isApiRequest = requestUrl.pathname.includes('/backend/api/');
  const isAppShell =
    event.request.mode === 'navigate' ||
    requestUrl.pathname.endsWith('/') ||
    requestUrl.pathname.endsWith('/panel.html') ||
    requestUrl.pathname.endsWith('/panel.js') ||
    requestUrl.pathname.endsWith('/styless.css') ||
    requestUrl.pathname.endsWith('/service-worker.js');

  if (isApiRequest || isAppShell) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
