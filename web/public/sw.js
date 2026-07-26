// web/public/sw.js
//
// Deliberately receives no data in the push event (the server sends an
// empty payload on purpose -- see functions/api/notify.ts) so this can only
// ever show a generic notification, never message content or sender identity.
// The actual message is fetched and decrypted by the page itself, over its
// existing relay connection, once it's opened.

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('PillTalk', {
      body: 'You have a new message.',
      tag: 'pilltalk-message',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    }),
  );
});
