/* =====================================================================
   Etapa 4 — Biblioteca de ejercicios del entrenador (#biblioteca)

   SOLO LECTURA de los datos existentes:
   - Ejercicios de serie: EXLIB (JSON incrustado en index.html, {n, v, d}).
   - Ejercicios propios: DATA.exLibrary ({n, v, d}); si coinciden por nombre
     sustituyen al de serie, igual que hace exLibAll() en el selector.
   - El grupo muscular sale del propio nombre («Ejercicio - Músculo, músculo»),
     que es como ya lo usa parseMuscles(). Si un nombre no lo trae, el ejercicio
     aparece como «Sin clasificar»: no se deduce nada.

   «Vídeo del entrenador»: PROPUESTA, DESACTIVADA (KLIB_COACH_VIDEO_ON=false).
   Necesita un campo nuevo `vc` dentro de cada entrada de DATA.exLibrary. Hasta
   que el usuario lo autorice, el campo se muestra bloqueado y no se escribe nada.
   La lógica pura (klCoachVideoApply) está lista y probada en
   ui/coach-library.test.js; nunca toca n, v ni d.
   ===================================================================== */

var KLIB_COACH_VIDEO_ON = false; // no activar sin autorización expresa
var KLIB_PAGE = 60;
var KLIB_ALIAS = { aductor: 'aductores' }; // misma palabra en singular/plural

function klNorm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function klMuscleKey(m) {
  var k = klNorm(m).replace(/\s+/g, '');
  return KLIB_ALIAS[k] || k;
}
function klTidy(s) {
  s = String(s || '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* Descompone «Base - Músculos» sin inventar: sin « - » no hay grupo. */
function klParse(name) {
  var n = String(name || '');
  var i = n.indexOf(' - ');
  if (i < 0) return { base: n.trim(), muscles: [] };
  var muscles = n.slice(i + 3).split(',').map(klTidy).filter(Boolean);
  return { base: n.slice(0, i).trim(), muscles: muscles };
}

/* Une serie + propios (los propios mandan, como en exLibAll). Pura y testeable. */
function klMerge(builtin, own) {
  var map = new Map();
  (builtin || []).forEach(function (x) {
    if (x && x.n) map.set(String(x.n).trim().toLowerCase(), { n: x.n, v: x.v || '', d: x.d || '', vc: '', own: false });
  });
  (own || []).forEach(function (x) {
    if (x && x.n) map.set(String(x.n).trim().toLowerCase(), { n: x.n, v: x.v || '', d: x.d || '', vc: x.vc || '', own: true });
  });
  return Array.from(map.values()).map(function (x) {
    var p = klParse(x.n);
    x.base = p.base;
    x.muscles = p.muscles;
    x.mkeys = p.muscles.map(klMuscleKey);
    x.sk = klNorm(x.n);
    return x;
  });
}

/* Grupos musculares presentes en los datos, con recuento y etiqueta más usada. */
function klGroups(items) {
  var g = {};
  items.forEach(function (x) {
    if (!x.muscles.length) return;
    var seen = {};
    x.muscles.forEach(function (m, idx) {
      var k = x.mkeys[idx];
      if (seen[k]) return; seen[k] = 1;
      var e = g[k] || (g[k] = { key: k, n: 0, labels: {} });
      e.n++;
      e.labels[m] = (e.labels[m] || 0) + 1;
    });
  });
  return Object.keys(g).map(function (k) {
    var e = g[k];
    var label = Object.keys(e.labels).sort(function (a, b) { return e.labels[b] - e.labels[a]; })[0];
    return { key: k, n: e.n, label: label };
  });
}

/* Filtro puro: q (nombre), mus (clave | '' | '__none'), prim, vid ('' | 'con' | 'sin' | 'mio'), sort. */
function klFilter(items, f) {
  var q = klNorm(f.q || '').trim();
  var words = q ? q.split(/\s+/) : [];
  var res = items.filter(function (x) {
    for (var i = 0; i < words.length; i++) if (x.sk.indexOf(words[i]) < 0) return false;
    if (f.mus === '__none') { if (x.muscles.length) return false; }
    else if (f.mus) {
      if (f.prim) { if (x.mkeys[0] !== f.mus) return false; }
      else if (x.mkeys.indexOf(f.mus) < 0) return false;
    }
    if (f.vid === 'con' && !x.v) return false;
    if (f.vid === 'sin' && x.v) return false;
    if (f.vid === 'mio' && !x.vc) return false;
    return true;
  });
  var dir = f.sort === 'za' ? -1 : 1;
  res.sort(function (a, b) { return dir * a.base.localeCompare(b.base, 'es', { sensitivity: 'base' }) || dir * a.n.localeCompare(b.n, 'es'); });
  return res;
}

/* PROPUESTA (no activa): devuelve una copia de exLibrary con el vídeo del
   entrenador puesto o quitado. Nunca cambia n, v ni d de ninguna entrada. */
function klCoachVideoApply(lib, builtin, name, url) {
  var key = String(name || '').trim().toLowerCase();
  url = String(url || '').trim();
  var out = (lib || []).map(function (x) { return Object.assign({}, x); });
  var hit = null;
  for (var i = 0; i < out.length; i++) if (out[i] && String(out[i].n || '').trim().toLowerCase() === key) { hit = out[i]; break; }
  if (hit) {
    if (url) hit.vc = url; else delete hit.vc;
    return out;
  }
  if (!url) return out;
  var base = (builtin || []).find(function (x) { return x && String(x.n || '').trim().toLowerCase() === key; });
  if (!base) return out;
  out.push({ n: base.n, v: base.v || '', d: base.d || '', vc: url });
  return out;
}

/* ---------------- estado y vista ---------------- */
var KLIB = { items: [], res: [] };

function klState() {
  if (!UI.coachLib) UI.coachLib = { q: '', mus: '', prim: false, vid: '', sort: 'az', limit: KLIB_PAGE };
  return UI.coachLib;
}
function klLoad() {
  var builtin = (typeof EXLIB !== 'undefined' && Array.isArray(EXLIB)) ? EXLIB : [];
  KLIB.items = klMerge(builtin, (typeof DATA !== 'undefined' && DATA && DATA.exLibrary) || []);
  KLIB.groups = klGroups(KLIB.items);
}
function klEsc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s); }
function klFmt(n) { try { return n.toLocaleString('es-ES'); } catch (_) { return String(n); } }
function klIc(id) { return '<svg class="ds-ic"><use href="#' + id + '"/></svg>'; }

