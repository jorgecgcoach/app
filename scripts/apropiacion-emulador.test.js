// ¿Puede alguien apropiarse de una ficha creando antes una cuenta, aunque conozca el código? Y: ¿la migración
// deja códigos en pantalla o en archivos? Contra los EMULADORES de Auth y Firestore con las reglas estrictas.
// Datos ficticios. Se ejecuta dentro de: npm run test:migracion
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Solo con emuladores (npm run test:migracion).');
}
const PROJECT = 'demo-appjorgecgcoach';
process.env.GCLOUD_PROJECT = PROJECT;
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const { applyMigration, simularAislamiento, formatSimulacion } = require('./migrate-client-auth');
const { verificarVinculos } = require('./verificar-vinculos');
const ident = require('../auth/code-identity');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } = require('firebase/firestore');

const ROOT = path.join(__dirname, '..');
const db = admin.firestore();
const FICHA = (name, extra) => Object.assign({ name, blocks: [{ id: 'b1', label: 'Bloque', cur: true, data: { log: {} } }], _rev: 1 }, extra || {});

async function vaciar() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
async function sembrar(fichas) {
  await vaciar();
  for (const [cid, f] of Object.entries(fichas)) await db.collection('clients').doc(cid).set(f);
  await db.collection('clients').doc('coach_data').set({ codes: {}, _rev: 1 });
}
const ficha = async cid => (await db.collection('clients').doc(cid).get()).data();

let n = 0;
function clienteSdk() {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, 'a' + (n++));
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const cdb = getFirestore(app);
  const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(cdb, h, Number(p));
  return { app, auth, cdb, cerrar: async () => { try { await signOut(auth); } catch (_) {} await deleteApp(app); } };
}
// Lo que haría un atacante desde el navegador: alta pública con el correo y la contraseña que salen del código.
async function intrusoConCodigo(code) {
  const s = clienteSdk();
  const cred = await createUserWithEmailAndPassword(s.auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code));
  return Object.assign(s, { uid: cred.user.uid });
}
async function entraConCodigo(code) {
  const s = clienteSdk();
  const cred = await signInWithEmailAndPassword(s.auth, await ident.clientEmailFromCode(code), ident.clientPasswordFromCode(code));
  return Object.assign(s, { uid: cred.user.uid });
}
async function noPuede(promesa, que) { await assert.rejects(promesa, e => /permission|PERMISSION_DENIED/i.test(String(e && (e.code || e.message))), que); }

test('se adelanta creando la cuenta del código que tendrá la víctima: la migración no la usa y el intruso no ve nada', async () => {
  await sembrar({ victima: FICHA('Víctima ficticia'), otra: FICHA('Otra ficticia') });
  const code = ident.generateClientCode();
  const intruso = await intrusoConCodigo(code);
  try {
    let i = 0;
    const r = await applyMigration({ generar: () => (i++ === 0 ? code : ident.generateClientCode()) });
    assert.equal(r.revisar.length, 1);
    assert.equal(r.revisar[0].motivo, 'ya-existia-una-cuenta-para-el-codigo');
    const afectada = r.revisar[0].clientId;
    assert.equal((await ficha(afectada)).authUid, undefined);
    // El intruso no lee ninguna ficha, ni el meta, ni puede listar.
    for (const cid of ['victima', 'otra', 'coach_data']) await noPuede(getDoc(doc(intruso.cdb, 'clients/' + cid)), 'leer ' + cid);
    await noPuede(getDocs(collection(intruso.cdb, 'clients')), 'listar');
    const mias = await getDocs(query(collection(intruso.cdb, 'clients'), where('authUids', 'array-contains', intruso.uid)));
    assert.equal(mias.size, 0);
    // Ni puede ponerse como dueño de una ficha ni crearse una.
    await noPuede(updateDoc(doc(intruso.cdb, 'clients/' + afectada), { authUids: [intruso.uid] }), 'apropiarse');
    await noPuede(updateDoc(doc(intruso.cdb, 'clients/' + afectada), { authUid: intruso.uid }), 'apropiarse (authUid)');
    await noPuede(setDoc(doc(intruso.cdb, 'clients/nueva-del-intruso'), { name: 'x', authUids: [intruso.uid] }), 'crear ficha');
    await noPuede(updateDoc(doc(intruso.cdb, 'clients/coach_data'), { codes: { [code]: { client: afectada } } }), 'escribir códigos');
    // Su cuenta no se ha tocado (ni borrada ni desactivada).
    assert.equal((await admin.auth().getUser(intruso.uid)).disabled, false);
  } finally { await intruso.cerrar(); }
});

