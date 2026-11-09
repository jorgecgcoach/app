/* Compatibilidad del guardado por transacción (shared/safe-save.js) con las
   reglas ESTRICTAS de firestore.rules. Solo emulador y datos ficticios:
   usa el gestor real (createSync) sobre la API compat que usa index.html. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const S = require('../shared/safe-save');

// Proyecto propio: node --test corre los archivos en paralelo y rules.test.js
// vacía demo-appjorgecgcoach en cada prueba.
const PROJECT = 'demo-jcg-safe-save-rules';

let testEnv;

test.before(async function () {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    }
  });
});

test.after(async function () {
  if (testEnv) await testEnv.cleanup();
});

test.beforeEach(async function () {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async function (ctx) {
    const db = ctx.firestore();
    await db.collection('clients').doc('coach_data').set({
      coachCode: '0000',
      codes: { 'DEMO-1234': { client: 'client-a' } },
      negocio: { payments: [] }
    });
    await db.collection('clients').doc('client-a').set({
      name: 'Cliente Ejemplo A',
      authUid: 'uid-a',
      sessions: [{ id: 's1', date: '2026-01-05', notes: 'inicial' }]
    });
    await db.collection('clients').doc('client-b').set({
      name: 'Cliente Ejemplo B',
      authUid: 'uid-b'
    });
  });
});

/* Un "dispositivo" mínimo: memoria local + gestor real. */
function device(db, name) {
  const local = {};
  const statuses = [];
  const sync = S.createSync({
    db,
    collection: 'clients',
    tabId: name,
    storage: null,
    timeoutMs: 10000,
    getLocal: (id) => local[id],
    applyLocal: (id, doc) => { if (doc) local[id] = S.clone(doc); else delete local[id]; },
    onStatus: (id, s, info) => statuses.push({ id, s, info })
  });
  async function load(id) {
    const snap = await db.collection('clients').doc(id).get();
    const raw = snap.exists ? snap.data() : null;
    sync.setBase(id, raw);
    if (raw) local[id] = S.stripSync(raw);
  }
  return { local, sync, statuses, load };
}

async function serverDoc(id) {
  let data;
  await testEnv.withSecurityRulesDisabled(async function (ctx) {
    const snap = await ctx.firestore().collection('clients').doc(id).get();
    data = snap.exists ? snap.data() : null;
  });
  return data;
}

test('el cliente guarda su propia ficha por transacción y conserva authUid', async function () {
  const db = testEnv.authenticatedContext('uid-a').firestore();
  const dev = device(db, 'tab-cliente');
  await dev.load('client-a');
  dev.local['client-a'].sessions[0].notes = 'editada por el cliente';
  dev.local['client-a'].diet = { kcal: 2000 };
  const res = await dev.sync.save('client-a');
  assert.equal(res.ok, true, JSON.stringify(res));
  const doc = await serverDoc('client-a');
  assert.equal(doc.authUid, 'uid-a');
  assert.equal(doc.sessions[0].notes, 'editada por el cliente');
  assert.deepEqual(doc.diet, { kcal: 2000 });
  assert.equal(doc._rev, 1);
  assert.match(doc._updatedBy, /^tab-cliente~[0-9a-f]{16}~1$/); // marca única por envío
  assert.deepEqual(doc._writers, [doc._updatedBy]);
});

test('el cliente no puede guardar la ficha de otro ni coach_data (error, sin escribir)', async function () {
  const db = testEnv.authenticatedContext('uid-a').firestore();
  const dev = device(db, 'tab-cliente');
  // No puede ni leerlas: simulamos una memoria local manipulada.
  dev.sync.setBase('client-b', { name: 'Cliente Ejemplo B', authUid: 'uid-b' });
  dev.local['client-b'] = { name: 'pisado', authUid: 'uid-b' };
  const r1 = await dev.sync.save('client-b');
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'error');

  dev.sync.setBase('coach_data', { coachCode: '0000' });
  dev.local['coach_data'] = { coachCode: '9999' };
  const r2 = await dev.sync.save('coach_data');
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'error');

  assert.equal((await serverDoc('client-b')).name, 'Cliente Ejemplo B');
  assert.equal((await serverDoc('coach_data')).coachCode, '0000');
  assert.ok(dev.statuses.some((x) => x.s === 'error'));
});

