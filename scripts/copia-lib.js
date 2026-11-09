/* Utilidades de la copia de seguridad (C1, fase 2). Sin red: solo transforman datos.
   Nunca imprimen nombres, códigos, PIN ni tokens: los informes son conteos y huellas. */
const crypto = require('crypto');

// Fusión aditiva compartida con la app (shared/copia-aditiva.js): mismo comportamiento en los dos sitios.
const aditiva = require('../shared/copia-aditiva');
const { fusionAditiva, sinSync, keyOf, SYNC_FIELDS } = aditiva;
const WRITERS_KEEP = 12;
const MARCA_RESTAURACION = 'restauracion';

// Sello de sincronización tras restaurar: sube _rev y CONSERVA las marcas de la nube (_writers), añadiendo
// la de la restauración al final, como hace el guardado seguro. Así un dispositivo que esperaba la
// confirmación de su propio envío lo sigue reconociendo y no ve un conflicto falso.
function selloRestauracion(actual, ahora) {
  const previos = (actual && Array.isArray(actual._writers)) ? actual._writers.filter(function (w) { return typeof w === 'string' && w !== MARCA_RESTAURACION; }) : [];
  return {
    _rev: ((actual && Number(actual._rev)) || 0) + 1,
    _updatedAt: ahora || new Date().toISOString(),
    _updatedBy: MARCA_RESTAURACION,
    _writers: previos.concat(MARCA_RESTAURACION).slice(-WRITERS_KEEP)
  };
}
const COACH_DOC = 'coach_data';
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
function huella(v) { return crypto.createHash('sha256').update(canon(v)).digest('hex').slice(0, 16); }


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

// La fusión aditiva (fusionAditiva, sinSync) vive en shared/copia-aditiva.js.

module.exports = { canon, huella, construirCopia, resumir, verificar, desdeCopiaApp, fusionAditiva, sinSync, selloRestauracion, keyOf, COACH_DOC, SYNC_FIELDS };
