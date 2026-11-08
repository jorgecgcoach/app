// Pruebas de la Biblioteca de ejercicios (etapa 4). Solo lógica pura, datos ficticios.
// Ejecutar: node --test ui/coach-library.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('./coach-library.js');

const SERIE = [
  { n: 'Sentadilla con barra - Cuádriceps, aductores, glúteo', v: 'https://youtu.be/AAAAAAAAAAA', d: 'Desc A' },
  { n: 'Press banca - Pectoral , deltoides anterior, tríceps', v: 'https://youtu.be/BBBBBBBBBBB', d: '' },
  { n: 'Hip thrust - Glúteo, isquios, aductor', v: '', d: 'Desc C' },
  { n: 'Respiración libre', v: '', d: '' },
];

test('el grupo muscular sale del nombre y sin « - » queda sin clasificar', () => {
  assert.deepStrictEqual(L.klParse(SERIE[1].n), { base: 'Press banca', muscles: ['Pectoral', 'Deltoides anterior', 'Tríceps'] });
  assert.deepStrictEqual(L.klParse('Respiración libre').muscles, []);
});

test('aductor y aductores cuentan como el mismo grupo', () => {
  assert.strictEqual(L.klMuscleKey('aductor'), L.klMuscleKey('Aductores'));
  const g = L.klGroups(L.klMerge(SERIE, []));
  assert.strictEqual(g.find(x => x.key === 'aductores').n, 2);
});

test('los ejercicios propios sustituyen al de serie con el mismo nombre', () => {
  const all = L.klMerge(SERIE, [{ n: 'press banca - Pectoral , deltoides anterior, tríceps', v: 'https://youtu.be/CCCCCCCCCCC', d: 'Mía' }]);
  assert.strictEqual(all.length, 4);
  const p = all.find(x => x.base.toLowerCase() === 'press banca');
  assert.ok(p.own);
  assert.strictEqual(p.v, 'https://youtu.be/CCCCCCCCCCC');
});

test('orden alfabético por defecto, búsqueda sin tildes y filtros', () => {
  const all = L.klMerge(SERIE, []);
  const base = { q: '', mus: '', prim: false, vid: '', sort: 'az' };
  assert.deepStrictEqual(L.klFilter(all, base).map(x => x.base), ['Hip thrust', 'Press banca', 'Respiración libre', 'Sentadilla con barra']);
  assert.deepStrictEqual(L.klFilter(all, { ...base, sort: 'za' }).map(x => x.base)[0], 'Sentadilla con barra');
  assert.deepStrictEqual(L.klFilter(all, { ...base, q: 'respiracion' }).map(x => x.base), ['Respiración libre']);
  assert.deepStrictEqual(L.klFilter(all, { ...base, mus: 'gluteo' }).map(x => x.base), ['Hip thrust', 'Sentadilla con barra']);
  assert.deepStrictEqual(L.klFilter(all, { ...base, mus: 'gluteo', prim: true }).map(x => x.base), ['Hip thrust']);
  assert.deepStrictEqual(L.klFilter(all, { ...base, mus: '__none' }).map(x => x.base), ['Respiración libre']);
  assert.strictEqual(L.klFilter(all, { ...base, vid: 'con' }).length, 2);
  assert.strictEqual(L.klFilter(all, { ...base, vid: 'sin' }).length, 2);
});

test('PROPUESTA vídeo del entrenador: no cambia nombre, vídeo general ni descripción', () => {
  const lib = [];
  const out = L.klCoachVideoApply(lib, SERIE, SERIE[0].n, 'https://youtu.be/MIOMIOMIO01');
  assert.strictEqual(lib.length, 0, 'no muta la entrada');
  assert.deepStrictEqual(out, [{ n: SERIE[0].n, v: SERIE[0].v, d: SERIE[0].d, vc: 'https://youtu.be/MIOMIOMIO01' }]);
  const out2 = L.klCoachVideoApply(out, SERIE, SERIE[0].n, '');
  assert.deepStrictEqual(out2, [{ n: SERIE[0].n, v: SERIE[0].v, d: SERIE[0].d }]);
  const own = [{ n: 'Mi ejercicio', v: 'https://youtu.be/ORIGINAL001', d: 'x' }];
  const out3 = L.klCoachVideoApply(own, SERIE, 'mi ejercicio', 'https://youtu.be/MIOMIOMIO02');
  assert.deepStrictEqual(out3[0], { n: 'Mi ejercicio', v: 'https://youtu.be/ORIGINAL001', d: 'x', vc: 'https://youtu.be/MIOMIOMIO02' });
  assert.deepStrictEqual(L.klCoachVideoApply(own, SERIE, 'No existe', 'https://youtu.be/X'), own);
});
