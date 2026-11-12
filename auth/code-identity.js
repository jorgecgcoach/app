/* Identidad sintética de un cliente a partir de su código de acceso.
   El sufijo y el prefijo NO son secretos: viajan en la app. Solo evitan
   que el email sea el código en claro y que una clave corta falle el
   mínimo de 6 caracteres de Firebase Auth. La clave real sigue siendo el código.
   Mismo archivo para el navegador, los tests y el script de migración. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JcgAuthIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DOMAIN = 'clients.appjorgecgcoach.app';
  var HASH_PREFIX = 'jcgcoach-client-v1|';
  // Público. No añade secreto: alarga la contraseña hasta el mínimo de Auth.
  var PUBLIC_PASSWORD_SUFFIX = 'Jcg#1';

  /* Credenciales aleatorias (C1, 11-11-2026). Sustituyen a los códigos elegidos a mano (a menudo un
     documento de identidad, que se puede adivinar). 12 símbolos de base32 Crockford (sin I, L, O, U),
     generados con el generador criptográfico: 60 bits, unos 10^18 códigos posibles. Se muestran como
     XXXX-XXXX-XXXX. Al escribirlos da igual mayúsculas, espacios o guiones, y O se lee como 0 e I/L como 1. */
  var ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var LARGO = 12;
  var FUERTE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

  function compactStrong(raw) {
    var s = String(raw || '').toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return FUERTE.test(s) ? s : null;
  }

  function isStrongCode(raw) { return compactStrong(raw) !== null; }

  function formatStrong(c) { return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8, 12); }

  function randomBytes(n) {
    var out = new Uint8Array(n);
    if (globalThis.crypto && globalThis.crypto.getRandomValues) { globalThis.crypto.getRandomValues(out); return out; }
    // Nunca una fuente predecible (el aleatorio normal de JavaScript): sin generador criptográfico no se genera nada.
    if (typeof require !== 'function') throw new Error('sin-generador-seguro');
    var b = require('crypto').randomBytes(n);
    for (var i = 0; i < n; i++) out[i] = b[i];
    return out;
  }

  // 32 símbolos = 5 bits: cada byte aleatorio se recorta a 5 bits (256 es múltiplo de 32, sin sesgo).
  function generateClientCode() {
    var b = randomBytes(LARGO);
    var s = '';
    for (var i = 0; i < LARGO; i++) s += ALFABETO[b[i] & 31];
    return formatStrong(s);
  }

  // Un código fuerte siempre se normaliza a XXXX-XXXX-XXXX; los antiguos, como antes.
  function normAuthCode(raw) {
    var c = compactStrong(raw);
    if (c) return formatStrong(c);
    return String(raw || '').toUpperCase().replace(/\s+/g, '').trim();
  }

  function looksLikeBareDni(raw) {
    var n = normAuthCode(raw);
    return /^\d{8}[A-Z]?$/.test(n) || /^[XYZ]\d{7}[A-Z]?$/.test(n);
  }

  function clientPasswordFromCode(raw) {
    var n = normAuthCode(raw);
    if (n.length < 3) throw new Error('short-code');
    return n + PUBLIC_PASSWORD_SUFFIX;
  }

  function sha256Hex(text) {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      return globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
      });
    }
    var createHash = require('crypto').createHash;
    return Promise.resolve(createHash('sha256').update(text).digest('hex'));
  }

  function clientEmailFromCode(raw) {
    var n = normAuthCode(raw);
    if (n.length < 3) return Promise.reject(new Error('short-code'));
    return sha256Hex(HASH_PREFIX + n).then(function (hex) {
      return 'c' + hex.slice(0, 32) + '@' + DOMAIN;
    });
  }

  return {
    DOMAIN: DOMAIN,
    HASH_PREFIX: HASH_PREFIX,
    PUBLIC_PASSWORD_SUFFIX: PUBLIC_PASSWORD_SUFFIX,
    normAuthCode: normAuthCode,
    isStrongCode: isStrongCode,
    generateClientCode: generateClientCode,
    CODE_BITS: LARGO * 5,
    looksLikeBareDni: looksLikeBareDni,
    clientPasswordFromCode: clientPasswordFromCode,
    clientEmailFromCode: clientEmailFromCode
  };
});
