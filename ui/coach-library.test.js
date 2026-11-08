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

test('vídeo del entrenador: no cambia nombre, vídeo general ni descripción', () => {
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

test('una copia hecha solo para tu vídeo no se marca como «tuyo» ni se duplica', () => {
  const lib = L.klCoachVideoApply([], SERIE, SERIE[1].n, 'https://youtu.be/MIOMIOMIO03');
  const all = L.klMerge(SERIE, lib);
  assert.strictEqual(all.length, SERIE.length);
  const p = all.find(x => x.base === 'Press banca');
  assert.strictEqual(p.own, false);
  assert.strictEqual(p.vc, 'https://youtu.be/MIOMIOMIO03');
  assert.strictEqual(p.v, SERIE[1].v);
});

test('editar cambia la entrada en su sitio y añadir va al final (cambios mínimos para el guardado seguro)', () => {
  const lib = [{ n: 'Otro', v: '', d: '' }, { n: SERIE[0].n, v: SERIE[0].v, d: SERIE[0].d, vc: 'https://youtu.be/AAAAAAAAAA1' }];
  const ed = L.klCoachVideoApply(lib, SERIE, SERIE[0].n, 'https://youtu.be/AAAAAAAAAA2');
  assert.strictEqual(ed.length, 2);
  assert.strictEqual(ed[1].vc, 'https://youtu.be/AAAAAAAAAA2');
  assert.deepStrictEqual(ed[0], lib[0]);
  const add = L.klCoachVideoApply(lib, SERIE, SERIE[2].n, 'https://vimeo.com/123456');
  assert.strictEqual(add.length, 3);
  assert.deepStrictEqual(add.slice(0, 2), lib);
  assert.deepStrictEqual(add[2], { n: SERIE[2].n, v: '', d: 'Desc C', vc: 'https://vimeo.com/123456' });
  // Con nombres repetidos se cambia la última entrada, que es la que se muestra.
  const dup = [{ n: 'X', v: '1', d: '' }, { n: 'x', v: '2', d: '' }];
  const r = L.klCoachVideoApply(dup, [], 'X', 'https://youtu.be/BBBBBBBBBB1');
  assert.strictEqual(r[0].vc, undefined);
  assert.strictEqual(r[1].vc, 'https://youtu.be/BBBBBBBBBB1');
});

test('validación de enlaces', () => {
  const V = L.klValidateUrl;
  assert.strictEqual(V('').ok, false);
  assert.strictEqual(V('hola que tal').ok, false);
  assert.strictEqual(V('ftp://youtube.com/x').ok, false);
  assert.strictEqual(V('javascript:alert(1)').ok, false);
  assert.strictEqual(V('https://localhost').ok, false);
  assert.strictEqual(V('https://www.youtube.com/@canal').ok, false, 'YouTube sin vídeo concreto');
  assert.deepStrictEqual(V('  https://youtu.be/dQw4w9WgXcQ  '), { ok: true, url: 'https://youtu.be/dQw4w9WgXcQ', embed: true });
  assert.strictEqual(V('youtube.com/shorts/XNjNbfKAeic').url, 'https://youtube.com/shorts/XNjNbfKAeic');
  assert.strictEqual(V('https://drive.google.com/file/d/abc123/view').embed, true);
  assert.deepStrictEqual(V('https://www.instagram.com/reel/xyz/'), { ok: true, url: 'https://www.instagram.com/reel/xyz/', embed: false });
});

// Guardado seguro real (shared/safe-save.js, sin modificar): dos dispositivos a la vez.
test('guardado seguro: dos dispositivos añaden su vídeo a ejercicios distintos y no se pisan', () => {
  const S = require('../shared/safe-save.js');
  const opts = { onlyKeys: ['exLibrary'] };
  const base = { exLibrary: [{ n: 'Mío', v: '', d: '' }] };
  const a = { exLibrary: L.klCoachVideoApply(base.exLibrary, SERIE, SERIE[0].n, 'https://youtu.be/AAAAAAAAAA1') };
  const b = { exLibrary: L.klCoachVideoApply(base.exLibrary, SERIE, SERIE[1].n, 'https://youtu.be/BBBBBBBBBB1') };
  const afterA = S.merge3(base, a, base, opts);          // A guarda primero
  assert.deepStrictEqual(afterA.conflicts, []);
  const afterB = S.merge3(base, b, afterA.doc, opts);    // B guarda encima de lo de A
  assert.deepStrictEqual(afterB.conflicts, []);
  const vcs = afterB.doc.exLibrary.map(x => x.vc).filter(Boolean).sort();
  assert.deepStrictEqual(vcs, ['https://youtu.be/AAAAAAAAAA1', 'https://youtu.be/BBBBBBBBBB1']);
  assert.strictEqual(afterB.doc.exLibrary[0].n, 'Mío');
});

test('guardado seguro: si dos dispositivos cambian el mismo vídeo a la vez, se para y avisa (no sobrescribe)', () => {
  const S = require('../shared/safe-save.js');
  const opts = { onlyKeys: ['exLibrary'] };
  const base = { exLibrary: [{ n: SERIE[0].n, v: SERIE[0].v, d: SERIE[0].d, vc: 'https://youtu.be/ORIGINAL001' }] };
  const a = { exLibrary: L.klCoachVideoApply(base.exLibrary, SERIE, SERIE[0].n, 'https://youtu.be/DEVICEA0001') };
  const b = { exLibrary: L.klCoachVideoApply(base.exLibrary, SERIE, SERIE[0].n, 'https://youtu.be/DEVICEB0001') };
  const afterA = S.merge3(base, a, base, opts);
  const afterB = S.merge3(base, b, afterA.doc, opts);
  assert.ok(afterB.conflicts.length > 0, 'debe detectar el conflicto');
  assert.strictEqual(afterA.doc.exLibrary[0].vc, 'https://youtu.be/DEVICEA0001');
});
