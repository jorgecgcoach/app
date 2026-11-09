/* Restauración ADITIVA de una copia: añade lo que falta y nunca borra ni cambia lo que ya existe.
   La usan la app («Restaurar desde un archivo») y scripts/restaurar-copia.js, para que las dos
   restauren igual.
   - Campo que no existe → se añade.
   - Objeto → se baja un nivel.
   - Lista de elementos con id/uid/date (mismo criterio que shared/safe-save.js): los que siguen
     existiendo se recorren por dentro (series perdidas dentro de un bloque que sigue ahí) y los que
     faltan se añaden al final. Sin clave no se puede saber cuál es cuál: se deja como está.
   - Cualquier valor que ya exista, aunque sea distinto, NO se toca: lo hecho después de la copia gana.
   - Credenciales y dueños (códigos, PIN, cuentas, tokens) nunca se reponen en un documento existente.
   - Los campos de sincronización del guardado seguro (_rev, _updatedAt, _updatedBy, _writers) nunca
     salen de la copia: son de la nube.

   OJO: aditivo también significa que algo BORRADO A PROPÓSITO después de la copia volvería. Por eso
   toda restauración empieza con un PLAN (simulacro): cada cosa que se añadiría tiene un identificador
   «coleccion/documento|ruta» y se puede EXCLUIR (un documento entero, un bloque, una serie…) antes de
   aplicar. El plan lleva una huella que cubre CADA cambio con SU CONTENIDO (no solo su ruta): si al
   aplicar el plan ya no es exactamente el revisado (la nube cambió, la copia es otra o las exclusiones
   son otras), no se aplica.

   Fichas que ya NO existen: se recrearían enteras. Sus credenciales y vinculaciones (código, códigos,
   cuentas de acceso, push; y en el documento del entrenador su PIN y la lista de códigos) NO se reponen
   salvo que se pida expresamente (recuperación de un desastre), y aun así nunca si otra ficha ya usa
   ese código o esa cuenta: un código reasignado no puede abrir dos fichas. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CopiaAditiva = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY_FIELDS = ['id', 'uid', 'date'];
  const SYNC_FIELDS = ['_rev', '_updatedAt', '_updatedBy', '_writers'];
  const NO_REPONER = ['codes', 'coachCode', 'code', 'authUid', 'authUids', 'push', 'coachPush'];
  const DOC = '(documento)';
  // Credenciales que identifican a quien entra: no pueden estar en dos fichas a la vez.
  const UNICAS = ['code', 'codes', 'authUid', 'authUids'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function keyOf(item) {
    if (!isObj(item)) return null;
    for (const k of KEY_FIELDS) if (item[k] !== undefined && item[k] !== null && item[k] !== '') return k + ':' + String(item[k]);
    return null;
  }
  function sinSync(doc) {
    if (!isObj(doc)) return doc;
    const o = Object.assign({}, doc);
    SYNC_FIELDS.forEach(function (k) { delete o[k]; });
    return o;
  }
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function iguales(a, b) { return canon(a) === canon(b); }

  // ¿Esta ruta (o un antepasado suyo) está excluida? «blocks[id:b1]» excluye todo lo que hay dentro.
  function excluida(ruta, excluir) {
    if (!excluir || !excluir.length) return false;
    for (const e of excluir) {
      if (e === ruta || e === DOC) return true;
      if (ruta.length > e.length && ruta.indexOf(e) === 0 && (ruta[e.length] === '.' || ruta[e.length] === '[')) return true;
    }
    return false;
  }

  /* fusionAditiva(actual, copia, ruta, cambios, excluir)
     excluir: lista de rutas DENTRO de este documento que no se reponen ('(documento)' = nada). */
  function fusionAditiva(actual, copia, ruta, cambios, excluir) {
    ruta = ruta || '';
    cambios = cambios || [];
    if (actual === undefined) {
      if (excluida(DOC, excluir)) return { valor: undefined, cambios };
      cambios.push({ ruta: ruta || DOC, tipo: 'documento-nuevo', valor: copia });
      return { valor: copia, cambios };
    }
    if (isObj(actual) && isObj(copia)) {
      const out = Object.assign({}, actual);
      for (const k of Object.keys(copia)) {
        if (!ruta && SYNC_FIELDS.indexOf(k) >= 0) continue;
        if (NO_REPONER.indexOf(k) >= 0) continue;
        const r = ruta ? ruta + '.' + k : k;
        if (excluida(r, excluir)) continue;
        if (!(k in actual)) { out[k] = copia[k]; cambios.push({ ruta: r, tipo: 'campo', valor: copia[k] }); continue; }
        out[k] = fusionAditiva(actual[k], copia[k], r, cambios, excluir).valor;
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
        return fusionAditiva(it, enCopia.get(k), ruta + '[' + k + ']', cambios, excluir).valor;
      });
      const nuevos = [];
      enCopia.forEach(function (it, k) {
        if (enActual.has(k)) return;
        const r = ruta + '[' + k + ']';
        if (excluida(r, excluir)) return;
        nuevos.push(it);
        cambios.push({ ruta: r, tipo: 'elemento', valor: it });
      });
      return { valor: valor.concat(nuevos), cambios };
    }
    return { valor: actual, cambios };
  }

  /* Identificador de un cambio del plan: «coleccion/documento|ruta». Excluir uno de estos (o un prefijo,
     o «coleccion/documento» entero) lo deja fuera. */
  function idCambio(col, id, ruta) { return col + '/' + id + '|' + ruta; }
  function exclusionesDe(col, id, excluir) {
    const out = [];
    (excluir || []).forEach(function (e) {
      const doc = col + '/' + id;
      if (e === doc) out.push(DOC);
      else if (e.indexOf(doc + '|') === 0) out.push(e.slice(doc.length + 1));
    });
    return out;
  }

  // Huella corta (orden estable). Sin red ni crypto: FNV-1a de 2×32 bits, basta para comparar.
  // Se calcula sobre las FIRMAS del plan (ruta + contenido de cada cambio), no solo sobre las rutas.
  function huellaPlan(firmas) {
    const txt = firmas.slice().sort().join('\n');
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  // Firma de un cambio: su identificador y una huella de lo que añadiría.
  function firmaCambio(id, valor) { return id + '#' + huellaPlan([canon(valor)]); }

  // Todos los valores de texto de un campo de credencial (código suelto, lista, o mapa por código).
  function valoresCred(v) {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.map(String);
    if (isObj(v)) return Object.keys(v);
    return [String(v)];
  }
  /* Ficha que se recrearía entera: qué credenciales lleva y cuáles se reponen.
     opciones.credenciales: reponerlas (solo para recuperar un desastre). opciones.todos: todas las fichas
     de la colección que existen ahora, para no repetir un código o una cuenta que ya es de otra. */
  // Devuelve { valor, lista }: el documento sin las credenciales que no se reponen (a cualquier
  // profundidad, p. ej. negocio.coachPush) y la lista de las que llevaba, con lo decidido.
  function credencialesAlRecrear(id, doc, opciones) {
    const lista = [];
    const usadas = new Set();
    const todos = (opciones && opciones.todos) || {};
    Object.keys(todos).forEach(function (otro) {
      const d = todos[otro];
      if (otro === id || !isObj(d)) return;
      UNICAS.forEach(function (k) { valoresCred(d[k]).forEach(function (x) { usadas.add(x); }); });
    });
    function limpiar(v, ruta) {
      if (Array.isArray(v)) return v.map(function (x, i) { return limpiar(x, ruta + '[' + (keyOf(x) || i) + ']'); });
      if (!isObj(v)) return v;
      const out = {};
      Object.keys(v).forEach(function (k) {
        const r = ruta ? ruta + '.' + k : k;
        if (NO_REPONER.indexOf(k) < 0) { out[k] = limpiar(v[k], r); return; }
        let motivo = null;
        if (!(opciones && opciones.credenciales)) motivo = 'no-pedido';
        else if (!ruta && UNICAS.indexOf(k) >= 0 && valoresCred(v[k]).some(function (x) { return usadas.has(x); })) motivo = 'en-uso';
        lista.push({ campo: r, repuesta: !motivo, motivo: motivo });
        if (!motivo) out[k] = v[k];
      });
      return out;
    }
    return { valor: limpiar(doc, ''), lista: lista };
  }

  /* Plan completo para una colección: qué se añadiría en cada documento, con exclusiones aplicadas.
     actuales: {id: doc|undefined}; copia: {id: doc}; opciones: {credenciales, todos} (ver arriba).
     Devuelve { docs: [{id, nuevo, cambios:[{id,ruta,tipo,firma}], credenciales, valor}], ids, firmas, huella }. */
  function planificar(col, actuales, copia, excluir, opciones) {
    const docs = [];
    const ids = [];
    const firmas = [];
    Object.keys(copia).sort().forEach(function (id) {
      let desdeCopia = sinSync(copia[id]);
      const actual = actuales[id] === undefined || actuales[id] === null ? undefined : sinSync(actuales[id]);
      let credenciales = [];
      if (actual === undefined && isObj(desdeCopia)) {
        const c = credencialesAlRecrear(id, desdeCopia, opciones);
        credenciales = c.lista;
        desdeCopia = c.valor;
      }
      const f = fusionAditiva(actual, desdeCopia, '', [], exclusionesDe(col, id, excluir));
      if (!f.cambios.length) return;
      const cambios = f.cambios.map(function (c) { const cid = idCambio(col, id, c.ruta); return { id: cid, ruta: c.ruta, tipo: c.tipo, firma: firmaCambio(cid, c.valor) }; });
      cambios.forEach(function (c) { ids.push(c.id); firmas.push(c.firma); });
      docs.push({ id: id, nuevo: actual === undefined, cambios: cambios, credenciales: credenciales, valor: f.valor });
    });
    return { col: col, docs: docs, ids: ids, firmas: firmas, huella: huellaPlan(firmas) };
  }

  // Huella de la parte de un plan que se aprobó (los cambios marcados), para compararla al aplicar.
  function huellaAprobada(plan, marcados) {
    const m = new Set(marcados);
    const firmas = [];
    plan.docs.forEach(function (d) { d.cambios.forEach(function (c) { if (m.has(c.id)) firmas.push(c.firma); }); });
    return huellaPlan(firmas);
  }

  /* Preparación de la restauración desde la APP.
     - nube: lo que hay AHORA en el servidor (leído justo antes), {id: doc|null}
     - base: lo último que esta pantalla sabe de la nube (sync.baseOf), {id: doc|null}
     - locales: lo que hay en memoria (DATA), {id: doc|undefined}
     - copia: {id: doc} de la copia
     Si la nube tiene algo que esta pantalla no ha visto, NO se planifica: se pide recargar. Así el plan
     nunca se calcula con datos viejos. */
  function prepararRestauracion(entrada) {
    const nube = entrada.nube || {}, base = entrada.base || {}, locales = entrada.locales || {}, copia = entrada.copia || {};
    const obsoletos = Object.keys(copia).filter(function (id) {
      const n = nube[id] === undefined ? null : nube[id];
      const b = base[id] === undefined ? null : base[id];
      return !iguales(n === null ? null : sinSync(n), b === null ? null : sinSync(b));
    });
    if (obsoletos.length) return { ok: false, motivo: 'obsoleto', obsoletos: obsoletos };
    return { ok: true, plan: planificar(entrada.col || 'clients', locales, copia, entrada.excluir, entrada.opciones) };
  }

  /* Justo antes de APLICAR (al pulsar «Restaurar lo marcado»), con el servidor leído OTRA VEZ:
     - nubeRevisada: lo leído del servidor para el simulacro; nubeAhora: lo leído ahora; base: lo que esta
       pantalla cree que hay en la nube (sync.baseOf).
     - Si la nube ha cambiado desde el simulacro (aunque el tiempo real de esta pantalla vaya con retraso
       y aún no lo sepa), o no coincide con lo que esta pantalla tiene, NO se aplica: hay que repetirlo.
     - Si el plan rehecho no es exactamente el aprobado (rutas Y contenido), tampoco.
     Devuelve {ok:true, plan} o {ok:false, motivo:'cambio-nube'|'plan-distinto', docs}. */
  function comprobarAntesDeAplicar(entrada) {
    const copia = entrada.copia || {};
    const n = function (x) { return x === undefined || x === null ? null : sinSync(x); };
    const cambiados = Object.keys(copia).filter(function (id) {
      const ahora = n((entrada.nubeAhora || {})[id]);
      return !iguales(ahora, n((entrada.nubeRevisada || {})[id])) || !iguales(ahora, n((entrada.base || {})[id]));
    });
    if (cambiados.length) return { ok: false, motivo: 'cambio-nube', docs: cambiados };
    const plan = planificar(entrada.col || 'clients', entrada.locales || {}, copia, entrada.excluir, entrada.opciones);
    if (plan.huella !== entrada.huellaAprobada) return { ok: false, motivo: 'plan-distinto', docs: [] };
    return { ok: true, plan: plan };
  }

  return { fusionAditiva, sinSync, keyOf, excluida, idCambio, planificar, huellaPlan, huellaAprobada, firmaCambio, credencialesAlRecrear, prepararRestauracion, comprobarAntesDeAplicar, KEY_FIELDS, SYNC_FIELDS, NO_REPONER, UNICAS, DOC };
});
