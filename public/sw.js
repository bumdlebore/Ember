const CACHE = "ember-shell-v1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // network only

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(event.request);
        // A redirect means the Access session lapsed; do not cache the login page.
        // Access can also serve a login/challenge page as a same-URL 200 with no
        // redirect (silent re-auth interstitial, device-posture check), which would
        // slip past the checks above. X-Ember-Shell is set only by our own Worker on
        // the real app HTML, so it is positive proof this response isn't an Access
        // interstitial — don't drop it even if the checks above look sufficient.
        if (res.ok && !res.redirected && res.type === "basic" && res.headers.get("X-Ember-Shell") === "1") {
          cache.put(event.request, res.clone());
        }
        return res;
      } catch {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const shell = await cache.match(SHELL);
        if (shell) return shell;
        throw new Error("offline and nothing cached");
      }
    })()
  );
});