test('cuenta ajena escrita en la ficha con las reglas abiertas: sin --aislar conserva el acceso (por eso existe); con --aislar lo pierde, sin borrar nada', async () => {
  await sembrar({ victima: FICHA('Víctima ficticia') });
  const intruso = await intrusoConCodigo(ident.generateClientCode());
  try {
    // Simula lo que alguien pudo escribir ANTES de F4, cuando cualquiera podía escribir en las fichas.
    await db.collection('clients').doc('victima').update({ authUids: [intruso.uid] });
    assert.equal((await getDoc(doc(intruso.cdb, 'clients/victima'))).exists(), true, 'con reglas estrictas, la ficha confía en authUids');
    const r1 = await applyMigration();
    assert.deepEqual(r1.revisar, [{ clientId: 'victima', motivo: 'ya-tiene-cuentas-no-verificadas' }]);
    assert.equal((await getDoc(doc(intruso.cdb, 'clients/victima'))).exists(), true, 'sin --aislar sigue entrando');
    const v = await verificarVinculos(admin);
    assert.ok(v.problemas.some(p => p.ficha === 'victima'), 'verificar-vinculos lo señala');

    // Sin simulación previa (o con otra huella) no se aísla nada.
    await assert.rejects(applyMigration({ aislar: true }), e => e.code === 'AISLAR_SIN_CONFIRMAR');
    await assert.rejects(applyMigration({ aislar: true, confirmarAislar: '000000000000' }), e => e.code === 'AISLAR_SIN_CONFIRMAR');
    assert.deepEqual((await ficha('victima')).authUids, [intruso.uid], 'nada aplicado');
    const sim = await simularAislamiento(admin);
    assert.equal(sim.totalFichas, 1);
    assert.equal(sim.totalCuentas, 1);
    assert.deepEqual(sim.fichas[0].cuentas[0].motivos, ['sin-marca']);
    const r2 = await applyMigration({ aislar: true, confirmarAislar: sim.huella });
    assert.deepEqual(r2.revisar, [{ clientId: 'victima', motivo: 'cuentas-no-verificadas-aisladas' }]);
    await noPuede(getDoc(doc(intruso.cdb, 'clients/victima')), 'aislado ya no lee');
    const f = await ficha('victima');
    assert.deepEqual(f.authUids, []);
    assert.equal(f.authUid, undefined);
    assert.deepEqual(f.cuentasEnRevision, [intruso.uid], 'queda anotada para revisarla');
    assert.equal(f.code, undefined, 'no se migra');
    assert.equal((await admin.auth().getUser(intruso.uid)).disabled, false, 'la cuenta no se toca');
    // Repetir no la migra ni la reasigna: sigue a revisar.
    const r3 = await applyMigration();
    assert.deepEqual(r3.revisar, [{ clientId: 'victima', motivo: 'cuentas-aisladas-en-revision' }]);
    assert.equal(r3.migradas, 0);
  } finally { await intruso.cerrar(); }
});

test('--aislar solo en la primera ejecución: luego podría quitar el acceso a cuentas buenas creadas desde la app', async () => {
  await sembrar({ c1: FICHA('Uno ficticio') });
  await applyMigration();
  const sim = await simularAislamiento(admin);
  assert.equal(sim.permitido, false);
  await assert.rejects(applyMigration({ aislar: true, confirmarAislar: sim.huella }), e => e.code === 'AISLAR_SOLO_PRIMERA_VEZ');
});

