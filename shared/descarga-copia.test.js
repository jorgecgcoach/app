// D3: con C1 activo, «Descargar copia» no lleva PIN ni códigos. Ejecuta exportBackup REAL de index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fuente(nombre) {
  let i = html.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, 'no encuentro ' + nombre);
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return html.slice(i, j + 1);
}
function datos() {
  return {
    active: { c: 'cli1', b: 'b1' }, coachCode: 'PIN-FICTICIO', codes: { 'COD1-FICT-0001': { client: 'cli1' } },
    exLibrary: [{ n: 'Ejercicio ficticio' }], templates: { workouts: [], diets: [] }, negocio: { payments: [{ id: 1 }] },
    clients: { cli1: { name: 'Ficticio', code: 'COD1-FICT-0001', authUid: 'uid-f', authUids: ['uid-f'], blocks: [{ id: 'b1' }] } }
  };
}
function descargar(auth) {
  let texto = null, nombre = null;
  const DATA = datos();
  const original = JSON.stringify(DATA);
  const ctx = {
    AUTH_ENABLED: auth, DATA, toast() {}, setTimeout() {},
    Blob: class { constructor(partes) { texto = partes.join(''); } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    document: { createElement: () => ({ click() {}, remove() {}, set download(v) { nombre = v; } }), body: { appendChild() {} } }
  };
  vm.createContext(ctx);
  vm.runInContext(fuente('copiaSinCredenciales') + '\n' + fuente('exportBackup'), ctx);
  ctx.exportBackup();
  assert.equal(JSON.stringify(DATA), original, 'la descarga no modifica los datos de la app');
  assert.match(nombre, /^copia-jorgecgcoach-/);
  return { copia: JSON.parse(texto), texto };
}

test('con C1 activo: la descarga habitual no lleva PIN, lista de códigos ni el código de cada ficha', () => {
  const { copia, texto } = descargar(true);
  assert.equal(copia._sinCredenciales, true);
  assert.equal('coachCode' in copia.meta, false);
  assert.equal('codes' in copia.meta, false);
  assert.equal('code' in copia.clients.cli1, false);
  assert.equal(texto.includes('PIN-FICTICIO'), false);
  assert.equal(texto.includes('COD1-FICT-0001'), false);
  // Todo lo demás sigue: fichas, bloques, biblioteca, plantillas y negocio.
  assert.equal(copia.clients.cli1.name, 'Ficticio');
  assert.deepEqual(copia.clients.cli1.blocks, [{ id: 'b1' }]);
  assert.deepEqual(copia.meta.exLibrary, [{ n: 'Ejercicio ficticio' }]);
  assert.deepEqual(copia.meta.negocio, { payments: [{ id: 1 }] });
  assert.equal(copia.resumen.clientes, 1);
  assert.equal(copia.resumen.codigos, 0);
});

test('sin C1 (producción hoy) la descarga sigue igual que antes', () => {
  const { copia } = descargar(false);
  assert.equal(copia.meta.coachCode, 'PIN-FICTICIO');
  assert.deepEqual(copia.meta.codes, { 'COD1-FICT-0001': { client: 'cli1' } });
  assert.equal(copia.clients.cli1.code, 'COD1-FICT-0001');
  assert.equal(copia._sinCredenciales, undefined);
});

test('restaurar desde la app nunca usa PIN ni códigos de la copia (una copia sin ellos se restaura igual)', () => {
  const f = fuente('importBackupFile');
  assert.match(f, /\['exLibrary','templates','negocio'\]\.forEach/);
  assert.equal(/coachCode|\.codes\b/.test(f), false);
});
