// ¿Conservan la migración y las reglas estrictas TODO lo que hay en las fichas y en el negocio?
// Valoraciones, pruebas de carga, entrenamientos con series, dietas, menús, formularios, pesos, pagos,
// contratos, contactos, biblioteca y plantillas. Emuladores de Auth y Firestore con las reglas estrictas.
// Datos ficticios. Se ejecuta dentro de: npm run test:migracion
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Solo con emuladores (npm run test:migracion).');
}
const PROJECT = 'demo-appjorgecgcoach';
process.env.GCLOUD_PROJECT = PROJECT;
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const { applyMigration } = require('./migrate-client-auth');
const ident = require('../auth/code-identity');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc } = require('firebase/firestore');

const db = admin.firestore();
// Campos que la migración AÑADE o actualiza a propósito. Todo lo demás debe quedar idéntico.
const DE_LA_MIGRACION = ['code', 'authUid', 'authUids', '_rev', '_updatedAt', '_updatedBy', '_writers'];
const sin = (o, campos) => { const c = JSON.parse(JSON.stringify(o)); campos.forEach(k => delete c[k]); return c; };

const VALORACION = { id: 'as_ficticia', date: '2026-11-11', createdAt: 1, updatedAt: 2,
  data: { importantActivities: ['caminar 30 min'], dolor: { actual: 3, peor: 6 }, notas: 'Valoración ficticia' } };
const FICHA = () => ({
  name: 'Cliente Ficticio', serviceType: 'premium', mods: { semana: true, valoracion: true }, notifs: { a: 1 },
  pagos: [{ id: 1, importe: 50, fecha: '2026-11-01' }],
  backRehab: { assessments: [VALORACION], loadTests: [{ id: 'lt1', date: '2026-11-11', kg: 40 }] },
  blocks: [{ id: 'b1', label: 'Bloque ficticio', cur: true, _logv: 2,
    data: { log: { 'w1|d1|e1': [{ kg: 60, reps: 8, rpe: 7 }, { kg: 62.5, reps: 8 }] }, notes: { e1: 'nota ficticia' } } }],
  dietRecs: [{ id: 'd1', texto: 'Dieta ficticia' }], menus: [{ id: 'm1', dias: [{ comida: 'Menú ficticio' }] }],
  fichas: { inicial: { respuestas: { objetivo: 'ficticio' } } }, weightSnapshots: [{ date: '2026-11-11', kg: 80 }],
  _rev: 7
});
const META = () => ({
  coachCode: 'PIN-FICTICIO', codes: {},
  exLibrary: [{ n: 'Sentadilla ficticia', v: 'https://example.invalid/v' }],
  templates: { workouts: [{ id: 't1' }], diets: [{ id: 'td1' }] },
  negocio: { contracts: [{ id: 95, estado: 'activo' }], payments: [{ id: 143, importe: 120 }], contacts: [{ id: 1, nombre: 'Contacto ficticio' }] },
  _rev: 40
});

async function vaciar() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
const leer = async id => (await db.collection('clients').doc(id).get()).data();
let n = 0;
async function comoCliente(code, fn) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, 'conservacion' + (n++));
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const cdb = getFirestore(app);
  const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(cdb, h, Number(p));
  try {
    await signInWithEmailAndPassword(auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code));
    return await fn(cdb);
  } finally { try { await signOut(auth); } catch (_) {} await deleteApp(app); }
}

test('la migración no toca valoraciones, entrenamientos, series, dietas ni negocio', async () => {
  await vaciar();
  await db.collection('clients').doc('cli').set(FICHA());
  await db.collection('clients').doc('coach_data').set(META());
  const r = await applyMigration();
  assert.equal(r.revisar.length, 0);
  const ficha = await leer('cli');
  assert.ok(ident.isStrongCode(ficha.code), 'tiene su código nuevo');
  assert.deepEqual(sin(ficha, DE_LA_MIGRACION), sin(FICHA(), DE_LA_MIGRACION), 'el resto de la ficha, idéntico');
  assert.equal(ficha._rev, 8, 'la migración sube _rev en uno (guardia _rev)');
  const meta = await leer('coach_data');
  assert.deepEqual(sin(meta, DE_LA_MIGRACION.concat('codes')), sin(META(), DE_LA_MIGRACION.concat('codes')), 'negocio, biblioteca, plantillas y PIN, idénticos');
  assert.deepEqual(Object.values(meta.codes).map(c => c.client), ['cli']);
});

test('con las reglas estrictas el cliente registra series sin perder la valoración, y una versión vieja no la pisa', async () => {
  const code = (await leer('cli')).code;
  await comoCliente(code, async cdb => {
    const ref = doc(cdb, 'clients/cli');
    const actual = (await getDoc(ref)).data();
    assert.deepEqual(actual.backRehab.assessments[0], VALORACION, 'el cliente ve su ficha completa');
    // Registra una serie nueva (como el guardado seguro: _rev + 1).
    const blocks = JSON.parse(JSON.stringify(actual.blocks));
    blocks[0].data.log['w1|d1|e1'].push({ kg: 65, reps: 6 });
    await updateDoc(ref, { blocks, _rev: actual._rev + 1 });
    // Una pestaña con datos viejos (sin la valoración) intenta guardar con su _rev antiguo: rechazado.
    await assert.rejects(updateDoc(ref, { backRehab: { assessments: [], loadTests: [] }, _rev: actual._rev + 1 }), /permission/i);
    await assert.rejects(updateDoc(ref, { backRehab: { assessments: [], loadTests: [] } }), /permission/i);
    // No puede leer ni escribir el negocio.
    await assert.rejects(getDoc(doc(cdb, 'clients/coach_data')), /permission/i);
    await assert.rejects(updateDoc(doc(cdb, 'clients/coach_data'), { negocio: {}, _rev: 41 }), /permission/i);
  });
  const ficha = await leer('cli');
  assert.equal(ficha.blocks[0].data.log['w1|d1|e1'].length, 3, 'la serie nueva está');
  assert.deepEqual(ficha.backRehab, FICHA().backRehab, 'valoración y pruebas de carga intactas');
  assert.deepEqual(ficha.dietRecs, FICHA().dietRecs);
  assert.deepEqual(ficha.menus, FICHA().menus);
  assert.deepEqual(sin(await leer('coach_data'), DE_LA_MIGRACION.concat('codes')), sin(META(), DE_LA_MIGRACION.concat('codes')), 'negocio intacto');
});
