// Only public application files belong in CacheStorage. Private data stays in
// the account-scoped application store and must always reach the API server.
const CACHE = 'vendora-public-v2';
const BASE = new URL('./', self.location.href);
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']
  .map(path => new URL(path, BASE).href);

function publicRequest(request) {
  return new Request(request, { credentials: 'omit', cache: 'no-store' });
}

function safeResponse(request, response) {
  const control = response.headers.get('cache-control') || '';
  const vary = response.headers.get('vary') || '';
  return request.credentials === 'omit' && response.ok && !response.redirected &&
    response.type !== 'opaque' && !/\b(no-store|private)\b/i.test(control) &&
    !response.headers.has('set-cookie') && !/\b(cookie|authorization)\b/i.test(vary);
}

async function save(cache, request, response) {
  if (safeResponse(request, response)) {
    try { await cache.put(request, response.clone()); } catch { /* Storage may be unavailable/full. */ }
  }
  return response;
}

async function purge(keepCurrent = false) {
  await Promise.all((await caches.keys())
    .filter(name => !keepCurrent || name !== CACHE)
    .map(name => caches.delete(name)));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await self.skipWaiting();
    // Failed/offline precaching must not prevent the privacy upgrade activating.
    await Promise.allSettled(SHELL.map(async url => {
      const request = publicRequest(new Request(url));
      const response = await fetch(request);
      await save(await caches.open(CACHE), request, response);
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await purge(true); // Removes every prior cache, including leaked API entries.
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_CACHES') event.waitUntil(purge());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin ||
      /(^|\/)(api|wema|whatsapp)(\/|$)/i.test(url.pathname) ||
      request.headers.has('authorization') || request.headers.has('cookie')) return;

  const isShell = !url.search && SHELL.includes(url.href);
  const assetName = url.pathname.startsWith(BASE.pathname + 'assets/')
    ? url.pathname.slice((BASE.pathname + 'assets/').length) : '';
  const isHashedAsset = !url.search && /^[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(assetName);
  if (!isShell && !isHashedAsset) return;

  const clean = publicRequest(request);
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(clean);
        return await save(cache, publicRequest(new Request(new URL('./index.html', BASE))), response);
      } catch (error) {
        const cached = await cache.match(new URL('./index.html', BASE).href);
        if (cached) return cached;
        throw error;
      }
    })());
  } else {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(clean);
      if (cached) return cached;
      return save(cache, clean, await fetch(clean));
    })());
  }
});