function viewCoachLibrary() {
  var st = klState();
  klLoad();
  var all = KLIB.items;
  var conV = all.filter(function (x) { return x.v; }).length;
  var conC = all.filter(function (x) { return x.vc; }).length;
  var sinG = all.filter(function (x) { return !x.muscles.length; }).length;
  var groups = KLIB.groups.slice().sort(function (a, b) { return a.label.localeCompare(b.label, 'es'); });
  var opts = '<option value="">Todos los grupos</option>' + groups.map(function (g) {
    return '<option value="' + klEsc(g.key) + '"' + (st.mus === g.key ? ' selected' : '') + '>' + klEsc(g.label) + ' (' + klFmt(g.n) + ')</option>';
  }).join('') + (sinG ? '<option value="__none"' + (st.mus === '__none' ? ' selected' : '') + '>Sin clasificar (' + klFmt(sinG) + ')</option>' : '');

  return '<div class="kl" id="klRoot">' +
    '<div class="kl-head">' +
      '<div class="kl-stats">' +
        '<div class="kl-stat"><b>' + klFmt(all.length) + '</b><span>ejercicios</span></div>' +
        '<div class="kl-stat t-red"><b>' + klFmt(conV) + '</b><span>con vídeo general</span></div>' +
        '<div class="kl-stat t-coach"><b>' + klFmt(conC) + '</b><span>con vídeo tuyo</span></div>' +
      '</div>' +
      '<button class="ds-btn ds-btn-secondary" type="button" onclick="openLibrary()">' + klIc('i-layers') + 'Plantillas</button>' +
    '</div>' +
    '<div class="kl-tools">' +
      '<label class="kl-search">' + klIc('i-search') +
        '<input id="klQ" type="search" placeholder="Buscar ejercicio por nombre" autocomplete="off" value="' + klEsc(st.q) + '" oninput="klSet(\'q\',this.value)" aria-label="Buscar ejercicio por nombre">' +
      '</label>' +
      '<div class="kl-selects">' +
        '<select id="klMus" class="kl-sel" onchange="klSet(\'mus\',this.value)" aria-label="Grupo muscular">' + opts + '</select>' +
        '<select id="klVid" class="kl-sel" onchange="klSet(\'vid\',this.value)" aria-label="Vídeo">' +
          '<option value="">Con y sin vídeo</option>' +
          '<option value="con"' + (st.vid === 'con' ? ' selected' : '') + '>Con vídeo general</option>' +
          '<option value="sin"' + (st.vid === 'sin' ? ' selected' : '') + '>Sin vídeo general</option>' +
          '<option value="mio"' + (st.vid === 'mio' ? ' selected' : '') + '>Con vídeo tuyo</option>' +
        '</select>' +
      '</div>' +
      '<div class="kl-chips" id="klChips"></div>' +
    '</div>' +
    '<div class="kl-sum" id="klSum"></div>' +
    '<div class="kl-list" id="klList"></div>' +
    '<p class="kl-note">El grupo muscular es el que figura en el nombre de cada ejercicio. Los que no lo indican aparecen como «Sin clasificar». ' +
      'No hay un dato de material o equipamiento, así que de momento se busca escribiéndolo (por ejemplo «polea» o «mancuerna»).</p>' +
  '</div>';
}

