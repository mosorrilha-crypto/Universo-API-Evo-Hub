// Service worker do PWA do atendente (issue #159). Dois papéis: (1) exigido
// pelos navegadores pra considerar o app "instalável" (Add to Home Screen);
// (2) recebe e exibe as notificações de Web Push (escalação nova, agente
// pausado com lead sem resposta — ver server/services/webPush.ts).
//
// De propósito SEM cache offline: o painel depende de dado sempre
// atualizado via API/SSE (conversas, escalonamentos) — responder com uma
// versão em cache seria pior que não ter service worker nenhum. O listener
// de 'fetch' abaixo não intercepta nada, só existe pra satisfazer o
// requisito de "service worker ativo" de alguns navegadores.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Passthrough intencional — sem event.respondWith(), o navegador segue
  // com o fetch normal de rede.
});

self.addEventListener('push', (event) => {
  let data = { title: 'Universo', body: 'Você tem uma notificação nova.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Payload não veio como JSON — mantém o fallback genérico acima.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
