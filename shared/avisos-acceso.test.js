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

test('la app instalada en el ordenador entra con Google por ventana emergente; la redirección solo en iPhone/iPad', () => {
  const i = html.indexOf('function preferGoogleRedirect(');
  const f = html.slice(i, i + html.slice(i).search(/\n\}\r?\n/));
  const prefer = new Function('window', 'navigator', f + '\n}\nreturn preferGoogleRedirect();');
  const win = standalone => ({ matchMedia: () => ({ matches: standalone }) });
  const pc = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', platform: 'Win32', maxTouchPoints: 0 };
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari', platform: 'iPhone', maxTouchPoints: 5 };
  assert.equal(prefer(win(true), pc), false, 'app instalada en el PC: ventana emergente');
  assert.equal(prefer(win(false), pc), false, 'pestaña normal en el PC: ventana emergente');
  assert.equal(prefer(win(false), iphone), false, 'Safari en iPhone: ventana emergente');
  assert.equal(prefer(win(true), iphone), true, 'app de la pantalla de inicio del iPhone: redirección');
});

test('el ayudante de Google se sirve desde la misma dirección que la app (iPhone, app del icono)', () => {
  const m = html.match(/const firebaseConfig = \{[\s\S]*?authDomain:\s*"([^"]+)"/);
  assert.ok(m, 'no encuentro authDomain');
  assert.equal(m[1], 'jorgecgcoach.github.io');
});
