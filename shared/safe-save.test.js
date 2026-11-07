/* Pruebas del guardado seguro con datos ficticios y un Firestore falso en
   memoria. No se conecta a ningún Firebase.
   Ejecutar: node --test shared/safe-save.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./safe-save.js');

const clone = v => JSON.parse(JSON.stringify(v));

/* ---------------- datos ficticios ---------------- */
function clienteFicticio() {
  return {
    name: 'Cliente Ficticio Uno',
    serviceType: 'training_nutrition',
    authUid: 'uid-ficticio-1',
    push: { tokens: ['token-ficticio-a'] },
    menus: [{ id: 'menu1', name: 'Menú A', meals: [{ name: 'Desayuno', img: '' }] }],
    fichas: { entrenamiento: { objetivo: 'fuerza' }, nutricion: {} },
    blocks: [{
      id: 'm7', label: 'Mesociclo 7', cur: true,
      data: {
        _logv: 2,
        program: { weeks: [{ days: [{ exs: [{ uid: 'ex1', n: 'Sentadilla', sets: 3 }, { uid: 'ex2', n: 'Press banca', sets: 3 }] }] }] },
        log: { 'ex1|0': { kg: 60, reps: 8 } },
        exNotes: { ex1: 'Buena técnica' },
        photoSessions: [{ id: 'ps1', date: '2026-10-01', frente: 'https://ejemplo.invalid/f1.jpg' }],
        anthroSessions: [{ date: '2026-10-01', vals: { m0: '80' } }],
        tracking: { '2026-10-01': { peso: 80 } },
        dietPlan: { meals: [{ name: 'Desayuno', foods: [{ n: 'Avena', g: 60 }] }, { name: 'Comida', foods: [{ n: 'Arroz', g: 80 }] }] },
        pesoReal: [80, 79.5]
      }
    }]
  };
}
function metaFicticio() {
  return {
    coachCode: '0000',
    codes: { ABC1: { client: 'cli1' } },
    exLibrary: [],
    templates: { workouts: [], diets: [] },
    negocio: {
      contacts: [{ id: 'ct1', name: 'Contacto Ficticio', updatedAt: '2026-10-01' }],
      pagos: [{ id: 'pg1', importe: 100, estado: 'cobrado' }]
    },
    _split: true
  };
}

/* ---------------- Firestore falso ---------------- */
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

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    key: i => Array.from(m.keys())[i] || null,
    get length() { return m.size; },
    _map: m
  };
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
    timeoutMs: 2000,
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

const blk = d => d.blocks[0].data;
// Deja correr las promesas pendientes (guardados lanzados en segundo plano).
const tick = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

/* ======================= funciones puras ======================= */

test('sin cambios no hay nada que guardar (abrir o cambiar de cliente no escribe)', () => {
  const c = clienteFicticio();
  assert.deepEqual(S.diffDocs(c, clone(c)), []);
});

test('un campo viejo no pisa uno reciente: solo viaja lo que cambió este dispositivo', () => {
  const base = clienteFicticio();
  const remote = clone(base); blk(remote).exNotes.ex1 = 'Nota NUEVA del otro móvil';
  const local = clone(base); local.name = 'Nombre editado aquí';
  const { doc, conflicts } = S.merge3(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.equal(doc.name, 'Nombre editado aquí');
  assert.equal(blk(doc).exNotes.ex1, 'Nota NUEVA del otro móvil');
});

test('el mismo campo cambiado en dos sitios es conflicto (no se elige a ciegas)', () => {
  const base = clienteFicticio();
  const remote = clone(base); blk(remote).log['ex1|0'].kg = 65;
  const local = clone(base); blk(local).log['ex1|0'].kg = 62.5;
  const { conflicts } = S.merge3(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].path, /log\.ex1\|0\.kg/);
});

