// PeaBe Coaching Hub — service worker
//
// Strategy:
//   - Static (HTML/CSS/JS/icons/manifest): stale-while-revalidate
//     so installed PWAs feel instant and silently update in the background.
//     A new deploy triggers a clients-side reload prompt (handled in index.html).
//   - API GETs (/api/get-clients, /api/coach-settings, /api/cohorts,
//     /api/activity-log): network-first with a fall-back to the cached
//     copy. So when offline the portal still renders read-only with the
//     last-known data instead of a blank screen.
//   - API POSTs / DELETEs / non-GETs: network-only. If the network's
//     unavailable the existing in-app save queue (see flushSaveQueue in
//     index.html) catches it. We don't try to be clever inside the worker.
//   - HTML navigation requests when offline: serve the cached index.html
//     so the PWA still launches.
//
// The version stamp here doubles as cache-busting — bumping it on each
// deploy guarantees a fresh install. The harness's deploy skill bumps the
// vNNNN tag in index.html; we read that tag at install time so this file
// doesn't need a separate version literal.

const VERSION    = 'peabe-v3';                 // bump if SW logic changes
const STATIC     = 'peabe-static-' + VERSION;
const API        = 'peabe-api-'    + VERSION;
// Precache the full critical-path bundle so a returning user (especially
// installed-PWA) opens the app instantly even before any network request.
// Includes: shell, CSS, every favicon size, the SW itself, and the
// manifest. Skips fonts (they're cross-origin and Google Fonts handles
// caching) — the SW will pick them up via stale-while-revalidate when
// the user actually loads them.
const PRECACHE   = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/peabe.svg',
  '/icons/peabe-maskable.svg',
  '/icons/peabe-180.png',
  '/icons/peabe-192.png',
  '/icons/peabe-256.png',
  '/icons/peabe-512.png',
];

// ── Install: precache the shell ──
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    // Use addAll-with-cache-bust so we always grab a fresh copy of each shell
    // resource at install time (otherwise the SW could cache stale assets).
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: 'reload' });
        if (resp.ok) await cache.put(url, resp);
      } catch { /* offline at install — fine, will fall back to network later */ }
    }));
    // Activate immediately on first install
    self.skipWaiting();
  })());
});

// ── Activate: drop old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== STATIC && k !== API) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

// ── Fetch: route by request type ──
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE → straight to network

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // third-party (Anthropic, Zoom, etc.)

  // API GETs — network first, fall back to cache, store fresh on success.
  // Only cache the four "shared state" endpoints; per-client data is too
  // chatty and would balloon the cache.
  if (url.pathname.startsWith('/api/')) {
    const cacheable = (
      url.pathname === '/api/get-clients' ||
      url.pathname === '/api/coach-settings' ||
      url.pathname === '/api/cohorts' ||
      url.pathname === '/api/activity-log' ||
      url.pathname === '/api/zoom-list-templates'
    );
    if (!cacheable) return; // pass through, no caching
    event.respondWith((async () => {
      try {
        const resp = await fetch(req);
        if (resp.ok) {
          const cache = await caches.open(API);
          cache.put(req, resp.clone());
        }
        return resp;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Offline + nothing cached — return a minimal empty payload so
        // the app doesn't hang waiting on an XHR that'll never resolve.
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-PeaBe-Offline': '1' },
        });
      }
    })());
    return;
  }

  // Navigation (HTML) — network first, fall back to cached index.html so
  // the PWA still launches when offline. Critical for the "feels like a
  // real app" experience.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const resp = await fetch(req);
        // Cache fresh HTML on success so subsequent offline launches use
        // the latest copy
        const cache = await caches.open(STATIC);
        cache.put('/index.html', resp.clone());
        return resp;
      } catch {
        const cached = await caches.match('/index.html');
        if (cached) return cached;
        return new Response('Offline. Reconnect and try again.', { status: 503 });
      }
    })());
    return;
  }

  // Static assets — stale-while-revalidate. Serve from cache instantly,
  // refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(STATIC);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then((resp) => {
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    }).catch(() => cached); // offline → return whatever's cached

    return cached || networkPromise;
  })());
});

// ── Message channel: let the page tell us to skip waiting on a new SW ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
