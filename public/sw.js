/// <reference lib="webworker" />

/**
 * Service Worker for ChatLDS Chat PWA.
 *
 * Strategy:
 *  - Next runtime chunks: network-only to avoid stale module factories
 *  - API routes: network-only (real-time chat data)
 *  - Navigation fallback: serve cached /chat when offline
 *  - Stable static assets: stale-while-revalidate
 */

const CACHE_NAME = "lds-rag-v2";

/** Paths to pre-cache on install. Avoid authenticated pages and Next chunks. */
const PRECACHE_URLS = ["/manifest.webmanifest"];

/* ------------------------------------------------------------------ */
/*  INSTALL — pre-cache the app shell                                 */
/* ------------------------------------------------------------------ */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* ------------------------------------------------------------------ */
/*  ACTIVATE — clean up old caches                                    */
/* ------------------------------------------------------------------ */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ------------------------------------------------------------------ */
/*  FETCH — route requests to the right strategy                      */
/* ------------------------------------------------------------------ */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST for chat API, etc.)
  if (request.method !== "GET") return;

  // Skip API routes, Clerk auth, analytics, and Next runtime chunks.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/v1/") ||
    url.hostname.includes("clerk") ||
    url.hostname.includes("vercel") ||
    url.hostname.includes("analytics")
  ) {
    return;
  }

  // For navigation requests → network-first with offline fallback to /chat
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match("/chat").then((r) => r || caches.match(request)))
    );
    return;
  }

  // For stable static assets (fonts, images, icons) → stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          // Only cache successful same-origin responses
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
