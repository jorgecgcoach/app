// Prueba de RECUPERACIÓN completa contra los emuladores de Firestore y Storage. Datos ficticios.
// Pregunta que responde: si se pierde todo (o una parte), ¿la copia permite recuperarlo entero y sin pisar
// lo que se hizo después?
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Solo con emuladores (npm run test:copias).');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-jcg-copias';
process.env.STORAGE_BUCKET = PROJECT + '.appspot.com';
const { iniciar } = require('./firebase-admin-init');
const { admin } = iniciar({});
const db = admin.firestore();
const lib = require('./copia-lib');
const { descargar } = require('./copia-firestore');
const { restaurar } = require('./restaurar-copia');
const st = require('./copia-storage');
const { bucket } = st.iniciarStorage({});

const TOKEN_FOTO = '11111111-2222-4333-8444-555555555555';
const TOKEN_PDF = '66666666-7777-4888-9999-000000000000';
const url = (ruta, token) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(ruta)}?alt=media&token=${token}`;
const FOTO = 'clients/cliA/photos/f1.jpg';
const PDF = 'clients/cliA/analitica/a1.pdf';
const BYTES_FOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 250, 251, 252]);
const BYTES_PDF = Buffer.from('%PDF-1.4 analitica ficticia\n%%EOF');

// Una ficha con TODAS las secciones que la app guarda (nombres reales de campos).
function fichaCompleta() {
  return {
    name: 'Cliente Ficticio Á', code: 'FICT-A', authUid: 'uid-a', authUids: ['uid-a', 'uid-a2'],
    serviceType: 'online', mods: { semana: true, dieta: true, antropometria: true, habitos: true, camino: true },
    blocks: [
      { id: 'b1', label: 'Mesociclo 1', cur: false, data: { _logv: 2,
        program: { weeks: [{ days: [{ name: 'Día A', exs: [{ uid: 'e1', n: 'Sentadilla', sets: 3, reps: '8', rir: '2', int: '', desc: '90' }] }] }] },
        log: { 'e1|0': { kg: '100', reps: '8', rir: '2', done: true }, 'e1|1': { kg: '102,5', reps: '7', rir: '1', done: true } },
        exNotes: { e1: { pain: 3, txt: 'molestia lumbar ficticia' } },
        sessions: { 'w1d0': { date: '2026-11-02', start: '13:07', energy: 7, doms: 0 } } } },
      { id: 'b2', label: 'Mesociclo 2', cur: true, data: { _logv: 2,
        program: { weeks: [{ days: [{ name: 'Día B', exs: [{ uid: 'e2', n: 'Press', sets: 4, reps: '10', rir: '3' }] }] }, { days: [] }] },
        log: { 'e2|0': { kg: '40', reps: '10', rir: '3' } }, exNotes: {} } }
    ],
    menus: [{ id: 'm1', name: 'Dieta ficticia', meals: [{ id: 'ml1', name: 'Desayuno', img: url(FOTO, TOKEN_FOTO), kcal: 450 }] }],
    dietRecs: ['beber agua'],
    antropometria: [{ date: '2026-10-01', peso: 80.5, cintura: 90, fotos: [url(FOTO, TOKEN_FOTO)] }],
    analiticas: [{ id: 'a1', date: '2026-09-15', url: url(PDF, TOKEN_PDF) }],
    seguimiento: [{ date: '2026-11-03', sueno: 7, dolor: 2, nota: 'ñandú y acentos' }],
    habitos: [{ id: 'h1', t: 'Pasos', dias: { '2026-11-03': true } }],
    camino: { fases: [{ id: 'f1', t: 'Fase 1', done: true }] },
    backRehab: { nivel: 2 }, fichas: [{ id: 'fi1' }], fichasDone: { fi1: true }, notifs: [{ id: 'n1', t: 'aviso' }],
    pagos: [{ id: 'pg1', importe: 60, fecha: '2026-11-01' }],
    push: { token: 'push-ficticio' },
    _rev: 7, _updatedAt: '2026-11-09T10:00:00.000Z', _updatedBy: 'tabX~0123456789abcdef~3', _writers: ['tabX~0123456789abcdef~2', 'tabX~0123456789abcdef~3']
  };
}
function metaCompleta() {
  return {
    coachCode: 'PIN-FICTICIO', codes: { 'FICT-A': { client: 'cliA' }, 'FICT-A2': { client: 'cliA' }, 'FICT-B': { client: 'cliB' } },
    exLibrary: [{ id: 'x1', n: 'Sentadilla', v: 'https://video.example/1' }],
    templates: { workouts: [{ id: 't1', name: 'Plantilla fuerza' }], diets: [{ id: 'td1', name: 'Plantilla dieta' }] },
    negocio: { contracts: [{ id: 'k1', cliente: 'cliA' }], payments: [{ id: 'p1', importe: 60 }, { id: 'p2', importe: 80 }], contacts: [{ id: 'ct1', n: 'Lead ficticio' }], coachPush: { token: 'push-coach' } },
    _split: true, _rev: 12, _writers: ['tabC~fedcba9876543210~1']
  };
}

async function vaciarTodo() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const [files] = await bucket.getFiles();
  for (const f of files) await f.delete();
}
async function subir(ruta, buf, tipo, token) {
  await bucket.file(ruta).save(buf, { resumable: false, metadata: { contentType: tipo, metadata: { firebaseStorageDownloadTokens: token } } });
}
async function todoFirestore() { return descargar(db); }
const sinSyncTodo = cols => Object.fromEntries(Object.entries(cols).map(([c, docs]) => [c, Object.fromEntries(Object.entries(docs).map(([id, d]) => [id, lib.sinSync(d)]))]));

let original, copia, dirStorage;

test.before(async () => {
  await vaciarTodo();
  await db.doc('clients/coach_data').set(metaCompleta());
  await db.doc('clients/cliA').set(fichaCompleta());
  await db.doc('clients/cliB').set({ name: 'Cliente Ficticio B', blocks: [{ id: 'bb', data: { _logv: 2, log: {}, program: { weeks: [] } } }], _rev: 1 });
  await db.doc('contacts/ct9').set({ n: 'Contacto ficticio', tel: '600000000' });
  await db.doc('catalog/exercises').set({ items: [{ n: 'Sentadilla', v: 'https://video.example/1' }], count: 1, updatedAt: '2026-11-09' });
  await db.doc('otra_coleccion/doc1').set({ algo: 'que la app aún no usa' });
  await subir(FOTO, BYTES_FOTO, 'image/jpeg', TOKEN_FOTO);
  await subir(PDF, BYTES_PDF, 'application/pdf', TOKEN_PDF);
  original = await todoFirestore();
  copia = JSON.parse(JSON.stringify(lib.construirCopia(original)));
  dirStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'jcg-copia-storage-'));
  await st.copiar(bucket, dirStorage);
});
test.after(() => { try { fs.rmSync(dirStorage, { recursive: true, force: true }); } catch (_) {} });

test('1. la copia de Firestore trae TODAS las colecciones (también las que la app aún no usa) y es íntegra', () => {
  assert.deepEqual(Object.keys(copia.colecciones).sort(), ['catalog', 'clients', 'contacts', 'otra_coleccion']);
  const v = lib.verificar(copia);
  assert.equal(v.ok, true, v.problemas.join());
  assert.equal(v.resumen.fichas, 2);
  assert.equal(v.resumen.seriesRegistradas, 3);
  assert.equal(v.resumen.notasPorEjercicio, 1);
  assert.equal(v.resumen.codigos, 3);
  assert.equal(v.resumen.plantillas, 2);
  assert.equal(v.resumen.pagos, 2);
  assert.equal(v.resumen.contratos, 1);
  assert.equal(v.resumen.biblioteca, 1);
  // Cada sección de la ficha está tal cual (programación, registro, dolor, dieta, medidas, analíticas, hábitos, pagos…)
  const a = copia.colecciones.clients.cliA, f = fichaCompleta();
  for (const k of Object.keys(f)) assert.deepEqual(a[k], f[k], 'sección ' + k);
});

test('2. la copia de Storage trae fotos y analíticas con su token, y cada enlace de las fichas tiene su archivo', () => {
  const v = st.verificar(dirStorage, copia);
  assert.equal(v.ok, true, (v.problemas || []).join());
  assert.equal(v.resumen.fotos, 1);
  assert.equal(v.resumen.analiticas, 1);
  assert.equal(v.resumen.enlacesEnFichas, 3);
  assert.deepEqual(v.avisos, []);
  const man = JSON.parse(fs.readFileSync(path.join(dirStorage, st.MANIFIESTO), 'utf8'));
  assert.equal(man.archivos.find(x => x.ruta === FOTO).token, TOKEN_FOTO);
});

test('3. una copia dañada se detecta (Firestore y Storage)', () => {
  const mala = JSON.parse(JSON.stringify(copia));
  delete mala.colecciones.clients.cliA.blocks[0].data.log['e1|1'];
  assert.equal(lib.verificar(mala).ok, false);
  const ruta = path.join(dirStorage, ...FOTO.split('/'));
  const bien = fs.readFileSync(ruta);
  fs.writeFileSync(ruta, Buffer.concat([bien, Buffer.from([0])]));
  assert.match(st.verificar(dirStorage).problemas.join(), /huella/);
  fs.writeFileSync(ruta, bien);
  assert.equal(st.verificar(dirStorage).ok, true);
});

test('4. DESASTRE TOTAL: se borra todo y la copia lo recupera entero (datos idénticos, archivos idénticos, mismos tokens)', async () => {
  await vaciarTodo();
  assert.equal((await db.collection('clients').get()).size, 0);
  const sinPedir = await restaurar(db, copia, { apply: false });
  assert.ok(sinPedir.credenciales.length > 0 && sinPedir.credenciales.every(c => /no se repone/.test(c)), 'sin pedirlo, ninguna credencial vuelve');
  const sim = await restaurar(db, copia, { apply: false, credenciales: true });
  const inf = await restaurar(db, copia, { apply: true, plan: sim.huella, credenciales: true });
  assert.equal(inf.documentosNuevos, 6); // coach_data, 2 fichas, contacto, catálogo y la colección extra
  const st2 = await st.restaurar(bucket, dirStorage, { apply: true });
  assert.equal(st2.repuestos.length, 2);
  const ahora = await todoFirestore();
  assert.deepEqual(sinSyncTodo(ahora), sinSyncTodo(original), 'los datos quedan idénticos a los de la copia');
  for (const [ruta, buf, tok] of [[FOTO, BYTES_FOTO, TOKEN_FOTO], [PDF, BYTES_PDF, TOKEN_PDF]]) {
    const [b] = await bucket.file(ruta).download();
    assert.ok(b.equals(buf), 'archivo idéntico ' + ruta);
    const [md] = await bucket.file(ruta).getMetadata();
    assert.equal(md.metadata.firebaseStorageDownloadTokens, tok, 'mismo token: los enlaces de las fichas siguen valiendo');
  }
});

test('5. PÉRDIDA PARCIAL: repone lo perdido sin pisar lo registrado después ni borrar las marcas del guardado seguro', async () => {
  // Después de la copia: el cliente registra una serie nueva y corrige un RIR (dos escrituras del guardado seguro)…
  const ref = db.doc('clients/cliA');
  const d = (await ref.get()).data();
  d.blocks[1].data.log['e2|1'] = { kg: '42,5', reps: '9', rir: '2' };
  d.blocks[0].data.log['e1|0'].rir = '3';
  d._rev = 20; d._updatedBy = 'iphone~aaaaaaaaaaaaaaaa~5'; d._writers = ['iphone~aaaaaaaaaaaaaaaa~4', 'iphone~aaaaaaaaaaaaaaaa~5'];
  // …y por un fallo se pierden una serie antigua, la dieta y una foto.
  delete d.blocks[0].data.log['e1|1'];
  delete d.menus;
  await ref.set(d);
  await bucket.file(FOTO).delete();

  const sim = await restaurar(db, copia, { apply: false });
  assert.ok(sim.cambios.some(c => c.includes('cliA') && c.includes('menus')));
  assert.equal((await ref.get()).data().menus, undefined, 'el simulacro no escribe');

  await restaurar(db, copia, { apply: true });
  await st.restaurar(bucket, dirStorage, { apply: true });
  const r = (await ref.get()).data();
  assert.deepEqual(r.blocks[0].data.log['e1|1'], { kg: '102,5', reps: '7', rir: '1', done: true }, 'serie perdida repuesta');
  assert.deepEqual(r.menus, fichaCompleta().menus, 'dieta repuesta');
  assert.deepEqual(r.blocks[1].data.log['e2|1'], { kg: '42,5', reps: '9', rir: '2' }, 'serie nueva intacta');
  assert.equal(r.blocks[0].data.log['e1|0'].rir, '3', 'la corrección posterior gana');
  assert.equal(r._rev, 21, 'sube _rev: los dispositivos abiertos recargan en vez de pisar');
  assert.deepEqual(r._writers, ['iphone~aaaaaaaaaaaaaaaa~4', 'iphone~aaaaaaaaaaaaaaaa~5', 'restauracion'], 'conserva las marcas de la nube (PR #8)');
  assert.equal(r._updatedBy, 'restauracion');
  const [b] = await bucket.file(FOTO).download();
  assert.ok(b.equals(BYTES_FOTO));
});

test('6. no revive credenciales retiradas: PIN, códigos ni dueños', async () => {
  const ref = db.doc('clients/coach_data');
  await ref.update({ coachCode: 'PIN-NUEVO', codes: { 'NUEVO-A': { client: 'cliA' } } });
  await db.doc('clients/cliA').update({ authUid: 'uid-nuevo', authUids: ['uid-nuevo'], code: 'NUEVO-A' });
  await restaurar(db, copia, { apply: true });
  const m = (await ref.get()).data();
  assert.equal(m.coachCode, 'PIN-NUEVO');
  assert.deepEqual(Object.keys(m.codes), ['NUEVO-A']);
  const a = (await db.doc('clients/cliA').get()).data();
  assert.equal(a.authUid, 'uid-nuevo');
  assert.deepEqual(a.authUids, ['uid-nuevo']);
});

test('7. restaurar archivos nunca pisa uno que ya existe (aunque sea distinto)', async () => {
  await subir(FOTO, Buffer.from('foto nueva posterior'), 'image/jpeg', 'token-nuevo');
  const inf = await st.restaurar(bucket, dirStorage, { apply: true });
  assert.equal(inf.repuestos.length, 0);
  const [b] = await bucket.file(FOTO).download();
  assert.equal(b.toString(), 'foto nueva posterior');
});

test('8. la «Descargar copia» de la app también se puede verificar y restaurar en un proyecto vacío', async () => {
  // Mismo formato que exportBackup() en index.html.
  const m = metaCompleta();
  const app = { _type: 'jcgcoach_backup', _v: 2, exportedAt: new Date().toISOString(),
    meta: { active: { c: 'cliA', b: 'b2' }, coachCode: m.coachCode, codes: m.codes, exLibrary: m.exLibrary, templates: m.templates, negocio: m.negocio },
    clients: { cliA: fichaCompleta(), cliB: { name: 'Cliente Ficticio B', blocks: [] } } };
  const tmp = path.join(os.tmpdir(), 'jcg-copia-app-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify(app));
  const { copia: c2, origen } = require('./verificar-copia').cargar(tmp);
  fs.unlinkSync(tmp);
  assert.equal(origen, 'app');
  assert.equal(lib.verificar(c2).ok, true);
  await vaciarTodo();
  await restaurar(db, c2, { apply: true, credenciales: true });   // proyecto vacío = desastre: se pide expresamente
  const a = (await db.doc('clients/cliA').get()).data();
  assert.deepEqual(lib.sinSync(a), lib.sinSync(fichaCompleta()));
  const meta = (await db.doc('clients/coach_data').get()).data();
  for (const k of ['coachCode', 'codes', 'exLibrary', 'templates', 'negocio']) assert.deepEqual(meta[k], m[k], 'meta ' + k);
});

test('9. simulacro detallado: cada cosa que se repondría con su identificador, y exclusiones (documento, bloque, serie, archivo)', async () => {
  await vaciarTodo();
  await restaurar(db, copia, { apply: true });
  await st.restaurar(bucket, dirStorage, { apply: true });
  // Después de la copia, a propósito: se da de baja a cliB, se borra el bloque b2 y la dieta de cliA y su foto.
  await db.doc('clients/cliB').delete();
  const d = (await db.doc('clients/cliA').get()).data();
  d.blocks = d.blocks.filter(b => b.id !== 'b2'); delete d.menus; delete d.blocks[0].data.log['e1|1']; d._rev++;
  await db.doc('clients/cliA').set(d);
  await bucket.file(FOTO).delete();
  const sim = await restaurar(db, copia, { apply: false });
  const ids = sim.cambios.map(c => c.split('  (')[0]);
  for (const x of ['clients/cliB|(documento)', 'clients/cliA|blocks[id:b2]', 'clients/cliA|menus', 'clients/cliA|blocks[id:b1].data.log.e1|1']) assert.ok(ids.includes(x), x);
  const excluir = ['clients/cliB', 'clients/cliA|blocks[id:b2]', 'clients/cliA|menus'];
  const sim2 = await restaurar(db, copia, { apply: false, excluir });
  assert.deepEqual(sim2.cambios.map(c => c.split('  (')[0]), ['clients/cliA|blocks[id:b1].data.log.e1|1']);
  await restaurar(db, copia, { apply: true, excluir, plan: sim2.huella });
  const a = (await db.doc('clients/cliA').get()).data();
  assert.deepEqual(a.blocks.map(b => b.id), ['b1']);
  assert.equal(a.menus, undefined);
  assert.ok(a.blocks[0].data.log['e1|1']);
  assert.equal((await db.doc('clients/cliB').get()).exists, false);
  const simSt = await st.restaurar(bucket, dirStorage, { apply: false, excluir: ['clients/cliA/photos/'] });
  assert.deepEqual(simSt.repuestos, []);
  assert.equal(simSt.excluidos, 1);
  await st.restaurar(bucket, dirStorage, { apply: true, excluir: ['clients/cliA/photos/'], plan: simSt.huella });
  assert.equal((await bucket.file(FOTO).exists())[0], false);
});

test('10. aplicar con un plan distinto del revisado no escribe nada', async () => {
  const antes = (await db.doc('clients/cliA').get()).data();
  const sim = await restaurar(db, copia, { apply: false });
  await assert.rejects(() => restaurar(db, copia, { apply: true, plan: 'ffffffffffffffff' }), e => e.code === 'PLAN_DISTINTO');
  await assert.rejects(() => restaurar(db, copia, { apply: true, plan: sim.huella, excluir: ['clients/cliB'] }), e => e.code === 'PLAN_DISTINTO');
  assert.deepEqual((await db.doc('clients/cliA').get()).data(), antes);
  await assert.rejects(() => st.restaurar(bucket, dirStorage, { apply: true, plan: 'ffffffffffffffff' }), e => e.code === 'PLAN_DISTINTO');
});

test('11. si la nube cambia durante la restauración, ese documento no se toca y se informa', async () => {
  const ref = db.doc('clients/cliA');
  const d = (await ref.get()).data(); delete d.blocks[0].data.log['e1|0']; d._rev++; await ref.set(d);
  const sim = await restaurar(db, copia, { apply: false, excluir: ['clients/cliB', 'clients/cliA|blocks[id:b2]', 'clients/cliA|menus'] });
  assert.deepEqual(sim.cambios.map(c => c.split('  (')[0]), ['clients/cliA|blocks[id:b1].data.log.e1|0']);
  // Justo antes de aplicar, el cliente vuelve a registrar esa serie con otros valores.
  const d2 = (await ref.get()).data(); d2.blocks[0].data.log['e1|0'] = { kg: '110', reps: '5', rir: '1' }; d2._rev++; await ref.set(d2);
  await assert.rejects(() => restaurar(db, copia, { apply: true, plan: sim.huella, excluir: ['clients/cliB', 'clients/cliA|blocks[id:b2]', 'clients/cliA|menus'] }), e => e.code === 'PLAN_DISTINTO');
  assert.deepEqual((await ref.get()).data().blocks[0].data.log['e1|0'], { kg: '110', reps: '5', rir: '1' });
});

/* ---- Segunda revisión antes de fusionar el PR #10 ---- */
const crypto = require('crypto');

test('12. el plan aprobado va ligado al CONTENIDO: otra copia con los mismos huecos pero otros valores no se aplica', async () => {
  await db.doc('clients/cliB').set({ name: 'Cliente Ficticio B', blocks: [], _rev: 30 });
  const ref = db.doc('clients/cliA');
  const d = (await ref.get()).data(); delete d.blocks[0].data.log['e1|1']; d._rev++; await ref.set(d);
  const ex = ['clients/cliB', 'clients/cliA|blocks[id:b2]', 'clients/cliA|menus', 'clients/cliA|blocks[id:b1].data.log.e1|0', 'clients/coach_data', 'contacts', 'catalog', 'otra_coleccion'];
  const sim = await restaurar(db, copia, { apply: false, excluir: ex });
  assert.deepEqual(sim.cambios.map(c => c.split('  (')[0]), ['clients/cliA|blocks[id:b1].data.log.e1|1']);
  const otra = JSON.parse(JSON.stringify(copia));
  otra.colecciones.clients.cliA.blocks[0].data.log['e1|1'] = { kg: '999', reps: '1', rir: '0', done: true };
  otra.huellas = lib.construirCopia(otra.colecciones).huellas;   // una copia válida en sí misma
  const simOtra = await restaurar(db, otra, { apply: false, excluir: ex });
  assert.deepEqual(simOtra.cambios, sim.cambios, 'mismas rutas');
  assert.notEqual(simOtra.huella, sim.huella, 'pero otro plan');
  const antes = (await ref.get()).data();
  await assert.rejects(() => restaurar(db, otra, { apply: true, plan: sim.huella, excluir: ex }), e => e.code === 'PLAN_DISTINTO');
  assert.deepEqual((await ref.get()).data(), antes, 'no se ha escrito nada');
  await restaurar(db, copia, { apply: true, plan: sim.huella, excluir: ex });
  assert.deepEqual((await ref.get()).data().blocks[0].data.log['e1|1'], copia.colecciones.clients.cliA.blocks[0].data.log['e1|1']);
});

test('13. Storage: el plan aprobado va ligado al contenido y al token de cada archivo, no solo a su ruta', async () => {
  await bucket.file(FOTO).delete({ ignoreNotFound: true });
  const sim = await st.restaurar(bucket, dirStorage, { apply: false });
  assert.deepEqual(sim.repuestos, [FOTO]);
  for (const cambio of ['contenido', 'token']) {
    const otra = fs.mkdtempSync(path.join(os.tmpdir(), 'jcg-copia-storage-otra-'));
    try {
      fs.cpSync(dirStorage, otra, { recursive: true });
      const man = JSON.parse(fs.readFileSync(path.join(otra, st.MANIFIESTO), 'utf8'));
      const a = man.archivos.find(x => x.ruta === FOTO);
      if (cambio === 'contenido') {
        const buf = Buffer.from('otra foto distinta, misma ruta');
        fs.writeFileSync(path.join(otra, ...FOTO.split('/')), buf);
        a.sha256 = crypto.createHash('sha256').update(buf).digest('hex'); a.bytes = buf.length;
      } else a.token = '99999999-8888-4777-8666-555555555555';
      fs.writeFileSync(path.join(otra, st.MANIFIESTO), JSON.stringify(man));
      assert.ok(st.verificar(otra).ok, 'la otra copia es íntegra en sí misma');
      const simOtra = await st.restaurar(bucket, otra, { apply: false });
      assert.deepEqual(simOtra.repuestos, sim.repuestos, 'mismas rutas (' + cambio + ')');
      await assert.rejects(() => st.restaurar(bucket, otra, { apply: true, plan: sim.huella }), e => e.code === 'PLAN_DISTINTO');
      const [existe] = await bucket.file(FOTO).exists();
      assert.equal(existe, false, 'no se ha subido nada (' + cambio + ')');
    } finally { fs.rmSync(otra, { recursive: true, force: true }); }
  }
  await st.restaurar(bucket, dirStorage, { apply: true, plan: sim.huella });
  const [md] = await bucket.file(FOTO).getMetadata();
  assert.equal(md.metadata.firebaseStorageDownloadTokens, TOKEN_FOTO);
});

test('14. recrear una ficha borrada NO revive su código, sus cuentas ni su push; con --con-credenciales sí, salvo lo que ya usa otra', async () => {
  const ex = ['clients/cliB', 'clients/coach_data', 'contacts', 'catalog', 'otra_coleccion'];
  await db.doc('clients/cliA').delete();
  const sim = await restaurar(db, copia, { apply: false, excluir: ex });
  assert.deepEqual(sim.credenciales.map(c => c.split('  (')[0]).sort(), ['clients/cliA|authUid', 'clients/cliA|authUids', 'clients/cliA|code', 'clients/cliA|push']);
  await restaurar(db, copia, { apply: true, plan: sim.huella, excluir: ex });
  const a = (await db.doc('clients/cliA').get()).data();
  for (const k of ['code', 'authUid', 'authUids', 'push']) assert.equal(a[k], undefined, k + ' no vuelve');
  assert.equal(a.blocks.length, 2, 'el resto de la ficha sí');
  // Recuperación de un desastre, pidiéndolo, pero su código ya se ha dado a otro cliente.
  await db.doc('clients/cliA').delete();
  await db.doc('clients/cliB').set({ name: 'Cliente Ficticio B', code: 'FICT-A', blocks: [], _rev: 40 });
  const sim2 = await restaurar(db, copia, { apply: false, excluir: ex, credenciales: true });
  assert.ok(sim2.credenciales.some(c => /^clients\/cliA\|code .*ya la usa otra ficha/.test(c)));
  await restaurar(db, copia, { apply: true, plan: sim2.huella, excluir: ex, credenciales: true });
  const b = (await db.doc('clients/cliA').get()).data();
  assert.equal(b.code, undefined, 'el código ya es de otro cliente: no se repite');
  assert.equal(b.authUid, 'uid-a');
  assert.deepEqual(b.authUids, ['uid-a', 'uid-a2']);
});

test('15. el documento del entrenador recreado no revive su PIN ni la lista de códigos sin pedirlo', async () => {
  await db.doc('clients/coach_data').delete();
  const ex = ['clients/cliA', 'clients/cliB', 'contacts', 'catalog', 'otra_coleccion'];
  const sim = await restaurar(db, copia, { apply: false, excluir: ex });
  await restaurar(db, copia, { apply: true, plan: sim.huella, excluir: ex });
  const m = (await db.doc('clients/coach_data').get()).data();
  assert.equal(m.coachCode, undefined);
  assert.equal(m.codes, undefined);
  assert.equal(m.negocio.coachPush, undefined, 'tampoco el push del entrenador');
  assert.equal(m.exLibrary.length, 1, 'biblioteca, plantillas y negocio sí');
});

/* ---- Tercera revisión antes de fusionar el PR #10: cambios CONCURRENTES mientras el script aplica ---- */
const { textoInforme } = require('./restaurar-copia');
const FUERA = ['contacts', 'catalog', 'otra_coleccion'];
// Cada código o cuenta, con las fichas a las que da acceso ahora (en sus campos o en la lista del entrenador).
async function duenosDeCredenciales() {
  const m = {};
  const add = (x, o) => { (m[x] = m[x] || new Set()).add(o); };
  (await db.collection('clients').get()).forEach(s => {
    const v = s.data();
    if (v.code) add('code:' + v.code, s.id);
    if (Array.isArray(v.codes)) v.codes.forEach(c => add('code:' + c, s.id));
    else if (v.codes) Object.keys(v.codes).forEach(c => add('code:' + c, (v.codes[c] && v.codes[c].client) || s.id));
    if (v.authUid) add('uid:' + v.authUid, s.id);
    (v.authUids || []).forEach(u => add('uid:' + u, s.id));
  });
  return m;
}
async function sinDuplicados() {
  const m = await duenosDeCredenciales();
  const dup = Object.keys(m).filter(k => m[k].size > 1).map(k => k + ' → ' + [...m[k]].join(','));
  assert.deepEqual(dup, [], 'ningún código ni cuenta da acceso a dos fichas');
}

test('16. una ficha cambia en Firestore MIENTRAS el script aplica: no se pisa, el informe lo dice y el resto queda coherente', async () => {
  const sinSerie = () => { const a = fichaCompleta(); delete a.blocks[0].data.log['e1|1']; a._rev = 60; return a; };
  const meta = metaCompleta(); meta.templates.workouts = []; meta._rev = 61;
  for (const variante of ['cambia lo mismo', 'la borran']) {
    await db.doc('clients/cliA').set(sinSerie());
    await db.doc('clients/cliB').set({ name: 'Cliente Ficticio B', blocks: [], _rev: 62 });
    await db.doc('clients/coach_data').set(meta);
    const sim = await restaurar(db, copia, { apply: false, excluir: FUERA });
    const ids = sim.cambios.map(c => c.split('  (')[0]);
    for (const x of ['clients/cliA|blocks[id:b1].data.log.e1|1', 'clients/cliB|blocks[id:bb]', 'clients/coach_data|templates.workouts[id:t1]']) assert.ok(ids.includes(x), x);
    let deB;
    const inf = await restaurar(db, copia, { apply: true, plan: sim.huella, excluir: FUERA, antesDeDocumento: async (col, id) => {
      const ref = db.doc(col + '/' + id);
      if (id === 'cliA') {   // otro cambio que NO toca lo que se repone: se conserva y cliA sí se restaura
        const d = (await ref.get()).data(); d.blocks[1].data.log['e2|1'] = { kg: '42', reps: '9' }; d._rev++; await ref.set(d);
      }
      if (id === 'cliB') {   // a la vez, en cliB pasa justo lo que se iba a reponer
        if (variante === 'la borran') await ref.delete();
        else { deB = { name: 'Cliente Ficticio B', blocks: [{ id: 'bb', label: 'hecho de nuevo en el móvil', data: { _logv: 2, log: { 'x|0': { kg: '1' } } } }], _rev: 63 }; await ref.set(deB); }
      }
    } });
    // cliB: no se toca, y el informe lo dice con su motivo.
    assert.deepEqual(inf.noAplicados, ['clients/cliB'], variante);
    assert.equal(inf.motivos['clients/cliB'], 'cambio-nube');
    assert.equal(inf.parcial, true);
    const b = await db.doc('clients/cliB').get();
    if (variante === 'la borran') assert.equal(b.exists, false, 'lo borrado durante la restauración sigue borrado');
    else assert.deepEqual(b.data(), deB, 'lo escrito durante la restauración queda tal cual');
    // El resto: restaurado, sin perder lo posterior y con el sello del guardado seguro.
    assert.deepEqual(inf.aplicados, ['clients/cliA', 'clients/coach_data']);
    const a = (await db.doc('clients/cliA').get()).data();
    assert.deepEqual(a.blocks[0].data.log['e1|1'], copia.colecciones.clients.cliA.blocks[0].data.log['e1|1']);
    assert.deepEqual(a.blocks[1].data.log['e2|1'], { kg: '42', reps: '9' }, 'lo escrito durante la restauración en cliA se conserva');
    assert.equal(a._rev, 62, 'cliA: _rev siguiente al que había justo antes');
    assert.equal(a._updatedBy, lib.selloRestauracion(undefined)._updatedBy);
    const m = (await db.doc('clients/coach_data').get()).data();
    assert.deepEqual(m.templates.workouts, [{ id: 't1', name: 'Plantilla fuerza' }]);
    assert.deepEqual(m.codes, meta.codes, 'la lista de códigos no se toca');
    assert.equal(m._rev, 62);
    // El informe impreso lo deja claro.
    const txt = textoInforme(inf, { apply: true, modo: 'emulador', excluir: FUERA });
    assert.match(txt, /RESTAURACIÓN PARCIAL/);
    assert.match(txt, /clients\/cliB.*NO restaurado.*cambió en la nube/);
    assert.match(txt, /✔ clients\/cliA/);
    // Repetirlo (simulacro nuevo) termina el trabajo sin pisar nada.
    const sim2 = await restaurar(db, copia, { apply: false, excluir: FUERA });
    const fin = await restaurar(db, copia, { apply: true, plan: sim2.huella, excluir: FUERA });
    assert.equal(fin.parcial, false);
    assert.deepEqual((await db.doc('clients/cliA').get()).data().blocks[1].data.log['e2|1'], { kg: '42', reps: '9' });
  }
});

test('17. --con-credenciales: si un código o una cuenta pasa a otra ficha después del simulacro (o durante la aplicación), nunca se duplica ni se reasigna', async () => {
  const ex = ['clients/cliB', 'clients/coach_data', ...FUERA];
  const preparar = async () => {
    await db.doc('clients/cliA').delete();
    await db.doc('clients/cliB').set({ name: 'Cliente Ficticio B', blocks: [], _rev: 70 });
    await db.doc('clients/cliC').delete();
    await db.doc('clients/coach_data').set(metaCompleta());   // FICT-A y FICT-A2 → cliA (su dueño), FICT-B → cliB
  };
  const darleACliB = async () => {
    await db.doc('clients/cliB').set({ name: 'Cliente Ficticio B', code: 'FICT-A', authUids: ['uid-a2'], blocks: [], _rev: 71 });
    const m = (await db.doc('clients/coach_data').get()).data(); m.codes['FICT-A'] = { client: 'cliB' }; m._rev++; await db.doc('clients/coach_data').set(m);
  };
  // a) Simulacro: el código de cliA está en la lista del entrenador, pero apuntando a cliA → se repone (no es de otro).
  await preparar();
  const sim = await restaurar(db, copia, { apply: false, excluir: ex, credenciales: true });
  assert.ok(sim.credenciales.some(c => /^clients\/cliA\|code .*SE REPONE/.test(c)), sim.credenciales.join('\n'));
  // b) Después de revisar el plan, el entrenador da ese código y una de esas cuentas a cliB → no se aplica nada.
  await darleACliB();
  await assert.rejects(() => restaurar(db, copia, { apply: true, plan: sim.huella, excluir: ex, credenciales: true }), e => e.code === 'PLAN_DISTINTO');
  assert.equal((await db.doc('clients/cliA').get()).exists, false);
  await sinDuplicados();
  // c) Lo mismo, pero DURANTE la aplicación (entre el plan del script y la transacción de cliA).
  await preparar();
  const sim2 = await restaurar(db, copia, { apply: false, excluir: ex, credenciales: true });
  const inf = await restaurar(db, copia, { apply: true, plan: sim2.huella, excluir: ex, credenciales: true,
    antesDeDocumento: async (col, id) => { if (id === 'cliA') await darleACliB(); } });
  assert.equal((await db.doc('clients/cliA').get()).exists, false, 'cliA no se recrea con un código o una cuenta que ya son de otro');
  assert.deepEqual(inf.noAplicados, ['clients/cliA']);
  assert.equal(inf.motivos['clients/cliA'], 'credenciales');
  assert.match(textoInforme(inf, { apply: true, modo: 'emulador', excluir: ex, credenciales: true }), /clients\/cliA.*NO restaurado.*otra ficha/);
  await sinDuplicados();
  // d) Repetido con un simulacro nuevo: cliA vuelve, sin lo que ya es de cliB y con lo que sigue siendo suyo.
  const sim3 = await restaurar(db, copia, { apply: false, excluir: ex, credenciales: true });
  await restaurar(db, copia, { apply: true, plan: sim3.huella, excluir: ex, credenciales: true });
  const a = (await db.doc('clients/cliA').get()).data();
  assert.equal(a.code, undefined);
  assert.equal(a.authUid, 'uid-a');
  assert.deepEqual(a.authUids, ['uid-a'], 'solo la cuenta que no es de otro');
  await sinDuplicados();
  // e) La lista de códigos del entrenador recreada con --con-credenciales: entrada a entrada, y con la misma
  //    comprobación dentro de la transacción si otra ficha se queda un código mientras tanto.
  await preparar();
  await db.doc('clients/cliA').set(fichaCompleta());
  await db.doc('clients/coach_data').delete();
  const exM = ['clients/cliA', 'clients/cliB', ...FUERA];
  const simM = await restaurar(db, copia, { apply: false, excluir: exM, credenciales: true });
  const infM = await restaurar(db, copia, { apply: true, plan: simM.huella, excluir: exM, credenciales: true,
    antesDeDocumento: async (col, id) => { if (id === 'coach_data') await db.doc('clients/cliC').set({ name: 'Cliente Ficticio C', code: 'FICT-B', _rev: 1 }); } });
  assert.deepEqual(infM.noAplicados, ['clients/coach_data']);
  assert.equal((await db.doc('clients/coach_data').get()).exists, false);
  await sinDuplicados();
  const simM2 = await restaurar(db, copia, { apply: false, excluir: exM, credenciales: true });
  assert.ok(simM2.credenciales.some(c => /coach_data\|codes .*1 ya/.test(c)), simM2.credenciales.join('\n'));
  await restaurar(db, copia, { apply: true, plan: simM2.huella, excluir: exM, credenciales: true });
  const m = (await db.doc('clients/coach_data').get()).data();
  assert.deepEqual(m.codes, { 'FICT-A': { client: 'cliA' }, 'FICT-A2': { client: 'cliA' } }, 'FICT-B ya es de cliC: no vuelve a apuntar a cliB');
  await sinDuplicados();
  await db.doc('clients/cliC').delete();
});
