// Migración de cuentas (C1) ejecutada de verdad contra los EMULADORES de Auth y Firestore,
// con las reglas estrictas. Datos ficticios. Ejecutar con: npm run test:migracion
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Solo con emuladores (npm run test:migracion).');
}
const PROJECT = 'demo-appjorgecgcoach';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const { applyMigration, planMigration } = require('./migrate-client-auth');
const ident = require('../auth/code-identity');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, collection, query, where, getDocs, limit } = require('firebase/firestore');

const FICHA = (name, extra) => Object.assign({ name, blocks: [{ id: 'b1', label: 'Bloque', cur: true, data: { program: { weeks: [{ days: [{ s: 'DÍA 1', exs: [{ uid: 'u1', n: 'Ejercicio', yt: '' }] }] }] }, log: { 'u1|1|0': { kg: 40 } } } }], pagos: [{ id: 1, importe: 50 }], _rev: 7 }, extra || {});
const DUMP = {
  _type: 'jcgcoach_backup',
  meta: {
    coachCode: 'PIN-FICTICIO',
    codes: {
      'COD-UNO': { client: 'c1' },
      'COD-DOS-A': { client: 'c2' }, 'COD-DOS-B': { client: 'c2' },   // un cliente con dos códigos válidos
      '12345678Z': { client: 'c3' },                                     // código tipo DNI
      'ANA 3F': { client: 'c4' },                                        // clave antigua con espacio
      'HUERFANO-1': { client: 'c-no-existe' }
    }
  },
  clients: {
    c1: FICHA('Ficticio Uno', { code: 'COD-UNO' }),
    c2: FICHA('Ficticio Dos'),
    c3: FICHA('Ficticio Tres'),
    c4: FICHA('Ficticio Cuatro'),
    c5: FICHA('Ficticio Sin Codigo')
  }
};

async function seed() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const db = admin.firestore();
  for (const [id, d] of Object.entries(DUMP.clients)) await db.collection('clients').doc(id).set(d);
  await db.collection('clients').doc('coach_data').set({ codes: DUMP.meta.codes, coachCode: 'PIN-FICTICIO' });
}

let n = 0;
async function asClient(typed, fn) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, 'c' + (n++));
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const db = getFirestore(app);
  const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, h, Number(p));
  try {
    const cred = await signInWithEmailAndPassword(auth, await ident.clientEmailFromCode(typed), ident.clientPasswordFromCode(typed));
    return await fn(db, cred.user.uid);
  } finally { try { await signOut(auth); } catch (_) {} await deleteApp(app); }
}
// Igual que loadClientAfterAuth en index.html.
async function miFicha(db, uid) {
  let q = await getDocs(query(collection(db, 'clients'), where('authUid', '==', uid), limit(1)));
  if (q.empty) q = await getDocs(query(collection(db, 'clients'), where('authUids', 'array-contains', uid), limit(1)));
  return q.empty ? null : q.docs[0];
}

test.before(seed);

test('el plan cuenta todos los códigos y avisa de lo raro, sin datos en claro', async () => {
  const plan = await planMigration(DUMP);
  const creates = plan.rows.filter(r => r.action === 'create');
  assert.equal(creates.length, 5, 'COD-UNO, COD-DOS-A, COD-DOS-B, 12345678Z, ANA 3F');
  assert.equal(plan.withoutCode, 1);
  const kinds = plan.warnings.map(w => w.kind).join(' | ');
  assert.match(kinds, /varios-codigos/);
  assert.match(kinds, /codigo-sin-ficha/);
  assert.ok(!JSON.stringify(plan).includes('COD-UNO') && !JSON.stringify(plan).includes('PIN-FICTICIO'));
});

test('aplicar en el emulador: cada código actual entra en SU ficha', async () => {
  const r = await applyMigration(DUMP);
  assert.equal(r.mode, 'emulator');
  assert.equal(r.created, 5);
  assert.equal(r.linked, 4);
  const casos = [['COD-UNO', 'c1'], ['cod-uno', 'c1'], ['  COD-DOS-A ', 'c2'], ['COD-DOS-B', 'c2'], ['12345678z', 'c3'], ['ANA 3F', 'c4'], ['ana3f', 'c4']];
  for (const [typed, esperado] of casos) {
    const id = await asClient(typed, async (db, uid) => { const d = await miFicha(db, uid); return d && d.id; });
    assert.equal(id, esperado, `«${typed}» debe abrir ${esperado}`);
  }
});