test('series añadidas en dos dispositivos se conservan todas', () => {
  const base = clienteFicticio();
  const remote = clone(base); blk(remote).log['ex1|1'] = { kg: 60, reps: 7 };
  const local = clone(base); blk(local).log['ex2|0'] = { kg: 40, reps: 10 };
  const { doc, conflicts } = S.merge3(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(Object.keys(blk(doc).log).sort(), ['ex1|0', 'ex1|1', 'ex2|0']);
});

test('sesiones (bloques) y fotos añadidas a la vez no desaparecen', () => {
  const base = clienteFicticio();
  const remote = clone(base); remote.blocks.push({ id: 'm8', label: 'Mesociclo 8', cur: false, data: { log: {} } });
  blk(remote).photoSessions.push({ id: 'ps2', date: '2026-11-01', frente: 'https://ejemplo.invalid/f2.jpg' });
  const local = clone(base); local.blocks.push({ id: 'm9', label: 'Mesociclo 9', cur: false, data: { log: {} } });
  blk(local).photoSessions.push({ id: 'ps3', date: '2026-11-02', frente: 'https://ejemplo.invalid/f3.jpg' });
  const { doc, conflicts } = S.merge3(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(doc.blocks.map(b => b.id), ['m7', 'm8', 'm9']);
  assert.deepEqual(blk(doc).photoSessions.map(p => p.id), ['ps1', 'ps2', 'ps3']);
});

test('dietas: cambios en comidas distintas se mezclan; la misma comida es conflicto', () => {
  const base = clienteFicticio();
  const remote = clone(base); blk(remote).dietPlan.meals[0].foods.push({ n: 'Plátano', g: 120 });
  const local = clone(base); blk(local).dietPlan.meals[1].foods[0].g = 100;
  let r = S.merge3(base, local, remote);
  assert.deepEqual(r.conflicts, []);
  assert.equal(blk(r.doc).dietPlan.meals[0].foods.length, 2);
  assert.equal(blk(r.doc).dietPlan.meals[1].foods[0].g, 100);

  const local2 = clone(base); blk(local2).dietPlan.meals[0].foods = [{ n: 'Tostadas', g: 50 }];
  r = S.merge3(base, local2, remote);
  assert.ok(r.conflicts.length >= 1);
});

test('negocio: pagos y contactos nuevos en dos dispositivos se conservan', () => {
  const base = metaFicticio();
  const remote = clone(base); remote.negocio.pagos.push({ id: 'pg2', importe: 50, estado: 'pendiente' });
  const local = clone(base); local.negocio.contacts.push({ id: 'ct2', name: 'Otro Ficticio', updatedAt: '2026-11-01' });
  local.negocio.pagos[0].estado = 'cobrado';
  const { doc, conflicts } = S.merge3(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(doc.negocio.pagos.map(p => p.id), ['pg1', 'pg2']);
  assert.deepEqual(doc.negocio.contacts.map(c => c.id), ['ct1', 'ct2']);
});

test('borrar aquí algo que otro dispositivo ha modificado es conflicto', () => {
  const base = clienteFicticio();
  const remote = clone(base); blk(remote).photoSessions[0].frente = 'https://ejemplo.invalid/nueva.jpg';
  const local = clone(base); blk(local).photoSessions = [];
  assert.equal(S.merge3(base, local, remote).conflicts.length, 1);
});

test('modificar aquí algo que otro dispositivo ha borrado es conflicto', () => {
  const base = clienteFicticio();
  const remote = clone(base); remote.blocks = [];
  const local = clone(base); blk(local).exNotes.ex2 = 'nota';
  assert.ok(S.merge3(base, local, remote).conflicts.length >= 1);
});

test('reordenar aquí y añadir allí se combinan', () => {
  const base = clienteFicticio();
  base.blocks.push({ id: 'm6', label: 'Mesociclo 6', data: {} });
  const remote = clone(base); remote.blocks.push({ id: 'm5', label: 'Mesociclo 5', data: {} });
  const local = clone(base); local.blocks.reverse();
  const { doc, conflicts } = S.merge3(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(doc.blocks.map(b => b.id), ['m6', 'm7', 'm5']);
});

test('arrays sin clave que solo crecen: se suman los dos añadidos', () => {
  const base = clienteFicticio();
  const remote = clone(base); blk(remote).pesoReal.push(79);
  const local = clone(base); blk(local).pesoReal.push(78.8);
  const { doc, conflicts } = S.merge3(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(blk(doc).pesoReal, [80, 79.5, 79, 78.8]);
});

test('las operaciones son JSON y aplicarlas dos veces no duplica nada', () => {
  const base = clienteFicticio();
  const local = clone(base);
  blk(local).log['ex2|0'] = { kg: 40, reps: 10 };
  blk(local).photoSessions.push({ id: 'ps9', date: '2026-11-03' });
  blk(local).pesoReal.push(78);
  const ops = JSON.parse(JSON.stringify(S.diffDocs(base, local)));
  const once = S.applyOps(base, ops);
  const twice = S.applyOps(once.doc, ops);
  assert.deepEqual(twice.conflicts, []);
  assert.deepEqual(twice.doc, local);
});

test('patchInPlace mantiene la identidad de los objetos que siguen existiendo', () => {
  const target = clienteFicticio();
  const blockRef = target.blocks[0];
  const logRef = blockRef.data.log;
  const src = clone(target); blk(src).log['ex1|1'] = { kg: 61 }; src.name = 'Otro';
  S.patchInPlace(target, src);
  assert.equal(target.blocks[0], blockRef);
  assert.equal(target.blocks[0].data.log, logRef);
  assert.equal(logRef['ex1|1'].kg, 61);
  assert.equal(target.name, 'Otro');
});

/* ======================= gestor con Firestore falso ======================= */

test('abrir y cambiar de cliente sin editar no escribe en el servidor', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio()); srv.put('cli2', clienteFicticio());
  const a = device(srv, 'A');
  a.load('cli1'); a.load('cli2');
  const r1 = await a.sync.save('cli1');
  const r2 = await a.sync.save('cli2');
  assert.ok(r1.noop && r2.noop);
  assert.equal(srv.writes, 0);
});

test('la memoria con _rev/_updatedAt (como la app) no cuenta como cambio', async () => {
  // Encontrado en la prueba e2e: abrir el cliente en otra pestaña escribía.
  const srv = fakeServer();
  srv.put('cli1', Object.assign(clienteFicticio(), { _rev: 7, _updatedAt: '2026-11-07T00:00:00Z', _updatedBy: 'otra' }));
  const a = device(srv, 'A');
  a.local.cli1 = srv.get('cli1'); // sin quitar los campos de control
  a.sync.setBase('cli1', srv.get('cli1'));
  assert.deepEqual(a.sync.pendingOps('cli1'), []);
  assert.ok((await a.sync.save('cli1')).noop);
  assert.equal(srv.writes, 0);
});

test('dos dispositivos con datos viejos: no se pierde ni la sesión ni la dieta', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'movil'); const b = device(srv, 'ordenador');
  a.load('cli1'); b.load('cli1');
  // El móvil registra una serie y una anotación
  blk(a.local.cli1).log['ex1|1'] = { kg: 60, reps: 7 };
  blk(a.local.cli1).exNotes.ex2 = 'Molestia leve en hombro';
  assert.ok((await a.sync.save('cli1')).ok);
  // El ordenador (sin enterarse) cambia la dieta
  blk(b.local.cli1).dietPlan.meals[1].foods[0].g = 90;
  assert.ok((await b.sync.save('cli1')).ok);
  const final = srv.get('cli1');
  assert.deepEqual(blk(final).log['ex1|1'], { kg: 60, reps: 7 });
  assert.equal(blk(final).exNotes.ex2, 'Molestia leve en hombro');
  assert.equal(blk(final).dietPlan.meals[1].foods[0].g, 90);
  assert.equal(final._rev, 2); // dos escrituras, ninguna perdida
  // El ordenador recibe en memoria lo del móvil al guardar
  assert.deepEqual(blk(b.local.cli1).log['ex1|1'], { kg: 60, reps: 7 });
});

test('conflicto en el mismo campo: se bloquea, se avisa y el servidor no cambia', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); const b = device(srv, 'B');
  a.load('cli1'); b.load('cli1');
  blk(a.local.cli1).log['ex1|0'].kg = 65;
  await a.sync.save('cli1');
  const before = srv.get('cli1');
  const writes = srv.writes;
  blk(b.local.cli1).log['ex1|0'].kg = 55;
  const r = await b.sync.save('cli1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
  assert.equal(b.last('cli1').s, 'conflict');
  assert.equal(srv.writes, writes);
  assert.deepEqual(srv.get('cli1'), before);
  // Sigue bloqueado: otro intento tampoco escribe
  blk(b.local.cli1).name = 'otro cambio';
  assert.equal((await b.sync.save('cli1')).reason, 'conflict');
  assert.equal(srv.writes, writes);
});

