// Migración de C1 INTERRUMPIDA de verdad (el proceso muere a mitad, como un corte de luz o de red, o cerrar la
// terminal) en tres momentos distintos, y reanudada después. Contra los EMULADORES de Auth y Firestore con las
// reglas estrictas y datos ficticios. Ejecutar con: npm run test:migracion
//   tras-crear    la cuenta de la 3.ª ficha ya existe, pero sin marca ni vínculo
//   tras-marca    la cuenta ya tiene la marca de su ficha, pero sin vínculo
//   tras-vincular la 3.ª ficha ya quedó vinculada (la transacción terminó) y se corta antes de la 4.ª
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Solo con emuladores (npm run test:migracion).');
}
const PROJECT = 'demo-appjorgecgcoach';
process.env.GCLOUD_PROJECT = PROJECT;
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const { applyMigration, CLAIM } = require('./migrate-client-auth');
const { verificarVinculos, cuentasSinVincular } = require('./verificar-vinculos');
const ident = require('../auth/code-identity');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signInWithCustomToken, signOut } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, collection, query, where, getDocs, limit } = require('firebase/firestore');

const db = admin.firestore();
const FICHA = (name, i) => ({
  name, _rev: 4 + i,
  blocks: [{ id: 'b1', label: 'Bloque', cur: true, data: { _logv: 2, log: { ['x' + i + '|0']: { kg: 40 + i, done: true } } } }],
  backRehab: { assessments: [{ id: 'v' + i, date: '2026-11-0' + i }] }, pagos: [{ id: i, importe: 50 }]
});
const SEMILLA = { c1: FICHA('Ficticio Uno', 1), c2: FICHA('Ficticio Dos', 2), c3: FICHA('Ficticio Tres', 3), c4: FICHA('Ficticio Cuatro', 4), demo: { name: 'Demo', blocks: [], _rev: 2 } };
const CODIGOS_VIEJOS = { 'VIEJO-1': { client: 'c1' }, 'VIEJO-2': { client: 'c2' }, 'VIEJO-3': { client: 'c3' }, 'VIEJO-4': { client: 'c4' } };
const REALES = ['c1', 'c2', 'c3', 'c4'];

async function vaciar() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
async function sembrar() {
  await vaciar();
  for (const [cid, f] of Object.entries(SEMILLA)) await db.collection('clients').doc(cid).set(f);
  await db.collection('clients').doc('coach_data').set({ coachCode: 'PIN-FICTICIO', codes: CODIGOS_VIEJOS, _rev: 3 });
}
const ficha = async cid => (await db.collection('clients').doc(cid).get()).data();
const meta = async () => (await db.collection('clients').doc('coach_data').get()).data();
const cuentasCliente = async () => (await admin.auth().listUsers()).users.filter(u => (u.email || '').endsWith('@' + ident.DOMAIN));

// La migración real en OTRO proceso que muere de golpe (process.exit, sin limpiar nada) en el momento pedido.
const CORTADA = `
  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const n0 = Number(process.env.CORTE_N); let n = 0;
  const morir = () => { if (++n === n0) process.exit(137); };
  const auth = admin.auth(), db = admin.firestore();
  if (process.env.CORTE === 'tras-crear') { const o = auth.createUser.bind(auth); auth.createUser = async u => { const r = await o(u); morir(); return r; }; }
  if (process.env.CORTE === 'tras-marca') { const o = auth.setCustomUserClaims.bind(auth); auth.setCustomUserClaims = async (a, b) => { const r = await o(a, b); morir(); return r; }; }
  if (process.env.CORTE === 'tras-vincular') { const o = db.runTransaction.bind(db); db.runTransaction = async (f, x) => { const r = await o(f, x); morir(); return r; }; }
  require('./migrate-client-auth').applyMigration().then(() => process.exit(0), e => { console.error(e && e.message); process.exit(1); });
`;
function migracionCortada(corte, n) {
  const r = spawnSync(process.execPath, ['-e', CORTADA], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { CORTE: corte, CORTE_N: String(n) }) });
  return r.status;
}

let napp = 0;
async function comoCliente(entrar, fn) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, 'i' + (napp++));
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const cdb = getFirestore(app);
  const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(cdb, h, Number(p));
  try { const cred = await entrar(auth); return await fn(cdb, cred.user.uid); }
  finally { try { await signOut(auth); } catch (_) {} await deleteApp(app); }
}
const conCodigo = code => async auth => signInWithEmailAndPassword(auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code));
async function miFicha(cdb, uid) {
  let q = await getDocs(query(collection(cdb, 'clients'), where('authUid', '==', uid), limit(1)));
  if (q.empty) q = await getDocs(query(collection(cdb, 'clients'), where('authUids', 'array-contains', uid), limit(1)));
  return q.empty ? null : q.docs[0];
}

