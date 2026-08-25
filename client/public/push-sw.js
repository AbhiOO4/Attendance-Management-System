/* Custom service-worker push handlers.
 *
 * vite-plugin-pwa runs in generateSW mode, so the Workbox service worker is
 * auto-generated and has no place for hand-written logic. We inject this file
 * via `workbox.importScripts: ['push-sw.js']` (see vite.config.ts): the generated
 * sw.js does `importScripts('push-sw.js')`, so these listeners run in the SW
 * scope alongside Workbox's precaching.
 *
 * The server (cron/checkoutReminder.js) sends a JSON payload:
 *   { title, body, url, tag }
 * `url` is an in-app path (e.g. "/attendance/<siteId>"); clicking focuses an
 * open tab (navigating it there) or opens a new one.
 */
/* global self, clients */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Non-JSON payload — fall back to plain text as the body.
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'NGDP AMS';
  const options = {
    body: payload.body || '',
    icon: '/appLogo.png',
    badge: '/ngdp logo.png',
    tag: payload.tag || 'ngdp-notification',
    renotify: true,
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Prefer a tab already on the target path.
      for (const client of windowClients) {
        try {
          const clientPath = new URL(client.url).pathname;
          const targetPath = new URL(targetUrl, client.url).pathname;
          if (clientPath === targetPath) return client.focus();
        } catch (e) {
          /* ignore malformed client URL */
        }
      }

      // Otherwise focus any open tab and navigate it to the target.
      for (const client of windowClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(targetUrl);
            } catch (e) {
              /* cross-context navigation may be blocked; leave focused */
            }
          }
          return;
        }
      }

      // No open tab — open a new window.
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })()
  );
});
