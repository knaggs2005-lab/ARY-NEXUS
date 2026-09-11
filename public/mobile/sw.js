/* Network-only navigation fallback. Never caches authenticated pages, APIs, messages or media. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || new URL(event.request.url).pathname !== "/mobile") return;
  event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARY · Offline</title><body style="background:#080c13;color:#e7ecf3;font:18px system-ui;padding:32px"><h1>ARY is out of reach.</h1><p>Reconnect to continue. No private pages are cached and no actions will replay automatically.</p><a style="color:#bdcaff" href="/mobile">Try again</a></body>', { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })));
});