for (const [corte, hechasAntes, huerfanas] of [['tras-crear', 2, 1], ['tras-marca', 2, 1], ['tras-vincular', 3, 0]]) {
  test(`migración cortada ${corte}: se reanuda sin duplicar cuentas, sin cambiar códigos ya dados y sin perder datos`, async () => {
    await sembrar();
    assert.equal(migracionCortada(corte, 3), 137, 'el proceso murió a mitad');

    // Estado a medias: las fichas ya hechas tienen su código y su cuenta; el resto sigue como estaba.
    const antes = {};
    for (const cid of REALES) antes[cid] = await ficha(cid);
    const hechas = REALES.filter(cid => antes[cid].authUid);
    assert.equal(hechas.length, hechasAntes);
    for (const cid of REALES.filter(c => !hechas.includes(c))) {
      assert.equal(antes[cid].code, undefined); assert.equal(antes[cid].authUid, undefined);
    }
    assert.equal((await cuentasCliente()).length, hechasAntes + huerfanas);

    // Reanudar: la misma orden otra vez.
    const r = await applyMigration();
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.revisar, []);
    assert.equal(r.yaHechas, hechasAntes, 'las ya hechas no se repiten');
    assert.equal(r.migradas, REALES.length - hechasAntes);

    const m = await meta();
    for (const cid of REALES) {
      const f = await ficha(cid);
      if (hechas.includes(cid)) {
        assert.equal(f.code, antes[cid].code, cid + ': el código ya creado NO cambia');
        assert.equal(f.authUid, antes[cid].authUid, cid + ': la cuenta ya creada NO cambia');
      }
      assert.deepEqual(f.authUids, [f.authUid], cid + ': una sola cuenta vinculada');
      assert.deepEqual(m.codes[f.code], { client: cid });
      assert.equal((await admin.auth().getUser(f.authUid)).customClaims[CLAIM], cid);
      // Nada de lo demás cambia.
      for (const k of ['name', 'blocks', 'backRehab', 'pagos']) assert.deepEqual(f[k], SEMILLA[cid][k], cid + ': ' + k + ' intacto');
      assert.equal(await comoCliente(conCodigo(f.code), async (cdb, uid) => (await miFicha(cdb, uid)).id), cid);
    }
    assert.equal(Object.keys(m.codes).length, REALES.length, 'un código por ficha real; ni viejos ni de cuentas a medias');
    Object.keys(CODIGOS_VIEJOS).forEach(k => assert.equal(m.codes[k], undefined));
    assert.deepEqual(await ficha('demo'), SEMILLA.demo, 'demo sin tocar');

    // Cuentas: una por ficha + la que quedó a medias (si la hubo). Esa no da acceso a nada.
    assert.equal((await cuentasCliente()).length, REALES.length + huerfanas);
    const s = await cuentasSinVincular(admin);
    assert.deepEqual(s, { cuentasDeCliente: REALES.length + huerfanas, sinVincular: huerfanas });
    if (huerfanas) {
      const vinculadas = new Set();
      for (const cid of REALES) vinculadas.add((await ficha(cid)).authUid);
      const huerfana = (await cuentasCliente()).find(u => !vinculadas.has(u.uid));
      const token = await admin.auth().createCustomToken(huerfana.uid);
      await comoCliente(auth => signInWithCustomToken(auth, token), async (cdb, uid) => {
        assert.equal(await miFicha(cdb, uid), null, 'la cuenta a medias no encuentra ficha');
        for (const cid of REALES.concat('coach_data', 'demo')) await assert.rejects(getDoc(doc(cdb, 'clients/' + cid)), 'ni puede leer ' + cid);
      });
    }
    assert.deepEqual((await verificarVinculos(admin)).problemas, []);

    // Una tercera vez no cambia nada.
    const fotos = {}; for (const cid of REALES) fotos[cid] = await ficha(cid);
    const r3 = await applyMigration();
    assert.equal(r3.migradas, 0); assert.equal(r3.yaHechas, REALES.length);
    for (const cid of REALES) assert.deepEqual(await ficha(cid), fotos[cid]);
    assert.equal((await cuentasCliente()).length, REALES.length + huerfanas);
  });
}
