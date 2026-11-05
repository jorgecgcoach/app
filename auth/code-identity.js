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

  function normAuthCode(raw) {
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
    looksLikeBareDni: looksLikeBareDni,
    clientPasswordFromCode: clientPasswordFromCode,
    clientEmailFromCode: clientEmailFromCode
  };
});
