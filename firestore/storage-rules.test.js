// C1 — Reglas de Storage (storage.rules, BORRADOR sin desplegar). Solo emulador y datos ficticios.
// Necesita los emuladores de Firestore y Storage a la vez (las reglas consultan clients/{id}.authUid).
// Ejecutar con: npm run test:seguridad
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');

const ROOT = path.join(__dirname, '..');
const JPG = { contentType: 'image/jpeg' };
const PDF = { contentType: 'application/pdf' };
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    // Las reglas de Storage consultan Firestore en el proyecto con el que arrancó el emulador.
    projectId: process.env.GCLOUD_PROJECT || 'demo-jcg-seguridad',
    firestore: { rules: require('./reglas').leer('firestore.rules') },
    storage: { rules: require('./reglas').leer('storage.rules') }
  });
});
test.after(async () => { if (env) await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const s = ctx.storage();
    await setDoc(doc(db, 'clients/client-a'), { name: 'Cliente Ficticio A', authUid: 'uid-a', authUids: ['uid-a', 'uid-a2'] });
    await setDoc(doc(db, 'clients/client-b'), { name: 'Cliente Ficticio B', authUid: 'uid-b' });
    await s.ref('clients/client-a/photos/p1.jpg').putString('foto-ficticia', 'raw', JPG);
    await s.ref('clients/client-a/analitica/a1.pdf').putString('pdf-ficticio', 'raw', PDF);
  });
});

const st = ctx => ctx.storage();
const anon = () => st(env.unauthenticatedContext());
const coach = () => st(env.authenticatedContext('uid-coach', { role: 'coach' }));
const clienteA = () => st(env.authenticatedContext('uid-a'));
const clienteB = () => st(env.authenticatedContext('uid-b'));
const ajeno = () => st(env.authenticatedContext('uid-cuenta-creada-por-un-extraño'));

test('anónimo: no lee, no lista, no sube, no borra', async () => {
  await assertFails(anon().ref('clients/client-a/photos/p1.jpg').getMetadata());
  await assertFails(anon().ref('clients/client-a/analitica/a1.pdf').getMetadata());
  await assertFails(anon().ref('clients/client-a/photos').listAll());
  await assertFails(anon().ref('clients/client-a/photos/x.jpg').putString('x', 'raw', JPG));
  await assertFails(anon().ref('clients/client-a/photos/p1.jpg').delete());
});

test('entrenador: lee, sube y borra en cualquier cliente', async () => {
  await assertSucceeds(coach().ref('clients/client-a/photos/p1.jpg').getMetadata());
  await assertSucceeds(coach().ref('clients/client-b/photos/n.jpg').putString('x', 'raw', JPG));
  await assertSucceeds(coach().ref('clients/client-b/analitica/n.pdf').putString('x', 'raw', PDF));
  await assertSucceeds(coach().ref('clients/client-a/photos/p1.jpg').delete());
});

test('cliente A: su carpeta sí; la de B no', async () => {
  await assertSucceeds(clienteA().ref('clients/client-a/photos/p1.jpg').getMetadata());
  await assertSucceeds(clienteA().ref('clients/client-a/analitica/a1.pdf').getMetadata());
  await assertSucceeds(clienteA().ref('clients/client-a/photos/nueva.jpg').putString('x', 'raw', JPG));
  await assertFails(clienteB().ref('clients/client-a/photos/p1.jpg').getMetadata());
  await assertFails(clienteB().ref('clients/client-a/analitica/a1.pdf').getMetadata());
  await assertFails(clienteB().ref('clients/client-a/photos/intruso.jpg').putString('x', 'raw', JPG));
  await assertFails(clienteB().ref('clients/client-a/photos/p1.jpg').delete());
});

test('cliente A con su segundo código (authUids): también su carpeta, y solo la suya', async () => {
  const a2 = st(env.authenticatedContext('uid-a2'));
  await assertSucceeds(a2.ref('clients/client-a/photos/p1.jpg').getMetadata());
  await assertSucceeds(a2.ref('clients/client-a/photos/otra.jpg').putString('x', 'raw', JPG));
  await assertFails(a2.ref('clients/client-b/photos/x.jpg').putString('x', 'raw', JPG));
});

test('una cuenta cualquiera (no cliente) no ve nada', async () => {
  await assertFails(ajeno().ref('clients/client-a/photos/p1.jpg').getMetadata());
  await assertFails(ajeno().ref('clients/coach_data/photos/x.jpg').putString('x', 'raw', JPG));
});

test('tipo y tamaño: ni ejecutables disfrazados ni archivos enormes', async () => {
  await assertFails(clienteA().ref('clients/client-a/photos/x.jpg').putString('<script>', 'raw', { contentType: 'text/html' }));
  await assertFails(clienteA().ref('clients/client-a/analitica/x.pdf').putString('x', 'raw', JPG));
  const grande = 'x'.repeat(8 * 1024 * 1024 + 10);
  await assertFails(clienteA().ref('clients/client-a/photos/grande.jpg').putString(grande, 'raw', JPG));
});

test('fuera de clients/ todo cerrado, incluso para el entrenador', async () => {
  await assertFails(coach().ref('otra/cosa.jpg').putString('x', 'raw', JPG));
  await assertFails(anon().ref('otra/cosa.jpg').getMetadata());
});

test('H2: un enlace con token se abre sin identificarse aunque las reglas estén cerradas', async () => {
  // Así funciona Firebase: el token del enlace sustituye a las reglas. Por eso, al cerrar Firestore,
  // lo importante es que nadie pueda sacar los enlaces de las fichas.
  const url = await coach().ref('clients/client-a/photos/p1.jpg').getDownloadURL();
  assert.match(url, /token=/);
  const r = await fetch(url);
  assert.equal(r.status, 200, 'el enlace con token funciona sin sesión');
  const sinToken = await fetch(url.replace(/&?token=[^&]+/, ''));
  assert.notEqual(sinToken.status, 200, 'sin token, las reglas lo bloquean');
});
