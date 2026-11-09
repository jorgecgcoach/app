/* Restauración ADITIVA de una copia: añade lo que falta y nunca borra ni cambia lo que ya existe.
   La usan la app («Restaurar desde un archivo») y scripts/restaurar-copia.js, para que las dos
   restauren igual.
   - Campo que no existe → se añade.
   - Objeto → se baja un nivel.
   - Lista de elementos con id/uid/date (mismo criterio que shared/safe-save.js): los que siguen
     existiendo se recorren por dentro (series perdidas dentro de un bloque que sigue ahí) y los que
     faltan se añaden al final. Sin clave no se puede saber cuál es cuál: se deja como está.
   - Cualquier valor que ya exista, aunque sea distinto, NO se toca: lo hecho después de la copia gana.
   - Credenciales y dueños (códigos, PIN, cuentas, tokens) nunca se reponen en un documento existente:
     un código retirado a propósito no debe volver a funcionar.
   - Los campos de sincronización del guardado seguro (_rev, _updatedAt, _updatedBy, _writers) nunca
     salen de la copia: son de la nube. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CopiaAditiva = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY_FIELDS = ['id', 'uid', 'date'];
  const SYNC_FIELDS = ['_rev', '_updatedAt', '_updatedBy', '_writers'];
  const NO_REPONER = ['codes', 'coachCode', 'code', 'authUid', 'authUids', 'push', 'coachPush'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function keyOf(item) {
    if (!isObj(item)) return null;
    for (const k of KEY_FIELDS) if (item[k] !== undefined && item[k] !== null && item[k] !== '') return k + ':' + String(item[k]);
    return null;
  }
  function sinSync(doc) {
    const o = Object.assign({}, doc);
    SYNC_FIELDS.forEach(function (k) { delete o[k]; });
    return o;
  }

  function fusionAditiva(actual, copia, ruta, cambios) {
    ruta = ruta || '';
    cambios = cambios || [];
    if (actual === undefined) { cambios.push({ ruta: ruta || '(documento)', tipo: 'documento-nuevo' }); return { valor: copia, cambios }; }
    if (isObj(actual) && isObj(copia)) {
      const out = Object.assign({}, actual);
      for (const k of Object.keys(copia)) {
        if (!ruta && SYNC_FIELDS.indexOf(k) >= 0) continue;
        if (NO_REPONER.indexOf(k) >= 0) continue;
        const r = ruta ? ruta + '.' + k : k;
        if (!(k in actual)) { out[k] = copia[k]; cambios.push({ ruta: r, tipo: 'campo' }); continue; }
        out[k] = fusionAditiva(actual[k], copia[k], r, cambios).valor;
      }
      return { valor: out, cambios };
    }
    if (Array.isArray(actual) && Array.isArray(copia)) {
      const enCopia = new Map();
      copia.forEach(function (it) { const k = keyOf(it); if (k && !enCopia.has(k)) enCopia.set(k, it); });
      const enActual = new Set(actual.map(keyOf).filter(Boolean));
      const vistos = new Set();
      const valor = actual.map(function (it) {
        const k = keyOf(it);
        if (!k || vistos.has(k) || !enCopia.has(k)) return it;
        vistos.add(k);
        return fusionAditiva(it, enCopia.get(k), ruta + '[' + k + ']', cambios).valor;
      });
      const nuevos = [];
      enCopia.forEach(function (it, k) { if (!enActual.has(k)) nuevos.push(it); });
      nuevos.forEach(function (it) { cambios.push({ ruta: ruta + '[' + keyOf(it).split(':')[0] + ']', tipo: 'elemento' }); });
      return { valor: valor.concat(nuevos), cambios };
    }
    return { valor: actual, cambios };
  }

  return { fusionAditiva, sinSync, keyOf, KEY_FIELDS, SYNC_FIELDS, NO_REPONER };
});
