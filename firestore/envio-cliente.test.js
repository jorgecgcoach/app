/* C1 — Lo que ENVÍA la app del cliente, con el guardado seguro real y las reglas ESTRICTAS.
   Regresión del fallo encontrado el 11-11-2026: la app rellena por defecto en memoria los tipos de aviso
   que faltan en una ficha antigua (clientNotifs). Si ese relleno viaja, las reglas rechazan la escritura
   ENTERA y el cliente no guarda ni sus series. shared/campos-cliente.js lo evita.
   Emulador y datos ficticios. npm run test:seguridad */
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const S = require('../shared/safe-save');
const CF = require('../shared/campos-cliente');
const reglas = require('./reglas');

let env;
test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-jcg-envio-cliente', firestore: { rules: reglas.leer('firestore.rules') } }); });
test.after(async () => { if (env) await env.cleanup(); });

const FICHA_ANTIGUA = () => ({
  name: 'Cliente Ficticio A', code: 'COD-A', authUid: 'uid-a', pagos: [{ id: 1, importe: 60 }], serviceType: 'training',
  mods: { semana: true }, notifs: { seguimiento: { mode: 'auto' } },
  blocks: [{ id: 'b1', data: { _logv: 2, log: {} } }]
});
async function sembrar(ficha) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => { await ctx.firestore().collection('clients').doc('client-a').set(ficha || FICHA_ANTIGUA()); });
}
async function servidor() {
  let d; await env.withSecurityRulesDisabled(async ctx => { d = (await ctx.firestore().collection('clients').doc('client-a').get()).data(); }); return d;
}
// Dispositivo del cliente: memoria + gestor real. conGuarda = lo que hace index.html (getLocal con limitarEnvio).
function cliente(conGuarda) {
  const db = env.authenticatedContext('uid-a').firestore();
  const local = {};
  let sync = null;
  sync = S.createSync({
    db, collection: 'clients', tabId: 'tab-cliente', storage: null, timeoutMs: 10000,
    getLocal: id => (local[id] === undefined ? undefined : (conGuarda ? CF.limitarEnvio(local[id], sync.baseOf(id)) : local[id])),
    applyLocal: (id, doc) => { if (doc) local[id] = S.clone(doc); else delete local[id]; },
    onStatus: () => {}
  });
  return {
    local, sync,
    async cargar() { const raw = (await db.collection('clients').doc('client-a').get()).data(); sync.setBase('client-a', raw); local['client-a'] = S.stripSync(raw); }
  };
}
// Lo que hace la app al pintar: añade los tipos de aviso que faltan y los módulos nuevos.
function rellenoDeLaApp(c) {
  Object.assign(c.notifs, { habitos: { mode: 'everyN', n: 2 }, rehab: { mode: 'off' }, medidas: { mode: 'off' } });
  c.mods.programa = false; c.mods.carga = false;
}

test('SIN la guarda: el relleno de avisos hace que las reglas rechacen también la serie (el fallo)', async () => {
  await sembrar();
  const d = cliente(false); await d.cargar();
  rellenoDeLaApp(d.local['client-a']);
  d.local['client-a'].blocks[0].data.log['e1|0'] = { kg: '40', reps: '8' };
  const r = await d.sync.save('client-a');
  assert.equal(r.ok, false);
  assert.deepEqual((await servidor()).blocks[0].data.log, {}, 'la serie no llegó');
});

test('CON la guarda: la serie se guarda y los avisos y módulos del entrenador quedan como estaban', async () => {
  await sembrar();
  const d = cliente(true); await d.cargar();
  rellenoDeLaApp(d.local['client-a']);
  d.local['client-a'].blocks[0].data.log['e1|0'] = { kg: '40', reps: '8' };
  const r = await d.sync.save('client-a');
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = await servidor();
  assert.deepEqual(s.blocks[0].data.log['e1|0'], { kg: '40', reps: '8' });
  assert.deepEqual(s.notifs, { seguimiento: { mode: 'auto' } });
  assert.deepEqual(s.mods, { semana: true });
});

test('CON la guarda: identidad, código, pagos, permisos y cuentas cambiados en memoria no viajan', async () => {
  await sembrar();
  const d = cliente(true); await d.cargar();
  const c = d.local['client-a'];
  Object.assign(c, { name: 'Otro', code: 'OTRO', pagos: [], serviceType: 'premium', authUid: 'uid-x', authUids: ['uid-x'] });
  c.mods.programa = true; c.notifs.seguimiento = { mode: 'off' };
  c.blocks[0].data.log['e1|1'] = { kg: '41' };
  const r = await d.sync.save('client-a');
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = await servidor();
  const { blocks, _rev, _updatedBy, _writers, _updatedAt, ...resto } = s;
  const { blocks: b0, ...esperado } = FICHA_ANTIGUA();
  assert.deepEqual(resto, esperado);
  assert.deepEqual(blocks[0].data.log['e1|1'], { kg: '41' });
});

test('ficha sin módulos ni avisos: el cliente puede crearlos por defecto (como permiten las reglas) y guardar', async () => {
  const f = FICHA_ANTIGUA(); delete f.mods; delete f.notifs; delete f.serviceType;
  await sembrar(f);
  const d = cliente(true); await d.cargar();
  Object.assign(d.local['client-a'], { mods: { semana: true }, notifs: { seguimiento: { mode: 'auto' } }, serviceType: null });
  d.local['client-a'].blocks[0].data.log['e1|0'] = { kg: '40' };
  const r = await d.sync.save('client-a');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual((await servidor()).blocks[0].data.log['e1|0'], { kg: '40' });
});

test('la lista de la app y la de las reglas son la misma', () => {
  const texto = reglas.leer('firestore.rules');
  const bloque = texto.slice(texto.indexOf('function clientFieldsOk'), texto.indexOf('match /clients/'));
  const enReglas = new Set((bloque.match(/'([A-Za-z_]+)'/g) || []).map(x => x.slice(1, -1)));
  ['authUid', 'authUids'].forEach(k => { assert.ok(texto.includes("get('" + k + "'"), k); enReglas.add(k); });
  assert.deepEqual([...enReglas].sort(), [...CF.PROTEGIDOS].sort());
});
