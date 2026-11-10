// C1: el código puesto en «Nuevo cliente» / «Añadir bloque» también crea la cuenta de acceso del cliente.
// Ejecuta las funciones reales de index.html con dobles de prueba. Datos ficticios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fuente(nombre) {
  let i = html.indexOf('async function ' + nombre + '(');
  if (i < 0) i = html.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, 'no encuentro ' + nombre);
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return html.slice(i, j + 1);
}
function contexto(opciones) {
  const ctx = {
    AUTH_ENABLED: opciones.auth, console: { warn() {} },
    actual: opciones.actual || null, asignados: [], altas: [], guardados: [], avisos: [],
    clientCodeOf() { return ctx.actual; },
    assignClientCode(cid, code) { if (opciones.codigoOcupado) return false; ctx.asignados.push(cid + ':' + code); return true; },
    ensureAuthReady: async () => {},
    provisionClientAuth: async (cid, code) => { if (opciones.fallaAlta) throw { code: 'auth/network-request-failed' }; ctx.altas.push(cid + ':' + code); },
    save(cid) { ctx.guardados.push(cid); },
    toast(t) { ctx.avisos.push(t); }
  };
  vm.createContext(ctx);
  vm.runInContext(fuente('codigoAlGuardarBloque') + '\n' + fuente('activarAccesoCliente'), ctx);
  return ctx;
}

test('el guardado del bloque usa la función que también crea la cuenta', () => {
  assert.match(fuente('saveBlock'), /codigoAlGuardarBloque\(cid,codeRaw\)/);
});

test('con Auth: código nuevo en «Nuevo cliente» → se asigna, se crea la cuenta y se guarda la ficha', async () => {
  const c = contexto({ auth: true });
  assert.equal(await c.codigoAlGuardarBloque('cli1', 'FICT-1'), true);
  assert.deepEqual(c.asignados, ['cli1:FICT-1']);
  assert.deepEqual(c.altas, ['cli1:FICT-1']);
  assert.deepEqual(c.guardados, ['cli1']);
});

test('con Auth: si la cuenta no se puede crear, se avisa con ⚠ y no se da por activado', async () => {
  const c = contexto({ auth: true, fallaAlta: true });
  assert.equal(await c.codigoAlGuardarBloque('cli1', 'FICT-1'), false);
  assert.deepEqual(c.guardados, []);
  assert.match(c.avisos[0], /^⚠/);
});

test('sin Auth (como hoy en producción): solo se asigna el código, sin cuentas', () => {
  const c = contexto({ auth: false });
  assert.equal(c.codigoAlGuardarBloque('cli1', 'FICT-1'), null);
  assert.deepEqual(c.asignados, ['cli1:FICT-1']);
  assert.deepEqual(c.altas, []);
});

test('código sin cambios, vacío u ocupado por otro cliente: no se crea ninguna cuenta', () => {
  const igual = contexto({ auth: true, actual: 'FICT-1' });
  assert.equal(igual.codigoAlGuardarBloque('cli1', 'FICT-1'), null);
  assert.deepEqual(igual.asignados, []);
  assert.equal(contexto({ auth: true }).codigoAlGuardarBloque('cli1', ''), null);
  const ocupado = contexto({ auth: true, codigoOcupado: true });
  assert.equal(ocupado.codigoAlGuardarBloque('cli1', 'FICT-2'), null);
  assert.deepEqual(ocupado.altas, []);
});
