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
const VERSION = '2026.06.07-160046-1a72319';

const CACHE = `breathe-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './orb3d.js',                       // 3D liquid module (lazy-imported)
  './vendor/three.module.min.js',     // bundled Three.js — works fully offline
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

// Shell = things that change every release → network-first. The vendor library
// is static/large, so it's treated as cache-first (not re-fetched each load).
function isShell(url) {
  if (/\/vendor\//.test(url.pathname)) return false;
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

/* ---- Activate: delete old caches, claim clients, and heal stale pages ---- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldBreatheCaches = keys.filter((k) => k.startsWith('breathe-') && k !== CACHE);
    // 'breathe-v1' was the original cache-first build whose page can't self-update.
    const migratingFromLegacy = keys.includes('breathe-v1');

    await Promise.all(oldBreatheCaches.map((k) => caches.delete(k)));
    await self.clients.claim();

    // First install (no old cache): nothing stale to refresh — don't reload.
    if (oldBreatheCaches.length === 0) return;

    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) {
      if (migratingFromLegacy && typeof client.navigate === 'function') {
        // The open page is running the OLD app.js (can't react to us), so force a
        // one-time reload. After this it's on the network-first build and self-heals.
        client.navigate(client.url).catch(() => {});
      } else {
        // Modern page: let it decide when to reload (it waits for a calm moment,
        // never mid-session). See the SW_UPDATED handler in app.js.
        client.postMessage({ type: 'SW_UPDATED' });
      }
    }
  })());
});

/* ---- Fetch: network-first for the shell, cache-first for static assets,
       and proper Range handling for audio so playback never breaks and the
       track becomes available offline after first play. ---- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignore cross-origin

  // Audio/byte-range requests (HTMLAudio, esp. iOS) — serve a 206 slice.
  if (req.headers.has('range')) { event.respondWith(rangeResponse(req)); return; }

  if (req.mode === 'navigate' || isShell(url)) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

// Keep the active track's bytes in memory (1 at a time) to avoid re-reading the
// whole file from Cache on every range request.
const _mediaMem = new Map();
async function getFullMedia(url) {
  if (_mediaMem.has(url)) return _mediaMem.get(url);
  const cache = await caches.open(CACHE);
  let res = await cache.match(url, { ignoreVary: true });
  if (!res) {
    const net = await fetch(url); // full GET (no range) → 200
    if (!net || !net.ok || net.status !== 200) return null;
    cache.put(url, net.clone());
    res = net;
  }
  const entry = { buf: await res.arrayBuffer(), type: res.headers.get('Content-Type') || 'audio/mpeg' };
  _mediaMem.clear(); // hold only the current track
  _mediaMem.set(url, entry);
  return entry;
}
async function rangeResponse(req) {
  try {
    const media = await getFullMedia(req.url);
    if (!media) return fetch(req); // not cacheable → straight passthrough
    const total = media.buf.byteLength;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
    let start = m ? parseInt(m[1], 10) : 0;
    let end = (m && m[2]) ? parseInt(m[2], 10) : total - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= total) end = total - 1;
    if (start > end) start = 0;
    const chunk = media.buf.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        'Content-Type': media.type,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunk.byteLength),
      },
    });
  } catch {
    try { return await fetch(req); } catch { return new Response('', { status: 504, statusText: 'Offline' }); }
  }
}

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
