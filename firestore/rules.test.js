const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where
} = require('firebase/firestore');

const PROJECT = 'demo-appjorgecgcoach';
const REGLAS = require('./reglas');
// El UID del entrenador sale de las reglas que se prueban: el marcador en el repositorio, el real en las generadas.
const ALLOWLIST_UID = REGLAS.uidEntrenador(REGLAS.leer('firestore.rules'));

let testEnv;

function fsdb(ctx) {
  return ctx.firestore();
}

test.before(async function () {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: REGLAS.leer('firestore.rules')
    }
  });
});

test.after(async function () {
  if (testEnv) await testEnv.cleanup();
});

test.beforeEach(async function () {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async function (ctx) {
    const db = fsdb(ctx);
    await setDoc(doc(db, 'clients/coach_data'), {
      coachCode: '0000',
      codes: { 'DEMO-1234': { client: 'client-a' } },
      negocio: { payments: [], contracts: [], contacts: [{ id: 1, nombre: 'Lead Ejemplo' }] },
      _rev: 1
    });
    await setDoc(doc(db, 'clients/client-a'), {
      name: 'Cliente Ejemplo A',
      authUid: 'uid-a',
      push: { enabled: false, tokens: ['token-ficticio-a'] },
      _rev: 1
    });
    await setDoc(doc(db, 'clients/client-b'), {
      name: 'Cliente Ejemplo B',
      authUid: 'uid-b',
      push: { enabled: false, tokens: ['token-ficticio-b'] },
      _rev: 1
    });
    await setDoc(doc(db, 'contacts/ct_1'), {
      id: 1,
      nombre: 'Lead Ejemplo',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  });
});

test('anónimo no lee coach_data, fichas ni contactos', async function () {
  const db = fsdb(testEnv.unauthenticatedContext());
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  await assertFails(getDoc(doc(db, 'clients/client-a')));
  await assertFails(getDocs(collection(db, 'clients')));
  await assertFails(getDoc(doc(db, 'contacts/ct_1')));
  await assertFails(setDoc(doc(db, 'clients/client-a'), { name: 'x' }));
});

test('el entrenador con claim role=coach lee y escribe coach_data y contactos', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-coach', { role: 'coach' }));
  const meta = await assertSucceeds(getDoc(doc(db, 'clients/coach_data')));
  assert.equal(meta.exists(), true);
  assert.equal(meta.get('codes')['DEMO-1234'].client, 'client-a');
  await assertSucceeds(setDoc(doc(db, 'clients/coach_data'), {
    coachCode: '0000',
    codes: {},
    negocio: { contacts: [] },
    _rev: 2
  }));
  const contact = await assertSucceeds(getDoc(doc(db, 'contacts/ct_1')));
  assert.equal(contact.get('nombre'), 'Lead Ejemplo');
  await assertSucceeds(setDoc(doc(db, 'contacts/ct_2'), {
    id: 2,
    nombre: 'Lead Ejemplo 2',
    updatedAt: '2026-02-01T00:00:00.000Z'
  }));
  await assertSucceeds(deleteDoc(doc(db, 'contacts/ct_2')));
  const ficha = await assertSucceeds(getDoc(doc(db, 'clients/client-b')));
  assert.equal(ficha.get('push').tokens[0], 'token-ficticio-b');
});

test('el entrenador de la allowlist entra sin custom claim', async function () {
  const db = fsdb(testEnv.authenticatedContext(ALLOWLIST_UID));
  await assertSucceeds(getDoc(doc(db, 'clients/coach_data')));
  await assertSucceeds(getDocs(collection(db, 'clients')));
});

test('una cuenta Google cualquiera no es el entrenador', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-google-ajena'));
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  await assertFails(getDoc(doc(db, 'contacts/ct_1')));
  await assertFails(getDoc(doc(db, 'clients/client-a')));
});

