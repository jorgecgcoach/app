// Adaptador de firebase-admin: la misma forma de siempre (admin.apps, admin.firestore(), admin.auth()...)
// construida con la API modular (firebase-admin/app, /firestore, /auth...). La API modular funciona igual
// en firebase-admin 12 y en 14; la 14 ya no trae la forma antigua (admin.apps, admin.credential...).
const app = require('firebase-admin/app');

function firestore() { return require('firebase-admin/firestore').getFirestore(); }
Object.defineProperty(firestore, 'FieldValue', { get: () => require('firebase-admin/firestore').FieldValue });
Object.defineProperty(firestore, 'Timestamp', { get: () => require('firebase-admin/firestore').Timestamp });

module.exports = {
  get apps() { return app.getApps(); },
  initializeApp: (...a) => app.initializeApp(...a),
  credential: { cert: (...a) => app.cert(...a), applicationDefault: (...a) => app.applicationDefault(...a) },
  firestore,
  auth: () => require('firebase-admin/auth').getAuth(),
  messaging: () => require('firebase-admin/messaging').getMessaging(),
  storage: () => require('firebase-admin/storage').getStorage()
};
