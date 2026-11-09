// Copia y restauración sin red. Datos ficticios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./copia-lib');

const COLS = () => ({
  clients: {
    coach_data: { coachCode: 'PIN-FICTICIO', codes: { 'COD-X': { client: 'c1' } }, exLibrary: [{ n: 'Sentadilla' }], templates: { workouts: [{ id: 't1' }], diets: [] }, negocio: { contracts: [{ id: 1 }], payments: [{ id: 'p1', importe: 50 }, { id: 'p2', importe: 60 }], contacts: [] }, _split: true },
    c1: { name: 'Ficticio Uno', code: 'COD-X', blocks: [{ id: 'b1', data: { log: { a: 1 } } }, { id: 'b2' }], pagos: [{ id: 1 }], _rev: 4 }
  },
  contacts: {},
  catalog: { exercises: { items: [{ n: 'Sentadilla', v: '' }], count: 1, updatedAt: 'x' } }
});

test('la copia lleva huellas y un resumen sin datos personales', () => {
  const c = lib.construirCopia(COLS());
  const v = lib.verificar(c);
  assert.equal(v.ok, true, v.problemas.join());
  assert.equal(v.resumen.fichas, 1);
  assert.equal(v.resumen.pagos, 2);
  assert.equal(v.resumen.plantillas, 1);
  const r = JSON.stringify(v.resumen);
  assert.ok(!r.includes('Ficticio') && !r.includes('PIN-FICTICIO') && !r.includes('COD-X'));
});

test('una copia retocada o incompleta se detecta', () => {
  const c = lib.construirCopia(COLS());
  c.colecciones.clients.c1.blocks.pop();
  assert.equal(lib.verificar(c).ok, false);
  const sinMeta = lib.construirCopia({ clients: { c1: { name: 'x' } } });
  assert.match(lib.verificar(sinMeta).problemas.join(), /entrenador/);
});

test('la copia de la app (formato antiguo y nuevo) se puede verificar', () => {
  const app = { _type: 'jcgcoach_backup', meta: { codes: {}, coachCode: 'x' }, clients: { c1: { name: 'x' } } };
  const v = lib.verificar(lib.construirCopia(lib.desdeCopiaApp(app)));
  assert.equal(v.ok, true);
  assert.equal(v.resumen.fichas, 1);
});

test('restaurar SOLO añade lo que falta: lo posterior a la copia gana y nada se borra', () => {
  const copia = COLS().clients.c1;
  const actual = { name: 'Nombre cambiado después', blocks: [{ id: 'b1', data: { log: { a: 9, b: 2 } } }, { id: 'b3' }], _rev: 9 };
  const f = lib.fusionAditiva(lib.sinSync(actual), lib.sinSync(copia));
  assert.equal(f.valor.name, 'Nombre cambiado después');
  assert.deepEqual(f.valor.blocks.map(b => b.id), ['b1', 'b3', 'b2'], 'b2 vuelve; b3 (nuevo) sigue');
  assert.equal(f.valor.blocks[0].data.log.a, 9, 'el dato cambiado después no se pisa');
  assert.equal(f.valor.blocks[0].data.log.b, 2);
  assert.deepEqual(f.valor.pagos, [{ id: 1 }], 'campo que faltaba entero');
  assert.equal(f.valor._rev, undefined);
});

test('restaurar nunca revive códigos, PIN ni dueños retirados después de la copia', () => {
  const copia = COLS().clients.coach_data;
  const actual = { coachCode: 'PIN-NUEVO', codes: { 'COD-NUEVO': { client: 'c1' } }, negocio: { payments: [{ id: 'p1', importe: 55 }] } };
  const f = lib.fusionAditiva(actual, copia);
  assert.equal(f.valor.coachCode, 'PIN-NUEVO');
  assert.deepEqual(Object.keys(f.valor.codes), ['COD-NUEVO']);
  assert.deepEqual(f.valor.negocio.payments.map(p => p.id + ':' + p.importe), ['p1:55', 'p2:60']);
  const c1 = lib.fusionAditiva({ name: 'x', authUid: 'nuevo' }, { name: 'x', code: 'COD-VIEJO', authUid: 'viejo', authUids: ['viejo'] });
  assert.deepEqual(c1.valor, { name: 'x', authUid: 'nuevo' });
});

test('la CLI de verificación no imprime datos personales', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcg-copia-'));
  const f = path.join(dir, 'c.json');
  fs.writeFileSync(f, JSON.stringify(lib.construirCopia(COLS())));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'verificar-copia.js'), f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Copia íntegra/);
  ['Ficticio', 'PIN-FICTICIO', 'COD-X'].forEach(s => assert.ok(!r.stdout.includes(s), s));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sin emulador ni --proyecto-real, copia y restauración se niegan', () => {
  const env = Object.assign({}, process.env);
  delete env.FIRESTORE_EMULATOR_HOST; delete env.GOOGLE_APPLICATION_CREDENTIALS;
  const r1 = spawnSync(process.execPath, [path.join(__dirname, 'copia-firestore.js'), '--salida', path.join(os.tmpdir(), 'nada.json')], { env, encoding: 'utf8' });
  assert.equal(r1.status, 2, r1.stderr);
  const r2 = spawnSync(process.execPath, [path.join(__dirname, 'restaurar-copia.js'), path.join(os.tmpdir(), 'nada.json'), '--apply'], { env, encoding: 'utf8' });
  assert.equal(r2.status, 2, r2.stderr);
});
