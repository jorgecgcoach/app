// C1 — Qué puede hacer un visitante SIN identificarse.
// Se ejecuta dos veces el mismo ataque: con la réplica de las reglas de producción de hoy
// (firestore/produccion-actual.rules) y con las reglas estrictas (firestore.rules).
// Solo emulador y datos ficticios. Ejecutar con: npm run test:seguridad
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } = require('firebase/firestore');

const RULES = {
  actual: fs.readFileSync(path.join(__dirname, 'produccion-actual.rules'), 'utf8'),
  estricta: require('./reglas').leer('firestore.rules')
};

async function seed(env) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'clients/coach_data'), {
      coachCode: 'PIN-FICTICIO',
      codes: { 'COD-A': { client: 'client-a' }, 'COD-B': { client: 'client-b' } },
      exLibrary: [{ n: 'Ejercicio propio', v: 'https://youtu.be/AAAAAAAAAAA', d: '', vc: 'https://youtu.be/BBBBBBBBBBB' }],
      negocio: {
        contracts: [{ id: 1, nombre: 'Cliente Ficticio A', importe: 100 }],
        payments: [{ id: 1, importe: 100 }],
        contacts: [{ id: 1, nombre: 'Contacto Ficticio', telefono: '600000000', correo: 'ficticio@example.com', notas: 'nota' }],
        coachPush: { tokens: ['token-ficticio-coach'] }
      },
      _rev: 3
    });
    await setDoc(doc(db, 'clients/client-a'), { name: 'Cliente Ficticio A', authUid: 'uid-a', salud: { lesion: 'ficticia' }, fotos: ['clients/client-a/photos/p1.jpg'], _rev: 5 });
    await setDoc(doc(db, 'clients/client-b'), { name: 'Cliente Ficticio B', authUid: 'uid-b', _rev: 2 });
  });
}

for (const [modo, rules] of Object.entries(RULES)) {
  test.describe(`visitante anónimo con reglas «${modo}»`, () => {
    let env;
    const ok = modo === 'actual' ? assertSucceeds : assertFails;
    test.before(async () => {
      env = await initializeTestEnvironment({ projectId: 'demo-jcg-exposicion-' + modo, firestore: { rules } });
    });
    test.after(async () => { if (env) await env.cleanup(); });
    test.beforeEach(async () => seed(env));
    const anon = () => env.unauthenticatedContext().firestore();

    test('leer coach_data (PIN, códigos de todos, contratos, pagos, CRM, tokens)', async () => {
      const r = await ok(getDoc(doc(anon(), 'clients/coach_data')));
      if (modo === 'actual') {
        assert.equal(r.get('coachCode'), 'PIN-FICTICIO');
        assert.equal(Object.keys(r.get('codes')).length, 2);
        assert.equal(r.get('negocio').contacts[0].telefono, '600000000');
      }
    });
    test('listar TODAS las fichas sin conocer ningún id', async () => {
      const r = await ok(getDocs(collection(anon(), 'clients')));
      if (modo === 'actual') assert.equal(r.size, 3);
    });
    test('leer la ficha de un cliente (salud, rutas de fotos)', async () => {
      await ok(getDoc(doc(anon(), 'clients/client-a')));
    });
    test('modificar la ficha de otro cliente', async () => {
      await ok(updateDoc(doc(anon(), 'clients/client-b'), { name: 'MODIFICADO' }));
    });
    test('cambiar el PIN del entrenador en coach_data', async () => {
      await ok(updateDoc(doc(anon(), 'clients/coach_data'), { coachCode: 'OTRO' }));
    });
    test('añadirse un código de acceso propio', async () => {
      await ok(updateDoc(doc(anon(), 'clients/coach_data'), { 'codes.COD-INTRUSO': { client: 'client-a' } }));
    });
    test('crear una ficha falsa', async () => {
      await ok(setDoc(doc(anon(), 'clients/falso'), { name: '<img src=x onerror=alert(1)>' }));
    });
    test('borrar la ficha de un cliente', async () => {
      await ok(deleteDoc(doc(anon(), 'clients/client-a')));
    });
    test('borrar coach_data entero', async () => {
      await ok(deleteDoc(doc(anon(), 'clients/coach_data')));
    });
    test('borrado masivo en un solo lote', async () => {
      const db = anon();
      const b = writeBatch(db);
      ['client-a', 'client-b', 'coach_data'].forEach(id => b.delete(doc(db, 'clients/' + id)));
      await ok(b.commit());
    });
    test('fuera de clients sigue cerrado en ambos casos', async () => {
      await assertFails(getDoc(doc(anon(), 'contacts/ct_1')));
      await assertFails(setDoc(doc(anon(), 'otra/x'), { a: 1 }));
    });
  });
}