test('campos que escribe un proceso externo (tokens push) no se borran', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  // El job de avisos limpia tokens y añade un campo nuevo
  const d = srv.get('cli1'); d.push = { tokens: [] }; d.avisoEnviado = '2026-11-07'; srv.put('cli1', d);
  blk(a.local.cli1).tracking['2026-11-07'] = { peso: 79 };
  assert.ok((await a.sync.save('cli1')).ok);
  const final = srv.get('cli1');
  assert.deepEqual(final.push.tokens, []);
  assert.equal(final.avisoEnviado, '2026-11-07');
  assert.deepEqual(blk(final).tracking['2026-11-07'], { peso: 79 });
});

test('sin conexión: no se escribe, se avisa, y al reconectar se mezcla con lo nuevo', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const a = device(srv, 'gimnasio', { storage }); const b = device(srv, 'casa');
  a.load('cli1'); b.load('cli1');
  srv.online = false;
  blk(a.local.cli1).log['ex2|0'] = { kg: 42.5, reps: 10 };
  const r = await a.sync.save('cli1');
  assert.equal(r.reason, 'error');
  assert.equal(a.last('cli1').s, 'error');
  assert.equal(srv.writes, 0);
  assert.ok(Array.from(storage._map.keys()).some(k => k.startsWith('jcg_pending:gimnasio:cli1')));
  // Mientras, en casa (con conexión) se añade una sesión de fotos
  srv.online = true;
  blk(b.local.cli1).photoSessions.push({ id: 'ps2', date: '2026-11-07' });
  assert.ok((await b.sync.save('cli1')).ok);
  // El gimnasio recupera la conexión y reintenta
  assert.ok((await a.sync.save('cli1')).ok);
  const final = srv.get('cli1');
  assert.deepEqual(blk(final).log['ex2|0'], { kg: 42.5, reps: 10 });
  assert.deepEqual(blk(final).photoSessions.map(p => p.id), ['ps1', 'ps2']);
  assert.ok(!Array.from(storage._map.keys()).some(k => k.startsWith('jcg_pending:')));
});

