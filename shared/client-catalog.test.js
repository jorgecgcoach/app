// Pruebas del catálogo de vídeos para clientes (datos ficticios). node --test shared/client-catalog.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./client-catalog.js');

const LIB = [
  { n: 'Remo propio', v: 'https://youtu.be/AAAAAAAAAAA', d: 'Descripción privada', vc: 'https://youtu.be/MIOMIOMIO01' },
  { n: 'Sin vídeo', v: '', d: 'x' },
  { n: 'remo propio', v: 'https://youtu.be/OTROOTRO001' },
  { n: 'Peligroso', v: 'javascript:alert(1)' },
  { n: 'Con espacios', v: 'https://youtu.be/x y' },
  { n: '  Aperturas  ', v: ' https://vimeo.com/123456 ' },
  null, 'texto', { v: 'https://youtu.be/SINNOMBRE01' }
];

test('solo nombre y vídeo general; nada de descripción ni vídeo del entrenador', () => {
  const { items } = C.build(LIB);
  for (const it of items) assert.deepEqual(Object.keys(it).sort(), ['n', 'v']);
  assert.ok(!JSON.stringify(items).includes('privada'));
  assert.ok(!JSON.stringify(items).includes('MIOMIOMIO01'));
});

test('misma regla que libVideoByName: gana la primera entrada con ese nombre', () => {
  const { items } = C.build(LIB);
  const remo = items.filter(x => x.n.toLowerCase() === 'remo propio');
  assert.equal(remo.length, 1);
  assert.equal(remo[0].v, 'https://youtu.be/AAAAAAAAAAA');
});

test('descarta enlaces vacíos, peligrosos o mal formados y recorta espacios', () => {
  const { items } = C.build(LIB);
  assert.deepEqual(items, [
    { n: 'Aperturas', v: 'https://vimeo.com/123456' },
    { n: 'Remo propio', v: 'https://youtu.be/AAAAAAAAAAA' }
  ]);
});

test('lo recibido de la nube se vuelve a limpiar', () => {
  const s = C.sanitize([{ n: 'A', v: 'https://youtu.be/AAAAAAAAAAA', extra: 'no' }, { n: 'B', v: 'data:text/html,x' }, 7]);
  assert.deepEqual(s, [{ n: 'A', v: 'https://youtu.be/AAAAAAAAAAA' }]);
  assert.deepEqual(C.sanitize(undefined), []);
});

test('la firma no cambia si el contenido es el mismo (no hay escrituras innecesarias)', () => {
  const a = C.build(LIB).items;
  const b = C.build(LIB.slice().reverse().filter(x => !(x && x.v === 'https://youtu.be/OTROOTRO001'))).items;
  assert.equal(C.signature(a), C.signature(b));
  assert.notEqual(C.signature(a), C.signature([{ n: 'Aperturas', v: 'https://vimeo.com/999' }]));
});

test('límite de tamaño', () => {
  const big = Array.from({ length: C.MAX_ITEMS + 50 }, (_, i) => ({ n: 'E' + i, v: 'https://youtu.be/VID' + i }));
  assert.equal(C.build(big).items.length, C.MAX_ITEMS);
});
