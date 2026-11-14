// Regresión del 14-11-2026: al fallar «Entrar con contraseña» el aviso de error quedaba DETRÁS de la
// pantalla de acceso (z-index del aviso 90 < 100 de la pantalla) y parecía que el botón no hacía nada.
// Y el acceso de respaldo solo se da por listo si Firebase confirma que la cuenta ya tiene contraseña.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const zIndex = sel => {
  const m = html.match(new RegExp('\\n\\' + sel + '\\{[^}]*z-index:(\\d+)'));
  assert.ok(m, 'no encuentro el z-index de ' + sel);
  return Number(m[1]);
};
const funcion = nombre => {
  const i = html.indexOf('async function ' + nombre + '(');
  assert.ok(i >= 0, 'no encuentro ' + nombre);
  const fin = html.slice(i).search(/\n\}\r?\n/);
  assert.ok(fin > 0, 'no encuentro el final de ' + nombre);
  return html.slice(i, i + fin);
};

test('los avisos se ven por encima de la pantalla de acceso y de las ventanas', () => {
  const toast = zIndex('.toast');
  assert.ok(toast > zIndex('.login-gate'), 'aviso por encima de la pantalla de acceso');
  assert.ok(toast > zIndex('.scrim'), 'aviso por encima de las ventanas');
});

test('un error al entrar con contraseña se avisa', () => {
  const f = funcion('submitCoachPassword');
  assert.match(f, /toast\([^;]*Correo o contraseña no válidos/);
});

test('el acceso de respaldo solo se da por listo si Firebase confirma la contraseña en la misma cuenta', () => {
  const f = funcion('saveCoachBackupAccess');
  const iUpd = f.indexOf('updatePassword('), iRel = f.indexOf('.reload()'), iChk = f.indexOf("providerId==='password'"), iOk = f.indexOf('Acceso de respaldo listo');
  assert.ok(iUpd > 0 && iRel > iUpd && iChk > iRel && iOk > iChk, 'updatePassword → reload → comprobar proveedor password → aviso de listo');
  assert.match(f, /cu\.uid===u\.uid/, 'misma cuenta (mismo UID)');
});