test('se cierra la app sin conexión: al volver a abrir se recuperan los cambios', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const clock = { t: 1_000_000 };
  const a = device(srv, 'pestanaVieja', { storage, clock });
  a.load('cli1'); a.sync.heartbeat();
  srv.online = false;
  blk(a.local.cli1).exNotes.ex1 = 'Anotación escrita sin cobertura';
  await a.sync.save('cli1');
  // Se cierra la app. Pasa el tiempo; otro dispositivo cambia otra cosa.
  srv.online = true;
  const d = srv.get('cli1'); d.name = 'Renombrado en otro sitio'; srv.put('cli1', d);
  clock.t += 60_000;
  const n = device(srv, 'pestanaNueva', { storage, clock });
  n.load('cli1');
  const rep = n.sync.recover();
  assert.deepEqual(rep.map(x => x.ok), [true]);
  await tick(); await tick();
  await n.sync.save('cli1');
  const final = srv.get('cli1');
  assert.equal(blk(final).exNotes.ex1, 'Anotación escrita sin cobertura');
  assert.equal(final.name, 'Renombrado en otro sitio');
});

test('los latidos de pestañas cerradas se limpian sin perder su journal', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const clock = { t: 1_000_000 };
  for (let i = 0; i < 5; i++) storage.setItem('jcg_tab:vieja' + i, String(clock.t - 3_600_000));
  storage.setItem('jcg_pending:vieja0:cli1', JSON.stringify({ at: 1, ops: [{ p: ['blocks', { k: 'id', v: 'm7' }, 'data', 'exNotes', 'ex2'], a: 'recuperada' }] }));
  const n = device(srv, 'nueva', { storage, clock });
  n.sync.heartbeat();
  assert.deepEqual(Array.from(storage._map.keys()).filter(k => k.startsWith('jcg_tab:')), ['jcg_tab:nueva']);
  n.load('cli1');
  assert.deepEqual(n.sync.recover().map(r => r.ok), [true]);
  await tick();
  assert.equal(blk(srv.get('cli1')).exNotes.ex2, 'recuperada');
});

test('no se recuperan cambios de una pestaña que sigue abierta', () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const clock = { t: 1_000_000 };
  const a = device(srv, 'viva', { storage, clock });
  a.sync.heartbeat();
  storage.setItem('jcg_pending:viva:cli1', JSON.stringify({ at: clock.t, ops: [] }));
  const n = device(srv, 'otra', { storage, clock });
  n.load('cli1');
  assert.deepEqual(n.sync.recover(), []);
});

const pendingKeys = storage => Array.from(storage._map.keys()).filter(k => k.startsWith('jcg_pending:'));
const copyStorage = storage => { const c = memStorage(); for (const [k, v] of storage._map) c.setItem(k, v); return c; };

test('un journal viejo no resucita un cambio que el usuario ya deshizo', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const clock = { t: 1_000_000 };
  const a = device(srv, 'A', { storage, clock });
  a.load('cli1'); a.sync.heartbeat();
  srv.online = false;
  blk(a.local.cli1).exNotes.ex1 = 'Nota escrita por error';
  assert.equal((await a.sync.save('cli1')).reason, 'error');
  srv.online = true;
  blk(a.local.cli1).exNotes.ex1 = 'Buena técnica'; // lo deshace antes de reconectar
  assert.ok((await a.sync.save('cli1')).ok);
  assert.deepEqual(pendingKeys(storage), []);
  clock.t += 60_000;
  const n = device(srv, 'N', { storage, clock });
  n.load('cli1');
  assert.deepEqual(n.sync.recover(), []);
  await tick();
  assert.equal(blk(srv.get('cli1')).exNotes.ex1, 'Buena técnica');
  assert.equal(srv.writes, 0);
});

test('la escritura llegó pero se perdió la respuesta: ni conflicto falso ni journal colgado', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const clock = { t: 1_000_000 };
  const a = device(srv, 'A', { storage, clock });
  const b = device(srv, 'B');
  a.load('cli1'); b.load('cli1'); a.sync.heartbeat();
  a.listen(); b.listen();
  blk(a.local.cli1).log['ex2|0'] = { kg: 40, reps: 10 };
  srv.loseReply = true;
  assert.equal((await a.sync.save('cli1')).reason, 'error');
  await tick();
  assert.deepEqual(blk(srv.get('cli1')).log['ex2|0'], { kg: 40, reps: 10 });
  assert.ok(!a.statuses.some(x => x.s === 'conflict'));
  assert.equal(a.sync.hasUnsaved(), false);
  assert.deepEqual(pendingKeys(storage), []);
  // Después otro dispositivo corrige esa serie; reabrir A no debe chocar ni deshacerla.
  blk(b.local.cli1).log['ex2|0'].kg = 45;
  assert.ok((await b.sync.save('cli1')).ok);
  clock.t += 60_000;
  const n = device(srv, 'N', { storage, clock });
  n.load('cli1');
  assert.deepEqual(n.sync.recover(), []);
  assert.equal(blk(srv.get('cli1')).log['ex2|0'].kg, 45);
});

