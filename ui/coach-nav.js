/* Navegación del ENTRENADOR: menú lateral, barra inferior en móvil, rutas e historial del navegador.
   - Solo actúa en modo entrenador. El modo cliente no pasa por aquí (ni historial ni menú).
   - No guarda nada: solo cambia lo que se ve (UI.home, UI.page, UI.tab, DATA.active) y llama a
     las funciones de pintado que ya existían en index.html.
   - Rutas (en el #hash de la URL, para que el botón atrás del navegador funcione dentro de la app):
       #inicio · #calendario · #clientes · #biblioteca · #configuracion
       #negocio/<apartado>                     (resumen, contratos, crm, renov, pagos, planes, metricas, importar)
       #cliente/<idCliente>/<idBloque>/<pestaña>
   Depende de globales de index.html (UI, DATA, NEG, isCoach, renderAll, renderNegTabs…), que solo se
   usan cuando se llama a estas funciones, nunca al cargar el archivo. */
'use strict';

var NAV_PAGES = ['inicio', 'calendario', 'clientes', 'biblioteca', 'negocio', 'configuracion'];
var NAV_NEG_TABS = [
  ['resumen', 'Resumen'], ['contratos', 'Contratos'], ['crm', 'CRM'], ['renov', 'Renovaciones'],
  ['pagos', 'Pagos'], ['planes', 'Planes'], ['metricas', 'Métricas'], ['importar', 'Importar']
];
var NAV_TITLES = {
  inicio: ['Inicio', 'Resumen del día'],
  calendario: ['Calendario', 'Fechas de tus clientes y tu negocio'],
  clientes: ['Clientes', 'Todos tus clientes'],
  biblioteca: ['Biblioteca de ejercicios', 'Ejercicios y vídeos'],
  negocio: ['Negocio', 'Cobros, contratos y métricas'],
  configuracion: ['Configuración', 'Ajustes del entrenador']
};
var NAV = { started: false, applying: false, open: null, openFor: null };

function navIsCoach() { return typeof isCoach === 'function' && isCoach(); }
function navPage() { return (UI && UI.page && NAV_PAGES.indexOf(UI.page) >= 0) ? UI.page : 'inicio'; }
function navEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }

/* Ruta que corresponde a lo que se está viendo ahora. */
function coachRoute() {
  if (!navIsCoach() || !UI || !DATA) return null;
  if (UI.home) {
    var p = navPage();
    return p === 'negocio' ? 'negocio/' + ((typeof NEG !== 'undefined' && NEG && NEG.tab) || 'resumen') : p;
  }
  var a = DATA.active || {};
  if (!a.c || !DATA.clients[a.c]) return 'inicio';
  return 'cliente/' + a.c + '/' + (a.b || '-') + '/' + (UI.tab || 'semana');
}

/* Se llama en cada pintado (renderView). Añade una entrada al historial solo si cambia de pantalla. */
function navSync() {
  if (!navIsCoach() || NAV.applying) return;
  var r = coachRoute(); if (!r) return;
  if (!NAV.started) {
    NAV.started = true;
    var want = decodeURIComponent((location.hash || '').slice(1));
    if (want && want !== r && navRouteValid(want)) { setTimeout(function () { navApply(want, 'replace'); }, 0); return; }
    try { history.replaceState({ jcg: r }, '', '#' + r); } catch (_) {}
  } else if (decodeURIComponent(location.hash.slice(1)) !== r) {
    try { history.pushState({ jcg: r }, '', '#' + r); } catch (_) {}
  }
  navMarkActive();
}

function navRouteValid(r) {
  var p = String(r || '').split('/');
  if (p[0] === 'cliente') return !!(p[1] && DATA && DATA.clients && DATA.clients[p[1]]);
  return NAV_PAGES.indexOf(p[0]) >= 0;
}

