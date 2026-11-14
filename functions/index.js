/* Funciones de C1 (opción C: altas controladas). PREPARADO, NO DESPLEGADO.
   Desplegar exige plan Blaze y Firebase Authentication con Identity Platform (para la función de bloqueo).
   Ver docs/altas-servidor.md. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { beforeUserCreated } = require('firebase-functions/v2/identity');
const admin = require('firebase-admin');
const { altaCliente, rechazarRegistro } = require('./altas');

admin.initializeApp();

// UID del entrenador: en functions/.env.appjorgecgcoach (ignorado por git; lo genera `npm run reglas:preparar`).
// Sin configurar = nadie entra por UID (solo con el claim role=='coach'): falla cerrado.
const coachUid = () => process.env.COACH_UID || '';

const REGION = 'europe-west1';

exports.altaCliente = onCall(
  { region: REGION, maxInstances: 2, concurrency: 1, cpu: 1, memory: '256MiB', timeoutSeconds: 30, enforceAppCheck: false },
  req => altaCliente(admin, req.data, req.auth, coachUid(), HttpsError)
);

exports.bloquearRegistro = beforeUserCreated({ region: REGION }, () => rechazarRegistro(HttpsError));
