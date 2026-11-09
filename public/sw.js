self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || 'Status pesanan Anda telah diperbarui.' };
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'KRIS DIAMOND SHOP', {
    body: payload.body || 'Status pesanan Anda telah diperbarui.',
    data: { url: payload.url || '/' },
    tag: payload.url || 'kris-order-update',
    renotify: true
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || '/', self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : self.location.origin;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