test('varias pestañas cerradas con cambios del mismo cliente: el journal los conserva todos', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const clock = { t: 1_000_000 };
  storage.setItem('jcg_pending:muerta1:cli1', JSON.stringify({ at: 1, ops: [{ p: ['blocks', { k: 'id', v: 'm7' }, 'data', 'exNotes', 'ex2'], a: 'de la pestaña 1' }] }));
  storage.setItem('jcg_pending:muerta2:cli1', JSON.stringify({ at: 2, ops: [{ p: ['name'], b: 'Cliente Ficticio Uno', a: 'Nombre de la pestaña 2' }] }));
  const n = device(srv, 'N', { storage, clock });
  n.load('cli1');
  srv.online = false;
  assert.deepEqual(n.sync.recover().map(r => r.ok), [true, true]);
  // La pestaña se cierra justo ahora, antes de que ningún guardado termine.
  const queda = copyStorage(storage);
  await tick();
  srv.online = true;
  clock.t += 60_000;
  const m = device(srv, 'M', { storage: queda, clock });
  m.load('cli1');
  m.sync.recover();
  await tick();
  const final = srv.get('cli1');
  assert.equal(blk(final).exNotes.ex2, 'de la pestaña 1');
  assert.equal(final.name, 'Nombre de la pestaña 2');
});

test('recuperar una entrada de la propia pestaña no la borra', () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const n = device(srv, 'N', { storage });
  storage.setItem('jcg_pending:N:cli1', JSON.stringify({ at: 1, ops: [{ p: ['name'], b: 'Cliente Ficticio Uno', a: 'Nombre recuperado' }] }));
  n.load('cli1');
  srv.online = false;
  assert.deepEqual(n.sync.recover().map(r => r.ok), [true]);
  const entry = JSON.parse(storage.getItem('jcg_pending:N:cli1'));
  assert.deepEqual(entry.ops.map(o => o.a), ['Nombre recuperado']);
});

test('con un conflicto pendiente, lo que se sigue editando también queda en el journal', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const a = device(srv, 'A', { storage }); const b = device(srv, 'B');
  a.load('cli1'); b.load('cli1');
  blk(b.local.cli1).log['ex1|0'].kg = 65;
  assert.ok((await b.sync.save('cli1')).ok);
  blk(a.local.cli1).log['ex1|0'].kg = 62.5;
  assert.equal((await a.sync.save('cli1')).reason, 'conflict');
  blk(a.local.cli1).exNotes.ex1 = 'Editada durante el conflicto';
  assert.equal((await a.sync.save('cli1')).reason, 'conflict');
  const entry = JSON.parse(storage.getItem('jcg_pending:A:cli1'));
  const paths = entry.ops.map(o => S.pathLabel(o.p));
  assert.ok(paths.some(p => /exNotes\.ex1/.test(p)), paths.join(','));
  assert.ok(paths.some(p => /log\.ex1\|0\.kg/.test(p)), paths.join(','));
  assert.equal(a.sync.hasUnsaved(), true);
});

test('hasUnsaved: avisa con cambios reales, guardado en marcha o conflicto; no al solo abrir', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A');
  a.load('cli1');
  assert.equal(a.sync.hasUnsaved(), false, 'abrir no es editar');
  a.sync.absorb(['cli1'], () => { blk(a.local.cli1).weightSnapshots = []; });
  assert.equal(a.sync.hasUnsaved(), false, 'los rellenos al pintar no cuentan');
  blk(a.local.cli1).exNotes.ex1 = 'cambio real';
  assert.equal(a.sync.hasUnsaved(), true, 'cambio sin enviar');
  const p = a.sync.save('cli1');
  assert.equal(a.sync.hasUnsaved(), true, 'transacción en marcha');
  assert.ok((await p).ok);
  assert.equal(a.sync.hasUnsaved(), false, 'guardado');
  srv.online = false;
  blk(a.local.cli1).exNotes.ex1 = 'sin conexión';
  await a.sync.save('cli1');
  assert.equal(a.sync.hasUnsaved(), true, 'error de red');
});

test('cliente borrado en otro dispositivo: ni guardar ni recuperar el journal lo vuelve a crear', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  srv.put('cli2', clienteFicticio());
  const storage = memStorage();
  const clock = { t: 1_000_000 };
  const b = device(srv, 'B', { storage, clock });
  b.load('cli1'); b.load('cli2'); b.listen(); b.sync.heartbeat();
  // B tenía una edición sin terminar de cli1; en cli2 no tenía nada.
  blk(b.local.cli1).exNotes.ex1 = 'editado en B';
  srv.online = false;
  await b.sync.save('cli1');
  srv.online = true;
  srv.remove('cli1'); srv.remove('cli2'); // el entrenador los elimina desde A
  assert.equal(b.local.cli2, undefined, 'sin cambios pendientes desaparece de B');
  assert.equal(b.sync.isBlocked('cli1'), true, 'con cambios pendientes se bloquea');
  assert.equal((await b.sync.save('cli1')).reason, 'conflict');
  const writes = srv.writes;
  // B se cierra y se vuelve a abrir más tarde.
  clock.t += 60_000;
  const n = device(srv, 'N', { storage, clock });
  n.load('cli1'); n.load('cli2');
  assert.deepEqual(n.sync.recover(), []);
  await tick();
  assert.equal(srv.get('cli1'), null);
  assert.equal(srv.get('cli2'), null);
  assert.equal(srv.writes, writes);
});

