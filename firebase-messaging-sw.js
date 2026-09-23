/* ============================================================
   firebase-messaging-sw.js
   Service Worker de notificaciones push para JorgeCGCoach.

   DÓNDE VA: en la MISMA carpeta que tu index.html (la carpeta /docs
   del repositorio). Debe quedar accesible como:
   https://TU-USUARIO.github.io/TU-REPO/firebase-messaging-sw.js

   No hace falta que toques nada de este archivo: la configuración
   de abajo es pública (la misma que ya está en tu index.html).
   ============================================================ */

importScripts('https://cdnjs.cloudflare.com/ajax/libs/firebase/10.8.0/firebase-app-compat.min.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/firebase/10.8.0/firebase-messaging-compat.min.js');

firebase.initializeApp({
  apiKey: "AIzaSyAKEIpIh5ukD0lTRVNZTe18ysLdkaHuzlU",
  authDomain: "appjorgecgcoach.firebaseapp.com",
  projectId: "appjorgecgcoach",
  storageBucket: "appjorgecgcoach.firebasestorage.app",
  messagingSenderId: "268327197097",
  appId: "1:268327197097:web:02657339a927df92634cb8"
});

const messaging = firebase.messaging();

// Notificación recibida con la app cerrada o en segundo plano
messaging.onBackgroundMessage(function(payload){
  const n = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(n.title || 'JorgeCGCoach', {
    body: n.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: data,
    tag: data.tag || 'jcg',
    renotify: true
  });
});

// Al tocar la notificación: abrir/enfocar la app
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (const c of list){ if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
