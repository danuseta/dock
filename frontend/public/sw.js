// DOCK service worker. Two jobs: keep the app's own files so it still opens when the server cannot be reached,
// and show the notifications the server pushes. It never touches the API: data stays the page's business.
const CACHE = 'dock-shell-v1';
const API = ['/graphql', '/api', '/ingest', '/internal', '/health'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

const keep = (key, response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(key, copy));
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const api = API.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
  if (request.method !== 'GET' || url.origin !== self.location.origin || api || url.pathname === '/sw.js') return;

  // A page load: the newest page when the server answers, the saved one when it does not. Every route is the same page.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => keep('/', response)).catch(() => caches.match('/')));
    return;
  }
  // Scripts, styles, images: built files carry a hash in their name, so a saved copy is never out of date.
  event.respondWith(caches.match(request).then((saved) => saved || fetch(request).then((response) => keep(request, response))));
});

self.addEventListener('push', (event) => {
  const message = event.data.json();
  event.waitUntil(self.registration.showNotification(message.title, { body: message.body, icon: '/icon-192.png', data: { url: message.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windows) => (windows.length > 0 ? windows[0].navigate(url).then((opened) => opened.focus()) : self.clients.openWindow(url))),
  );
});
