// C1 — Reglas de RESCATE (firestore.rescate.rules): la vuelta atrás que NO vuelve a abrir la base.
// Se comprueba que siguen cerrando todo a los anónimos y a otros clientes, y que lo único que relajan
// es la lista de campos protegidos de la ficha propia. Además, ningún archivo de reglas que se pueda
// desplegar deja abiertas las fichas, salvo el de transición (que es, a propósito, como producción hoy).
// Emulador y datos ficticios. npm run test:seguridad
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } = require('firebase/firestore');
const reglas = require('./reglas');

const RULES = reglas.leer('firestore.rescate.rules');
let env;
test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-jcg-rescate', firestore: { rules: RULES } }); });
test.after(async () => { if (env) await env.cleanup(); });

async function sembrar() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'clients/coach_data'), { coachCode: 'PIN-FICTICIO', codes: { 'COD-A': { client: 'client-a' } }, negocio: { contacts: [] } });
    await setDoc(doc(db, 'clients/client-a'), { name: 'Cliente Ficticio A', code: 'COD-A', authUid: 'uid-a', pagos: [{ id: 1 }], blocks: [], _rev: 1 });
    await setDoc(doc(db, 'clients/client-b'), { name: 'Cliente Ficticio B', authUid: 'uid-b', _rev: 1 });
    await setDoc(doc(db, 'contacts/ct_1'), { nombre: 'Contacto Ficticio' });
    await setDoc(doc(db, 'catalog/exercises'), { items: [], count: 0, updatedAt: 1 });
  });
}
// Vale el marcador del repositorio y también las reglas generadas con el UID real (REGLAS_DIR).
const COACH_UID = reglas.uidEntrenador(RULES);
const anon = () => env.unauthenticatedContext().firestore();
const clienteA = () => env.authenticatedContext('uid-a').firestore();
const coach = () => env.authenticatedContext(COACH_UID).firestore();
const otraCuenta = () => env.authenticatedContext('uid-cualquiera').firestore();

test('anónimo: no lee ni escribe nada (no se vuelve a abrir)', async () => {
  await sembrar();
  const db = anon();
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  await assertFails(getDoc(doc(db, 'clients/client-a')));
  await assertFails(getDocs(collection(db, 'clients')));
  await assertFails(setDoc(doc(db, 'clients/nuevo'), { name: 'x' }));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { name: 'x' }));
  await assertFails(deleteDoc(doc(db, 'clients/client-a')));
  await assertFails(getDoc(doc(db, 'catalog/exercises')));
  await assertFails(getDoc(doc(db, 'contacts/ct_1')));
  await assertFails(setDoc(doc(db, 'otra/cosa'), { a: 1 }));
});

test('cualquier cuenta sin ficha: tampoco ve fichas, meta ni contactos', async () => {
  await sembrar();
  const db = otraCuenta();
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  await assertFails(getDoc(doc(db, 'clients/client-a')));
  await assertFails(getDocs(collection(db, 'clients')));
  await assertFails(getDoc(doc(db, 'contacts/ct_1')));
  await assertFails(setDoc(doc(db, 'clients/nuevo'), { name: 'x', authUid: 'uid-cualquiera' }));
});

test('cliente: su ficha sí (también campos protegidos en modo rescate), lo demás no', async () => {
  await sembrar();
  const db = clienteA();
  await assertSucceeds(getDoc(doc(db, 'clients/client-a')));
  await assertSucceeds(getDocs(query(collection(db, 'clients'), where('authUid', '==', 'uid-a'))));
  await assertSucceeds(updateDoc(doc(db, 'clients/client-a'), { blocks: [{ id: 'b1' }], mods: { semana: true } }));
  await assertSucceeds(updateDoc(doc(db, 'clients/client-a'), { name: 'Cliente Ficticio A' }));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { authUid: 'uid-x' }));
  await assertFails(updateDoc(doc(db, 'clients/client-a'), { authUids: ['uid-a', 'uid-x'] }));
  await assertFails(deleteDoc(doc(db, 'clients/client-a')));
  await assertFails(getDoc(doc(db, 'clients/client-b')));
  await assertFails(updateDoc(doc(db, 'clients/client-b'), { name: 'x' }));
  await assertFails(getDoc(doc(db, 'clients/coach_data')));
  await assertFails(getDocs(collection(db, 'clients')));
  await assertFails(setDoc(doc(db, 'clients/nuevo'), { name: 'x', authUid: 'uid-a' }));
  await assertFails(setDoc(doc(db, 'catalog/exercises'), { items: [], count: 0, updatedAt: 2 }));
  await assertSucceeds(getDoc(doc(db, 'catalog/exercises')));
});

test('entrenador: todo, y coach_data sigue sin admitir dueño', async () => {
  await sembrar();
  const db = coach();
  await assertSucceeds(getDoc(doc(db, 'clients/coach_data')));
  await assertSucceeds(getDocs(collection(db, 'clients')));
  await assertSucceeds(setDoc(doc(db, 'clients/nuevo'), { name: 'Nuevo Ficticio' }));
  await assertSucceeds(updateDoc(doc(db, 'clients/client-b'), { pagos: [] }));
  await assertSucceeds(getDoc(doc(db, 'contacts/ct_1')));
  await assertFails(updateDoc(doc(db, 'clients/coach_data'), { authUid: 'uid-a' }));
});

test('ningún archivo de reglas desplegable abre las fichas, salvo el de transición', () => {
  const abierto = /allow\s+[a-z, ]*(read|write|get|list|update|create|delete)[a-z, ]*:\s*if\s+true\s*;/;
  for (const nombre of ['firestore.rules', 'firestore.rescate.rules']) {
    assert.ok(!abierto.test(reglas.leer(nombre)), nombre + ' no debe tener «if true»');
  }
  assert.ok(!abierto.test(reglas.leer('storage.rules')), 'storage.rules no debe tener «if true»');
});