test('tiempo real: lo de otro dispositivo llega a memoria y se mezcla con lo pendiente', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); const b = device(srv, 'B');
  a.load('cli1'); b.load('cli1');
  const stop = b.listen();
  blk(a.local.cli1).log['ex1|1'] = { kg: 60, reps: 6 };
  await a.sync.save('cli1');
  assert.deepEqual(blk(b.local.cli1).log['ex1|1'], { kg: 60, reps: 6 });
  // B tiene algo pendiente cuando llega otro cambio: se mezcla y se guarda
  stop();
  b.local.cli1.fichas.nutricion.alergias = 'ninguna';
  const stop2 = b.listen();
  blk(a.local.cli1).exNotes.ex1 = 'actualizada';
  await a.sync.save('cli1');
  await tick(); await tick(); await tick();
  stop2();
  const final = srv.get('cli1');
  assert.equal(blk(final).exNotes.ex1, 'actualizada');
  assert.equal(final.fichas.nutricion.alergias, 'ninguna');
  assert.deepEqual(blk(final).log['ex1|1'], { kg: 60, reps: 6 });
});

test('tiempo real con conflicto: no toca la memoria local y bloquea el guardado', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const b = device(srv, 'B'); b.load('cli1');
  const stop = b.listen();
  blk(b.local.cli1).exNotes.ex1 = 'mía';
  const d = srv.get('cli1'); blk(d).exNotes.ex1 = 'del otro'; srv.put('cli1', d);
  stop();
  assert.equal(blk(b.local.cli1).exNotes.ex1, 'mía');
  assert.ok(b.sync.isBlocked('cli1'));
  const writes = srv.writes;
  assert.equal((await b.sync.save('cli1')).reason, 'conflict');
  assert.equal(srv.writes, writes);
  assert.equal(blk(srv.get('cli1')).exNotes.ex1, 'del otro');
});

test('descartar por decisión del usuario se queda con lo de la nube', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); const b = device(srv, 'B');
  a.load('cli1'); b.load('cli1');
  blk(a.local.cli1).exNotes.ex1 = 'A'; await a.sync.save('cli1');
  blk(b.local.cli1).exNotes.ex1 = 'B'; await b.sync.save('cli1');
  assert.ok(b.sync.isBlocked('cli1'));
  b.sync.discardPending('cli1');
  assert.equal(blk(b.local.cli1).exNotes.ex1, 'A');
  assert.ok(!b.sync.isBlocked('cli1'));
  assert.equal(srv.get('cli1')._rev, 1); // solo la escritura de A
});

test('escritura concurrente durante la transacción: se reintenta y no se pierde ninguna', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  blk(a.local.cli1).log['ex2|1'] = { kg: 45, reps: 8 };
  srv.beforeCommit = () => { const d = srv.get('cli1'); blk(d).log['ex2|2'] = { kg: 45, reps: 7 }; srv.put('cli1', d); };
  assert.ok((await a.sync.save('cli1')).ok);
  const log = blk(srv.get('cli1')).log;
  assert.ok(log['ex2|1'] && log['ex2|2']);
});

test('documento borrado en otro dispositivo: no se resucita con datos viejos', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  srv.remove('cli1');
  blk(a.local.cli1).exNotes.ex1 = 'tarde';
  const r = await a.sync.save('cli1');
  assert.equal(r.reason, 'conflict');
  assert.equal(srv.get('cli1'), null);
});

test('cliente nuevo: se crea; si ya existe con otros datos, conflicto', async () => {
  const srv = fakeServer();
  const a = device(srv, 'A');
  a.local.nuevo = { name: 'Cliente Nuevo Ficticio', blocks: [] };
  assert.ok((await a.sync.save('nuevo')).ok);
  assert.equal(srv.get('nuevo').name, 'Cliente Nuevo Ficticio');

  srv.put('dup', { name: 'Ya existía', blocks: [{ id: 'x', data: {} }] });
  const b = device(srv, 'B');
  b.local.dup = { name: 'Otro nombre', blocks: [] };
  b.sync.setBase('dup', null); // cree que no existe
  assert.equal((await b.sync.save('dup')).reason, 'conflict');
  assert.equal(srv.get('dup').name, 'Ya existía');
});

test('documento demasiado grande: se bloquea antes de escribir', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A', { docLimit: 2000 }); a.load('cli1');
  a.local.cli1.photo = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
  const r = await a.sync.save('cli1');
  assert.equal(r.reason, 'size');
  assert.equal(srv.writes, 0);
});

test('meta del entrenador: solo se comparan sus claves; "active" no viaja', async () => {
  const srv = fakeServer();
  const m = metaFicticio(); m.active = { c: 'cli1', b: 'm7' }; m.extraDeOtroProceso = { x: 1 };
  srv.put('coach_data', m);
  const keys = ['coachCode', 'codes', 'exLibrary', 'templates', 'negocio', '_split'];
  const a = device(srv, 'A', { diffOpts: id => (id === 'coach_data' ? { onlyKeys: keys } : undefined) });
  a.load('coach_data');
  a.local.coach_data.active = { c: 'cli2', b: null }; // navegar
  delete a.local.coach_data.extraDeOtroProceso;     // la app no lo conoce
  assert.ok((await a.sync.save('coach_data')).noop);
  a.local.coach_data.negocio.pagos.push({ id: 'pg3', importe: 30 });
  assert.ok((await a.sync.save('coach_data')).ok);
  const final = srv.get('coach_data');
  assert.deepEqual(final.active, { c: 'cli1', b: 'm7' });
  assert.deepEqual(final.extraDeOtroProceso, { x: 1 });
  assert.deepEqual(final.negocio.pagos.map(p => p.id), ['pg1', 'pg3']);
});

