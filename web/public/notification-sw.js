self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route;
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[\\\u0000-\u001f]/.test(route)) return;
  event.waitUntil((async () => {
    const target = new URL(self.registration.scope);
    target.hash = route;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindows = windows.filter(client => {
      const url = new URL(client.url);
      return url.origin === target.origin && url.pathname === target.pathname;
    }).sort((a, b) => Number(b.focused) - Number(a.focused));
    for (const client of appWindows) {
      try {
        // Navigation survives renderer startup and does not need a message listener.
        const navigated = await client.navigate(target.href);
        if (!navigated) continue;
        await navigated.focus();
        return;
      } catch {
        // A window can close between enumeration and notification activation.
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
