/* Breathe — service worker
   ----------------------------------------------------------------------------
   Update strategy (so deploys reliably reach phones, not just laptops):

   • VERSION is stamped uniquely on every deploy by tools/deploy.sh, so the
     bytes of this file ALWAYS change → the browser detects a new service
     worker → install/activate re-run → the old cache is deleted.
   • App shell (HTML / CSS / JS / JSON) and navigations use NETWORK-FIRST, so
     when online you always get the newest files; the cache is only a fallback
     for offline. (The old cache-first strategy is what served stale builds.)
   • Static binary assets (icons) use cache-first — they change rarely and a
     version bump re-precaches them anyway.
   • skipWaiting() + clients.claim() make the new worker take control
     immediately instead of waiting for every tab to close.
   ---------------------------------------------------------------------------- */

// ⚠️  Do not hand-edit unless you know why — tools/deploy.sh rewrites this line
//     with a unique timestamp+commit on every deploy so caches always bust.
const VERSION = '2026.06.06-170158-25f1bd7';

const CACHE = `breathe-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

// Shell = things that change every release. Served network-first.
function isShell(url) {
  return url.pathname.endsWith('/') || /\.(html|css|js|json)$/i.test(url.pathname);
}

/* ---- Install: precache fresh copies, then take over ASAP ---- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // {cache:'reload'} bypasses the HTTP cache so we precache truly fresh files.
    // allSettled so one missing asset can't abort the whole install.
    await Promise.allSettled(
      ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

/* ---- Activate: delete every old Breathe cache, then claim clients ---- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('breathe-') && k !== CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---- Fetch: network-first for the shell, cache-first for static assets ---- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignore cross-origin

  if (req.mode === 'navigate' || isShell(url)) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // Always hit the network for the latest; don't let the HTTP cache shortcut us.
    const fresh = await fetch(req, { cache: 'no-store' });
    if (fresh && fresh.ok) cache.put(req, fresh.clone()); // refresh offline copy
    return fresh;
  } catch {
    // Offline (or network failed): fall back to cache.
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html'))
          || (await cache.match('./'))
          || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return cached || new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* ---- Allow the page to trigger an immediate activation if it wants ---- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
