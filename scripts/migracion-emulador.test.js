// Migración de cuentas (C1) con CÓDIGOS ALEATORIOS NUEVOS, ejecutada de verdad contra los EMULADORES de Auth y
// Firestore con las reglas estrictas. Datos ficticios. Ejecutar con: npm run test:migracion
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Solo con emuladores (npm run test:migracion).');
}
const PROJECT = 'demo-appjorgecgcoach';
process.env.GCLOUD_PROJECT = PROJECT;
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const { applyMigration, comprobar, CLAIM } = require('./migrate-client-auth');
const { verificarVinculos } = require('./verificar-vinculos');
const ident = require('../auth/code-identity');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, collection, query, where, getDocs, limit } = require('firebase/firestore');

const FICHA = (name, extra) => Object.assign({ name, blocks: [{ id: 'b1', label: 'Bloque', cur: true, data: { log: { 'u1|1|0': { kg: 40 } } } }], pagos: [{ id: 1, importe: 50 }], _rev: 7 }, extra || {});
const db = admin.firestore();

async function vaciar() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
async function sembrar(fichas, codes) {
  await vaciar();
  for (const [cid, f] of Object.entries(fichas)) await db.collection('clients').doc(cid).set(f);
  await db.collection('clients').doc('coach_data').set({ coachCode: 'PIN-FICTICIO', codes: codes || {}, _rev: 3 });
}
const ficha = async cid => (await db.collection('clients').doc(cid).get()).data();
const meta = async () => (await db.collection('clients').doc('coach_data').get()).data();

let n = 0;
async function comoCliente(code, fn) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, 'c' + (n++));
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const cdb = getFirestore(app);
  const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(cdb, h, Number(p));
  try {
    const cred = await signInWithEmailAndPassword(auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code));
    return await fn(cdb, cred.user.uid);
  } finally { try { await signOut(auth); } catch (_) {} await deleteApp(app); }
}
async function miFicha(cdb, uid) {
  let q = await getDocs(query(collection(cdb, 'clients'), where('authUid', '==', uid), limit(1)));
  if (q.empty) q = await getDocs(query(collection(cdb, 'clients'), where('authUids', 'array-contains', uid), limit(1)));
  return q.empty ? null : q.docs[0];
}

test('cada ficha recibe un código aleatorio nuevo y su cuenta; el código viejo (tipo DNI) no da acceso', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno', { code: '12345678Z' }), c2: FICHA('Ficticio Dos') }, { '12345678Z': { client: 'c1' }, 'COD-DOS': { client: 'c2' } });
  const r = await applyMigration();
  assert.equal(r.mode, 'emulator');
  assert.equal(r.migradas, 2);
  assert.deepEqual(r.revisar, []);
  assert.deepEqual(r.errores, []);
  const m = await meta();
  for (const cid of ['c1', 'c2']) {
    const f = await ficha(cid);
    assert.equal(ident.isStrongCode(f.code), true, 'código aleatorio de 60 bits');
    assert.deepEqual(m.codes[f.code], { client: cid });
    assert.deepEqual(f.authUids, [f.authUid]);
    assert.equal((await admin.auth().getUser(f.authUid)).customClaims[CLAIM], cid);
    assert.equal(await comoCliente(f.code, async (cdb, uid) => (await miFicha(cdb, uid)).id), cid);
    assert.equal(await comoCliente(f.code.toLowerCase().replace(/-/g, ' '), async (cdb, uid) => (await miFicha(cdb, uid)).id), cid, 'escrito en minúsculas y con espacios');
  }
  assert.equal(m.codes['12345678Z'], undefined, 'los códigos viejos se quitan');
  assert.equal(m.codes['COD-DOS'], undefined);
  await assert.rejects(comoCliente('12345678Z', async () => 1), 'el DNI no tiene cuenta');
});

test('solo añade código, cuentas y sello: el resto de la ficha queda idéntico', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno') });
  await applyMigration();
  const { code, authUid, authUids, _rev, _updatedBy, _updatedAt, _writers, ...resto } = await ficha('c1');
  const { _rev: r0, ...esperado } = FICHA('Ficticio Uno');
  assert.deepEqual(resto, esperado);
  assert.equal(_rev, 8);
  assert.equal(_updatedBy, 'migracion-c1');
});

test('repetirla no crea más cuentas, no cambia códigos y no cierra sesiones', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno'), c2: FICHA('Ficticio Dos') });
  await applyMigration();
  const antes = { c1: await ficha('c1'), c2: await ficha('c2'), meta: await meta() };
  const cuentas0 = (await admin.auth().listUsers()).users.length;
  const r = await applyMigration();
  assert.equal(r.migradas, 0);
  assert.equal(r.yaHechas, 2);
  assert.deepEqual(r.revisar, []);
  assert.equal((await admin.auth().listUsers()).users.length, cuentas0);
  assert.deepEqual({ c1: await ficha('c1'), c2: await ficha('c2'), meta: await meta() }, antes);
});