test('el cliente A lee y escribe su ficha, no la de B ni coach_data', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-a'));
  const own = await assertSucceeds(getDoc(doc(db, 'clients/client-a')));
  assert.equal(own.get('name'), 'Cliente Ejemplo A');
  assert.equal(own.get('push').tokens[0], 'token-ficticio-a');
  // Guardia _rev: sin _rev, o con un _rev viejo (datos de otra pestaña), no se escribe.
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { fichasDone: true }));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { fichasDone: true, _rev: 1 }));
  await assertSucceeds(updateDoc(doc(db, 'clients/client-a'), { fichasDone: true, _rev: 2 }));
  await assertFails(getDoc(doc(db, 'clients/client-b')));
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  await assertFails(updateDoc(doc(db, 'clients/client-b'), { name: 'no' }));
  await assertFails(getDoc(doc(db, 'contacts/ct_1')));
  await assertFails(setDoc(doc(db, 'contacts/ct_9'), { id: 9, nombre: 'no' }));
});

test('el cliente no cambia su authUid, no borra su ficha y no lista el archivo', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-a'));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { authUid: 'uid-b' }));
  await assertFails(deleteDoc(doc(db, 'clients/client-a')));
  await assertFails(getDocs(collection(db, 'clients')));
  await assertFails(setDoc(doc(db, 'clients/client-nuevo'), { name: 'Nuevo', authUid: 'uid-a' }));
});

test('la consulta por authUid devuelve solo la ficha propia', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-a'));
  const snap = await assertSucceeds(getDocs(query(
    collection(db, 'clients'),
    where('authUid', '==', 'uid-a')
  )));
  assert.equal(snap.size, 1);
  assert.equal(snap.docs[0].id, 'client-a');
  const ids = snap.docs.map(function (d) { return d.id; });
  assert.equal(ids.includes('coach_data'), false);
  assert.equal(ids.includes('client-b'), false);
});

test('coach_data no acepta un campo authUid', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-coach', { role: 'coach' }));
  await assertFails(setDoc(doc(db, 'clients/coach_data'), {
    coachCode: '0000',
    authUid: 'uid-a'
  }));
  await assertFails(updateDoc(doc(db, 'clients/coach_data'), { authUid: 'uid-a' }));
});

test('cliente con varios códigos (authUids): su segunda cuenta lee, consulta y guarda solo su ficha', async function () {
  await testEnv.withSecurityRulesDisabled(async function (ctx) {
    await updateDoc(doc(fsdb(ctx), 'clients/client-a'), { authUids: ['uid-a', 'uid-a2'] });
  });
  const db = fsdb(testEnv.authenticatedContext('uid-a2'));
  await assertSucceeds(getDoc(doc(db, 'clients/client-a')));
  await assertSucceeds(updateDoc(doc(db, 'clients/client-a'), { fichasDone: true, _rev: 2 }));
  const snap = await assertSucceeds(getDocs(query(collection(db, 'clients'), where('authUids', 'array-contains', 'uid-a2'))));
  assert.deepEqual(snap.docs.map(function (d) { return d.id; }), ['client-a']);
  await assertFails(getDoc(doc(db, 'clients/client-b')));
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  // No puede añadirse ni quitarse dueños.
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { authUids: ['uid-a2'] }));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { authUids: ['uid-a', 'uid-a2', 'uid-b'] }));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { authUid: 'uid-a2' }));
  // Un cliente sin authUids tampoco puede crearse esa lista.
  const dbB = fsdb(testEnv.authenticatedContext('uid-b'));
  await assertFails(updateDoc(doc(dbB, 'clients/client-b'), { authUids: ['uid-b', 'uid-intruso'] }));
});

test('coach_data no acepta un campo authUids', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-coach', { role: 'coach' }));
  await assertFails(updateDoc(doc(db, 'clients/coach_data'), { authUids: ['uid-a'] }));
});

test('ni el entrenador lee una colección distinta', async function () {
  const db = fsdb(testEnv.authenticatedContext('uid-coach', { role: 'coach' }));
  await assertFails(getDoc(doc(db, 'secretos/x')));
  await assertFails(setDoc(doc(db, 'secretos/x'), { a: 1 }));
});