test('el cliente no puede cambiar su authUid aunque lo edite en memoria', async function () {
  const db = testEnv.authenticatedContext('uid-a').firestore();
  const dev = device(db, 'tab-cliente');
  await dev.load('client-a');
  dev.local['client-a'].authUid = 'uid-b';
  const res = await dev.sync.save('client-a');
  assert.equal(res.ok, false);
  assert.equal((await serverDoc('client-a')).authUid, 'uid-a');
});

test('el entrenador crea, edita y guarda coach_data por transacción', async function () {
  const db = testEnv.authenticatedContext('uid-coach', { role: 'coach' }).firestore();
  const dev = device(db, 'tab-coach');
  await dev.load('coach_data');
  await dev.load('client-a');
  await dev.load('client-nuevo');
  dev.local['client-nuevo'] = { name: 'Cliente Nuevo Ficticio', sessions: [] };
  dev.local['client-a'].sessions.push({ id: 's2', date: '2026-01-12', notes: 'coach' });
  dev.local['coach_data'].negocio.payments.push({ id: 'p1', amount: 50 });
  for (const id of ['client-nuevo', 'client-a', 'coach_data']) {
    const res = await dev.sync.save(id);
    assert.equal(res.ok, true, id + ' ' + JSON.stringify(res));
  }
  assert.equal((await serverDoc('client-nuevo')).name, 'Cliente Nuevo Ficticio');
  const a = await serverDoc('client-a');
  assert.equal(a.authUid, 'uid-a');
  assert.deepEqual(a.sessions.map((x) => x.id), ['s1', 's2']);
  const meta = await serverDoc('coach_data');
  assert.equal('authUid' in meta, false);
  assert.deepEqual(meta.negocio.payments, [{ id: 'p1', amount: 50 }]);
});

test('cliente y entrenador editan a la vez la misma ficha sin perder nada', async function () {
  const coachDb = testEnv.authenticatedContext('uid-coach', { role: 'coach' }).firestore();
  const clientDb = testEnv.authenticatedContext('uid-a').firestore();
  const coach = device(coachDb, 'tab-coach');
  const cli = device(clientDb, 'tab-cliente');
  await coach.load('client-a');
  await cli.load('client-a');
  coach.local['client-a'].diet = { kcal: 1800 };
  cli.local['client-a'].sessions[0].notes = 'nota del cliente';
  assert.equal((await coach.sync.save('client-a')).ok, true);
  assert.equal((await cli.sync.save('client-a')).ok, true);
  const doc = await serverDoc('client-a');
  assert.deepEqual(doc.diet, { kcal: 1800 });
  assert.equal(doc.sessions[0].notes, 'nota del cliente');
  assert.equal(doc.authUid, 'uid-a');
  assert.equal(doc._rev, 2);
});

test('tiempo real: el entrenador escucha la colección y el cliente solo su ficha', async function () {
  const coachDb = testEnv.authenticatedContext('uid-coach', { role: 'coach' }).firestore();
  const clientDb = testEnv.authenticatedContext('uid-a').firestore();
  const listen = (q) => new Promise((resolve, reject) => {
    const off = q.onSnapshot((snap) => { off(); resolve(snap); }, (e) => reject(e));
  });
  const all = await listen(coachDb.collection('clients'));
  assert.equal(all.size, 3);
  const own = await listen(clientDb.collection('clients').doc('client-a'));
  assert.equal(own.data().name, 'Cliente Ejemplo A');
  await assert.rejects(listen(clientDb.collection('clients').doc('client-b')));
  await assert.rejects(listen(clientDb.collection('clients')));
});
