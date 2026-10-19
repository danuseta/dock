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
  const options = { body: message.body, icon: '/icon-192.png', data: { ...(message.data || {}), url: message.url } };
  if (message.tag) options.tag = message.tag;
  if (Array.isArray(message.actions) && message.actions.length > 0) options.actions = message.actions.slice(0, 2);
  event.waitUntil(self.registration.showNotification(message.title, options));
});

const ANSWER_TICKET = 'mutation AnswerTicket($ticketKey: String!, $text: String!) { answerTicket(ticketKey: $ticketKey, text: $text) }';
const ANSWER_ASK = 'mutation AnswerChatInteraction($sessionId: ID!, $id: Int!, $decision: String!) { answerChatInteraction(sessionId: $sessionId, id: $id, decision: $decision) { id } }';

// What a notification button sends: a fixed answer to a waiting ticket, or allow / deny for a request in a chat turn.
const requestFor = (data, action) => {
  if (data.kind === 'answer' && action.startsWith('answer:')) {
    const text = (data.choices || [])[Number(action.slice('answer:'.length))];
    return text ? { query: ANSWER_TICKET, variables: { ticketKey: data.ticketKey, text }, done: `Sent "${text}" to ${data.ticketKey}.` } : null;
  }
  if (data.kind === 'interaction' && (action === 'allow' || action === 'deny')) {
    return { query: ANSWER_ASK, variables: { sessionId: data.sessionId, id: data.id, decision: action }, done: action === 'allow' ? 'Allowed once.' : 'Denied.' };
  }
  return null;
};

const sendAnswer = async (request) => {
  const response = await fetch('/graphql', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: request.query, variables: request.variables }) });
  if (!response.ok) return false;
  const result = await response.json();
  return !result.errors || result.errors.length === 0;
};

const openPage = (url) => self.clients.matchAll({ type: 'window' }).then((windows) => (windows.length > 0 ? windows[0].navigate(url).then((opened) => opened.focus()) : self.clients.openWindow(url)));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const request = event.action ? requestFor(data, event.action) : null;
  if (!request) {
    event.waitUntil(openPage(data.url));
    return;
  }
  // A button answers DOCK directly; when DOCK refuses (locked, signed out, already answered), the page opens instead.
  event.waitUntil(sendAnswer(request)
    .then((ok) => (ok ? self.registration.showNotification('DOCK', { body: request.done, icon: '/icon-192.png', tag: 'dock-answered' }) : openPage(data.url)))
    .catch(() => openPage(data.url)));
});
