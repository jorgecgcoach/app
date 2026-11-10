// El UID del entrenador en las reglas: único, igual en las tres, y en las generadas para desplegar, sin
// marcador. El de verdad entra como entrenador; uno casi igual, una cuenta cualquiera o un cliente, no.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, collection, getDocs } = require('firebase/firestore');
const R = require('./reglas');
const { preparar } = require('../scripts/preparar-reglas');

const reglas = { estricta: R.leer('firestore.rules'), transicion: R.leer('firestore.transicion.rules'), storage: R.leer('storage.rules') };
const UID = R.uidEntrenador(reglas.estricta);
const casi = UID.slice(0, -1) + (UID.slice(-1) === 'a' ? 'b' : 'a');

test('las tres reglas tienen el MISMO UID de entrenador, una sola vez', () => {
  assert.equal(R.uidEntrenador(reglas.transicion), UID);
  assert.equal(R.uidEntrenador(reglas.storage), UID);
});

test('reglas para desplegar: ningún UID de ejemplo y con formato de Firebase', { skip: !R.generadas() && 'solo con las reglas generadas' }, () => {
  for (const [n, t] of Object.entries(reglas)) assert.ok(!t.includes(R.MARCADOR), n + ' sin marcador');
  assert.match(UID, /^[A-Za-z0-9]{28}$/);
  assert.notEqual(UID, R.MARCADOR);
});

test('el repositorio (público) nunca lleva el UID real: solo el marcador', () => {
  const fs = require('fs');
  for (const n of ['firestore.rules', 'firestore.transicion.rules', 'storage.rules']) {
    assert.equal(R.uidEntrenador(fs.readFileSync(path.join(R.ROOT, n), 'utf8')), R.MARCADOR, n);
  }
});

test('preparar-reglas se niega con un UID mal formado o con el marcador', () => {
  const os = require('os');
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reglas-'));
  try {
    const { leerUid } = require('../scripts/preparar-reglas');
    for (const malo of ['corto', 'con espacios dentro del uid 12345', R.MARCADOR, 'abc/def']) {
      const antes = process.argv.slice();
      process.argv = antes.concat(['--uid', malo]);
      try { assert.throws(() => leerUid(), malo); } finally { process.argv = antes; }
    }
    const r = preparar('A'.repeat(28), tmp);
    assert.equal(r.huellas.length, 3);
    for (const n of ['firestore.rules', 'firestore.transicion.rules', 'storage.rules']) assert.ok(!fs.readFileSync(path.join(tmp, n), 'utf8').includes(R.MARCADOR));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'firebase.json'), 'utf8')).firestore, { rules: 'firestore.rules' });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT || 'demo-jcg-seguridad', firestore: { rules: reglas.estricta }, storage: { rules: reglas.storage } });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'clients/coach_data'), { coachCode: 'PIN-FICTICIO', exLibrary: [] });
    await setDoc(doc(db, 'clients/cliA'), { name: 'Ficticio A', authUid: 'uid-a', blocks: [] });
    await ctx.storage().ref('clients/cliA/photos/f1.jpg').putString('foto ficticia', 'raw', { contentType: 'image/jpeg' });
  });
});
test.after(async () => { if (env) await env.cleanup(); });

test('Firestore: el UID de las reglas entra como entrenador SIN claim; uno casi igual o una cuenta cualquiera, no', async () => {
  const coach = env.authenticatedContext(UID).firestore();
  await assertSucceeds(getDoc(doc(coach, 'clients/coach_data')));
  await assertSucceeds(getDocs(collection(coach, 'clients')));
  await assertSucceeds(getDoc(doc(coach, 'clients/cliA')));
  for (const otro of [casi, 'uid-google-ajena', UID.toLowerCase() === UID ? UID.toUpperCase() : UID.toLowerCase()]) {
    const db = env.authenticatedContext(otro).firestore();
    await assertFails(getDoc(doc(db, 'clients/coach_data')));
    await assertFails(getDoc(doc(db, 'clients/cliA')));
  }
  const cliente = env.authenticatedContext('uid-a').firestore();
  await assertSucceeds(getDoc(doc(cliente, 'clients/cliA')));
  await assertFails(getDoc(doc(cliente, 'clients/coach_data')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'clients/coach_data')));
});

test('Storage: el UID de las reglas lee las fotos de un cliente; uno casi igual, no', async () => {
  await assertSucceeds(env.authenticatedContext(UID).storage().ref('clients/cliA/photos/f1.jpg').getMetadata());
  await assertFails(env.authenticatedContext(casi).storage().ref('clients/cliA/photos/f1.jpg').getMetadata());
});
