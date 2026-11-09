/* Regresión de la restauración desde la APP («Restaurar desde un archivo») con el guardado seguro de
   verdad (shared/safe-save.js) y un Firestore falso en memoria. Datos ficticios.
   1) La app calcula la restauración con sus datos en memoria: si están desactualizados o la nube cambia
      a la vez, NO puede borrar ni sobrescribir lo reciente, ni dejar algo a medias sin decirlo.
   2) Aditivo = lo borrado a propósito volvería: el simulacro lo enseña y se puede excluir.
   (fakeServer y device: copia de shared/safe-save.test.js) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./safe-save.js');
const CA = require('./copia-aditiva.js');
const clone = v => JSON.parse(JSON.stringify(v));

function fakeServer() {
  const docs = new Map();
  const listeners = new Set();
  const srv = {
    online: true,
    writes: 0,
    beforeCommit: null, // gancho para meter escrituras concurrentes
    get: id => (docs.has(id) ? clone(docs.get(id)) : null),
    put(id, data) { docs.set(id, clone(data)); srv.version.set(id, (srv.version.get(id) || 0) + 1); notify(id); },
    remove(id) { docs.delete(id); srv.version.set(id, (srv.version.get(id) || 0) + 1); notify(id); },
    version: new Map(),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    db() {
      return {
        collection: () => ({ doc: id => ({ id }) }),
        runTransaction: async fn => {
          for (let attempt = 0; attempt < 5; attempt++) {
            if (!srv.online) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
            const read = new Map();
            const pending = [];
            const t = {
              get: async ref => { read.set(ref.id, srv.version.get(ref.id) || 0); const d = srv.get(ref.id); return { exists: d !== null, data: () => clone(d) }; },
              set: (ref, data) => pending.push([ref.id, clone(data)])
            };
            const out = await fn(t);
            if (srv.beforeCommit) { const h = srv.beforeCommit; srv.beforeCommit = null; h(); }
            if (!srv.online) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
            const stale = Array.from(read.entries()).some(([id, v]) => (srv.version.get(id) || 0) !== v);
            if (stale) continue; // Firestore reintenta la transacción
            for (const [id, data] of pending) { srv.writes++; srv.put(id, data); }
            // La escritura llegó, pero la respuesta se pierde (corte, tiempo agotado).
            if (srv.loseReply) { srv.loseReply = false; const e = new Error('deadline-exceeded'); e.code = 'deadline-exceeded'; throw e; }
            // La escritura llegó y la respuesta llega, pero tarde (después del límite del cliente).
            if (srv.delayReply) { const d = srv.delayReply; srv.delayReply = 0; await new Promise(r => setTimeout(r, d)); }
            return out;
          }
          throw new Error('demasiados reintentos');
        }
      };
    }
  };
  function notify(id) { for (const fn of listeners) fn(id, srv.get(id)); }
  return srv;
}

/* Un "dispositivo": su memoria local + su gestor de guardado. */
function device(srv, name, opts) {
  opts = opts || {};
  const local = {};
  const statuses = [];
  let clock = opts.clock || { t: 1_000_000 };
  const sync = S.createSync({
    db: srv.db(), collection: 'clients', tabId: name,
    storage: opts.storage || null,
    now: () => clock.t,
    timeoutMs: opts.timeoutMs || 2000,
    docLimit: opts.docLimit,
    diffOpts: opts.diffOpts,
    getLocal: id => (local[id] === undefined ? undefined : clone(local[id])),
    applyLocal: (id, doc) => { if (doc === null) delete local[id]; else local[id] = clone(doc); },
    onStatus: (id, s, info) => statuses.push({ id, s, info })
  });
  return {
    name, local, statuses, sync, clock,
    load(id) { const raw = srv.get(id); if (raw) local[id] = S.stripSync(raw); sync.setBase(id, raw); },
    listen() { return srv.onChange((id, data) => sync.remote(id, data, { fromCache: false, hasPendingWrites: false })); },
    last(id) { return statuses.filter(x => x.id === id).pop(); }
  };
}


const tick = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const L = d => d.blocks[0].data.log;

