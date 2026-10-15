// Acadex service worker: shows push notifications and opens the page they point to.
self.addEventListener('push', (event) => {
  let data = { title: 'Acadex', body: '', link: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* not JSON */
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, data: { link: data.link }, icon: '/favicon.ico', tag: data.type }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(link);
          return c.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});
