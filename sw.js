/* ============================================================
   NIYYAH ADMIN — SERVICE WORKER (v2)
   - App shell works offline (HTML, icons, manifest)
   - Firebase SDK files (pinned version on gstatic) are cached so the
     app can start offline; without them the whole script fails to load
   - NEVER touches Firestore, Auth or other Google API calls
   ============================================================ */

const CACHE_NAME = "niyyah-shell-v3";
const SDK_CACHE = "niyyah-sdk-v1";
const NAV_TIMEOUT_MS = 4000;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

// Only cross-origin requests are checked, so hosting on *.firebaseapp.com still works
function isApiOrAuthRequest(url) {
  if (url.origin === self.location.origin) return false;
  const host = url.hostname;
  return (
    host.endsWith("googleapis.com") ||
    host.endsWith("google.com") ||
    host.endsWith("firebaseio.com") ||
    host.endsWith("firebaseapp.com") ||
    host.includes("identitytoolkit") ||
    host.includes("securetoken") ||
    url.pathname.includes("/google.firestore")
  );
}

function isFirebaseSdk(url) {
  return url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
}

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // add one by one so a single missing file doesn't cancel the rest
      Promise.all(SHELL_ASSETS.map(a => cache.add(a).catch(err => console.warn("PWA: skip", a, err))))
    )
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k !== SDK_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromCacheOrNetwork(req, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && (res.status === 200 || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      });
    })
  );
}

function staleWhileRevalidate(req) {
  return caches.open(CACHE_NAME).then(cache =>
    cache.match(req).then(cached => {
      const refresh = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
}

function networkFirstNavigation(req) {
  return new Promise(resolve => {
    let settled = false;
    const useCache = () =>
      caches.match("./index.html").then(c => c || caches.match("./")).then(c => {
        if (c && !settled) { settled = true; resolve(c); }
        return c;
      });
    // On a slow or flaky connection, fall back to the cached page after a few seconds
    const timer = setTimeout(useCache, NAV_TIMEOUT_MS);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put("./index.html", copy));
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      useCache().then(c => { if (!c && !settled) { settled = true; resolve(Response.error()); } });
    });
  });
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  if (isApiOrAuthRequest(url)) return;

  if (isFirebaseSdk(url)) {                       // pinned versions never change
    event.respondWith(fromCacheOrNetwork(req, SDK_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {                  // the page itself
    event.respondWith(networkFirstNavigation(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));   // icons, manifest, etc.
});
