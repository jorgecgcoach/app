/* =======================================================================
   Guardado seguro (sin sobrescrituras de datos antiguos).
   -----------------------------------------------------------------------
   index.html lo carga con <script src> y los tests con require(): es el
   mismo código en los dos sitios.

   Idea: nunca se manda el documento entero tal y como está en memoria.
   1. Se guarda una "base": la última versión conocida del servidor.
   2. Al guardar se calculan SOLO los cambios locales respecto a esa base
      (diffDocs), campo a campo. Un campo que este dispositivo no ha tocado
      no viaja, así que no puede pisar lo que otro haya escrito.
   3. En una transacción se lee el documento actual del servidor y se le
      aplican esos cambios (applyOps). Cada cambio lleva el valor anterior:
      si el servidor ya no tiene ese valor (otro dispositivo lo cambió) es
      un conflicto y NO se escribe nada. Se bloquea y se avisa.
   4. Un listener en tiempo real trae los cambios de otros dispositivos y
      los mezcla con lo que haya pendiente en este (misma regla).
   5. Los cambios pendientes se apuntan en localStorage (journal) para no
      perderlos si se cierra la app sin conexión.

   Arrays: los de objetos con id/uid/date único se mezclan por clave (dos
   dispositivos pueden añadir sesiones o series a la vez sin perder
   ninguna). Los demás se mezclan por posición si no cambia la longitud,
   por añadido al final si solo crecen, y si no se tratan como un valor.
   ======================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SafeSave = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // _writers: marcas de las últimas escrituras (la más reciente al final). Sirve
  // para reconocer un envío propio cuya respuesta se perdió aunque otro
  // dispositivo haya escrito después (ver ownAttempt).
  const SYNC_FIELDS = ['_rev', '_updatedAt', '_updatedBy', '_writers'];
  const WRITERS_KEEP = 12;
  function writersOf(raw) {
    if (!raw) return [];
    if (Array.isArray(raw._writers)) return raw._writers.filter(t => typeof t === 'string');
    return raw._updatedBy ? [raw._updatedBy] : [];
  }
  function syncStamp(raw, tag, rev, at) {
    const w = writersOf(raw).filter(t => t !== tag);
    w.push(tag);
    return { _rev: rev, _updatedAt: at, _updatedBy: tag, _writers: w.slice(-WRITERS_KEEP) };
  }
  const KEY_FIELDS = ['id', 'uid', 'date'];
  const DOC_LIMIT = 1048487;
  const JOURNAL_PREFIX = 'jcg_pending:';
  const TAB_PREFIX = 'jcg_tab:';
  const TAB_STALE_MS = 15000;

  function randomId() {
    try {
      const c = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' && globalThis.crypto);
      if (c && c.getRandomValues) return Array.from(c.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {}
    return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a).filter(k => a[k] !== undefined);
    const kb = Object.keys(b).filter(k => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function stripSync(doc) {
    if (!isPlainObject(doc)) return doc;
    const o = {};
    for (const k of Object.keys(doc)) if (SYNC_FIELDS.indexOf(k) < 0) o[k] = doc[k];
    return o;
  }

  function jsonSize(o) {
    try { return new TextEncoder().encode(JSON.stringify(o)).length; }
    catch (e) { try { return JSON.stringify(o).length; } catch (_) { return 0; } }
  }

  /* Campo clave común a todos los arrays no vacíos (único en cada uno), o null. */
  function arrayKey() {
    const arrays = Array.prototype.filter.call(arguments, a => Array.isArray(a) && a.length);
    if (!arrays.length) return null;
    for (const kf of KEY_FIELDS) {
      const ok = arrays.every(a => {
        const seen = new Set();
        return a.every(x => {
          if (!isPlainObject(x)) return false;
          const v = x[kf];
          if (typeof v !== 'string' && typeof v !== 'number') return false;
          const s = typeof v + ':' + v;
          if (seen.has(s)) return false;
          seen.add(s);
          return true;
        });
      });
      if (ok) return kf;
    }
    return null;
  }

  /* ---------------------------------------------------------------------
     diffDocs(base, local) -> lista de operaciones serializables (JSON).
     Segmentos de ruta: 'clave' (objeto) | {i, n} (posición, n = longitud
     esperada) | {k, v} (elemento de array con k === v).
     Tipos de operación:
       {p, b, a}                 cambia el valor de b a a (a undefined = borrar)
       {p, b:undefined, a, after|atEnd} añade un elemento con clave detrás
                                 de `after`, o al final
       {p, order:true, b, a}     reordena elementos con clave
       {p, append, baseLen}      añade elementos al final de un array sin clave
     --------------------------------------------------------------------- */
  function diffDocs(base, local, opts) {
    const ops = [];
    const only = opts && opts.onlyKeys;
    if (only && isPlainObject(base || {}) && isPlainObject(local || {})) {
      for (const k of only) diffInto((base || {})[k], (local || {})[k], [k], ops);
    } else {
      diffInto(base, local, [], ops);
    }
    return ops;
  }

  function diffInto(b, l, path, ops) {
    if (deepEqual(b, l)) return;
    if (isPlainObject(b) && isPlainObject(l)) {
      const keys = new Set(Object.keys(b).concat(Object.keys(l)));
      for (const k of keys) diffInto(b[k], l[k], path.concat(k), ops);
      return;
    }
    if (Array.isArray(b) && Array.isArray(l)) {
      const kf = arrayKey(b, l);
      if (kf) {
        const bm = new Map(b.map(x => [x[kf], x]));
        const lm = new Map(l.map(x => [x[kf], x]));
        for (const x of b) diffInto(x, lm.get(x[kf]), path.concat({ k: kf, v: x[kf] }), ops);
        // Los nuevos que van detrás del último elemento que ya existía se
        // añaden al final (así se respeta el orden de llegada entre dispositivos).
        let lastOld = -1;
        l.forEach((x, i) => { if (bm.has(x[kf])) lastOld = i; });
        for (let i = 0; i < l.length; i++) {
          const x = l[i];
          if (bm.has(x[kf])) continue;
          const op = { p: path.concat({ k: kf, v: x[kf] }), b: undefined, a: clone(x) };
          if (i > lastOld && b.length) op.atEnd = true;
          else op.after = i > 0 ? l[i - 1][kf] : null;
          ops.push(op);
        }
        const localCommon = l.filter(x => bm.has(x[kf])).map(x => x[kf]);
        const baseCommon = b.filter(x => lm.has(x[kf])).map(x => x[kf]);
        if (!deepEqual(localCommon, baseCommon)) ops.push({ p: path, order: true, k: kf, b: baseCommon, a: localCommon });
        return;
      }
      if (b.length === l.length) {
        for (let i = 0; i < l.length; i++) diffInto(b[i], l[i], path.concat({ i, n: b.length }), ops);
        return;
      }
      if (l.length > b.length && deepEqual(l.slice(0, b.length), b)) {
        ops.push({ p: path, append: clone(l.slice(b.length)), baseLen: b.length });
        return;
      }
    }
    ops.push({ p: path, b: clone(b), a: clone(l) });
  }

  function segLabel(seg) {
    if (typeof seg === 'string') return seg;
    if ('i' in seg) return '[' + seg.i + ']';
    return '[' + seg.k + '=' + seg.v + ']';
  }
  function pathLabel(p) {
    return p.map(segLabel).join('.').replace(/\.\[/g, '[');
  }

  /* Devuelve {ok, node} o {ok:false, why}. */
  function child(container, seg) {
    if (typeof seg === 'string') {
      if (!isPlainObject(container)) return { ok: false, why: 'tipo' };
      return { ok: true, node: container[seg] };
    }
    if (!Array.isArray(container)) return { ok: false, why: 'tipo' };
    if ('i' in seg) {
      if (container.length !== seg.n) return { ok: false, why: 'longitud' };
      return { ok: true, node: container[seg.i] };
    }
    return { ok: true, node: container.find(x => isPlainObject(x) && x[seg.k] === seg.v) };
  }

  function walk(doc, path) {
    let cur = doc;
    for (const seg of path) {
      const r = child(cur, seg);
      if (!r.ok) return r;
      if (r.node === undefined || r.node === null) return { ok: false, why: 'falta' };
      cur = r.node;
    }
    return { ok: true, node: cur };
  }

  function setChild(parent, seg, val, op) {
    if (typeof seg === 'string') {
      if (val === undefined) delete parent[seg];
      else parent[seg] = val;
      return;
    }
    if ('i' in seg) { parent[seg.i] = val === undefined ? null : val; return; }
    const idx = parent.findIndex(x => isPlainObject(x) && x[seg.k] === seg.v);
    if (val === undefined) { if (idx >= 0) parent.splice(idx, 1); return; }
    if (idx >= 0) { parent[idx] = val; return; }
    let at = parent.length;
    if (!op || op.atEnd) { parent.push(val); return; }
    if (op.after === null) at = 0;
    else if (op && op.after !== undefined) {
      const prev = parent.findIndex(x => isPlainObject(x) && x[seg.k] === op.after);
      if (prev >= 0) at = prev + 1;
    }
    parent.splice(at, 0, val);
  }

  /* ---------------------------------------------------------------------
     applyOps(target, ops) -> {doc, conflicts}
     No modifica target. Una operación solo se aplica si el valor actual
     del destino es el que había en la base (o ya es el valor nuevo). Si no,
     se apunta como conflicto: quien llama decide no escribir.
     --------------------------------------------------------------------- */
  function applyOps(target, ops) {
    let doc = clone(target === undefined || target === null ? {} : target);
    const conflicts = [];
    const conflict = (op, why) => conflicts.push({ path: pathLabel(op.p), why });
    for (const op of ops) {
      if (op.order) { applyOrder(doc, op, conflict); continue; }
      if (op.append) { applyAppend(doc, op, conflict); continue; }
      if (!op.p.length) {
        if (deepEqual(doc, op.b) || deepEqual(doc, op.a)) doc = clone(op.a === undefined ? {} : op.a);
        else conflict(op, 'cambiado en otro dispositivo');
        continue;
      }
      const parent = walk(doc, op.p.slice(0, -1));
      if (!parent.ok) {
        // El contenedor ya no existe: borrar algo dentro de él no hace falta.
        if (op.a === undefined) continue;
        conflict(op, parent.why === 'falta' ? 'borrado en otro dispositivo' : 'estructura distinta en otro dispositivo');
        continue;
      }
      const last = op.p[op.p.length - 1];
      const cur = child(parent.node, last);
      if (!cur.ok) { conflict(op, 'estructura distinta en otro dispositivo'); continue; }
      if (!(deepEqual(cur.node, op.b) || deepEqual(cur.node, op.a))) {
        conflict(op, 'cambiado en otro dispositivo');
        continue;
      }
      setChild(parent.node, last, clone(op.a), op);
    }
    return { doc, conflicts };
  }

  function applyOrder(doc, op, conflict) {
    const r = walk(doc, op.p);
    if (!r.ok || !Array.isArray(r.node)) { conflict(op, 'lista borrada en otro dispositivo'); return; }
    const arr = r.node;
    const set = new Set(op.a);
    const slots = [];
    arr.forEach((x, i) => { if (isPlainObject(x) && set.has(x[op.k])) slots.push(i); });
    const present = slots.map(i => arr[i][op.k]);
    const presentSet = new Set(present);
    const baseR = op.b.filter(k => presentSet.has(k));
    const localR = op.a.filter(k => presentSet.has(k));
    if (!(deepEqual(present, baseR) || deepEqual(present, localR))) { conflict(op, 'reordenado en otro dispositivo'); return; }
    const byKey = new Map(slots.map(i => [arr[i][op.k], arr[i]]));
    slots.forEach((slot, j) => { arr[slot] = byKey.get(localR[j]); });
  }

  function applyAppend(doc, op, conflict) {
    const parentPath = op.p.slice(0, -1);
    const last = op.p[op.p.length - 1];
    const parent = op.p.length ? walk(doc, parentPath) : { ok: false, why: 'tipo' };
    if (!parent.ok) { conflict(op, 'lista borrada en otro dispositivo'); return; }
    const cur = child(parent.node, last);
    if (!cur.ok) { conflict(op, 'estructura distinta en otro dispositivo'); return; }
    if (cur.node === undefined && op.baseLen === 0) { setChild(parent.node, last, clone(op.append)); return; }
    if (!Array.isArray(cur.node)) { conflict(op, 'lista borrada en otro dispositivo'); return; }
    const arr = cur.node;
    const n = op.append.length;
    // Ya aplicado (reintento del mismo cambio): no duplicar.
    if (arr.length >= op.baseLen + n && deepEqual(arr.slice(op.baseLen, op.baseLen + n), op.append)) return;
    if (arr.length >= n && deepEqual(arr.slice(arr.length - n), op.append)) return;
    for (const x of op.append) arr.push(clone(x));
  }

  function merge3(base, local, remote, opts) {
    return applyOps(remote, diffDocs(base, local, opts));
  }

  /* Copia src dentro de target sin cambiar la identidad de los objetos que
     siguen existiendo. Así el código que guardó una referencia (un modal
     abierto, un bloque) sigue editando el objeto que se guarda. */
  function patchInPlace(target, src) {
    if (!isPlainObject(target) || !isPlainObject(src)) return src;
    for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
    for (const k of Object.keys(src)) target[k] = patchValue(target[k], src[k]);
    return target;
  }
  function patchValue(t, s) {
    if (isPlainObject(t) && isPlainObject(s)) return patchInPlace(t, s);
    if (Array.isArray(t) && Array.isArray(s)) {
      const kf = arrayKey(t, s);
      if (kf) {
        const tm = new Map(t.map(x => [x[kf], x]));
        const out = s.map(x => (tm.has(x[kf]) ? patchInPlace(tm.get(x[kf]), x) : x));
        t.length = 0;
        out.forEach(x => t.push(x));
        return t;
      }
      if (t.length === s.length) {
        for (let i = 0; i < s.length; i++) t[i] = patchValue(t[i], s[i]);
        return t;
      }
    }
    return s;
  }

  /* ---------------------------------------------------------------------
     Journal: cambios pendientes por pestaña en localStorage.
     --------------------------------------------------------------------- */
  function createJournal(storage, tabId, now) {
    const keyFor = id => JOURNAL_PREFIX + tabId + ':' + id;
    function safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
    // Latidos de pestañas ya cerradas: sobran (que falte el latido equivale a
    // "pestaña muerta"), así que se borran para no llenar localStorage.
    function sweepTabs() {
      safe(() => {
        const stale = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && key.indexOf(TAB_PREFIX) === 0 && key !== TAB_PREFIX + tabId && now() - Number(storage.getItem(key) || 0) >= TAB_STALE_MS) stale.push(key);
        }
        stale.forEach(k => storage.removeItem(k));
      });
    }
    let beats = 0;
    function heartbeat() {
      if (!storage) return;
      safe(() => storage.setItem(TAB_PREFIX + tabId, String(now())));
      if (beats++ % 12 === 0) sweepTabs();
    }
    return {
      heartbeat,
      // own: por cada guardado enviado y aún sin confirmar, su marca y los cambios
      // posteriores a lo que envió. Sirve al reabrir si la nube lleva esa marca.
      put(id, ops, own) { if (storage) safe(() => storage.setItem(keyFor(id), JSON.stringify(own && own.length ? { at: now(), ops, own } : { at: now(), ops }))); },
      clear(id) { if (storage) safe(() => storage.removeItem(keyFor(id))); },
      /* Entradas de pestañas que ya no están vivas (o de esta misma). */
      orphans() {
        if (!storage) return [];
        return safe(() => {
          const out = [];
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || key.indexOf(JOURNAL_PREFIX) !== 0) continue;
            const rest = key.slice(JOURNAL_PREFIX.length);
            const sep = rest.indexOf(':');
            const tab = rest.slice(0, sep);
            const id = rest.slice(sep + 1);
            if (tab !== tabId) {
              const hb = Number(storage.getItem(TAB_PREFIX + tab) || 0);
              if (now() - hb < TAB_STALE_MS) continue;
            }
            let entry = null;
            try { entry = JSON.parse(storage.getItem(key)); } catch (_) {}
            if (entry && Array.isArray(entry.ops)) out.push({ key, tab, id, at: entry.at, ops: entry.ops, own: Array.isArray(entry.own) ? entry.own : [] });
          }
          return out;
        }, []);
      },
      drop(key) { if (storage) safe(() => storage.removeItem(key)); }
    };
  }

  /* ---------------------------------------------------------------------
     createSync(cfg): gestor de documentos de una colección.
       cfg.db           Firestore (API compat: collection/doc/runTransaction)
       cfg.collection   nombre de la colección
       cfg.tabId        identificador de esta pestaña
       cfg.storage      localStorage (o null)
       cfg.now          () => ms
       cfg.timeoutMs    límite de una transacción
       cfg.diffOpts(id) opciones de diff para un documento (onlyKeys)
       getLocal(id) documento local limpio, o undefined si no existe
       cfg.applyLocal(id, doc|null) mete en memoria la versión mezclada
       cfg.onStatus(id, status, info) 'saving'|'saved'|'error'|'conflict'|'size'|'remote'
     --------------------------------------------------------------------- */
  function createSync(cfg) {
    const now = cfg.now || (() => Date.now());
    const limit = cfg.docLimit || DOC_LIMIT;
    const timeoutMs = cfg.timeoutMs || 20000;
    const journal = createJournal(cfg.storage || null, cfg.tabId || 'tab', now);
    const states = new Map();
    const status = (id, s, info) => { try { cfg.onStatus && cfg.onStatus(id, s, info); } catch (e) { /* la UI no debe romper el guardado */ } };
    const opts = id => (cfg.diffOpts ? cfg.diffOpts(id, st(id).base) : undefined);
    // La memoria de la app guarda el documento tal cual llegó (con _rev...).
    // Esos campos son del gestor: nunca cuentan como cambio local.
    const getLocal = id => { const d = cfg.getLocal(id); return d === undefined ? undefined : stripSync(d); };
    const ref = id => cfg.db.collection(cfg.collection).doc(id);

    function st(id) {
      let s = states.get(id);
      if (!s) { s = { known: false, base: null, rev: 0, inflight: null, again: false, blocked: null, remoteQueued: undefined, latestRemote: undefined, lastError: null, attempts: [], serverWriters: [] }; states.set(id, s); }
      return s;
    }
    function err(kind, extra) { const e = new Error(kind); e.kind = kind; Object.assign(e, extra || {}); return e; }
    function withTimeout(p) {
      let t;
      const to = new Promise((_, rej) => { t = setTimeout(() => rej(err('timeout')), timeoutMs); });
      return Promise.race([p, to]).finally(() => clearTimeout(t));
    }

    function setBase(id, raw) {
      const s = st(id);
      s.known = true;
      s.base = raw ? clone(stripSync(raw)) : null;
      s.rev = (raw && raw._rev) || 0;
      s.blocked = null;
      s.absorbed = null;
      s.attempts = [];
      s.serverWriters = writersOf(raw);
    }
    function forget(id) { states.delete(id); journal.clear(id); }

    /* ---- valores por defecto locales ----
       Las pantallas crean estructuras vacías al pintarse (weightSnapshots = [],
       estModel, program...) y ensureData() rellena campos que faltan. Eso no
       es una edición: no debe subir a la nube ni chocar con lo que otro
       dispositivo haya escrito de verdad en ese campo. absorb() apunta los
       campos NUEVOS que aparecen mientras corre fn; mientras sigan con ese
       mismo valor, no cuentan como cambio. En cuanto el usuario mete algo
       dentro, el valor cambia y se guarda entero. */
    // "Inicialización": el campo no existía, era null o era un contenedor vacío
    // ({} o []), p. ej. trackingArray() convierte el {} antiguo en [].
    const emptyContainer = v => (Array.isArray(v) && !v.length) || (isPlainObject(v) && !Object.keys(v).length);
    const isInit = op => !op.order && !op.append && (op.b === undefined || op.b === null || emptyContainer(op.b)) && op.a !== undefined;
    function filterOps(s, ops) {
      if (!s.absorbed || !s.absorbed.size) return ops;
      return ops.filter(op => !(isInit(op) && s.absorbed.get(pathLabel(op.p)) === JSON.stringify(op.a)));
    }
    function localOps(id, from, local) { return filterOps(st(id), diffDocs(from || {}, local, opts(id))); }

    /* ---- guardados propios sin confirmar ----
       Si una transacción llega a la nube pero la respuesta se pierde (corte,
       tiempo agotado), la base se queda atrás y el siguiente cambio del mismo
       campo parecería "cambiado en otro dispositivo". Cada envío lleva una
       marca única (pestaña ~ instancia aleatoria ~ contador) que se escribe
       en _updatedBy y se añade a _writers (las últimas escrituras). Una marca
       solo entra en _writers cuando su escritura se confirma en el servidor,
       así que si la nube trae la marca de un envío de aquí, ese envío llegó,
       sin adivinar. Entonces los pendientes se cuentan desde lo que se envió
       y no desde la base vieja. Cada cambio se sigue comprobando campo a
       campo contra la nube: si otro dispositivo cambió después ese mismo
       dato, sigue siendo conflicto. Sin marca propia, todo como antes. */
    const MAX_ATTEMPTS = 20;
    let attemptSeq = 0;
    // Identificador aleatorio de esta instancia (cada carga de la app es una
    // nueva): aunque dos dispositivos generasen la misma tabId, sus marcas no
    // coinciden. 64 bits del generador criptográfico si existe.
    const instanceId = randomId();
    // El envío de aquí más reciente cuya marca está en la nube.
    function ownAttempt(s, raw) {
      if (!s.attempts.length) return null;
      const w = writersOf(raw);
      for (let i = s.attempts.length - 1; i >= 0; i--) if (w.indexOf(s.attempts[i].tag) >= 0) return s.attempts[i];
      return null;
    }
    // Cambios locales que faltan en la nube, según qué versión hay allí.
    function opsAgainst(id, s, raw, local) {
      const own = ownAttempt(s, raw);
      return { own, ops: localOps(id, own ? own.sent : s.base, local) };
    }
    function journalPut(id, ops) {
      const s = st(id);
      const local = getLocal(id);
      const own = local === undefined ? [] : s.attempts.map(a => ({ tag: a.tag, ops: localOps(id, a.sent, local) }));
      journal.put(id, ops, own);
    }
    function absorb(ids, fn) {
      const snaps = [];
      for (const id of ids || []) {
        const local = getLocal(id);
        if (local === undefined) continue;
        const s = st(id);
        snaps.push({ id, before: new Set(diffDocs(s.base || {}, local, opts(id)).map(o => pathLabel(o.p))) });
      }
      try { return fn(); }
      finally {
        for (const { id, before } of snaps) {
          const local = getLocal(id);
          if (local === undefined) continue;
          const s = st(id);
          for (const op of diffDocs(s.base || {}, local, opts(id))) {
            const label = pathLabel(op.p);
            if (isInit(op) && !before.has(label)) (s.absorbed || (s.absorbed = new Map())).set(label, JSON.stringify(op.a));
          }
        }
      }
    }

    /* Justo después de cargar (y de ensureData): todo campo nuevo que haya en
       memoria es relleno de la app, no una edición. Nunca para documentos que
       aún no existen en la nube (base null): esos hay que subirlos enteros. */
    function markDefaults(ids) {
      for (const id of ids || []) {
        const s = st(id);
        if (!s.known || s.base === null) continue;
        const local = getLocal(id);
        if (local === undefined) continue;
        for (const op of diffDocs(s.base, local, opts(id))) {
          if (isInit(op)) (s.absorbed || (s.absorbed = new Map())).set(pathLabel(op.p), JSON.stringify(op.a));
        }
      }
    }

    function pendingOps(id) {
      const s = st(id);
      const local = getLocal(id);
      if (local === undefined) return [];
      return localOps(id, s.base, local);
    }

    // Con el documento bloqueado no se envía nada, pero lo que se siga
    // editando tiene que sobrevivir a un cierre: al journal.
    function keepPending(id) {
      const ops = pendingOps(id);
      if (ops.length) journalPut(id, ops);
    }

    function save(id) {
      const s = st(id);
      if (s.blocked) { keepPending(id); status(id, 'conflict', s.blocked); return Promise.resolve({ ok: false, reason: 'conflict', conflicts: s.blocked }); }
      if (s.inflight) { s.again = true; return s.inflight; }
      s.inflight = doSave(id).finally(() => {
        s.inflight = null;
        if (s.remoteQueued !== undefined) { const r = s.remoteQueued; s.remoteQueued = undefined; remote(id, r.raw, r.meta); }
        if (s.again && !s.blocked) { s.again = false; save(id); }
      });
      return s.inflight;
    }

    async function doSave(id) {
      const s = st(id);
      const local = getLocal(id);
      if (local === undefined) return { ok: true, noop: true };
      const sent = clone(local);
      const baseAtStart = s.base;
      const ops = localOps(id, baseAtStart, sent);
      // Nada pendiente (deshecho, o ya llegó aunque se perdiera la respuesta):
      // un journal anterior ya no vale y al reabrir resucitaría valores viejos.
      if (!ops.length) { journal.clear(id); s.lastError = null; status(id, 'saved'); return { ok: true, noop: true }; }
      if (jsonSize(sent) > limit) { s.lastError = 'size'; status(id, 'size'); return { ok: false, reason: 'size' }; }
      // Este envío: su marca queda apuntada (en memoria y en el journal) ANTES
      // de mandarlo, por si llega a la nube y la respuesta no vuelve.
      const attempt = { tag: (cfg.tabId || 'tab') + '~' + instanceId + '~' + (++attemptSeq), sent };
      s.attempts.push(attempt);
      if (s.attempts.length > MAX_ATTEMPTS) s.attempts.shift();
      journalPut(id, ops);
      status(id, 'saving');
      let result;
      const tx = cfg.db.runTransaction(async t => {
        const snap = await t.get(ref(id));
        const exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
        const raw = exists ? snap.data() : null;
        s.latestRemote = raw ? clone(stripSync(raw)) : null;
        if (!exists && baseAtStart !== null) throw err('conflict', { conflicts: [{ path: '(documento)', why: 'borrado en otro dispositivo' }] });
        const remoteDoc = raw ? stripSync(raw) : {};
        // ¿La nube tiene justo lo que escribió un envío anterior de aquí? Entonces
        // solo falta lo editado después de ese envío.
        const prev = ownAttempt(s, raw);
        const sendOps = prev ? localOps(id, prev.sent, sent) : ops;
        const merged = applyOps(remoteDoc, sendOps);
        if (merged.conflicts.length) throw err('conflict', { conflicts: merged.conflicts });
        if (prev && deepEqual(merged.doc, remoteDoc)) return { doc: remoteDoc, rev: (raw && raw._rev) || 0, writers: writersOf(raw), wrote: false };
        if (jsonSize(merged.doc) > limit) throw err('size');
        const rev = ((raw && raw._rev) || 0) + 1;
        t.set(ref(id), Object.assign({}, merged.doc, syncStamp(raw, attempt.tag, rev, new Date(now()).toISOString())));
        return { doc: merged.doc, rev, writers: syncStamp(raw, attempt.tag, rev, '')._writers, wrote: true };
      });
      try {
        result = await withTimeout(tx);
      } catch (e) {
        if (e && (e.kind === 'conflict' || e.kind === 'size')) {
          // Se rechazó antes de escribir: este envío no está en la nube.
          s.attempts = s.attempts.filter(x => x !== attempt);
          if (e.kind === 'size') { s.lastError = 'size'; status(id, 'size'); return { ok: false, reason: 'size' }; }
          s.blocked = e.conflicts;
          s.lastError = 'conflict';
          keepPending(id);
          status(id, 'conflict', e.conflicts);
          return { ok: false, reason: 'conflict', conflicts: e.conflicts };
        }
        // Puede haber llegado o no: se queda apuntado. Si la transacción
        // termina más tarde, esa respuesta es la confirmación de Firestore.
        if (e && e.kind === 'timeout') tx.then(r => lateConfirm(id, attempt, r), () => {});
        s.lastError = 'error';
        status(id, 'error', e);
        return { ok: false, reason: 'error', error: e };
      }
      confirmed(id, result, attempt);
      // Lo que se editó mientras la transacción estaba en marcha se vuelve a
      // montar encima de lo que quedó en el servidor.
      const nowLocal = getLocal(id);
      if (nowLocal !== undefined) {
        const further = localOps(id, sent, nowLocal);
        const rebased = applyOps(result.doc, further);
        if (rebased.conflicts.length) {
          s.blocked = rebased.conflicts;
          keepPending(id);
          status(id, 'conflict', rebased.conflicts);
          return { ok: false, reason: 'conflict', conflicts: rebased.conflicts };
        }
        // Solo se toca la memoria si el servidor traía algo nuevo (no por los
        // valores por defecto locales, que no viajan).
        if (localOps(id, rebased.doc, nowLocal).length) cfg.applyLocal(id, rebased.doc);
        if (further.length) s.again = true;
      }
      status(id, 'saved');
      return { ok: true };
    }

    // Se olvidan los envíos hasta `attempt` (incluido): los anteriores ya no
    // pueden llegar después (una transacción de Firestore falla si el documento
    // cambió desde que lo leyó). Los posteriores, si los hay, siguen apuntados.
    function dropAttemptsThrough(s, attempt) {
      const i = attempt ? s.attempts.indexOf(attempt) : -1;
      s.attempts = i < 0 ? [] : s.attempts.slice(i + 1);
    }
    // Firestore ha confirmado una versión escrita (o reconocida) por este dispositivo.
    function confirmed(id, result, attempt) {
      const s = st(id);
      s.known = true;
      s.base = clone(result.doc);
      s.rev = result.rev;
      s.serverWriters = result.writers || [];
      dropAttemptsThrough(s, attempt);
      s.lastError = null;
      journal.clear(id);
    }

    /* La transacción que dimos por perdida (tiempo agotado) termina bien más
       tarde: es la confirmación de Firestore. Solo se usa si nada más reciente
       se ha visto del servidor entretanto; si no, la decidirá la marca. */
    function lateConfirm(id, attempt, result) {
      const s = st(id);
      if (!result || s.inflight || s.blocked || s.attempts.indexOf(attempt) < 0 || s.rev >= result.rev) return;
      confirmed(id, result, attempt);
      const local = getLocal(id);
      if (local === undefined) { status(id, 'saved'); return; }
      const rebased = applyOps(result.doc, localOps(id, attempt.sent, local));
      if (rebased.conflicts.length) {
        s.blocked = rebased.conflicts;
        keepPending(id);
        status(id, 'conflict', rebased.conflicts);
        return;
      }
      if (localOps(id, rebased.doc, local).length) cfg.applyLocal(id, rebased.doc);
      if (pendingOps(id).length) save(id);
      else status(id, 'saved');
    }

    function projected(id, doc) {
      const o = opts(id);
      if (!o || !o.onlyKeys || !isPlainObject(doc)) return doc;
      const out = {};
      o.onlyKeys.forEach(k => { if (doc[k] !== undefined) out[k] = doc[k]; });
      return out;
    }

    /* Cambio que llega del servidor (listener en tiempo real). */
    function remote(id, raw, meta) {
      if (meta && (meta.fromCache || meta.hasPendingWrites)) return;
      const s = st(id);
      if (s.inflight) { s.remoteQueued = { raw, meta }; return; }
      const incoming = raw ? clone(stripSync(raw)) : null;
      if (!s.known) {
        // Documento que este dispositivo no había cargado (p. ej. cliente nuevo
        // creado en otro). Si aquí no existe, se adopta tal cual. Si existe, se
        // mezcla como si la base fuera "no existía": cualquier campo distinto
        // es conflicto.
        s.known = true; s.base = null; s.rev = 0;
        if (getLocal(id) === undefined) {
          if (incoming) { s.base = incoming; s.rev = (raw && raw._rev) || 0; cfg.applyLocal(id, clone(incoming)); }
          return;
        }
      }
      // Instantánea MÁS VIEJA que la versión que ya conocemos (cada escritura
      // sube _rev). Con conexión lenta, el aviso de un guardado anterior puede
      // llegar después de que este dispositivo haya guardado otra vez; no trae
      // nada nuevo. Si se usara, la pantalla y la base retrocederían (series
      // que "desaparecen") y el siguiente cambio chocaría contra la nube como
      // "cambiado en otro dispositivo" sin serlo.
      if (raw && s.base !== null && (Number(raw._rev) || 0) < s.rev) return;
      if (deepEqual(incoming, s.base)) return; // eco de nuestra propia escritura
      s.latestRemote = incoming;
      const local = getLocal(id);
      // Si es la versión que escribió un envío de aquí cuya respuesta se perdió,
      // lo pendiente se cuenta desde lo que se envió (ver ownAttempt).
      const against = local === undefined ? { own: null, ops: [] } : opsAgainst(id, s, raw, local);
      const ops = against.ops;
      if (incoming === null) {
        if (s.base === null) return; // nunca existió en el servidor: nada que hacer
        if (ops.length) {
          s.blocked = [{ path: '(documento)', why: 'borrado en otro dispositivo' }];
          keepPending(id);
          status(id, 'conflict', s.blocked);
          return;
        }
        forget(id);
        cfg.applyLocal(id, null);
        status(id, 'remote');
        return;
      }
      const merged = applyOps(incoming, ops);
      if (merged.conflicts.length) {
        s.blocked = merged.conflicts;
        keepPending(id);
        status(id, 'conflict', merged.conflicts);
        return;
      }
      s.base = incoming;
      s.rev = (raw && raw._rev) || 0;
      s.serverWriters = writersOf(raw);
      if (against.own) { dropAttemptsThrough(s, against.own); s.lastError = null; if (!ops.length && !s.attempts.length) journal.clear(id); }
      cfg.applyLocal(id, merged.doc);
      status(id, against.own && !ops.length ? 'saved' : 'remote');
      if (ops.length) save(id);
    }

    /* Al arrancar: cambios que quedaron sin guardar en una pestaña cerrada. */
    /* ropts.othersOnly: solo pestañas cerradas, no la propia. Sirve para volver
       a mirar unos segundos después de abrir: tras una recarga rápida la
       pestaña anterior aún parece viva y su journal no se ve al arrancar. */
    function recover(ids, ropts) {
      const wanted = ids ? new Set(ids) : null;
      const report = [];
      for (const entry of journal.orphans()) {
        if (wanted && !wanted.has(entry.id)) continue;
        if (ropts && ropts.othersOnly && entry.tab === (cfg.tabId || 'tab')) continue;
        const local = getLocal(entry.id);
        if (local === undefined) continue;
        // La pestaña cerrada envió algo que sí llegó (la nube lleva su marca):
        // solo falta lo que editó después de ese envío.
        const w = st(entry.id).serverWriters || [];
        let own = null;
        for (let i = entry.own.length - 1; i >= 0 && !own; i--) if (w.indexOf(entry.own[i].tag) >= 0) own = entry.own[i];
        const merged = applyOps(local, own ? own.ops : entry.ops);
        if (merged.conflicts.length) {
          st(entry.id).blocked = merged.conflicts;
          status(entry.id, 'conflict', merged.conflicts);
          report.push({ id: entry.id, ok: false, conflicts: merged.conflicts, key: entry.key });
          continue;
        }
        cfg.applyLocal(entry.id, merged.doc);
        // Todo lo pendiente del documento (no solo esta entrada): si hay varias
        // pestañas cerradas, la última no debe tapar a las anteriores.
        journal.drop(entry.key);
        journalPut(entry.id, pendingOps(entry.id));
        report.push({ id: entry.id, ok: true });
        save(entry.id);
      }
      return report;
    }

    /* Solo por decisión explícita del usuario: tira lo pendiente de este
       dispositivo y se queda con lo último que se vio en el servidor. */
    function discardPending(id) {
      const s = st(id);
      for (const entry of journal.orphans()) if (entry.id === id) journal.drop(entry.key);
      journal.clear(id);
      s.blocked = null;
      s.again = false;
      s.attempts = [];
      if (s.latestRemote !== undefined) { s.base = s.latestRemote; s.latestRemote = undefined; }
      if (s.known) cfg.applyLocal(id, s.base ? clone(s.base) : null);
    }

    /* Solo por decisión explícita del usuario, ante un conflicto: en los datos
       que chocan se queda lo de la nube; todo lo demás pendiente en este
       dispositivo (lo editado antes y después del conflicto, y lo de pestañas
       cerradas) se guarda encima de la versión actual del servidor, en una
       transacción. Si no se puede leer o escribir (sin conexión...), no se
       toca nada: lo pendiente sigue en memoria y en el journal. */
    async function resolveWithCloud(id) {
      const s = st(id);
      if (s.inflight) { try { await s.inflight; } catch (_) {} }
      const local = getLocal(id);
      const orphanEntries = journal.orphans().filter(e => e.id === id);
      const ops = [];
      for (const e of orphanEntries.sort((x, y) => (x.at || 0) - (y.at || 0))) ops.push(...e.ops);
      if (local !== undefined && s.known) ops.push(...localOps(id, s.base, local));
      let result;
      try {
        result = await withTimeout(cfg.db.runTransaction(async t => {
          const snap = await t.get(ref(id));
          const exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
          const raw = exists ? snap.data() : null;
          if (!exists) return { deleted: true };
          const remoteDoc = stripSync(raw);
          const merged = applyOps(remoteDoc, ops);
          const rev = raw._rev || 0;
          if (deepEqual(merged.doc, remoteDoc)) return { doc: remoteDoc, rev, conflicts: merged.conflicts, wrote: false };
          if (jsonSize(merged.doc) > limit) throw err('size');
          t.set(ref(id), Object.assign({}, merged.doc, syncStamp(raw, cfg.tabId || 'tab', rev + 1, new Date(now()).toISOString())));
          return { doc: merged.doc, rev: rev + 1, conflicts: merged.conflicts, wrote: true };
        }));
      } catch (e) {
        const reason = e && e.kind === 'size' ? 'size' : 'error';
        status(id, reason === 'size' ? 'size' : 'error', e);
        return { ok: false, reason, error: e };
      }
      for (const entry of orphanEntries) journal.drop(entry.key);
      journal.clear(id);
      s.blocked = null; s.again = false; s.latestRemote = undefined; s.lastError = null; s.attempts = [];
      if (result.deleted) {
        // Borrado en la nube: no se resucita sin que el usuario lo cree de nuevo.
        s.base = null; s.rev = 0;
        cfg.applyLocal(id, null);
        status(id, 'remote');
        return { ok: true, deleted: true, kept: 0, dropped: [] };
      }
      s.known = true; s.base = clone(result.doc); s.rev = result.rev;
      cfg.applyLocal(id, clone(result.doc));
      status(id, 'saved');
      // La misma ruta puede venir del journal y de la memoria: se cuenta una vez.
      const droppedPaths = new Set(result.conflicts.map(c => c.path));
      const dropped = Array.from(droppedPaths).map(p => result.conflicts.find(c => c.path === p));
      const kept = new Set(ops.map(o => pathLabel(o.p)).filter(p => !droppedPaths.has(p))).size;
      return { ok: true, wrote: result.wrote, dropped, kept };
    }

    return {
      setBase, forget, save, remote, recover, pendingOps, discardPending, resolveWithCloud, absorb, markDefaults,
      heartbeat: journal.heartbeat,
      orphans: journal.orphans,
      isKnown: id => st(id).known,
      isBlocked: id => !!st(id).blocked,
      blockedInfo: id => st(id).blocked,
      ids: () => Array.from(states.keys()),
      hasUnsaved() {
        for (const [id, s] of states) {
          if (s.inflight || s.blocked) return true;
          if (s.known && pendingOps(id).length) return true;
        }
        return false;
      },
      baseOf: id => clone(st(id).base)
    };
  }

  const VERSION = '20261109-instantaneas';
  return { VERSION, diffDocs, applyOps, merge3, deepEqual, clone, stripSync, patchInPlace, arrayKey, createSync, createJournal, pathLabel, SYNC_FIELDS };
});
