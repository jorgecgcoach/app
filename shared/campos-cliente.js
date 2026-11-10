/* =======================================================================
   Campos de la ficha que SOLO decide el entrenador (C1).
   -----------------------------------------------------------------------
   Las reglas (firestore.rules, clientFieldsOk + ownersUnchanged) rechazan la
   escritura ENTERA de un cliente si cambia cualquiera de estos campos. La app
   del cliente rellena algunos por defecto en memoria (p. ej. clientNotifs()
   añade los tipos de aviso que faltan en fichas antiguas). Si ese relleno
   viajara, el cliente no podría guardar NADA, ni sus series.

   Por eso, en la app del cliente, lo que se envía lleva en estos campos lo que
   hay en la nube (la base del guardado seguro), nunca lo de la memoria:
   - si el campo existe en la nube, se envía el valor de la nube;
   - si no existe y es de los que el cliente puede crear por defecto (las
     reglas lo permiten: mods, serviceType, notifs), se envía el de memoria;
   - si no existe y no se puede crear, no se envía.
   Así el cliente nunca cambia su identidad, códigos, cuentas, permisos ni
   datos administrativos, y las reglas nunca bloquean sus series.

   firestore/campos-cliente.test.js comprueba que esta lista y la de las
   reglas son la misma.
   ======================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClientFields = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Identidad, código, pagos (no se pueden crear ni cambiar).
  const FIJOS = ['name', 'code', 'pagos'];
  // Permisos y configuración del entrenador (se pueden crear si faltan, nunca cambiar).
  const CREABLES = ['mods', 'serviceType', 'notifs'];
  // Cuentas de acceso (ownersUnchanged).
  const CUENTAS = ['authUid', 'authUids'];
  const PROTEGIDOS = FIJOS.concat(CREABLES, CUENTAS);

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  // local: la ficha que se va a enviar (ya saneada). servidor: la última versión conocida de la nube.
  function limitarEnvio(local, servidor) {
    if (!local || typeof local !== 'object') return local;
    const out = Object.assign({}, local);
    for (const k of PROTEGIDOS) {
      if (has(servidor, k)) out[k] = servidor[k];
      else if (CREABLES.indexOf(k) >= 0 && has(local, k)) out[k] = local[k];
      else delete out[k];
    }
    return out;
  }

  return { limitarEnvio, PROTEGIDOS, FIJOS, CREABLES, CUENTAS };
});
