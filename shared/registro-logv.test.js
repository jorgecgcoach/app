// Registro de entrenamiento: la migración de formato nunca debe vaciar lo que ya está en el
// formato actual. Ejecuta las funciones reales de index.html. Datos ficticios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fuente(nombre) {
  const i = html.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, 'no encuentro ' + nombre);
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return html.slice(i, j + 1);
}
const ctx = { n: 0 };
ctx.exUidGen = () => 'nuevo' + (ctx.n++);
vm.createContext(ctx);
vm.runInContext(fuente('migrateLogKeys'), ctx);

const J = x => JSON.parse(JSON.stringify(x));
const programa = () => ({ weeks: [{ days: [{ exs: [{ uid: 'u1', sets: 3 }, { uid: 'u2', sets: 2 }] }] }] });

test('bloque SIN marca con registro en formato actual: no se pierde nada (el fallo de producción)', () => {
  const b = { data: { program: programa(), log: { 'u1|0': { kg: '42' }, 'u1|1': { kg: '44' }, 'u2|0': { kg: '10' } }, exNotes: { u1: { pain: 2 } } } };
  ctx.migrateLogKeys(b);
  assert.deepEqual(Object.keys(b.data.log).sort(), ['u1|0', 'u1|1', 'u2|0']);
  assert.deepEqual(J(b.data.exNotes), { u1: { pain: 2 } });
  assert.equal(b.data._logv, 2);
});

test('formato antiguo (día|ejercicio|serie|semana) se sigue convirtiendo', () => {
  const b = { data: { program: programa(), log: { '0|0|1|1': { kg: '30' }, '0|1|0|1': { kg: '5' } }, exNotes: { '0|0|1': { pain: 1 } } } };
  ctx.migrateLogKeys(b);
  assert.deepEqual(J(b.data.log), { 'u1|1': { kg: '30' }, 'u2|0': { kg: '5' } });
  assert.deepEqual(J(b.data.exNotes), { u1: { pain: 1 } });
});

test('mezcla: gana el dato en formato actual; lo huérfano antiguo se descarta como antes', () => {
  const b = { data: { program: programa(), log: { 'u1|0': { kg: 'nuevo' }, '0|0|0|1': { kg: 'viejo' }, '__none|0|5|0|1': { kg: 'x' }, '9|9|0|1': { kg: 'huerfano' } } } };
  ctx.migrateLogKeys(b);
  assert.deepEqual(J(b.data.log), { 'u1|0': { kg: 'nuevo' } });
});

test('ya marcado: no se toca', () => {
  const log = { cualquier: 1 };
  const b = { data: { _logv: 2, program: programa(), log } };
  ctx.migrateLogKeys(b);
  assert.equal(b.data.log, log);
});

test('los bloques nuevos nacen con la marca _logv=2', () => {
  assert.match(fuente('emptyBlock'), /_logv:2/);
});