test('cuenta de OTRA persona ya vinculada a la ficha (p. ej. con las reglas abiertas): no se migra, se pide revisión y no se borra nada', async () => {
  const intruso = await (async () => { await vaciar(); return admin.auth().createUser({ email: 'intruso-ficticio@example.com', password: 'clave-ficticia-1' }); })();
  for (const [cid, f] of Object.entries({ c1: FICHA('Ficticio Uno', { authUids: [intruso.uid] }), c2: FICHA('Ficticio Dos', { authUid: intruso.uid }), c3: FICHA('Ficticio Tres') })) await db.collection('clients').doc(cid).set(f);
  await db.collection('clients').doc('coach_data').set({ codes: {} });
  const r = await applyMigration();
  assert.deepEqual(r.revisar.map(x => x.clientId).sort(), ['c1', 'c2']);
  assert.ok(r.revisar.every(x => x.motivo === 'ya-tiene-cuentas-no-verificadas'));
  assert.equal(r.migradas, 1, 'las demás siguen');
  assert.deepEqual((await ficha('c1')).authUids, [intruso.uid], 'no reasigna');
  assert.equal((await ficha('c1')).code, undefined, 'no le da código nuevo');
  assert.equal((await admin.auth().getUser(intruso.uid)).disabled, false, 'no toca la cuenta');
  const rows = await comprobar(admin);
  assert.deepEqual(rows.filter(x => x.action === 'revisar').map(x => x.clientId).sort(), ['c1', 'c2']);
  // verificar-vinculos también lo señala.
  const v = await verificarVinculos(admin);
  assert.deepEqual([...new Set(v.problemas.map(p => p.ficha))].sort(), ['c1', 'c2']);
});

test('cuenta propia de la migración pero de OTRA ficha: tampoco se acepta', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno'), c2: FICHA('Ficticio Dos') });
  await applyMigration();
  const uidDeC1 = (await ficha('c1')).authUid;
  await db.collection('clients').doc('c3').set(FICHA('Ficticio Tres', { authUid: uidDeC1 }));
  const r = await applyMigration();
  assert.deepEqual(r.revisar.map(x => x.clientId), ['c3']);
});

test('si ya existe una cuenta para el código recién generado: revisión, sin usarla', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno') });
  const fijo = '7K3M-Q9TB-0R1W';
  const previa = await admin.auth().createUser({ email: await ident.clientEmailFromCode(fijo), password: 'otra-clave-ficticia' });
  const r = await applyMigration({ generar: () => fijo });
  assert.deepEqual(r.revisar, [{ clientId: 'c1', motivo: 'ya-existia-una-cuenta-para-el-codigo' }]);
  assert.equal((await ficha('c1')).authUid, undefined);
  assert.equal((await meta()).codes[fijo], undefined);
  assert.equal((await admin.auth().getUser(previa.uid)).email, await ident.clientEmailFromCode(fijo), 'la cuenta previa no se toca');
});

test('un generador que no da códigos aleatorios fuertes se rechaza', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno') });
  const r = await applyMigration({ generar: () => '12345678Z' });
  assert.equal(r.migradas, 0);
  assert.equal(r.errores.length, 1);
  assert.equal((await ficha('c1')).authUid, undefined);
});

test('fallo a mitad: la ficha que falla queda sin acceso, las demás siguen, y repetir lo completa', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno'), c2: FICHA('Ficticio Dos') });
  const auth = admin.auth();
  const original = auth.setCustomUserClaims.bind(auth);
  let veces = 0;
  auth.setCustomUserClaims = async (uid, c) => { if (veces++ === 0) { const e = new Error('cuota'); e.code = 'auth/quota-exceeded'; throw e; } return original(uid, c); };
  let r;
  try { r = await applyMigration(); } finally { auth.setCustomUserClaims = original; }
  assert.equal(r.errores.length, 1);
  assert.equal(r.migradas, 1);
  const fallida = r.errores[0].clientId;
  assert.equal((await ficha(fallida)).authUid, undefined, 'sin vínculo a medias');
  assert.equal((await ficha(fallida)).code, undefined);
  const r2 = await applyMigration();
  assert.equal(r2.migradas, 1);
  assert.equal(r2.yaHechas, 1);
  const f = await ficha(fallida);
  assert.equal(await comoCliente(f.code, async (cdb, uid) => (await miFicha(cdb, uid)).id), fallida);
});

test('con las reglas estrictas: cada cliente solo su ficha, y no puede cambiar sus dueños ni su código', async () => {
  await sembrar({ c1: FICHA('Ficticio Uno'), c2: FICHA('Ficticio Dos') });
  await applyMigration();
  const c2 = await ficha('c2');
  await comoCliente(c2.code, async (cdb, uid) => {
    await assert.rejects(getDoc(doc(cdb, 'clients/c1')));
    await assert.rejects(getDoc(doc(cdb, 'clients/coach_data')));
    await assert.rejects(updateDoc(doc(cdb, 'clients/c2'), { authUids: [uid, 'otro'] }));
    await assert.rejects(updateDoc(doc(cdb, 'clients/c2'), { code: 'OTRO' }));
    const actual = (await getDoc(doc(cdb, 'clients/c2'))).data();
    await assert.rejects(updateDoc(doc(cdb, 'clients/c2'), { blocks: actual.blocks }), 'sin _rev no se guarda');
    await updateDoc(doc(cdb, 'clients/c2'), { blocks: actual.blocks, _rev: actual._rev + 1 });
  });
  const v = await verificarVinculos(admin);
  assert.deepEqual(v.problemas, []);
});

test('un código que no existe no entra', async () => {
  await assert.rejects(comoCliente(ident.generateClientCode(), async () => 1));
});