function ficha() {
  return { name: 'Cliente Ficticio', code: 'COD-1', authUid: 'uid-1',
    blocks: [
      { id: 'b1', data: { _logv: 2, log: { 'e1|0': { kg: '100', reps: '8', rir: '2' }, 'e1|1': { kg: '100', reps: '8', rir: '2' } } } },
      { id: 'b2', data: { _logv: 2, log: {} } }
    ],
    menus: [{ id: 'm1', name: 'Dieta A' }] };
}

// Lo mismo que hacen importBackupFile/applyRestorePlan en index.html.
function prepararComoLaApp(srv, dev, copia, excluir) {
  const nube = {}, base = {};
  Object.keys(copia).forEach(id => { nube[id] = srv.get(id); base[id] = dev.sync.baseOf(id); });
  const r = CA.prepararRestauracion({ col: 'clients', nube, base, locales: dev.local, copia, excluir });
  r.nube = nube;
  return r;
}
async function aplicarComoLaApp(srv, dev, copia, prep, marcados, excluir, antesDeGuardar) {
  const nubeAhora = {}, base = {};
  Object.keys(copia).forEach(id => { nubeAhora[id] = srv.get(id); base[id] = dev.sync.baseOf(id); });
  const c = CA.comprobarAntesDeAplicar({ col: 'clients', nubeRevisada: prep.nube, nubeAhora, base, locales: dev.local, copia, excluir,
    huellaAprobada: CA.huellaAprobada(prep.plan, marcados) });
  if (!c.ok) return { abortado: true, motivo: c.motivo, docs: c.docs };
  if (antesDeGuardar) await antesDeGuardar();
  for (const d of c.plan.docs) dev.local[d.id] = d.valor;
  const informe = [];
  for (const d of c.plan.docs) { const r = await dev.sync.save(d.id); informe.push({ id: d.id, ok: !!r.ok, reason: r.reason }); }
  return { informe };
}

test('R1 datos en memoria desactualizados: no se planifica (pide recargar) y la nube no se toca', async () => {
  const srv = fakeServer(); srv.put('cli1', Object.assign(ficha(), { _rev: 1 }));
  const copia = { cli1: ficha() };
  const coach = device(srv, 'Coach'); coach.load('cli1');      // sin tiempo real: no ve lo que viene después
  const cli = device(srv, 'Cliente'); cli.load('cli1');
  L(cli.local.cli1)['e1|2'] = { kg: '105', reps: '6', rir: '1' };   // registrada después de la copia
  delete cli.local.cli1.menus;                                       // y la dieta, quitada a propósito
  assert.ok((await cli.sync.save('cli1')).ok);
  const antes = clone(srv.get('cli1'));
  const p = prepararComoLaApp(srv, coach, copia);
  assert.equal(p.ok, false);
  assert.equal(p.motivo, 'obsoleto');
  assert.deepEqual(p.obsoletos, ['cli1']);
  assert.deepEqual(srv.get('cli1'), antes, 'no se ha escrito nada');
});