function klChipsHtml(st) {
  var top = KLIB.groups.slice().sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
  if (st.mus && st.mus !== '__none' && !top.some(function (g) { return g.key === st.mus; })) {
    var cur = KLIB.groups.find(function (g) { return g.key === st.mus; });
    if (cur) top.unshift(cur);
  }
  var chip = function (key, label, n) {
    var on = st.mus === key;
    return '<button type="button" class="kl-chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" onclick="klSet(\'mus\',' + (on ? '\'\'' : '\'' + key + '\'') + ')">' + klEsc(label) + (n != null ? '<span>' + klFmt(n) + '</span>' : '') + '</button>';
  };
  var h = chip('', 'Todos', null);
  h += top.map(function (g) { return chip(g.key, g.label, g.n); }).join('');
  if (st.mus && st.mus !== '__none') {
    h += '<label class="kl-prim"><input type="checkbox"' + (st.prim ? ' checked' : '') + ' onchange="klSet(\'prim\',this.checked)"> Solo como músculo principal</label>';
  }
  return h;
}

function klCardHtml(x, idx) {
  var tags = x.muscles.length
    ? x.muscles.map(function (m, i) { return '<span class="kl-tag' + (i === 0 ? ' main' : '') + '">' + klEsc(m) + '</span>'; }).join('')
    : '<span class="kl-tag none">Sin clasificar</span>';
  var gen = x.v
    ? '<button type="button" class="kl-play gen" onclick="klPlay(' + idx + ',\'v\')">' + '<span class="kl-play-ic">▶</span>Ver vídeo</button>'
    : '<span class="kl-novid">Sin vídeo general</span>';
  var coach;
  if (KLIB_COACH_VIDEO_ON) {
    coach = (x.vc ? '<button type="button" class="kl-play coach" onclick="klPlay(' + idx + ',\'vc\')"><span class="kl-play-ic">▶</span>Ver mi vídeo</button>' : '') +
      '<div class="kl-vc-in"><input type="url" id="klVc' + idx + '" placeholder="Pega el enlace de tu vídeo" value="' + klEsc(x.vc) + '" aria-label="Enlace del vídeo del entrenador">' +
      '<button type="button" class="ds-btn ds-btn-primary" onclick="klSaveCoachVideo(' + idx + ')">Guardar</button></div>';
  } else {
    coach = '<div class="kl-vc-in locked"><input type="url" placeholder="Pega el enlace de tu vídeo" disabled aria-label="Enlace del vídeo del entrenador (pendiente de autorización)">' +
      '<button type="button" class="ds-btn ds-btn-secondary" disabled>Guardar</button></div>' +
      '<span class="kl-lock">Pendiente de tu autorización: aún no guarda nada.</span>';
  }
  return '<article class="kl-card">' +
    '<div class="kl-card-top"><h3>' + klEsc(x.base || x.n) + '</h3>' + (x.own ? '<span class="kl-own" title="Ejercicio añadido o editado por ti">Tuyo</span>' : '') + '</div>' +
    '<div class="kl-tags">' + tags + '</div>' +
    (x.d ? '<p class="kl-desc">' + klEsc(x.d) + '</p>' : '') +
    '<div class="kl-vids">' +
      '<div class="kl-vrow gen"><span class="kl-vlab">' + klIc('i-video') + 'Vídeo general</span>' + gen + '</div>' +
      '<div class="kl-vrow coach"><span class="kl-vlab">' + klIc('i-video') + 'Vídeo del entrenador</span>' + coach + '</div>' +
    '</div>' +
  '</article>';
}