test('simulación de --aislar: cuenta fichas y cuentas, explica por qué, y no muestra uids ni cambia nada', async () => {
  await sembrar({});
  const intruso = await intrusoConCodigo(ident.generateClientCode());
  try {
    await db.collection('clients').doc('c1').set(FICHA('Uno ficticio', { authUids: [intruso.uid, 'uid-inexistente-ficticio'] }));
    await db.collection('clients').doc('c2').set(FICHA('Dos ficticio', { authUid: intruso.uid }));
    await db.collection('clients').doc('c3').set(FICHA('Tres ficticio'));
    const antes = JSON.stringify((await db.collection('clients').get()).docs.map(d => [d.id, d.data()]));
    const sim = await simularAislamiento(admin);
    assert.equal(sim.totalFichas, 2);
    assert.equal(sim.totalCuentas, 2, 'la misma cuenta en dos fichas cuenta una vez');
    const c1 = sim.fichas.find(x => x.clientId === 'c1');
    assert.ok(c1.cuentas.some(c => !c.existe && c.motivos.includes('no-existe')));
    assert.ok(c1.cuentas.some(c => c.existe && c.motivos.includes('en-2-fichas') && c.motivos.includes('sin-marca')));
    const texto = formatSimulacion(sim);
    assert.match(texto, /Fichas que perderían el acceso de sus cuentas: 2/);
    assert.match(texto, /--confirmar-aislar=[0-9a-f]{12}/);
    for (const secreto of [intruso.uid, 'uid-inexistente-ficticio', 'Uno ficticio', '@']) assert.equal(texto.includes(secreto), false);
    assert.equal(JSON.stringify((await db.collection('clients').get()).docs.map(d => [d.id, d.data()])), antes, 'solo lee');
    // Si algo cambia entre la simulación y la aplicación, no se aplica nada.
    await db.collection('clients').doc('c3').update({ authUids: ['uid-plantado-despues'] });
    await assert.rejects(applyMigration({ aislar: true, confirmarAislar: sim.huella }), e => e.code === 'AISLAR_SIN_CONFIRMAR');
    assert.deepEqual((await ficha('c2')).authUid, intruso.uid, 'nada aplicado');
  } finally { await intruso.cerrar(); }
});

test('conoce el código de otro cliente ya migrado: entra (el código es la llave), pero no puede quedarse con la ficha', async () => {
  await sembrar({ victima: FICHA('Víctima ficticia') });
  await applyMigration();
  const f0 = await ficha('victima');
  const intruso = await entraConCodigo(f0.code);
  try {
    assert.equal(intruso.uid, f0.authUid);
    // Cambia la contraseña para echar al cliente, e intenta añadir otra cuenta suya o cambiar el código.
    await updatePassword(intruso.auth.currentUser, 'clave-ficticia-del-intruso');
    await noPuede(updateDoc(doc(intruso.cdb, 'clients/victima'), { authUids: [f0.authUid, 'uid-del-intruso'] }), 'añadir cuenta');
    await noPuede(updateDoc(doc(intruso.cdb, 'clients/victima'), { code: 'OTRO' }), 'cambiar código');
    // El entrenador regenera el código (lo que hace la app: cuenta nueva y authUids = [solo la nueva]).
    const nuevo = ident.generateClientCode();
    const u = await admin.auth().createUser({ email: await ident.clientEmailFromCode(nuevo), password: ident.clientPasswordFromCode(nuevo) });
    await db.collection('clients').doc('victima').update({ code: nuevo, authUid: u.uid, authUids: [u.uid] });
    // La sesión del intruso sigue abierta, pero ya no le da acceso.
    await noPuede(getDoc(doc(intruso.cdb, 'clients/victima')), 'tras regenerar');
    const cliente = await entraConCodigo(nuevo);
    try { assert.equal((await getDoc(doc(cliente.cdb, 'clients/victima'))).exists(), true); } finally { await cliente.cerrar(); }
  } finally { await intruso.cerrar(); }
});