test('R2 recargado: el simulacro enseña lo borrado a propósito, se excluye, y lo reciente queda intacto', async () => {
  const srv = fakeServer(); srv.put('cli1', Object.assign(ficha(), { _rev: 1 }));
  const copia = { cli1: ficha(), cli9: { name: 'Cliente dado de baja', blocks: [] } };
  const cli = device(srv, 'Cliente'); cli.load('cli1');
  L(cli.local.cli1)['e1|2'] = { kg: '105', reps: '6', rir: '1' };
  L(cli.local.cli1)['e1|0'].rir = '3';                // corrección posterior
  delete L(cli.local.cli1)['e1|1'];                   // perdida (fallo)
  delete cli.local.cli1.menus;                        // quitada a propósito
  cli.local.cli1.blocks = cli.local.cli1.blocks.filter(b => b.id !== 'b2');   // bloque borrado a propósito
  assert.ok((await cli.sync.save('cli1')).ok);
  const coach = device(srv, 'Coach'); coach.load('cli1');
  const p = prepararComoLaApp(srv, coach, copia);
  assert.equal(p.ok, true);
  const ids = p.plan.ids;
  assert.ok(ids.includes('clients/cli1|blocks[id:b1].data.log.e1|1'), 'la serie perdida');
  assert.ok(ids.includes('clients/cli1|menus'), 'la dieta borrada a propósito aparece en el simulacro');
  assert.ok(ids.includes('clients/cli1|blocks[id:b2]'), 'el bloque borrado a propósito aparece en el simulacro');
  assert.ok(ids.includes('clients/cli9|(documento)'), 'el cliente dado de baja aparece en el simulacro');
  const excluir = ['clients/cli1|menus', 'clients/cli1|blocks[id:b2]', 'clients/cli9|(documento)'];
  const marcados = ids.filter(x => !excluir.includes(x));
  const r = await aplicarComoLaApp(srv, coach, copia, p, marcados, excluir);
  assert.deepEqual(r.informe.map(x => x.ok), [true]);
  const d = srv.get('cli1');
  assert.deepEqual(L(d)['e1|1'], { kg: '100', reps: '8', rir: '2' }, 'serie perdida repuesta');
  assert.deepEqual(L(d)['e1|2'], { kg: '105', reps: '6', rir: '1' }, 'serie posterior intacta');
  assert.equal(L(d)['e1|0'].rir, '3', 'la corrección posterior gana');
  assert.equal(d.menus, undefined, 'lo excluido no vuelve');
  assert.deepEqual(d.blocks.map(b => b.id), ['b1']);
  assert.equal(srv.get('cli9'), null);
});

test('R3 otro dispositivo cambia lo mismo mientras se restaura: conflicto, no se pisa y el informe dice qué quedó sin restaurar', async () => {
  const srv = fakeServer();
  for (const id of ['cli1', 'cli2']) { const x = ficha(); delete L(x)['e1|1']; srv.put(id, Object.assign(x, { _rev: 2 })); }
  const copia = { cli1: ficha(), cli2: ficha() };
  const coach = device(srv, 'Coach'); coach.load('cli1'); coach.load('cli2');
  const p = prepararComoLaApp(srv, coach, copia);
  assert.equal(p.ok, true);
  // Ya comprobado, justo mientras se guarda, el cliente 2 registra ESA serie con otros valores.
  const r = await aplicarComoLaApp(srv, coach, copia, p, p.plan.ids, [], async () => {
    const cli2 = device(srv, 'Cliente2'); cli2.load('cli2');
    L(cli2.local.cli2)['e1|1'] = { kg: '90', reps: '10', rir: '1' };
    assert.ok((await cli2.sync.save('cli2')).ok);
  });
  assert.deepEqual(r.informe.map(x => [x.id, x.ok, x.reason || null]), [['cli1', true, null], ['cli2', false, 'conflict']]);
  assert.deepEqual(L(srv.get('cli2'))['e1|1'], { kg: '90', reps: '10', rir: '1' }, 'lo del cliente gana: no se pisa');
  assert.deepEqual(L(srv.get('cli1'))['e1|1'], { kg: '100', reps: '8', rir: '2' });
});

test('R4 nunca borra: tras restaurar, todo lo que había en la nube sigue (aunque la copia sea más pequeña)', async () => {
  const srv = fakeServer();
  const grande = ficha(); L(grande)['e9|0'] = { kg: '1' }; grande.extra = { nuevo: true }; grande.blocks.push({ id: 'b3', data: {} });
  srv.put('cli1', Object.assign(clone(grande), { _rev: 5 }));
  const coach = device(srv, 'Coach'); coach.load('cli1');
  const pequena = { name: 'otro nombre', blocks: [{ id: 'b1', data: { log: {} } }] };
  const p = prepararComoLaApp(srv, coach, { cli1: pequena });
  assert.equal(p.ok, true);
  assert.equal(p.plan.ids.length, 0, 'no hay nada que añadir');
  const r = await aplicarComoLaApp(srv, coach, { cli1: pequena }, p, [], []);
  assert.deepEqual(r.informe, []);
  assert.deepEqual(S.stripSync(srv.get('cli1')), grande);
});

