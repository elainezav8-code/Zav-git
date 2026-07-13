/* Frentes: service worker. Guarda a casca do app para abrir instantaneo. */

var CACHE = 'frentes-v1';
var CASCA = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(CASCA); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (chaves) {
      return Promise.all(chaves.map(function (chave) {
        if (chave !== CACHE) return caches.delete(chave);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (evento) {
  var url = new URL(evento.request.url);
  // So a casca local entra no cache. Chamadas ao backend vao sempre a rede.
  if (url.origin !== location.origin || evento.request.method !== 'GET') return;
  evento.respondWith(
    caches.match(evento.request).then(function (guardado) {
      var daRede = fetch(evento.request).then(function (resposta) {
        if (resposta.ok) {
          var copia = resposta.clone();
          caches.open(CACHE).then(function (cache) { cache.put(evento.request, copia); });
        }
        return resposta;
      }).catch(function () { return guardado; });
      return guardado || daRede;
    })
  );
});
