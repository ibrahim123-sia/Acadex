// Acadex service worker: makes the app installable and usable offline, and shows push
// notifications.
//   - the app shell (the page and its hashed assets) is cached, so Acadex opens offline
//   - API reads of the to-do list / dashboards and course lists are network-first with the
//     last good copy as a fallback
//   - content a person saved for offline (pages, files) is served from its own cache
// Caches hold signed-in data, so the app clears them when someone signs out.
const VERSION = 'v1';
const SHELL = `acadex-shell-${VERSION}`;
const ASSETS = `acadex-assets-${VERSION}`;
const API = 'acadex-api';
const OFFLINE = 'acadex-offline';
const KEEP = [SHELL, ASSETS, API, OFFLINE];

// API reads kept for offline use (the last good answer)
const API_FALLBACK = [/\/api\/me\/(student|teacher)\/overview/, /\/api\/me\/dashboard/, /\/api\/courses(\?|$)/, /\/api\/notifications(\?|$)/, /\/api\/timetable/, /\/api\/conversations(\?|$)/, /\/api\/auth\/me$/];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName, { store = true } = {}) {
  try {
    const res = await fetch(request);
    if (store && res.ok) (await caches.open(cacheName)).put(request, res.clone());
    return res;
  } catch (err) {
    const found = (await (await caches.open(cacheName)).match(request, { ignoreVary: true })) || (await (await caches.open(OFFLINE)).match(request, { ignoreVary: true }));
    if (found) return found;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // pages: the network, else the cached shell (the app routes itself)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) caches.open(SHELL).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.open(SHELL).then((c) => c.match('/')))
    );
    return;
  }
  // hashed build assets never change: cache first
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }
  if (url.pathname.includes('/api/')) {
    // never cache the live stream, sign-in or file downloads that were not saved
    if (url.pathname.includes('/events') || url.pathname.includes('/auth/refresh')) return;
    if (API_FALLBACK.some((re) => re.test(url.pathname + url.search))) {
      event.respondWith(networkFirst(req, API));
      return;
    }
    // anything saved for offline: network first, the saved copy when offline
    event.respondWith(
      fetch(req).catch(async (err) => {
        const hit = await (await caches.open(OFFLINE)).match(req, { ignoreVary: true });
        if (hit) return hit;
        throw err;
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear') event.waitUntil(Promise.all([caches.delete(API), caches.delete(OFFLINE)]));
});

self.addEventListener('push', (event) => {
  let data = { title: 'Acadex', body: '', link: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* not JSON */
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, data: { link: data.link }, icon: '/icon-192.png', badge: '/icon-192.png', tag: data.type }));
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
