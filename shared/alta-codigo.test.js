// C1: altas y cambios de código desde el navegador del entrenador (con Auth).
// Ejecuta las funciones REALES de index.html con dobles de Firebase. Datos ficticios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ident = require('../auth/code-identity');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fuente(nombre) {
  let i = html.indexOf('async function ' + nombre + '(');
  if (i < 0) i = html.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, 'no encuentro ' + nombre);
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return html.slice(i, j + 1);
}
const FUNCIONES = ['normCode', 'isStrongFormat', 'codeAllowed', 'newClientCode', 'validarCodigoNuevo', 'assignClientCode',
  'clientCodeOf', 'provisionClientAuth', 'errorAlta', 'comprobarSesionEntrenador', 'cambiarCodigoConCuenta',
  'avisoAltaCliente', 'codigoAlGuardarBloque', 'activarAccesoCliente'];
const json = v => JSON.parse(JSON.stringify(v));

/* Firebase de mentira. `cuentas` es el «servidor» de Auth (email → uid). */
function contexto(o) {
  o = o || {};
  const cuentas = new Map(o.cuentas || []);
  const registro = []; // orden de los efectos: la ficha debe cambiar DESPUÉS de crear la cuenta
  let n = 0;
  let ctx;
  const secundaria = {
    setPersistence: async () => {},
    createUserWithEmailAndPassword: async (email) => {
      if (o.retrasoAlta) await new Promise(r => setTimeout(r, o.retrasoAlta));
      if (o.redCae) { registro.push('alta-fallida'); throw { code: 'auth/network-request-failed' }; }
      if (cuentas.has(email)) { registro.push('alta-existente'); throw { code: 'auth/email-already-in-use' }; }
      const uid = 'uid-' + (++n);
      cuentas.set(email, uid);
      const f = ctx.DATA.clients.cli1;
      registro.push('alta:' + uid + ':codigo=' + (f && f.code));
      return { user: { uid } };
    },
    signOut: async () => {}
  };
  const usuarioEntrenador = o.sinSesion ? null : {
    getIdToken: async () => { if (o.tokenCaducado) throw { code: 'auth/user-token-expired' }; return 't'; }
  };
  const authFn = () => ({ currentUser: usuarioEntrenador });
  authFn.Auth = { Persistence: { NONE: 'none' } };
  ctx = {
    AUTH_ENABLED: o.auth !== false, window: { JcgAuthIdentity: ident }, console: { warn() {} },
    DATA: { codes: { 'VIEJO-1': { client: 'cli1' } }, clients: { cli1: { name: 'Ficticio', code: 'VIEJO-1', authUid: 'uid-viejo', authUids: ['uid-viejo'] }, cli2: { name: 'Otro' } } },
    _codigosGenerados: new Set(), _altaEnCurso: false,
    firebase: { auth: authFn, app: () => ({ auth: () => secundaria, options: {} }), initializeApp: () => ({ auth: () => secundaria }) },
    ensureAuthReady: async () => {},
    avisos: [], guardados: [], registro,
    toast(t) { ctx.avisos.push(t); },
    save(cid) { registro.push('save:' + cid); ctx.guardados.push(cid); }
  };
  vm.createContext(ctx);
  vm.runInContext(FUNCIONES.map(fuente).join('\n'), ctx);
  ctx.cuentas = cuentas;
  return ctx;
}
const fichaIntacta = c => assert.deepEqual(json(c.DATA.clients.cli1), { name: 'Ficticio', code: 'VIEJO-1', authUid: 'uid-viejo', authUids: ['uid-viejo'] });

test('el guardado del bloque usa la función que también crea la cuenta', () => {
  assert.match(fuente('saveBlock'), /codigoAlGuardarBloque\(cid,codeRaw\)/);
});

test('con Auth: un código generado crea la cuenta y SOLO después cambia código y cuentas, en un único guardado', async () => {
  const c = contexto();
  const code = c.newClientCode();
  assert.equal(await c.cambiarCodigoConCuenta('cli1', code.toLowerCase()), 'uid-1');
  assert.deepEqual(c.registro, ['alta:uid-1:codigo=VIEJO-1', 'save:cli1'], 'la ficha seguía igual mientras se creaba la cuenta');
  const f = json(c.DATA.clients.cli1);
  assert.equal(f.code, code);
  assert.equal(f.authUid, 'uid-1');
  assert.deepEqual(f.authUids, ['uid-1'], 'la cuenta anterior pierde el acceso');
  assert.deepEqual(json(c.DATA.codes), { [code]: { client: 'cli1' } });
});

test('con Auth: códigos elegidos a mano se rechazan, también si tienen el formato de uno generado', async () => {
  for (const debil of ['12345678Z', '12345678Z-7', 'JUAN2026', 'FICT-1', '7K3M-Q9TB-0R1W', 'MAR1AGARC1A1']) {
    const c = contexto();
    await assert.rejects(c.cambiarCodigoConCuenta('cli1', debil), e => e.code === 'jcg/codigo-no-valido', debil);
    assert.equal(c.cuentas.size, 0, 'no se crea ninguna cuenta');
    fichaIntacta(c);
    assert.equal(c.assignClientCode('cli1', debil), false);
    fichaIntacta(c);
  }
});

test('un código generado es de un solo uso: no vale para otro cliente', async () => {
  const c = contexto();
  const code = c.newClientCode();
  await c.cambiarCodigoConCuenta('cli1', code);
  await assert.rejects(c.cambiarCodigoConCuenta('cli2', code), e => e.code === 'jcg/codigo-no-valido');
  assert.equal(c.cuentas.size, 1);
});