test('la migración solo añade authUid/authUids: el resto de la ficha queda idéntico', async () => {
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
    const d = (await admin.firestore().collection('clients').doc(id).get()).data();
    const { authUid, authUids, ...resto } = d;
    assert.deepEqual(resto, DUMP.clients[id], id);
  }
  const c5 = (await admin.firestore().collection('clients').doc('c5').get()).data();
  assert.equal(c5.authUid, undefined, 'sin código no se crea cuenta');
});

test('repetirla no duplica cuentas ni cambia nada', async () => {
  const antes = (await admin.firestore().collection('clients').get()).docs.map(d => [d.id, JSON.stringify(d.data())]);
  const r = await applyMigration(DUMP);
  assert.equal(r.created, 0);
  assert.equal(r.existed, 5);
  const despues = (await admin.firestore().collection('clients').get()).docs.map(d => [d.id, JSON.stringify(d.data())]);
  assert.deepEqual(despues, antes);
});

test('con las reglas estrictas: cada cliente solo su ficha, y no puede cambiar sus dueños', async () => {
  await asClient('COD-DOS-B', async (db, uid) => {
    await assert.rejects(getDoc(doc(db, 'clients/c1')));
    await assert.rejects(getDoc(doc(db, 'clients/coach_data')));
    await assert.rejects(updateDoc(doc(db, 'clients/c2'), { authUids: [uid] }));
    await assert.rejects(updateDoc(doc(db, 'clients/c2'), { authUid: uid }));
    await updateDoc(doc(db, 'clients/c2'), { 'blocks': (await getDoc(doc(db, 'clients/c2'))).data().blocks });
  });
});

test('un código que no existía no entra', async () => {
  await assert.rejects(asClient('COD-INVENTADO', async () => 1));
});

// La copia puede ser de unas horas antes. Se manda lo que hay AHORA en Firestore.
test('con una copia anterior: no resucita fichas borradas, no pisa un authUid nuevo ni vincula un código viejo', async () => {
  const db = admin.firestore();
  const COPIA = {
    meta: { codes: { 'BORRADO-1': { client: 'c6' }, 'VIEJO-7': { client: 'c7' }, 'ANTES-8': { client: 'c8' } } },
    clients: { c6: FICHA('Ficticio Seis'), c7: FICHA('Ficticio Siete', { code: 'VIEJO-7' }), c8: FICHA('Ficticio Ocho'), coach_data: { codes: {} } }
  };
  // Estado actual: c6 borrado después de la copia; c7 tiene hoy otro código; c8 ya tiene una cuenta nueva.
  await db.collection('clients').doc('c7').set(FICHA('Ficticio Siete', { code: 'NUEVO-7' }));
  await db.collection('clients').doc('c8').set(FICHA('Ficticio Ocho', { authUid: 'uid-nuevo-del-entrenador' }));
  const meta0 = (await db.collection('clients').doc('coach_data').get()).data();
  const r = await applyMigration(COPIA);
  assert.equal(r.linked, 0);
  assert.equal(r.missing, 1);
  assert.equal(r.codeChanged, 1);
  assert.equal(r.unlinked, 1);
  assert.equal((await db.collection('clients').doc('c6').get()).exists, false, 'la ficha borrada no vuelve');
  assert.equal((await db.collection('clients').doc('c7').get()).data().authUid, undefined, 'el código viejo no abre la ficha');
  assert.equal((await db.collection('clients').doc('c8').get()).data().authUid, 'uid-nuevo-del-entrenador');
  assert.deepEqual((await db.collection('clients').doc('coach_data').get()).data(), meta0, 'coach_data intacto');
  assert.equal(await asClient('VIEJO-7', async (cdb, uid) => miFicha(cdb, uid)), null);
});
