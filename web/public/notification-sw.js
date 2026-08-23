self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route;
  if (typeof route !== 'string' || !route.startsWith('/chat/')) return;
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
