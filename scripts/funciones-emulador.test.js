// Opción C (altas controladas): la función altaCliente y el bloqueo del registro público, ejecutados de verdad
// en los emuladores de Auth, Firestore y Functions con las reglas estrictas. Datos ficticios.
// Ejecutar con: npm run test:funciones
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Solo con emuladores (npm run test:funciones).');
}
const PROJECT = 'demo-appjorgecgcoach';
process.env.GCLOUD_PROJECT = PROJECT;
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const ident = require('../auth/code-identity');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc } = require('firebase/firestore');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');

const FUNCIONES = '127.0.0.1:5399';
const db = admin.firestore();
const FICHA = name => ({ name, blocks: [], _rev: 1 });

async function vaciar() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
let n = 0;
function sdk() {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, 'f' + (n++));
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const cdb = getFirestore(app);
  const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(cdb, h, Number(p));
  const fns = getFunctions(app, 'europe-west1');
  const [fh, fp] = FUNCIONES.split(':');
  connectFunctionsEmulator(fns, fh, Number(fp));
  return { app, auth, cdb, alta: httpsCallable(fns, 'altaCliente'), cerrar: async () => { try { await signOut(auth); } catch (_) {} await deleteApp(app); } };
}
// El entrenador: cuenta creada con el Admin SDK (como hoy la de Google) y claim role=coach.
async function entrenador() {
  const u = await admin.auth().createUser({ email: 'entrenador-ficticio@example.com', password: 'clave-ficticia-entrenador' });
  await admin.auth().setCustomUserClaims(u.uid, { role: 'coach' });
  const s = sdk();
  await signInWithEmailAndPassword(s.auth, 'entrenador-ficticio@example.com', 'clave-ficticia-entrenador');
  return s;
}
async function preparar() {
  await vaciar();
  await db.collection('clients').doc('c1').set(FICHA('Uno ficticio'));
  await db.collection('clients').doc('c2').set(FICHA('Dos ficticio'));
  await db.collection('clients').doc('coach_data').set({ codes: {}, _rev: 1 });
}
const codigoDe = e => e && String(e.code || '');

test('el registro público queda cerrado; el Admin SDK (migración y función) sigue pudiendo crear cuentas', async () => {
  await preparar();
  const s = sdk();
  try {
    const code = ident.generateClientCode();
    await assert.rejects(createUserWithEmailAndPassword(s.auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code)),
      e => /permission|blocking|PERMISSION_DENIED|admin-restricted|internal-error/i.test(codigoDe(e) + ' ' + (e && e.message)), 'alta desde el navegador rechazada');
    await assert.rejects(createUserWithEmailAndPassword(s.auth, 'cualquiera-ficticio@example.com', 'clave-ficticia-1'));
    assert.equal((await admin.auth().listUsers()).users.length, 0, 'no se ha creado ninguna cuenta');
    const u = await admin.auth().createUser({ email: 'admin-ficticio@example.com', password: 'clave-ficticia-2' });
    assert.ok(u.uid, 'el Admin SDK no pasa por el bloqueo');
  } finally { await s.cerrar(); }
});

test('el entrenador da el alta: cuenta con la marca de la ficha; tras guardar la ficha, el cliente entra y solo ve la suya', async () => {
  await preparar();
  const ent = await entrenador();
  try {
    const code = ident.generateClientCode();
    const r = await ent.alta({ clientId: 'c1', code: code.toLowerCase() });
    const uid = r.data.uid;
    assert.deepEqual(Object.keys(r.data), ['uid'], 'solo devuelve el uid');
    const u = await admin.auth().getUser(uid);
    assert.equal(u.customClaims.jcgCliente, 'c1');
    assert.equal(u.email, await ident.clientEmailFromCode(code));
    // La función no toca la ficha: la escribe la app del entrenador, con sus reglas.
    assert.equal((await db.collection('clients').doc('c1').get()).data().authUid, undefined);
    await updateDoc(doc(ent.cdb, 'clients/c1'), { code, authUid: uid, authUids: [uid] });
    await updateDoc(doc(ent.cdb, 'clients/coach_data'), { codes: { [code]: { client: 'c1' } } });
    const cli = sdk();
    try {
      await signInWithEmailAndPassword(cli.auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code));
      assert.equal((await getDoc(doc(cli.cdb, 'clients/c1'))).exists(), true);
      await assert.rejects(getDoc(doc(cli.cdb, 'clients/c2')));
      // Cambiar su contraseña (update, no alta) sigue funcionando con el registro cerrado.
      await updatePassword(cli.auth.currentUser, 'clave-ficticia-cambiada');
    } finally { await cli.cerrar(); }
  } finally { await ent.cerrar(); }
});

