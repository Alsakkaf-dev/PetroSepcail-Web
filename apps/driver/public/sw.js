/* PetroSpecial driver — service worker.
 *
 * A driver spends a shift in basements, lift shafts and industrial estates.
 * This worker exists so that losing signal costs them the *data* they have
 * not fetched yet, and nothing else: the app itself, its fonts, its icons and
 * the map tiles they have already seen keep working.
 *
 * Three caching rules, and one thing it deliberately does not do.
 *
 * 1. Build output (`/_next/static/...`) is content-hashed and immutable, so
 *    it is cache-first, forever. This is what makes a cold start offline
 *    possible at all.
 * 2. Map tiles are cross-origin images. Cache-first with a cap, because a
 *    tile for a given z/x/y never changes meaningfully within a shift and
 *    re-fetching one over a bad connection is the slowest thing on the
 *    screen. Matched by destination rather than by host: the tile server is
 *    an environment variable and this file must not know its name.
 * 3. Page navigations are network-first with a cached fallback, so a driver
 *    who has opened the manifest once can open it again with no signal. The
 *    HTML carries no data — every driver screen fetches its own — so there
 *    is nothing in a cached page to leak.
 *
 * What it does NOT do: queue writes. A POD, a transition or a ping made
 * offline is still lost, and pretending otherwise with a Background Sync
 * registration that silently drops payloads would be worse than the current
 * honest failure. A durable queue needs IndexedDB plus idempotent replay
 * against the clientActionId every one of those endpoints already accepts —
 * real work, and not something to ship unverified.
 */

const VERSION = "v1";
const STATIC_CACHE = `ps-driver-static-${VERSION}`;
const TILE_CACHE = `ps-driver-tiles-${VERSION}`;
const PAGE_CACHE = `ps-driver-pages-${VERSION}`;

/** Roughly a city at one zoom level. Beyond this the oldest go. */
const TILE_LIMIT = 300;

self.addEventListener("install", (event) => {
  // Nothing is pre-cached: Next's chunk names change every build, so a fixed
  // manifest would be stale the moment it shipped. The caches fill on first
  // use instead, which for a driver is the sign-in they do indoors anyway.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, TILE_CACHE, PAGE_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

/** Keep a cache from growing without bound. Oldest-first, which for tiles is
 * a good enough proxy for least-useful. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Opaque responses (a cross-origin tile with no CORS headers) are still
  // worth storing — they render fine, they just cannot be inspected.
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    if (limit) void trim(cacheName, limit);
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GETs. A POD, a transition and a shift close must reach the server or
  // fail loudly; there is no version of caching a write that is safe here.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // The API is never cached. A manifest from twenty minutes ago is worse than
  // no manifest: it sends a driver to a stop that has been reassigned.
  if (url.pathname.startsWith("/api/")) return;
  if (!sameOrigin && request.destination !== "image" && request.destination !== "font") return;

  if (sameOrigin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (sameOrigin && (request.destination === "font" || request.destination === "image")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Cross-origin images are map tiles, by elimination — nothing else on a
  // driver screen loads a picture from another host.
  if (!sameOrigin && request.destination === "image") {
    event.respondWith(cacheFirst(request, TILE_CACHE, TILE_LIMIT));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE));
  }
});
