// Copia → cambios y pérdidas → restauración, contra el emulador de Firestore. Datos ficticios.
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Solo con emulador (npm run test:migracion).');
const { iniciar } = require('./firebase-admin-init');
const { admin } = iniciar({});
const db = admin.firestore();
const lib = require('./copia-lib');
const { descargar } = require('./copia-firestore');
const { restaurar } = require('./restaurar-copia');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-appjorgecgcoach';
let copia;

test.before(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await db.doc('clients/coach_data').set({ coachCode: 'PIN-FICTICIO', codes: { 'COD-A': { client: 'ca' } }, negocio: { payments: [{ id: 'p1' }, { id: 'p2' }], contracts: [{ id: 1 }] }, templates: { workouts: [], diets: [] }, exLibrary: [], _split: true });
  await db.doc('clients/ca').set({ name: 'Ficticio A', blocks: [{ id: 'b1', data: { log: { x: 1 } } }, { id: 'b2' }], _rev: 3 });
  await db.doc('clients/cb').set({ name: 'Ficticio B', blocks: [], _rev: 1 });
  await db.doc('catalog/exercises').set({ items: [], count: 0, updatedAt: 'x' });
  copia = lib.construirCopia(await descargar(db));
});

test('la copia descargada del emulador es íntegra y completa', () => {
  const v = lib.verificar(JSON.parse(JSON.stringify(copia)));
  assert.equal(v.ok, true, v.problemas.join());
  assert.equal(v.resumen.fichas, 2);
  assert.equal(v.resumen.pagos, 2);
});

test('simulacro: dice lo que repondría y no escribe nada', async () => {
  await db.doc('clients/cb').delete();
  await db.doc('clients/ca').set({ name: 'Cambiado después', blocks: [{ id: 'b1', data: { log: { x: 7 } } }, { id: 'b9' }], _rev: 5 });
  await db.doc('clients/coach_data').update({ coachCode: 'PIN-NUEVO', codes: {}, 'negocio.payments': [{ id: 'p1' }, { id: 'p3' }] });
  const inf = await restaurar(db, copia, { apply: false });
  assert.equal(inf.documentosNuevos, 1);
  assert.ok(inf.documentosConAñadidos >= 2);
  assert.equal((await db.doc('clients/cb').get()).exists, false);
  assert.ok(!inf.cambios.join('\n').includes('Ficticio'));
});

test('aplicar: repone lo perdido, respeta lo posterior y no revive el PIN ni los códigos', async () => {
  await restaurar(db, copia, { apply: true });
  const cb = (await db.doc('clients/cb').get()).data();
  assert.equal(cb.name, 'Ficticio B');
  const ca = (await db.doc('clients/ca').get()).data();
  assert.equal(ca.name, 'Cambiado después');
  assert.deepEqual(ca.blocks.map(b => b.id), ['b1', 'b9', 'b2']);
  assert.equal(ca.blocks[0].data.log.x, 7);
  assert.equal(ca._rev, 6, 'sube _rev: los dispositivos abiertos recargan en vez de pisar');
  const meta = (await db.doc('clients/coach_data').get()).data();
  assert.equal(meta.coachCode, 'PIN-NUEVO');
  assert.deepEqual(meta.codes, {});
  assert.deepEqual(meta.negocio.payments.map(p => p.id), ['p1', 'p3', 'p2']);
});

test('repetir la restauración no cambia nada más', async () => {
  const inf = await restaurar(db, copia, { apply: true });
  assert.equal(inf.documentosNuevos + inf.documentosConAñadidos, 0);
});
