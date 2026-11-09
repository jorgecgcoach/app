/* Inicializa firebase-admin para los scripts de copia.
   - Con FIRESTORE_EMULATOR_HOST: emulador (proyecto demo), sin credenciales.
   - Sin emulador: proyecto real SOLO si se pasa --proyecto-real y hay cuenta de servicio
     en GOOGLE_APPLICATION_CREDENTIALS (ruta a un JSON fuera del repositorio). */
function iniciar(opciones) {
  const admin = require('firebase-admin');
  if (admin.apps.length) return { admin, modo: process.env.FIRESTORE_EMULATOR_HOST ? 'emulador' : 'real' };
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-appjorgecgcoach' });
    return { admin, modo: 'emulador' };
  }
  if (!process.argv.includes('--proyecto-real')) {
    const e = new Error('Sin emulador hace falta --proyecto-real para tocar el proyecto real' + (opciones && opciones.escribe ? ' (y además el permiso explícito de escritura)' : '') + '.');
    e.code = 'SIN_PERMISO';
    throw e;
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const e = new Error('Falta GOOGLE_APPLICATION_CREDENTIALS (ruta al JSON de la cuenta de servicio, fuera del repositorio).');
    e.code = 'SIN_PERMISO';
    throw e;
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'appjorgecgcoach' });
  return { admin, modo: 'real' };
}
module.exports = { iniciar };
