// C1 — Parada de emergencia (firestore.congelado.rules): la vuelta atrás que NO abre la base.
// Clientes: solo leen su ficha; no escriben nada (ni identidad, ni códigos, ni cuentas, ni permisos, ni
// datos administrativos, ni series). Entrenador: todo. Anónimos y otras cuentas: nada.
// Además: ningún archivo de reglas desplegable abre las fichas salvo el de transición.
// Emulador y datos ficticios. npm run test:seguridad
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, getDocs, query, where } = require('firebase/firestore');
const reglas = require('./reglas');

const RULES = reglas.leer('firestore.congelado.rules');
let env;
test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-jcg-congelado', firestore: { rules: RULES } }); });
test.after(async () => { if (env) await env.cleanup(); });

async function sembrar() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'clients/coach_data'), { coachCode: 'PIN-FICTICIO', codes: { 'COD-A': { client: 'client-a' } }, negocio: { contacts: [] }, _rev: 1 });
    await setDoc(doc(db, 'clients/client-a'), { name: 'Cliente Ficticio A', code: 'COD-A', authUid: 'uid-a', pagos: [{ id: 1 }], mods: { semana: true }, serviceType: 't', notifs: {}, blocks: [], _rev: 1 });
    await setDoc(doc(db, 'clients/client-b'), { name: 'Cliente Ficticio B', authUid: 'uid-b', _rev: 1 });
    await setDoc(doc(db, 'contacts/ct_1'), { nombre: 'Contacto Ficticio' });
    await setDoc(doc(db, 'catalog/exercises'), { items: [], count: 0, updatedAt: 1 });
  });
}
const COACH_UID = reglas.uidEntrenador(RULES);
const anon = () => env.unauthenticatedContext().firestore();
const clienteA = () => env.authenticatedContext('uid-a').firestore();
const coach = () => env.authenticatedContext(COACH_UID).firestore();

test('anónimo y cuentas sin ficha: nada', async () => {
  await sembrar();
  for (const db of [anon(), env.authenticatedContext('uid-cualquiera').firestore()]) {
    await assertFails(getDoc(doc(db, 'clients/coach_data')));
    await assertFails(getDoc(doc(db, 'clients/client-a')));
    await assertFails(getDocs(collection(db, 'clients')));
    await assertFails(setDoc(doc(db, 'clients/nuevo'), { name: 'x' }));
    await assertFails(getDoc(doc(db, 'contacts/ct_1')));
    await assertFails(setDoc(doc(db, 'otra/cosa'), { a: 1 }));
  }
  await assertFails(getDoc(doc(anon(), 'catalog/exercises')));
});

test('cliente: lee su ficha y el catálogo, y no escribe NINGÚN campo', async () => {
  await sembrar();
  const db = clienteA();
  await assertSucceeds(getDoc(doc(db, 'clients/client-a')));
  await assertSucceeds(getDocs(query(collection(db, 'clients'), where('authUid', '==', 'uid-a'))));
  await assertSucceeds(getDoc(doc(db, 'catalog/exercises')));
  const ref = doc(db, 'clients/client-a');
  for (const cambio of [{ name: 'x' }, { code: 'X' }, { authUid: 'uid-x' }, { authUids: ['uid-a', 'uid-x'] }, { pagos: [] }, { mods: { semana: true, programa: true } },
    { serviceType: 'premium' }, { notifs: { a: 1 } }, { blocks: [{ id: 'b1' }] }, { pagos: deleteField() }]) {
    await assertFails(updateDoc(ref, cambio));
  }
  await assertFails(deleteDoc(ref));
  await assertFails(getDoc(doc(db, 'clients/client-b')));
  await assertFails(updateDoc(doc(db, 'clients/client-b'), { name: 'x' }));
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  await assertFails(getDocs(collection(db, 'clients')));
  await assertFails(setDoc(doc(db, 'catalog/exercises'), { items: [], count: 0, updatedAt: 2 }));
});

test('entrenador: todo, y coach_data sigue sin admitir dueño', async () => {
  await sembrar();
  const db = coach();
  await assertSucceeds(getDoc(doc(db, 'clients/coach_data')));
  await assertSucceeds(getDocs(collection(db, 'clients')));
  await assertFails(setDoc(doc(db, 'clients/nuevo'), { name: 'Nuevo Ficticio' }), 'sin _rev no se crea');
  await assertSucceeds(setDoc(doc(db, 'clients/nuevo'), { name: 'Nuevo Ficticio', _rev: 1 }));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { pagos: [], blocks: [{ id: 'b2' }] }), 'sin _rev no se guarda');
  await assertSucceeds(updateDoc(doc(db, 'clients/client-a'), { pagos: [], blocks: [{ id: 'b2' }], _rev: 2 }));
  await assertSucceeds(getDoc(doc(db, 'contacts/ct_1')));
  await assertFails(updateDoc(doc(db, 'clients/coach_data'), { authUid: 'uid-a' }));
});

test('ningún archivo de reglas desplegable abre algo con «if true», salvo el de transición', () => {
  const abierto = /allow\s+[a-z, ]*:\s*if\s+true\s*;/;
  for (const nombre of reglas.ARCHIVOS_REGLAS.filter(n => n !== 'firestore.transicion.rules')) {
    assert.ok(!abierto.test(reglas.leer(nombre)), nombre + ' no debe tener «if true»');
  }
});