test('dos pestañas del mismo navegador no se pisan', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const storage = memStorage();
  const t1 = device(srv, 'tab1', { storage }); const t2 = device(srv, 'tab2', { storage });
  t1.load('cli1'); t2.load('cli1');
  blk(t1.local.cli1).anthroSessions.push({ date: '2026-11-05', vals: { m0: '79' } });
  blk(t2.local.cli1).anthroSessions.push({ date: '2026-11-06', vals: { m0: '78.5' } });
  await Promise.all([t1.sync.save('cli1'), t2.sync.save('cli1')]);
  assert.deepEqual(blk(srv.get('cli1')).anthroSessions.map(s => s.date), ['2026-10-01', '2026-11-05', '2026-11-06']);
});

test('lo editado mientras la transacción está en marcha también se guarda', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  blk(a.local.cli1).log['ex1|1'] = { kg: 60, reps: 8 };
  const p = a.sync.save('cli1');
  blk(a.local.cli1).log['ex1|2'] = { kg: 60, reps: 6 }; // segunda serie, antes de que acabe
  a.sync.save('cli1');
  await p;
  for (let i = 0; i < 5; i++) await tick();
  const log = blk(srv.get('cli1')).log;
  assert.ok(log['ex1|1'] && log['ex1|2']);
});

/* ============ consultar pantallas no escribe (encontrado en e2e) ============ */

test('estructuras vacías creadas al pintar no se suben ni cuentan como cambio', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  // Lo que hacían Seguimiento / Antropometría / Dieta al pintarse
  a.sync.absorb(['cli1'], () => {
    blk(a.local.cli1).weightSnapshots = [];
    blk(a.local.cli1).estModel = { base: 80, steps: [{ dir: 'flat', pct: 0.2 }] };
    blk(a.local.cli1).dietSurveys = [];
    a.local.cli1.periodization = { macros: [], meso: {} };
  });
  assert.deepEqual(a.sync.pendingOps('cli1'), []);
  assert.ok((await a.sync.save('cli1')).noop);
  assert.equal(srv.writes, 0);
});

test('convertir al pintar un contenedor vacío ({} -> []) no se sube', async () => {
  const srv = fakeServer();
  const c = clienteFicticio(); blk(c).tracking = {}; srv.put('cli1', c);
  const a = device(srv, 'A'); a.load('cli1');
  a.sync.absorb(['cli1'], () => { blk(a.local.cli1).tracking = []; }); // trackingArray()
  assert.deepEqual(a.sync.pendingOps('cli1'), []);
  // y si después se registra algo, sí se guarda
  blk(a.local.cli1).tracking.push({ date: '2026-11-07', peso: '79' });
  assert.ok((await a.sync.save('cli1')).ok);
  assert.deepEqual(blk(srv.get('cli1')).tracking, [{ date: '2026-11-07', peso: '79' }]);
});

test('en cuanto el usuario mete datos en una estructura por defecto, se guarda entera', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  a.sync.absorb(['cli1'], () => { blk(a.local.cli1).weightSnapshots = []; });
  blk(a.local.cli1).weightSnapshots.push({ date: '2026-11-07', weight: 79.4, src: 'seg' });
  assert.ok((await a.sync.save('cli1')).ok);
  assert.deepEqual(blk(srv.get('cli1')).weightSnapshots, [{ date: '2026-11-07', weight: 79.4, src: 'seg' }]);
});

test('un valor por defecto local no choca con datos reales escritos en otro dispositivo', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'movil'); const b = device(srv, 'ordenador');
  a.load('cli1'); b.load('cli1');
  // El móvil solo ha mirado la periodización (vacía)...
  a.sync.absorb(['cli1'], () => { a.local.cli1.periodization = { macros: [], meso: {} }; });
  // ...mientras el ordenador la rellena de verdad.
  b.local.cli1.periodization = { macros: [{ id: 'mac1', n: 'Fuerza' }], meso: {} };
  assert.ok((await b.sync.save('cli1')).ok);
  // El móvil edita otra cosa: no hay conflicto y no pisa la periodización.
  blk(a.local.cli1).log['ex1|2'] = { kg: 60, reps: 5 };
  assert.ok((await a.sync.save('cli1')).ok);
  const final = srv.get('cli1');
  assert.deepEqual(final.periodization.macros.map(m => m.id), ['mac1']);
  assert.deepEqual(blk(final).log['ex1|2'], { kg: 60, reps: 5 });
  // Y la memoria del móvil recibe la periodización real.
  assert.deepEqual(a.local.cli1.periodization.macros.map(m => m.id), ['mac1']);
});