test('si ya existe una cuenta para el código (otra persona lo conocía y se adelantó): no se vincula y la ficha no cambia', async () => {
  const code = ident.generateClientCode();
  const c = contexto({ cuentas: [[await ident.clientEmailFromCode(code), 'uid-intruso']] });
  c._codigosGenerados.add(code);
  await assert.rejects(c.cambiarCodigoConCuenta('cli1', code), e => e.code === 'jcg/code-in-use');
  fichaIntacta(c);
  assert.deepEqual(json(c.DATA.codes), { 'VIEJO-1': { client: 'cli1' } });
  assert.deepEqual(c.guardados, []);
  assert.match(c.avisoAltaCliente({ code: 'jcg/code-in-use' }), /no se ha usado/);
});

test('error de red al crear la cuenta: la ficha no cambia y el código anterior sigue valiendo', async () => {
  const c = contexto({ redCae: true });
  await assert.rejects(c.cambiarCodigoConCuenta('cli1', c.newClientCode()), e => e.code === 'auth/network-request-failed');
  fichaIntacta(c);
  assert.deepEqual(c.guardados, []);
  assert.match(c.avisoAltaCliente({ code: 'auth/network-request-failed' }), /No se ha cambiado el acceso/);
});

test('respuesta perdida (la cuenta se creó pero no llegó la respuesta): repetir con el mismo código NO reutiliza la cuenta', async () => {
  const c = contexto();
  const code = c.newClientCode();
  c.cuentas.set(await ident.clientEmailFromCode(code), 'uid-huerfana');
  await assert.rejects(c.cambiarCodigoConCuenta('cli1', code), e => e.code === 'jcg/code-in-use');
  fichaIntacta(c);
  assert.equal(await c.cambiarCodigoConCuenta('cli1', c.newClientCode()), 'uid-1', 'con otro código, sí');
});

test('sesión del entrenador caducada o cerrada: no se crea ninguna cuenta', async () => {
  for (const o of [{ sinSesion: true }, { tokenCaducado: true }]) {
    const c = contexto(o);
    await assert.rejects(c.cambiarCodigoConCuenta('cli1', c.newClientCode()), e => e.code === 'jcg/sesion-entrenador');
    assert.equal(c.cuentas.size, 0);
    fichaIntacta(c);
    assert.match(c.avisoAltaCliente({ code: 'jcg/sesion-entrenador' }), /Vuelve a entrar/);
  }
});

test('doble pulsación: solo un cambio a la vez, una sola cuenta', async () => {
  const c = contexto({ retrasoAlta: 20 });
  const a = c.newClientCode(), b = c.newClientCode();
  const p1 = c.cambiarCodigoConCuenta('cli1', a);
  await assert.rejects(c.cambiarCodigoConCuenta('cli1', b), e => e.code === 'jcg/alta-en-curso');
  await p1;
  assert.equal(c.cuentas.size, 1);
  assert.equal(c.DATA.clients.cli1.code, a);
  assert.equal(c._altaEnCurso, false, 'el cerrojo se suelta');
});

test('la ficha se borró mientras se creaba la cuenta: no se escribe el código', async () => {
  const c = contexto({ retrasoAlta: 10 });
  const p = c.cambiarCodigoConCuenta('cli1', c.newClientCode());
  delete c.DATA.clients.cli1;
  await assert.rejects(p, e => e.code === 'jcg/ficha-borrada');
  assert.deepEqual(json(c.DATA.codes), { 'VIEJO-1': { client: 'cli1' } });
  assert.deepEqual(c.guardados, []);
});

test('«Nuevo cliente» / «Añadir bloque»: con Auth activa la cuenta; si falla, avisa con ⚠ y no guarda', async () => {
  const ok = contexto();
  assert.equal(await ok.codigoAlGuardarBloque('cli2', ok.newClientCode()), true);
  assert.deepEqual(json(ok.DATA.clients.cli2.authUids), ['uid-1']);
  const mal = contexto({ redCae: true });
  assert.equal(await mal.codigoAlGuardarBloque('cli2', mal.newClientCode()), false);
  assert.deepEqual(mal.guardados, []);
  assert.match(mal.avisos[0], /^⚠/);
});

test('sin cambios o vacío: no se crea ninguna cuenta', () => {
  const c = contexto();
  assert.equal(c.codigoAlGuardarBloque('cli1', 'VIEJO-1'), null);
  assert.equal(c.codigoAlGuardarBloque('cli1', ''), null);
  assert.equal(c.cuentas.size, 0);
});

test('sin Auth (producción hoy): se siguen aceptando los códigos actuales, sin cuentas', () => {
  const c = contexto({ auth: false });
  assert.equal(c.codigoAlGuardarBloque('cli1', 'FICT-1'), null);
  assert.equal(c.DATA.clients.cli1.code, 'FICT-1');
  assert.equal(c.cuentas.size, 0);
});

test('los campos de código son de solo lectura con Auth y la ventana muestra el código vigente', () => {
  assert.match(fuente('openCodeModal'), /readOnly=AUTH_ENABLED/);
  assert.match(fuente('openCodeModal'), /!isStrongFormat\(cur\)\)\?newClientCode\(\):cur/);
  assert.match(fuente('openAdd'), /\$\("#addCode"\)\.readOnly=AUTH_ENABLED/);
  assert.match(fuente('saveCodeModalWithAuth'), /Sin cambios/);
});

test('entrada del cliente: un código antiguo se avisa SIN enviarlo a Firebase', () => {
  const f = fuente('loginClientWithAuth');
  const chequeo = f.indexOf('isStrongCode(code)');
  assert.ok(chequeo > 0);
  assert.ok(chequeo < f.indexOf('clientEmailFromCode'), 'antes de derivar el correo');
  assert.ok(chequeo < f.indexOf('signInWithEmailAndPassword'), 'antes de llamar a Auth');
  assert.match(f, /han cambiado por seguridad/);
});