test('R5 si algo cambia entre el simulacro y aplicar, no se aplica nada', async () => {
  const srv = fakeServer(); const x = ficha(); delete L(x)['e1|1']; srv.put('cli1', Object.assign(x, { _rev: 1 }));
  const coach = device(srv, 'Coach'); coach.load('cli1');
  const p = prepararComoLaApp(srv, coach, { cli1: ficha() });
  L(coach.local.cli1)['e1|1'] = { kg: '1' };          // aparece en memoria entre medias
  const antes = clone(srv.get('cli1'));
  const r = await aplicarComoLaApp(srv, coach, { cli1: ficha() }, p, p.plan.ids, []);
  assert.equal(r.abortado, true);
  assert.equal(r.motivo, 'plan-distinto');
  assert.deepEqual(srv.get('cli1'), antes);
});

test('R6 credenciales: un cliente reasignado no recupera su código ni su cuenta antiguos', () => {
  const p = CA.planificar('clients', { cli1: { name: 'x', code: 'NUEVO', authUid: 'uid-nuevo' } }, { cli1: ficha() }, []);
  assert.ok(!p.ids.some(i => /\|(code|authUid)$/.test(i)));
  assert.equal(p.docs[0].valor.code, 'NUEVO');
  assert.equal(p.docs[0].valor.authUid, 'uid-nuevo');
});

test('R7 exclusiones: por documento, por bloque o por serie; el resto se aplica', () => {
  const actual = { blocks: [{ id: 'b1', data: { log: {} } }] };
  const copia = { blocks: [{ id: 'b1', data: { log: { a: 1, b: 2 } } }, { id: 'b2' }], menus: [] };
  const todo = CA.planificar('clients', { c: actual }, { c: copia }, []);
  assert.deepEqual(todo.ids.sort(), ['clients/c|blocks[id:b1].data.log.a', 'clients/c|blocks[id:b1].data.log.b', 'clients/c|blocks[id:b2]', 'clients/c|menus']);
  const parte = CA.planificar('clients', { c: actual }, { c: copia }, ['clients/c|blocks[id:b1].data.log.a', 'clients/c|blocks[id:b2]']);
  assert.deepEqual(parte.ids.sort(), ['clients/c|blocks[id:b1].data.log.b', 'clients/c|menus']);
  assert.deepEqual(parte.docs[0].valor.blocks.map(b => b.id), ['b1']);
  assert.deepEqual(parte.docs[0].valor.blocks[0].data.log, { b: 2 });
  assert.equal(CA.planificar('clients', { c: actual }, { c: copia }, ['clients/c']).ids.length, 0);
  assert.equal(CA.planificar('clients', { c: undefined }, { c: copia }, ['clients/c|(documento)']).docs.length, 0);
  assert.notEqual(todo.huella, parte.huella);
});

/* ---- Segunda revisión antes de fusionar el PR #10 ---- */

const sinSerie = (k) => { const x = ficha(); delete L(x)[k]; return x; };

test('R8 la huella del plan depende de LO QUE se añadiría, no solo de las rutas', () => {
  const actual = { cli1: sinSerie('e1|1') };
  const a = { cli1: ficha() };
  const b = { cli1: ficha() }; L(b.cli1)['e1|1'] = { kg: '999', reps: '1', rir: '0' };
  const pa = CA.planificar('clients', actual, a, []), pb = CA.planificar('clients', actual, b, []);
  assert.deepEqual(pa.ids, pb.ids, 'mismas rutas');
  assert.notEqual(pa.huella, pb.huella, 'valores distintos → otro plan');
  // Ficha entera recreada: la huella cubre su contenido.
  const na = CA.planificar('clients', {}, { cli9: { name: 'A', blocks: [] } }, []);
  const nb = CA.planificar('clients', {}, { cli9: { name: 'B', blocks: [] } }, []);
  assert.notEqual(na.huella, nb.huella);
});

