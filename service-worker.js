var CACHE_NAME = 'charlie-journal-v5';
var SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './sync.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var isSameOrigin = event.request.url.indexOf(self.location.origin) === 0;
  if (!isSameOrigin) return; // let CDN requests (fonts, Supabase, XLSX) hit the network normally

  // network-first for our own files, so a fresh deploy is seen immediately
  // when there's a connection; cache is only a fallback for offline use.
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      })
      .catch(function () { return caches.match(event.request); })
  );
});
