// C1 · H1 — Reglas del catálogo de vídeos (catalog/exercises), con las reglas estrictas y las de transición.
// Solo emulador y datos ficticios. Ejecutar con: npm run test:seguridad
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, collection, getDocs, updateDoc } = require('firebase/firestore');

const ROOT = path.join(__dirname, '..');
const RULES = {
  estricta: require('./reglas').leer('firestore.rules'),
  transicion: require('./reglas').leer('firestore.transicion.rules')
};
const CAT = { items: [{ n: 'Ejercicio propio', v: 'https://youtu.be/AAAAAAAAAAA' }], count: 1, updatedAt: '2026-11-09T00:00:00.000Z' };

for (const [modo, rules] of Object.entries(RULES)) {
  test.describe(`catálogo con reglas «${modo}»`, () => {
    let env;
    test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-jcg-catalogo-' + modo, firestore: { rules } }); });
    test.after(async () => { if (env) await env.cleanup(); });
    test.beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async ctx => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'catalog/exercises'), CAT);
        await setDoc(doc(db, 'clients/client-a'), { name: 'Cliente Ficticio A', authUid: 'uid-a' });
      });
    });
    const anon = () => env.unauthenticatedContext().firestore();
    const cliente = () => env.authenticatedContext('uid-a').firestore();
    const coach = () => env.authenticatedContext('uid-coach', { role: 'coach' }).firestore();

    test('anónimo no lee el catálogo', async () => {
      await assertFails(getDoc(doc(anon(), 'catalog/exercises')));
    });
    test('el cliente con sesión lo lee, pero no lo lista, ni lo cambia, ni lo borra', async () => {
      const r = await assertSucceeds(getDoc(doc(cliente(), 'catalog/exercises')));
      assert.equal(r.get('items')[0].v, 'https://youtu.be/AAAAAAAAAAA');
      await assertFails(getDocs(collection(cliente(), 'catalog')));
      await assertFails(setDoc(doc(cliente(), 'catalog/exercises'), { items: [], count: 0, updatedAt: 'x' }));
      await assertFails(deleteDoc(doc(cliente(), 'catalog/exercises')));
    });
    test('el entrenador lo escribe con su forma exacta', async () => {
      await assertSucceeds(setDoc(doc(coach(), 'catalog/exercises'), { items: [], count: 0, updatedAt: 'x' }));
      await assertFails(setDoc(doc(coach(), 'catalog/exercises'), { items: [], count: 0, updatedAt: 'x', codes: { X: 1 } }), 'no admite campos extra (p. ej. códigos)');
      await assertFails(setDoc(doc(coach(), 'catalog/exercises'), { items: 'no-lista', count: 0, updatedAt: 'x' }));
      await assertFails(setDoc(doc(coach(), 'catalog/otro'), { items: [], count: 0, updatedAt: 'x' }), 'solo existe catalog/exercises');
    });
    test('una cuenta cualquiera no puede escribirlo', async () => {
      const ajeno = env.authenticatedContext('uid-ajeno').firestore();
      await assertFails(updateDoc(doc(ajeno, 'catalog/exercises'), { count: 99 }));
    });
    if (modo === 'transicion') {
      test('en transición, clients sigue como hoy (para no bloquear versiones antiguas)', async () => {
        await assertSucceeds(getDoc(doc(anon(), 'clients/client-a')));
      });
    } else {
      test('en estricta, clients queda cerrado para anónimos', async () => {
        await assertFails(getDoc(doc(anon(), 'clients/client-a')));
      });
    }
  });
}