test('R9 al aplicar se relee el servidor: si un cliente borró algo desde el simulacro y el tiempo real va con retraso, no se aplica nada', async () => {
  const srv = fakeServer(); srv.put('cli1', Object.assign(sinSerie('e1|1'), { _rev: 1 }));
  const copia = { cli1: ficha() };
  const coach = device(srv, 'Coach'); coach.load('cli1');      // tiempo real con retraso: no le llega lo de abajo
  const prep = prepararComoLaApp(srv, coach, copia);
  assert.equal(prep.ok, true);
  // Mientras el entrenador revisa la lista, el cliente borra a propósito el bloque b1.
  const cli = device(srv, 'Cliente'); cli.load('cli1');
  cli.local.cli1.blocks = cli.local.cli1.blocks.filter(x => x.id !== 'b1');
  assert.ok((await cli.sync.save('cli1')).ok);
  const antes = clone(srv.get('cli1'));
  const r = await aplicarComoLaApp(srv, coach, copia, prep, prep.plan.ids, []);
  assert.equal(r.abortado, true, 'se para antes de escribir y lo dice');
  assert.equal(r.motivo, 'cambio-nube');
  assert.deepEqual(r.docs, ['cli1']);
  assert.deepEqual(srv.get('cli1'), antes, 'no se ha escrito nada');
  assert.ok(!srv.get('cli1').blocks.some(x => x.id === 'b1'), 'el bloque borrado no vuelve');
});

test('R10 al aplicar se relee el servidor: cualquier cambio desde el simulacro (aunque sea en otra parte) obliga a repetirlo', async () => {
  const srv = fakeServer(); srv.put('cli1', Object.assign(sinSerie('e1|1'), { _rev: 1 }));
  const copia = { cli1: ficha() };
  const coach = device(srv, 'Coach'); coach.load('cli1');
  const prep = prepararComoLaApp(srv, coach, copia);
  const cli = device(srv, 'Cliente'); cli.load('cli1');
  L(cli.local.cli1)['e1|5'] = { kg: '80', reps: '5', rir: '2' };
  assert.ok((await cli.sync.save('cli1')).ok);
  const antes = clone(srv.get('cli1'));
  const r = await aplicarComoLaApp(srv, coach, copia, prep, prep.plan.ids, []);
  assert.equal(r.abortado, true);
  assert.deepEqual(srv.get('cli1'), antes);
});

test('R11 recrear una ficha que ya no existe NO revive credenciales (código, cuentas, push, PIN) salvo que se pida, y nunca si otro las usa', () => {
  const borrada = Object.assign(ficha(), { authUids: ['uid-1', 'uid-1b'], codes: ['COD-1', 'COD-1B'], push: { token: 'push-viejo' } });
  const p = CA.planificar('clients', { cli1: undefined }, { cli1: borrada }, []);
  const v = p.docs[0].valor;
  for (const k of ['code', 'codes', 'authUid', 'authUids', 'push']) assert.equal(v[k], undefined, k + ' no se repone');
  assert.equal(v.name, 'Cliente Ficticio');
  assert.equal(v.blocks.length, 2, 'el resto de la ficha sí');
  assert.deepEqual(p.docs[0].credenciales.map(c => c.campo).sort(), ['authUid', 'authUids', 'code', 'codes', 'push']);
  const pc = CA.planificar('clients', { coach_data: undefined }, { coach_data: { coachCode: 'PIN-VIEJO', codes: { 'COD-1': { client: 'cli1' } }, exLibrary: [] } }, []);
  assert.equal(pc.docs[0].valor.coachCode, undefined, 'PIN del entrenador');
  assert.equal(pc.docs[0].valor.codes, undefined, 'lista de códigos');
  // Recuperación de un desastre (se pide expresamente): sí, salvo lo que ya es de otra ficha.
  const todos = { cli2: { name: 'Otro', code: 'COD-1', authUids: ['uid-1b'] } };
  const q = CA.planificar('clients', { cli1: undefined }, { cli1: borrada }, [], { credenciales: true, todos });
  const w = q.docs[0].valor;
  assert.equal(w.code, undefined, 'ese código ya es de otro cliente');
  assert.equal(w.codes, undefined, 'uno de sus códigos ya es de otro');
  assert.equal(w.authUids, undefined, 'una de sus cuentas ya es de otro');
  assert.equal(w.authUid, 'uid-1');
  assert.deepEqual(w.push, { token: 'push-viejo' });
  assert.notEqual(q.huella, p.huella);
});
