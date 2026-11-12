/* Altas controladas de clientes (C1, opción C). Lógica sin dependencias de firebase-functions para poder
   probarla contra los emuladores. PREPARADO, NO DESPLEGADO.

   - Solo el entrenador (su UID o el claim role=='coach', que solo pone el Admin SDK) puede crear cuentas.
   - Solo códigos generados (60 bits, auth/code-identity.js). El código lo genera la app del entrenador, que
     es quien se lo entrega al cliente; aquí solo se valida y se crea la cuenta.
   - Si ya existe una cuenta para ese código, NO se reutiliza (podría ser de otra persona).
   - La cuenta lleva la marca jcgCliente = id de la ficha (procedencia verificable, como en la migración).
   - No cambia la ficha: código y cuentas los escribe después la app del entrenador en un único guardado
     (el mismo camino ya probado, con las reglas del entrenador). Si eso falla, la cuenta queda suelta, sin
     ficha: no da acceso a nada.
   - Nunca escribe en registros el código, el correo ni la contraseña. */
const id = require('./code-identity');

const CLAIM = 'jcgCliente';
const ID_FICHA = /^[A-Za-z0-9_-]{1,120}$/;

function esEntrenador(auth, coachUid) {
  if (!auth || !auth.uid) return false;
  if (coachUid && auth.uid === coachUid) return true;
  return !!(auth.token && auth.token.role === 'coach');
}

async function altaCliente(admin, data, auth, coachUid, HttpsError) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sin sesión.');
  if (!esEntrenador(auth, coachUid)) throw new HttpsError('permission-denied', 'Solo el entrenador puede dar altas.');
  const cid = data && data.clientId;
  const raw = data && data.code;
  if (typeof cid !== 'string' || !ID_FICHA.test(cid) || cid === 'coach_data') throw new HttpsError('invalid-argument', 'Ficha no válida.');
  if (typeof raw !== 'string' || !id.isStrongCode(raw)) throw new HttpsError('invalid-argument', 'Solo valen códigos generados.');
  const code = id.normAuthCode(raw);
  const ficha = await admin.firestore().collection('clients').doc(cid).get();
  if (!ficha.exists) throw new HttpsError('not-found', 'La ficha no existe.');
  let user;
  try {
    user = await admin.auth().createUser({ email: await id.clientEmailFromCode(code), password: id.clientPasswordFromCode(code) });
  } catch (e) {
    if (e && e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Ya había una cuenta para ese código: genera otro.');
    throw new HttpsError('internal', 'No se pudo crear la cuenta.');
  }
  try {
    await admin.auth().setCustomUserClaims(user.uid, { [CLAIM]: cid });
  } catch (e) {
    // Cuenta recién creada aquí mismo y que nadie conoce: se retira para no dejar una cuenta sin marca.
    try { await admin.auth().deleteUser(user.uid); } catch (_) { /* queda suelta y sin ficha: sin acceso */ }
    throw new HttpsError('internal', 'No se pudo marcar la cuenta.');
  }
  return { uid: user.uid };
}

// Defensa adicional al interruptor de la consola: cualquier alta que NO venga del Admin SDK se rechaza.
function rechazarRegistro(HttpsError) {
  throw new HttpsError('permission-denied', 'Las altas solo las da el entrenador.');
}

module.exports = { altaCliente, rechazarRegistro, esEntrenador, CLAIM };
