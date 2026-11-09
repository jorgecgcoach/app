/* Utilidades de la copia de seguridad (C1, fase 2). Sin red: solo transforman datos.
   Nunca imprimen nombres, códigos, PIN ni tokens: los informes son conteos y huellas. */
const crypto = require('crypto');

// Mismo criterio que shared/safe-save.js para reconocer los elementos de una lista.
const KEY_FIELDS = ['id', 'uid', 'date'];
const SYNC_FIELDS = ['_rev', '_updatedAt', '_updatedBy'];
const COACH_DOC = 'coach_data';

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
function huella(v) { return crypto.createHash('sha256').update(canon(v)).digest('hex').slice(0, 16); }

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function keyOf(item) {
  if (!isObj(item)) return null;
  for (const k of KEY_FIELDS) if (item[k] !== undefined && item[k] !== null && item[k] !== '') return k + ':' + String(item[k]);
  return null;
}

/* Copia en bruto: { _type:'jcgcoach_firestore', exportedAt, colecciones:{ clients:{id:doc}, contacts:{...}, catalog:{...} }, huellas, resumen } */
function construirCopia(colecciones, exportedAt) {
  const huellas = {};
  for (const col of Object.keys(colecciones)) {
    huellas[col] = {};
    for (const id of Object.keys(colecciones[col])) huellas[col][id] = huella(colecciones[col][id]);
  }
  return { _type: 'jcgcoach_firestore', _v: 1, exportedAt: exportedAt || new Date().toISOString(), colecciones, huellas, resumen: resumir(colecciones) };
}

function len(x) { return Array.isArray(x) ? x.length : 0; }
function resumir(colecciones) {
  const clients = colecciones.clients || {};
  const meta = clients[COACH_DOC] || {};
  const neg = meta.negocio || {};
  const fichas = Object.keys(clients).filter(function (id) { return id !== COACH_DOC; });
  let bloques = 0, pagosCliente = 0, conAuth = 0, registros = 0, notas = 0, sinMarca = 0;
  fichas.forEach(function (id) {
    const c = clients[id] || {};
    bloques += len(c.blocks);
    (Array.isArray(c.blocks) ? c.blocks : []).forEach(function (b) {
      const d = (b && b.data) || {};
      registros += Object.keys(isObj(d.log) ? d.log : {}).length;
      notas += Object.keys(isObj(d.exNotes) ? d.exNotes : {}).length;
      if (d._logv !== 2) sinMarca++;
    });
    pagosCliente += len(c.pagos);
    if (c.authUid) conAuth++;
  });
  return {
    fichas: fichas.length,
    fichasConCuenta: conAuth,
    bloques: bloques,
    bloquesSinMarcaLogv: sinMarca,
    seriesRegistradas: registros,
    notasPorEjercicio: notas,
    pagosEnFichas: pagosCliente,
    hayDocumentoEntrenador: !!clients[COACH_DOC],
    codigos: Object.keys(meta.codes || {}).length,
    biblioteca: len(meta.exLibrary),
    plantillas: len((meta.templates || {}).workouts) + len((meta.templates || {}).diets),
    contratos: len(neg.contracts),
    pagos: len(neg.payments),
    contactosNegocio: len(neg.contacts),
    contactosColeccion: Object.keys(colecciones.contacts || {}).length
  };
}

/* Convierte la copia de la app («Descargar copia») al formato bruto, para verificarla igual. */
function desdeCopiaApp(dump) {
  const clients = Object.assign({}, dump.clients || {});
  if (dump.meta) clients[COACH_DOC] = Object.assign({}, dump.meta, { _split: true });
  return { clients: clients };
}

function verificar(copia) {
  const problemas = [];
  if (!copia || copia._type !== 'jcgcoach_firestore' || !isObj(copia.colecciones)) {
    return { ok: false, problemas: ['no es una copia de Firestore de esta app'], resumen: null };
  }
  const cols = copia.colecciones;
  if (!isObj(cols.clients) || !Object.keys(cols.clients).length) problemas.push('la copia no trae fichas');
  if (isObj(cols.clients) && !cols.clients[COACH_DOC]) problemas.push('falta el documento del entrenador (códigos, negocio, biblioteca)');
  let alteradas = 0, sinHuella = 0;
  for (const col of Object.keys(cols)) {
    for (const id of Object.keys(cols[col])) {
      const h = copia.huellas && copia.huellas[col] && copia.huellas[col][id];
      if (!h) sinHuella++;
      else if (h !== huella(cols[col][id])) alteradas++;
    }
  }
  if (alteradas) problemas.push(alteradas + ' documento(s) no coinciden con su huella (archivo dañado o editado)');
  if (sinHuella) problemas.push(sinHuella + ' documento(s) sin huella');
  const resumen = resumir(cols);
  if (copia.resumen && canon(copia.resumen) !== canon(resumen)) problemas.push('el resumen guardado no coincide con el contenido');
  const meta = (cols.clients || {})[COACH_DOC] || {};
  const huerfanos = Object.keys(meta.codes || {}).filter(function (k) {
    const cid = meta.codes[k] && meta.codes[k].client;
    return cid && !(cols.clients || {})[cid];
  }).length;
  return { ok: problemas.length === 0, problemas: problemas, resumen: resumen, avisos: huerfanos ? [huerfanos + ' código(s) apuntan a fichas que no existen'] : [] };
}

/* Restauración ADITIVA: añade solo lo que falta en «actual».
   - Campo que no existe → se añade.
   - Objeto → se baja un nivel.
   - Lista de elementos con id/uid/date → se añaden los elementos que faltan (al final).
   - Cualquier valor que ya exista (aunque sea distinto) → NO se toca: lo de después de la copia gana.
   - Nunca borra nada. Los campos de sincronización no se copian. */
// Credenciales y dueños: si el documento existe, NUNCA se reponen desde la copia. Un código o PIN
// cambiado a propósito después de la copia (p. ej. tras la fuga) no debe volver a funcionar.
const NO_REPONER = ['codes', 'coachCode', 'code', 'authUid', 'authUids', 'push', 'coachPush'];

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
    const keys = new Set(actual.map(keyOf).filter(Boolean));
    const nuevos = copia.filter(function (it) { const k = keyOf(it); return k && !keys.has(k); });
    if (!nuevos.length) return { valor: actual, cambios };
    nuevos.forEach(function (it) { cambios.push({ ruta: ruta + '[' + keyOf(it).split(':')[0] + ']', tipo: 'elemento' }); });
    return { valor: actual.concat(nuevos), cambios };
  }
  return { valor: actual, cambios };
}

function sinSync(doc) {
  const o = Object.assign({}, doc);
  SYNC_FIELDS.forEach(function (k) { delete o[k]; });
  return o;
}

module.exports = { canon, huella, construirCopia, resumir, verificar, desdeCopiaApp, fusionAditiva, sinSync, keyOf, COACH_DOC, SYNC_FIELDS };
