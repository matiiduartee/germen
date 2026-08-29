/**
 * Service worker: es lo que hace que la app abra sin internet.
 *
 * Dos estrategias distintas, a propósito:
 *  - El armazón (HTML, CSS, JS, datos) va primero a la red y cae al caché.
 *    Así una tablet conectada toma los cambios enseguida, y una sin conexión
 *    igual abre.
 *  - Las fotos de wixstatic van primero al caché. Una foto no cambia nunca:
 *    volver a pedirla es gastar datos al pedo.
 */

const VERSION = 'germen-v1';
const ARMAZON = `${VERSION}-armazon`;
const FOTOS = `${VERSION}-fotos`;

const ESENCIALES = [
  './',
  'index.html',
  'css/estilo.css',
  'js/app.mjs',
  'js/reglas.mjs',
  'js/almacen.mjs',
  'js/pedidos.mjs',
  'datos/catalogo.json',
  'datos/recorrido.json',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(ARMAZON)
      .then((c) => c.addAll(ESENCIALES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Los pedidos al proxy nunca se cachean.
  if (url.pathname.includes('/_functions/')) return;

  if (url.hostname.endsWith('wixstatic.com')) {
    e.respondWith(cachePrimero(request, FOTOS));
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(redPrimero(request, ARMAZON));
  }
});

async function cachePrimero(request, nombre) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(request);
  if (guardada) return guardada;

  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    // Sin red y sin la foto guardada: no hay nada que devolver.
    return new Response('', { status: 504, statusText: 'Sin conexión' });
  }
}

async function redPrimero(request, nombre) {
  const cache = await caches.open(nombre);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const guardada = await cache.match(request);
    if (guardada) return guardada;
    // Navegación sin conexión y sin caché: devolvemos el index, que sí está.
    if (request.mode === 'navigate') {
      const index = await cache.match('index.html');
      if (index) return index;
    }
    throw e;
  }
}