/* Pone la app en la pantalla de la ruta r (sin guardar nada). mode: 'push' (por defecto), 'replace' o 'pop'. */
function navApply(r, mode) {
  if (!navIsCoach()) return;
  var p = String(r || '').split('/');
  NAV.applying = true;
  try {
    if (p[0] === 'cliente' && DATA.clients[p[1]]) {
      var cid = p[1], c = DATA.clients[cid], blocks = c.blocks || [];
      var bid = p[2];
      if (!blocks.some(function (b) { return b.id === bid; })) bid = ((blocks.find(function (b) { return b.cur; }) || blocks[0]) || {}).id || null;
      var changed = !DATA.active || DATA.active.c !== cid || DATA.active.b !== bid;
      DATA.active = { c: cid, b: bid };
      UI.home = false; UI.fichaIntake = false; UI.monthlyReview = false;
      UI.tab = p[3] || 'semana';
      if (changed) {
        try { UI.week = hasProgram() ? currentWeekIdx() : CUR_WEEK; } catch (_) {}
        UI.openDay = 0;
        try { loadTimers(); } catch (_) {}
        try { persistActive(); } catch (_) {}
      }
    } else {
      var page = NAV_PAGES.indexOf(p[0]) >= 0 ? p[0] : 'inicio';
      UI.home = true; UI.page = page;
      if (page === 'negocio') {
        try { negPrepare(); } catch (e) { console.warn('Negocio:', e); }
        if (NAV_NEG_TABS.some(function (t) { return t[0] === p[1]; })) NEG.tab = p[1];
      }
    }
    UI._navAnim = true;
    navCloseDrawer();
    renderAll();
  } finally { NAV.applying = false; }
  var now = coachRoute();
  try {
    if (mode === 'pop') { if (now !== decodeURIComponent(location.hash.slice(1))) history.replaceState({ jcg: now }, '', '#' + now); }
    else if (mode === 'replace' || decodeURIComponent(location.hash.slice(1)) === now) history.replaceState({ jcg: now }, '', '#' + now);
    else history.pushState({ jcg: now }, '', '#' + now);
  } catch (_) {}
  navMarkActive();
  window.scrollTo({ top: 0 });
}

function navTo(r) { navApply(r, 'push'); }

/* Clic en un enlace del menú: navegación interna (Ctrl/Cmd+clic sigue abriendo otra pestaña). */
function navGo(ev, r) {
  if (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1)) return true;
  if (ev) ev.preventDefault();
  if (r.indexOf('negocio/') === 0) { try { negPrepare(); } catch (_) {} }
  if (r === 'clientes' && UI) UI.homeQ = ''; // desde el menú, Clientes se abre sin la búsqueda anterior
  navTo(r);
  return false;
}

/* Botón atrás / adelante del navegador. */
window.addEventListener('popstate', function () {
  if (!navIsCoach() || !UI || !DATA) return;
  var r = decodeURIComponent((location.hash || '').slice(1)) || 'inicio';
  if (r === coachRoute()) return;
  navApply(navRouteValid(r) ? r : 'inicio', 'pop');
});

/* ---------- menú lateral: estado activo y grupos desplegables ----------
   Un grupo se abre solo cuando su sección está activa (Biblioteca, Negocio, o Clientes al estar en
   la ficha de un cliente o en la pantalla Clientes). La flecha de Clientes permite abrir o cerrar su
   lista a mano; esa elección dura hasta que cambias de sección. */
