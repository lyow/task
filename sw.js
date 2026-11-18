/* The only job of this worker: receive links, text and photos shared from other apps (Web Share Target).
   It caches nothing and answers no other request, so app updates and the version check work exactly as before. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function keep(data) {
  return new Promise((res, rej) => {
    const open = indexedDB.open('pm-share', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('inbox');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').put(data, 'last');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    };
  });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'POST' || !url.pathname.endsWith('/share')) return;   // everything else goes to the network untouched
  e.respondWith((async () => {
    try {
      const f = await e.request.formData();
      const file = f.get('photo');
      await keep({ title: String(f.get('title') || ''), text: String(f.get('text') || ''), url: String(f.get('url') || ''),
        file: file && file.size ? file : null, at: Date.now() });
    } catch (err) { /* nothing to keep — the app still opens */ }
    return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
  })());
});

/* Closed-app reminders (web push). Only used once the server side from docs/push-setup.md is set up. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {} } catch (err) { d = { title: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'For today', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'pm-today', data: { url: d.url || './#focus' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './#focus', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus() } }
    return self.clients.openWindow(url);
  }));
});