function klRefresh() {
  var list = document.getElementById('klList');
  if (!list) return;
  var st = klState();
  KLIB.res = klFilter(KLIB.items, st);
  var shown = KLIB.res.slice(0, st.limit);
  var chips = document.getElementById('klChips');
  if (chips) chips.innerHTML = klChipsHtml(st);
  var active = !!(st.q || st.mus || st.vid);
  var sum = document.getElementById('klSum');
  if (sum) sum.innerHTML = '<span class="kl-count"><b>' + klFmt(KLIB.res.length) + '</b> ' + (KLIB.res.length === 1 ? 'ejercicio' : 'ejercicios') + '</span>' +
    (active ? '<button type="button" class="kl-clear" onclick="klClear()">Quitar filtros</button>' : '') +
    '<div class="kl-seg" role="group" aria-label="Orden alfabético">' +
      '<button type="button" class="' + (st.sort !== 'za' ? 'on' : '') + '" aria-pressed="' + (st.sort !== 'za') + '" onclick="klSet(\'sort\',\'az\')">A–Z</button>' +
      '<button type="button" class="' + (st.sort === 'za' ? 'on' : '') + '" aria-pressed="' + (st.sort === 'za') + '" onclick="klSet(\'sort\',\'za\')">Z–A</button>' +
    '</div>';
  if (!shown.length) {
    list.innerHTML = '<div class="kl-empty"><b>No hay ejercicios con esos filtros.</b><span>Prueba con otro nombre o quita algún filtro.</span></div>';
    return;
  }
  list.innerHTML = shown.map(klCardHtml).join('') +
    (KLIB.res.length > shown.length
      ? '<button type="button" class="ds-btn ds-btn-secondary kl-more" onclick="klMore()">Mostrar más (' + klFmt(KLIB.res.length - shown.length) + ' restantes)</button>'
      : '');
}

/* ---------------- acciones (solo vista; ninguna guarda) ---------------- */
function klSet(k, v) {
  var st = klState();
  st[k] = v;
  if (k === 'mus' && !v) st.prim = false;
  st.limit = KLIB_PAGE;
  if (k === 'mus') { var s = document.getElementById('klMus'); if (s && s.value !== v) s.value = v; }
  klRefresh();
}
function klClear() {
  var st = klState();
  st.q = ''; st.mus = ''; st.prim = false; st.vid = ''; st.limit = KLIB_PAGE;
  var q = document.getElementById('klQ'); if (q) q.value = '';
  var m = document.getElementById('klMus'); if (m) m.value = '';
  var vd = document.getElementById('klVid'); if (vd) vd.value = '';
  klRefresh();
}
function klMore() { klState().limit += KLIB_PAGE; klRefresh(); }
function klPlay(idx, field) {
  var x = KLIB.res[idx];
  if (!x || !x[field]) return;
  if (typeof showVideo === 'function') showVideo(x[field], (field === 'vc' ? 'Tu vídeo · ' : '') + (x.base || x.n));
}

/* Guardado del vídeo del entrenador: bloqueado hasta autorización. */
function klSaveCoachVideo(idx) {
  if (!KLIB_COACH_VIDEO_ON) { if (typeof toast === 'function') toast('El vídeo del entrenador aún no está activado'); return; }
  var x = KLIB.res[idx];
  var el = document.getElementById('klVc' + idx);
  if (!x || !el) return;
  var url = String(el.value || '').trim();
  if (url && !/^https?:\/\//i.test(url)) { toast('Pega un enlace que empiece por https://'); return; }
  var builtin = (typeof EXLIB !== 'undefined' && Array.isArray(EXLIB)) ? EXLIB : [];
  DATA.exLibrary = klCoachVideoApply(DATA.exLibrary || [], builtin, x.n, url);
  save();
  klLoad(); klRefresh();
  toast(url ? 'Vídeo del entrenador guardado' : 'Vídeo del entrenador quitado');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { klParse: klParse, klMerge: klMerge, klGroups: klGroups, klFilter: klFilter, klCoachVideoApply: klCoachVideoApply, klMuscleKey: klMuscleKey };
}