function navGroupOpen(k, page) {
  if (NAV.open && Object.prototype.hasOwnProperty.call(NAV.open, k)) return NAV.open[k];
  return k === page;
}
function navToggle(g) {
  var page = UI && UI.home ? navPage() : 'clientes';
  if (!NAV.open) NAV.open = {};
  NAV.open[g] = !navGroupOpen(g, page);
  NAV.openFor = page;
  navMarkActive();
}
function navMarkActive() {
  var nav = document.getElementById('dsNav'); if (!nav || !UI) return;
  var page = UI.home ? navPage() : 'clientes';
  var negTab = (typeof NEG !== 'undefined' && NEG && NEG.tab) || 'resumen';
  var sub = document.getElementById('navNegSub');
  if (sub && !sub.childElementCount) {
    sub.innerHTML = NAV_NEG_TABS.map(function (t) {
      return '<a class="ds-nav-subitem" href="#negocio/' + t[0] + '" data-page="negocio" data-sub="' + t[0] + '" onclick="return navGo(event,\'negocio/' + t[0] + '\')">' + t[1] + '</a>';
    }).join('');
  }
  nav.querySelectorAll('.ds-nav-item').forEach(function (a) {
    var on = a.getAttribute('data-page') === page;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  nav.querySelectorAll('.ds-nav-subitem[data-sub]').forEach(function (a) {
    var on = UI.home && a.getAttribute('data-page') === page && (page !== 'negocio' || a.getAttribute('data-sub') === negTab);
    a.classList.toggle('on', on);
  });
  if (NAV.open && NAV.openFor !== page) NAV.open = null; // al cambiar de sección, vuelve al comportamiento automático
  nav.querySelectorAll('.ds-nav-group').forEach(function (g) {
    var k = g.getAttribute('data-group');
    var open = navGroupOpen(k, page);
    g.classList.toggle('open', open);
    var b = g.querySelector('.ds-nav-exp'); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  var n = document.getElementById('navClientCount');
  if (n && DATA && DATA.clients) { var k2 = Object.values(DATA.clients).filter(function (c) { return c && !c.archived; }).length; n.textContent = k2 ? String(k2) : ''; }
}
function navCloseDrawer() { if (window.innerWidth <= 900 && typeof closeSide === 'function') closeSide(); }

/* ---------- títulos de la barra superior ---------- */
function coachPageTitle() {
  var p = navPage(), t = NAV_TITLES[p] || NAV_TITLES.inicio;
  if (p === 'negocio') {
    var tab = NAV_NEG_TABS.find(function (x) { return x[0] === ((typeof NEG !== 'undefined' && NEG && NEG.tab) || 'resumen'); });
    return ['Negocio', tab ? tab[1] : t[1]];
  }
  if (p === 'clientes' && DATA && DATA.clients) {
    var n = Object.values(DATA.clients).filter(function (c) { return c && !c.archived; }).length;
    return ['Clientes', n === 1 ? '1 cliente activo' : n + ' clientes activos'];
  }
  return t;
}

/* ---------- barra inferior en móvil (modo entrenador, fuera de la ficha de un cliente) ---------- */
function coachBotnavRender(bn) {
  if (!bn) return;
  var page = navPage();
  var items = [['inicio', 'Inicio', 'i-home'], ['calendario', 'Calendario', 'i-calendar'], ['clientes', 'Clientes', 'i-users'], ['negocio', 'Negocio', 'i-chart']];
  bn.classList.add('ds-botnav');
  bn.style.display = '';
  bn.innerHTML = items.map(function (it) {
    var r = it[0] === 'negocio' ? 'negocio/' + ((typeof NEG !== 'undefined' && NEG && NEG.tab) || 'resumen') : it[0];
    return '<button type="button" class="' + (page === it[0] ? 'on' : '') + '"' + (page === it[0] ? ' aria-current="page"' : '') + ' onclick="navGo(null,\'' + r + '\')"><svg class="ds-ic"><use href="#' + it[2] + '"/></svg><span>' + it[1] + '</span></button>';
  }).join('') + '<button type="button" class="' + (page === 'biblioteca' || page === 'configuracion' ? 'on' : '') + '" onclick="openSide()" aria-label="Más secciones"><svg class="ds-ic"><use href="#i-grid"/></svg><span>Más</span></button>';
}

/* ---------- pantallas del entrenador ---------- */
function coachPageRender(v) {
  var p = navPage();
  v.className = 'wrap ds-page ds-page-' + p;
  if (p === 'negocio') {
    v.innerHTML = '<div class="neg-modal neg-page"><div class="neg-tabs" id="negTabs"></div><div class="neg-body" id="negBody"></div></div>';
    try { negPrepare(); renderNegTabs(); renderNegBody(); } catch (e) { console.warn('Negocio:', e); }
  } else if (p === 'calendario') v.innerHTML = (typeof viewCoachCalendar === 'function') ? viewCoachCalendar() : coachViewCalendarioPreview();
  else if (p === 'biblioteca') {
    if (typeof viewCoachLibrary === 'function') { v.innerHTML = viewCoachLibrary(); klRefresh(); }
    else v.innerHTML = coachViewBibliotecaPreview();
  }
  else if (p === 'configuracion') v.innerHTML = coachViewConfig();
  else if (p === 'inicio' && typeof viewCoachDashboard === 'function') v.innerHTML = viewCoachDashboard();
  else v.innerHTML = viewHome(); // Clientes: buscador, filtros y tarjetas de siempre
  navMarkActive();
}

function dsIcon(id) { return '<svg class="ds-ic"><use href="#' + id + '"/></svg>'; }

function coachViewCalendarioPreview() {
  return '<div class="ds-empty">' +
    '<div class="ds-empty-ic">' + dsIcon('i-calendar') + '</div>' +
    '<h2>Calendario del entrenador</h2>' +
    '<p>Aquí verás tu semana: fines de plan, vencimientos de pago, videollamadas de cierre y sesiones de tus clientes. Se construye en la etapa 3 del rediseño.</p>' +
    '<p class="ds-muted">La periodización de cada cliente sigue disponible dentro de su ficha.</p>' +
    '</div>';
}

function coachViewBibliotecaPreview() {
  var all = [], conVideo = 0;
  try { all = exLibAll(); conVideo = all.filter(function (x) { return x.v; }).length; } catch (_) {}
  var fmt = function (n) { try { return n.toLocaleString('es-ES'); } catch (_) { return String(n); } };
  return '<div class="ds-empty">' +
    '<div class="ds-empty-ic">' + dsIcon('i-dumbbell') + '</div>' +
    '<h2>Biblioteca de ejercicios</h2>' +
    '<p><b>' + fmt(all.length) + '</b> ejercicios, <b>' + fmt(conVideo) + '</b> con vídeo. La nueva vista con buscador, filtros y vídeos se construye en la etapa 4 del rediseño.</p>' +
    '<p class="ds-muted">Mientras tanto, al programar un entrenamiento puedes buscarlos y añadir vídeos desde el selector de ejercicios.</p>' +
    '<div class="ds-actions"><button class="ds-btn ds-btn-secondary" type="button" onclick="openLibrary()">' + dsIcon('i-layers') + 'Abrir plantillas</button></div>' +
    '</div>';
}

function coachViewConfig() {
  var row = function (ic, t, d, fn, cls) {
    return '<button type="button" class="ds-setting' + (cls ? ' ' + cls : '') + '" onclick="' + fn + '"><span class="ds-setting-ic">' + dsIcon(ic) + '</span><span class="ds-setting-tx"><b>' + navEsc(t) + '</b><span>' + navEsc(d) + '</span></span><svg class="ds-ic ds-setting-go"><use href="#i-chevron"/></svg></button>';
  };
  return '<div class="ds-settings">' +
    row('i-key', 'Código de entrenador', 'Cambia el código con el que entras como entrenador.', 'openCoachCodeModal()') +
    row('i-shield', 'Copia de seguridad', 'Descarga o restaura una copia de tus datos.', 'openBackup()') +
    row('i-layers', 'Plantillas', 'Entrenamientos y dietas guardados para reutilizar.', 'openLibrary()') +
    row('i-logout', 'Cerrar sesión', 'Sal de la cuenta de entrenador en este dispositivo.', 'logout()', 'danger') +
    '</div>';
}