test('solo el entrenador: sin sesión, un cliente o una cuenta cualquiera no pueden dar altas', async () => {
  await preparar();
  const anonimo = sdk();
  try {
    await assert.rejects(anonimo.alta({ clientId: 'c1', code: ident.generateClientCode() }), e => codigoDe(e) === 'functions/unauthenticated');
  } finally { await anonimo.cerrar(); }
  await admin.auth().createUser({ email: 'otro-ficticio@example.com', password: 'clave-ficticia-3' });
  const otro = sdk();
  try {
    await signInWithEmailAndPassword(otro.auth, 'otro-ficticio@example.com', 'clave-ficticia-3');
    await assert.rejects(otro.alta({ clientId: 'c1', code: ident.generateClientCode() }), e => codigoDe(e) === 'functions/permission-denied');
  } finally { await otro.cerrar(); }
  // Una cuenta de cliente (con su marca) tampoco.
  const code = ident.generateClientCode();
  const cu = await admin.auth().createUser({ email: await ident.clientEmailFromCode(code), password: ident.clientPasswordFromCode(code) });
  await admin.auth().setCustomUserClaims(cu.uid, { jcgCliente: 'c1' });
  const cli = sdk();
  try {
    await signInWithEmailAndPassword(cli.auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code));
    await assert.rejects(cli.alta({ clientId: 'c2', code: ident.generateClientCode() }), e => codigoDe(e) === 'functions/permission-denied');
  } finally { await cli.cerrar(); }
  assert.equal((await admin.auth().listUsers()).users.length, 2, 'ninguna cuenta nueva');
});

test('datos no válidos: código elegido a mano, ficha inexistente o el meta', async () => {
  await preparar();
  const ent = await entrenador();
  try {
    for (const [data, esperado] of [
      [{ clientId: 'c1', code: '12345678Z' }, 'functions/invalid-argument'],
      [{ clientId: 'c1', code: '7K3M-Q9TB-0R1' }, 'functions/invalid-argument'],
      [{ clientId: 'coach_data', code: ident.generateClientCode() }, 'functions/invalid-argument'],
      [{ clientId: '../c1', code: ident.generateClientCode() }, 'functions/invalid-argument'],
      [{ clientId: 'no-existe', code: ident.generateClientCode() }, 'functions/not-found']
    ]) await assert.rejects(ent.alta(data), e => codigoDe(e) === esperado, JSON.stringify(data.clientId));
    assert.equal((await admin.auth().listUsers()).users.length, 1, 'solo el entrenador');
  } finally { await ent.cerrar(); }
});

test('si ya existe una cuenta para el código, no se reutiliza ni se toca', async () => {
  await preparar();
  const ent = await entrenador();
  try {
    const code = ident.generateClientCode();
    const previa = await admin.auth().createUser({ email: await ident.clientEmailFromCode(code), password: 'otra-clave-ficticia' });
    await assert.rejects(ent.alta({ clientId: 'c1', code }), e => codigoDe(e) === 'functions/already-exists');
    const u = await admin.auth().getUser(previa.uid);
    assert.equal(u.customClaims, undefined, 'sin marca');
    assert.equal(u.disabled, false);
  } finally { await ent.cerrar(); }
});

test('el entrenador entra con su cuenta existente aunque el registro esté cerrado', async () => {
  await preparar();
  const ent = await entrenador();
  try {
    assert.equal((await getDoc(doc(ent.cdb, 'clients/coach_data'))).exists(), true);
  } finally { await ent.cerrar(); }
});
