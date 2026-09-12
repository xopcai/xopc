self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route;
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows[0];
    if (client) {
      client.postMessage({ type: 'xopc:notification-click', route });
      await client.focus();
      return;
    }
    await self.clients.openWindow(`/#${route}`);
  })());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let message;
    try { message = event.data?.json(); } catch { return; }
    if (!message || typeof message.id !== 'string' || typeof message.title !== 'string'
      || typeof message.route !== 'string' || !/^\/proactive\?(item|digest|probe)=/.test(message.route)) return;
    await self.registration.showNotification(message.title.slice(0, 120), {
      body: typeof message.body === 'string' ? message.body.slice(0, 180) : '',
      tag: message.id,
      icon: '/pwa-192x192.png',
      data: { route: message.route },
    });
  })());
});
