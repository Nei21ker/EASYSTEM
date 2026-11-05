// Service worker de EASYSTEM: hace que la app abra rápido en una red débil y siga abriendo sin conexión.
//
//   · /api/*            → NUNCA pasa por aquí (los datos son del servidor y de la caché del navegador con ETag).
//   · /_astro, /img, íconos → primero la caché (los archivos tienen el hash en el nombre: nunca cambian).
//   · Páginas (HTML)    → primero la red (siempre lo más nuevo); si tarda más de 3 s o no hay conexión, la última copia guardada.
//
// Subir VERSION borra las copias anteriores. Las páginas no llevan datos de ningún usuario (se arman en el navegador con la API).
const VERSION = 'v1';
const CACHE_ESTATICO = `easystem-estatico-${VERSION}`;
const CACHE_PAGINAS = `easystem-paginas-${VERSION}`;
const ESPERA_RED_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) {
        if (nombre !== CACHE_ESTATICO && nombre !== CACHE_PAGINAS) await caches.delete(nombre);
      }
      await self.clients.claim();
    })()
  );
});

const esEstatico = (ruta) => /^\/(_astro|img)\//.test(ruta) || /^\/(logo\.png|favicon\.ico|favicon-32\.png|apple-touch-icon\.png)$/.test(ruta);

async function primeroCache(peticion) {
  const cache = await caches.open(CACHE_ESTATICO);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) cache.put(peticion, respuesta.clone());
  return respuesta;
}

/** Se guarda solo una página completa y válida (no redirecciones, errores ni otra cosa que HTML). */
function guardarPagina(url, respuesta) {
  const tipo = respuesta.headers.get('content-type') || '';
  if (!respuesta.ok || respuesta.redirected || !tipo.includes('text/html')) return;
  const copia = respuesta.clone();
  caches.open(CACHE_PAGINAS).then((cache) => cache.put(url.origin + url.pathname, copia));
}

async function primeroRed(peticion, url) {
  const cache = await caches.open(CACHE_PAGINAS);
  const guardada = await cache.match(url.origin + url.pathname);
  const red = fetch(peticion).then((respuesta) => {
    guardarPagina(url, respuesta);
    return respuesta;
  });
  if (!guardada) return red;
  // Con copia guardada: la red tiene 3 s; si tarda o falla, se abre la copia (y la red sigue en segundo plano actualizándola)
  const limite = new Promise((resolver) => setTimeout(() => resolver(guardada), ESPERA_RED_MS));
  return Promise.race([red.catch(() => guardada), limite]);
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (esEstatico(url.pathname)) {
    evento.respondWith(primeroCache(peticion));
  } else if (peticion.mode === 'navigate') {
    evento.respondWith(primeroRed(peticion, url));
  }
});