test('absorb no esconde una edición real que ya estaba pendiente antes de pintar', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  blk(a.local.cli1).log['ex2|0'] = { kg: 40 };             // edición real, aún sin guardar
  a.sync.absorb(['cli1'], () => { blk(a.local.cli1).dietSurveys = []; });
  const labels = a.sync.pendingOps('cli1').map(o => S.pathLabel(o.p));
  assert.deepEqual(labels, ['blocks[id=m7].data.log.ex2|0']);
});

test('markDefaults tras cargar: los rellenos no suben; un documento que no existe en la nube sí', async () => {
  const srv = fakeServer();
  srv.put('cli1', clienteFicticio());
  const a = device(srv, 'A'); a.load('cli1');
  a.local.cli1.notifs = { modo: 'auto' };                 // como ensureData
  a.local.legacy = { name: 'Cliente solo en meta antiguo', blocks: [] };
  a.sync.setBase('legacy', null);                          // aún sin documento
  a.sync.markDefaults(['cli1', 'legacy']);
  assert.deepEqual(a.sync.pendingOps('cli1'), []);
  assert.ok(a.sync.pendingOps('legacy').length > 0, 'el cliente sin documento debe seguir pendiente de subir');
  assert.ok((await a.sync.save('legacy')).ok);
  assert.equal(srv.get('legacy').name, 'Cliente solo en meta antiguo');
});

/* ======================= cableado en index.html ======================= */

test('index.html: navegar y pintar no llaman a save()', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  // Cuerpo de una función: su línea, o hasta la primera línea que sea "}".
  const lines = html.split('\n');
  const fnBody = name => {
    const i = lines.findIndex(l => l.startsWith('function ' + name + '('));
    assert.ok(i >= 0, 'no encuentro ' + name);
    if (lines[i].trimEnd().endsWith('}')) return lines[i];
    let j = i + 1; while (j < lines.length && lines[j].trimEnd() !== '}') j++;
    return lines.slice(i, j + 1).join('\n');
  };
  for (const f of ['calStart', 'toggleClient', 'pickBlock', 'clientPickBlock', 'openClientValoracion', 'openClientFichas']) {
    assert.ok(!/\bsave\(/.test(fnBody(f)), f + ' no debe guardar');
  }
  // openClient ocupa dos líneas
  const oc = html.slice(html.indexOf('function openClient(cid)'), html.indexOf('function openClientValoracion'));
  assert.ok(!/\bsave\(/.test(oc), 'openClient no debe guardar');
  for (const r of ['renderAll', 'renderView', 'renderTop', 'renderTabs', 'renderSide']) {
    assert.ok(html.includes(r + '=renderGuard(' + r + ');'), r + ' debe ir envuelto');
  }
  assert.ok(/if\(_renderDepth>0\)return;/.test(html), 'save() debe ignorarse mientras se pinta');
});

test('index.html: el aviso al cerrar mira el gestor y el borrado espera a la nube', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const unsaved = html.slice(html.indexOf('function hasUnsavedWork()'), html.indexOf("window.addEventListener('beforeunload'"));
  assert.ok(/sync\.hasUnsaved\(\)/.test(unsaved), 'beforeunload debe contar transacciones en marcha y cambios sin enviar');
  assert.ok(/_logSaveT/.test(unsaved) && /_syncProblems\.size/.test(unsaved));
  assert.ok(/addEventListener\('beforeunload',e=>\{\s*if\(hasUnsavedWork\(\)\)/.test(html));
  const del = html.slice(html.indexOf('function delClient('), html.indexOf('function viewHome('));
  const then = del.indexOf('deleteClientDoc(cid).then(');
  assert.ok(then > 0, 'delClient debe esperar al borrado en la nube');
  for (const s of ['delete DATA.clients[cid]', 'delete DATA.codes[k]', "toast('Cliente eliminado')"]) {
    assert.ok(del.indexOf(s) > then, s + ' solo tras confirmar el borrado');
  }
  assert.ok(/\.catch\(/.test(del.slice(then)), 'el fallo del borrado se avisa');
  const dc = html.slice(html.indexOf('function deleteClientDoc('), html.indexOf('/* CRM en la colección contacts'));
  assert.ok(/runTransaction/.test(dc) && !/\.delete\(\)\.then/.test(dc));
  assert.ok(/journal:sync\.orphans\(\)/.test(html), 'la descarga incluye el journal de pestañas cerradas');
});

test('index.html: sin set() directos sobre clients, sin persistencia y con el módulo cargado', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="shared/safe-save.js"></script>'));
  assert.ok(!/enablePersistence\s*\(/.test(html), 'la persistencia local debe estar desactivada');
  assert.ok(!/clientsCol\(\)\.doc\([^)]*\)\.set\(/.test(html), 'no debe quedar clientsCol().doc().set()');
  assert.ok(!/collection\('clients'\)\.doc\([^)]*\)\.set\(/.test(html), "no debe quedar collection('clients').doc().set()");
  assert.ok(!/function writeClientDoc/.test(html));
});
