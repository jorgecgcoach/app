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

// Códigos aleatorios (C1): con Auth solo valen los generados, y una cuenta que ya existiera no se reutiliza.
const ident = require('../auth/code-identity');
function contextoCodigos(auth, extra) {
  const ctx = Object.assign({
    AUTH_ENABLED: auth, window: { JcgAuthIdentity: ident }, DATA: { codes: {}, clients: { cli1: { name: 'Ficticio' } } },
    avisos: [], guardados: [], toast(t) { ctx.avisos.push(t); }, save(cid) { ctx.guardados.push(cid); }
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(['normCode', 'codeAllowed', 'newClientCode', 'assignClientCode', 'provisionClientAuth'].map(fuente).join('\n'), ctx);
  return ctx;
}

test('con Auth: un código elegido a mano (p. ej. un DNI o con sufijo) no se asigna', () => {
  for (const debil of ['12345678Z', '12345678Z-7', 'JUAN2026', 'FICT-1']) {
    const c = contextoCodigos(true);
    assert.equal(c.assignClientCode('cli1', debil), false, debil);
    assert.deepEqual(c.DATA.codes, {});
    assert.equal(c.DATA.clients.cli1.code, undefined);
    assert.match(c.avisos[0], /^⚠ Solo valen códigos generados/);
  }
});

test('con Auth: el código generado se asigna, normalizado aunque se escriba en minúsculas', () => {
  const c = contextoCodigos(true);
  const code = c.newClientCode();
  assert.equal(ident.isStrongCode(code), true);
  assert.equal(c.assignClientCode('cli1', code.toLowerCase().replace(/-/g, ' ')), true);
  assert.equal(c.DATA.clients.cli1.code, code);
  assert.equal(JSON.stringify(c.DATA.codes[code]), '{"client":"cli1"}');
});

test('sin Auth (producción hoy) se siguen aceptando los códigos actuales', () => {
  const c = contextoCodigos(false);
  assert.equal(c.assignClientCode('cli1', 'FICT-1'), true);
});

function firebaseFalso(crear) {
  const auth = { setPersistence: async () => {}, createUserWithEmailAndPassword: crear, signOut: async () => {} };
  const app = { auth: () => auth };
  return { app: () => app, initializeApp: () => app, auth: { Auth: { Persistence: { NONE: 'none' } } } };
}

test('si ya existe una cuenta para el código, NO se vincula a la ficha (podría ser de otra persona)', async () => {
  const c = contextoCodigos(true, { firebase: firebaseFalso(async () => { throw { code: 'auth/email-already-in-use' }; }) });
  c.DATA.clients.cli1.authUids = ['uid-anterior'];
  await assert.rejects(c.provisionClientAuth('cli1', ident.generateClientCode()), e => e.code === 'jcg/code-in-use');
  assert.deepEqual(c.DATA.clients.cli1.authUids, ['uid-anterior'], 'no se toca la ficha');
  assert.equal(c.DATA.clients.cli1.authUid, undefined);
});

test('al dar un código nuevo, solo su cuenta queda en la ficha (las anteriores pierden el acceso)', async () => {
  const c = contextoCodigos(true, { firebase: firebaseFalso(async () => ({ user: { uid: 'uid-nuevo' } })) });
  c.DATA.clients.cli1.authUids = ['uid-anterior', 'uid-ajeno'];
  assert.equal(await c.provisionClientAuth('cli1', ident.generateClientCode()), 'uid-nuevo');
  assert.equal(JSON.stringify(c.DATA.clients.cli1.authUids), '["uid-nuevo"]');
  assert.equal(c.DATA.clients.cli1.authUid, 'uid-nuevo');
});
