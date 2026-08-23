// Web Push Service Worker。只做两件事：收到 push 事件时，如果没有前台窗口就弹系统通知；
// 点击通知时把已打开的窗口聚焦，或者开一个新的。
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
    const clientList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const inForeground = clientList.some((c) => c.visibilityState === 'visible' && c.focused);
    if (inForeground) return;
    await self.registration.showNotification(data.title || '喵喵', {
      body: data.body || '',
      tag: 'meow-chat',
      renotify: true,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const c of clientList) {
      if ('focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
