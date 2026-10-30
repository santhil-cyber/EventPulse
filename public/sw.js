// Minimal service worker for staff incident alerts. Android Chrome only shows
// notifications through a service worker registration, and tapping one should
// bring the staff console back to the front.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => "focus" in client);
    if (existing) return existing.focus();
    return self.clients.openWindow("/");
  })());
});