test('superficie conocida del alta pública: una cuenta cualquiera solo puede leer el catálogo de ejercicios', async () => {
  await sembrar({ c1: FICHA('Uno ficticio') });
  await db.collection('catalog').doc('exercises').set({ items: [] });
  const s = clienteSdk();
  try {
    await createUserWithEmailAndPassword(s.auth, 'cualquiera-ficticio@example.com', 'clave-ficticia-1');
    assert.equal((await getDoc(doc(s.cdb, 'catalog/exercises'))).exists(), true, 'si esto cambia, actualizar docs/despliegue-c1.md');
    await noPuede(getDoc(doc(s.cdb, 'clients/c1')), 'ficha');
    await noPuede(getDoc(doc(s.cdb, 'clients/coach_data')), 'meta');
    await noPuede(getDocs(collection(s.cdb, 'clients')), 'listar');
    await noPuede(setDoc(doc(s.cdb, 'catalog/exercises'), { items: [1] }), 'escribir catálogo');
  } finally { await s.cerrar(); }
});

function listarArchivos(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name), rel = path.relative(base, p);
    if (e.isDirectory()) out.push(...listarArchivos(p, base));
    else if (!/\.log$/.test(e.name)) out.push(rel + ':' + fs.statSync(p).size);
  }
  return out.sort();
}

test('la migración por consola no muestra ni escribe códigos, correos, uids ni nombres, y no crea archivos', async () => {
  await sembrar({ c1: FICHA('Nombre Ficticio Uno'), c2: FICHA('Nombre Ficticio Dos'), c3: FICHA('Nombre Ficticio Tres', { authUids: ['uid-plantado-ficticio'] }) });
  const antes = listarArchivos(ROOT, ROOT);
  const env = Object.assign({}, process.env);
  const ejecutar = args => spawnSync(process.execPath, [path.join(__dirname, 'migrate-client-auth.js'), ...args], { env, encoding: 'utf8', cwd: ROOT });
  const simulacion = ejecutar(['--simular-aislar']);
  assert.equal(simulacion.status, 0, simulacion.stderr);
  const huella = (simulacion.stdout.match(/Huella de este conjunto: ([0-9a-f]{12})/) || [])[1];
  assert.ok(huella, 'la simulación da la huella');
  const sinConfirmar = ejecutar(['--apply', '--aislar']);
  const otraHuella = ejecutar(['--apply', '--aislar', '--confirmar-aislar=000000000000']);
  assert.equal(sinConfirmar.status, 2);
  assert.equal(otraHuella.status, 2);
  assert.deepEqual((await ficha('c3')).authUids, ['uid-plantado-ficticio'], 'sin confirmar no se toca nada');
  assert.equal((await ficha('c1')).code, undefined, 'ni se migra nada');
  const salidas = [simulacion, sinConfirmar, otraHuella, ejecutar(['--comprobar']), ejecutar(['--apply', '--aislar', '--confirmar-aislar=' + huella]), ejecutar(['--apply']), ejecutar(['--comprobar'])];
  assert.equal(salidas[4].status, 3, 'termina con 3: hay una ficha a revisar');
  assert.deepEqual((await ficha('c3')).cuentasEnRevision, ['uid-plantado-ficticio']);
  const texto = salidas.map(s => s.stdout + '\n' + s.stderr).join('\n');
  const secretos = ['Nombre Ficticio', 'uid-plantado-ficticio', '@clients.appjorgecgcoach.app', 'Jcg#1'];
  for (const cid of ['c1', 'c2']) {
    const f = await ficha(cid);
    assert.ok(ident.isStrongCode(f.code));
    secretos.push(f.code, f.code.replace(/-/g, ''), f.authUid, await ident.clientEmailFromCode(f.code));
  }
  for (const s of secretos) assert.equal(texto.includes(s), false, 'aparece en la salida un dato que no debe');
  assert.match(texto, /No se han impreso/);
  assert.deepEqual(listarArchivos(ROOT, ROOT), antes, 'no se ha creado ni cambiado ningún archivo');
});
