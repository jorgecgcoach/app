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
  const inf = await restaurar(db, copia, { apply: true });
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
  await restaurar(db, c2, { apply: true });
  const a = (await db.doc('clients/cliA').get()).data();
  assert.deepEqual(lib.sinSync(a), lib.sinSync(fichaCompleta()));
  const meta = (await db.doc('clients/coach_data').get()).data();
  for (const k of ['coachCode', 'codes', 'exLibrary', 'templates', 'negocio']) assert.deepEqual(meta[k], m[k], 'meta ' + k);
});
