// shared/campos-cliente.js: lo que envía la app del cliente en los campos del entrenador.
const test = require('node:test');
const assert = require('node:assert/strict');
const CF = require('./campos-cliente');

test('campos del entrenador: siempre el valor de la nube', () => {
  const nube = { name: 'A', code: 'C', pagos: [1], mods: { a: true }, serviceType: 't', notifs: { s: 1 }, authUid: 'u', authUids: ['u'], blocks: [] };
  const local = { name: 'B', code: 'D', pagos: [], mods: { a: false, b: true }, serviceType: 'x', notifs: {}, authUid: 'v', authUids: ['v'], blocks: [{ id: 1 }] };
  const out = CF.limitarEnvio(local, nube);
  for (const k of CF.PROTEGIDOS) assert.deepEqual(out[k], nube[k], k);
  assert.deepEqual(out.blocks, [{ id: 1 }], 'lo del cliente sí viaja');
  assert.equal(local.name, 'B', 'no modifica la memoria');
});

test('si faltan en la nube: los creables viajan; identidad, código, pagos y cuentas, no', () => {
  const out = CF.limitarEnvio({ name: 'B', code: 'D', pagos: [], authUid: 'v', mods: { a: true }, notifs: {}, serviceType: null, x: 1 }, { x: 0 });
  assert.deepEqual(Object.keys(out).sort(), ['mods', 'notifs', 'serviceType', 'x']);
});

test('sin nube conocida (null): no inventa campos del entrenador', () => {
  const out = CF.limitarEnvio({ name: 'B', mods: {}, x: 1 }, null);
  assert.deepEqual(out, { mods: {}, x: 1 });
});
