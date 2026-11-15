/* Panel de INICIO del entrenador (fase 1 del rediseño del menú principal).
   SOLO LECTURA: no guarda nada ni cambia ningún cálculo. Las cifras salen de las funciones de Negocio
   que ya existían en index.html (negActivos, negReconocido, negCaja, negSaldo, negFin, negProx,
   negDaysTo, negIsFrozen, negCallScheduled, negCoachAlerts) y de los programas de los clientes
   (startDate + nº de semanas del bloque actual). No inventa horas ni eventos.
   Secciones: 1 resumen · 2 videollamadas y citas · 3 programas que terminan · 4 pagos ·
              5 tareas y avisos · 6 accesos rápidos. */
'use strict';

var DASH_HORIZON = 21;   // días que mira la agenda de citas
var DASH_PROG_DIAS = 14; // programas que terminan en este margen (o terminaron hace menos)

function dashEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function dashIc(id, cls) { return '<svg class="ds-ic' + (cls ? ' ' + cls : '') + '"><use href="#' + id + '"/></svg>'; }
function dashIni(name) { return String(name || '?').trim().split(/\s+/).map(function (x) { return x[0] || ''; }).slice(0, 2).join('').toUpperCase(); }
function dashNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' '); }
var DASH_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dashDayLabel(iso, d) {
  if (d === 0) return ['HOY', ''];
  var p = String(iso).split('-');
  return [String(+p[2]), DASH_MES[(+p[1]) - 1] || ''];
}
function dashWhen(d) {
  if (d < 0) return d === -1 ? 'Venció ayer' : 'Venció hace ' + (-d) + ' días';
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Mañana';
  return 'En ' + d + ' días';
}
function dashISO(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }

/* Cliente de la app con el mismo nombre que el contrato (solo para mostrar su foto / abrir su ficha). */
function dashClientByName(nombre) {
  var n = dashNorm(nombre); if (!n || !DATA || !DATA.clients) return null;
  var hit = null;
  Object.keys(DATA.clients).forEach(function (id) { var c = DATA.clients[id]; if (!hit && c && dashNorm(c.name) === n) hit = { id: id, c: c }; });
  return hit;
}
function dashAvatar(nombre) {
  var m = dashClientByName(nombre);
  if (m && m.c.photo) return '<span class="dash-av"><img src="' + dashEsc(m.c.photo) + '" alt=""></span>';
  return '<span class="dash-av">' + dashEsc(dashIni(nombre)) + '</span>';
}
function dashCurBlock(c) { return (c.blocks || []).find(function (x) { return x && x.cur; }) || (c.blocks || [])[(c.blocks || []).length - 1]; }

/* Fin del programa del bloque actual de cada cliente (lectura directa; no llama a blockProgram, que rellena). */
function dashPrograms() {
  var out = [], hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  Object.keys(DATA.clients || {}).forEach(function (id) {
    var c = DATA.clients[id]; if (!c || c.archived) return;
    var b = dashCurBlock(c); var p = b && b.data && b.data.program;
    if (!p || !Array.isArray(p.weeks) || !p.weeks.length || !p.startDate) return;
    var start = new Date(p.startDate + 'T00:00:00'); if (isNaN(start)) return;
    var fin = new Date(start); fin.setDate(fin.getDate() + p.weeks.length * 7 - 1);
    var d = Math.round((fin - hoy) / 86400000);
    var sem = Math.min(p.weeks.length, Math.max(1, Math.floor((hoy - start) / 86400000 / 7) + 1));
    out.push({ id: id, c: c, b: b, fin: dashISO(fin), d: d, sem: sem, total: p.weeks.length });
  });
  return out;
}

/* ---------- datos (todo de lectura) ---------- */
function dashData() {
  var out = { ok: true };
  try {
    var hoy = negToday(), m = negYm(hoy);
    var cs = negContracts();
    var al = negCoachAlerts();
    // 1. Resumen (mismas fórmulas que Negocio → Resumen y Negocio → Pagos)
    out.activos = negActivos(m);
    out.ingresos = negReconocido(m);
    out.cobrado = negCaja(m);
    out.objetivo = (NEGO().cfg && NEGO().cfg.target) || 0;
    out.fichas = Object.values(DATA.clients || {}).filter(function (c) { return c && !c.archived; }).length;

    // 2. Videollamadas y citas: fechas registradas en los contratos
    var citas = [];
    cs.forEach(function (c) {
      if (negIsFrozen(c)) return;
      var fin = negFin(c), dF = negDaysTo(fin);
      if (dF >= 0 && dF <= DASH_HORIZON) citas.push({ tipo: 'cierre', iso: fin, d: dF, c: c, ok: negCallScheduled(c) });
      if (c.inicio) { var dI = negDaysTo(c.inicio); if (dI >= 0 && dI <= DASH_HORIZON) citas.push({ tipo: 'inicio', iso: c.inicio, d: dI, c: c }); }
    });
    citas.sort(function (a, b) { return a.d - b.d || String(a.c.nombre).localeCompare(String(b.c.nombre)); });
    out.citas = citas;

    // 3. Programas que terminan pronto (o ya terminaron sin bloque nuevo)
    var progs = dashPrograms().filter(function (o) { return o.d <= DASH_PROG_DIAS && o.d >= -DASH_PROG_DIAS; });
    progs.sort(function (a, b) { return a.d - b.d; });
    out.progs = progs;

    // 4. Pagos pendientes y próximos vencimientos
    var pagos = [];
    cs.forEach(function (c) {
      if (negIsFrozen(c) || !(negSaldo(c) > 0)) return;
      var px = negProx(c), d = negDaysTo(px);
      if (d <= 30) pagos.push({ c: c, iso: px, d: d, importe: negSaldo(c) });
    });
    pagos.sort(function (a, b) { return a.d - b.d; });
    out.pagos = pagos;
    out.pendiente = cs.reduce(function (s, c) { return s + negSaldo(c); }, 0);
    out.vencidos = pagos.filter(function (p) { return p.d < 0; });
    out.vencidoTotal = out.vencidos.reduce(function (s, p) { return s + p.importe; }, 0);

    // 5. Tareas y avisos (por prioridad)
    var t = [];
    if (out.vencidos.length) t.push({ prio: 0, tone: 'danger', ic: 'i-wallet', titulo: out.vencidos.length === 1 ? '1 cobro vencido' : out.vencidos.length + ' cobros vencidos', det: negEur(out.vencidoTotal) + ' por cobrar', ruta: 'negocio/pagos' });
    progs.filter(function (o) { return o.d < 0; }).forEach(function (o) {
      t.push({ prio: 0, tone: 'danger', ic: 'i-dumbbell', nombre: o.c.name, titulo: o.c.name, det: 'Su programa terminó hace ' + (-o.d) + (o.d === -1 ? ' día' : ' días'), ruta: 'cliente/' + o.id + '/' + o.b.id + '/programa' });
    });
    al.renov.forEach(function (o) {
      t.push({ prio: 1, tone: 'violet', ic: 'i-video', nombre: o.c.nombre, titulo: o.c.nombre, det: 'Agenda su videollamada de cierre', ruta: 'negocio/renov' });
    });
    var lunes = (typeof calMondayISO === 'function') ? calMondayISO() : null;
    Object.keys(DATA.clients || {}).forEach(function (id) {
      var c = DATA.clients[id]; if (!c || c.archived || !lunes) return;
      var b = dashCurBlock(c);
      var tr = b && b.data && Array.isArray(b.data.tracking) ? b.data.tracking : [];
      if (tr.some(function (x) { return x && x.date === lunes && x._submittedAt; }))
        t.push({ prio: 2, tone: 'info', ic: 'i-clipboard', nombre: c.name, titulo: c.name, det: 'Seguimiento semanal recibido', ruta: 'cliente/' + id + '/' + b.id + '/seguimiento' });
    });
    Object.keys(DATA.clients || {}).forEach(function (id) {
      var c = DATA.clients[id]; if (!c || c.archived) return;
      if (c.serviceType !== 'training' && c.serviceType !== 'training_nutrition') return;
      var b = dashCurBlock(c);
      var tiene = b && b.data && b.data.program && Array.isArray(b.data.program.weeks) && b.data.program.weeks.some(function (w) { return (w.days || []).some(function (d) { return (d.exs || []).length; }); });
      if (!tiene) t.push({ prio: 3, tone: 'muted', ic: 'i-dumbbell', nombre: c.name, titulo: c.name, det: b ? 'Aún no tiene entrenamiento' : 'No tiene ningún bloque', ruta: b ? 'cliente/' + id + '/' + b.id + '/programa' : 'clientes' });
    });
    t.sort(function (a, b) { return a.prio - b.prio; });
    out.tareas = t;
  } catch (e) { console.warn('Inicio:', e); out.ok = false; out.error = e; }
  return out;
}

/* ---------- piezas de la vista ---------- */
function dashCard(id, ic, titulo, count, link, cuerpo, extraCls) {
  return '<section class="dash-card' + (extraCls ? ' ' + extraCls : '') + '" id="' + id + '" aria-labelledby="' + id + 'H"><div class="dash-card-h"><h3 id="' + id + 'H">' + dashIc(ic) + '<span>' + titulo + '</span>' +
    (count ? '<span class="dash-count">' + count + '</span>' : '') + '</h3>' + (link || '') + '</div>' + cuerpo + '</section>';
}
function dashLink(txt, fn) { return '<button type="button" class="dash-link" onclick="' + fn + '">' + txt + dashIc('i-arrow') + '</button>'; }
function dashNone(ic, txt) { return '<div class="dash-none">' + dashIc(ic) + '<span>' + txt + '</span></div>'; }
function dashMoreBtn(key, total, max) {
  if (total <= max) return '';
  var on = UI && UI.dashMore && UI.dashMore[key];
  return '<button type="button" class="dash-more" onclick="UI.dashMore=UI.dashMore||{};UI.dashMore[\'' + key + '\']=!UI.dashMore[\'' + key + '\'];renderView()">' + (on ? 'Ver menos' : 'Ver todos (' + total + ')') + '</button>';
}
function dashSlice(key, arr, max) { return (UI && UI.dashMore && UI.dashMore[key]) ? arr : arr.slice(0, max); }

function dashTareas(D) {
  var rows = dashSlice('tareas', D.tareas, 6).map(function (a) {
    var lead = a.nombre ? dashAvatar(a.nombre) : '<span class="dash-av t-' + a.tone + '">' + dashIc(a.ic) + '</span>';
    var pill = { danger: 'Urgente', violet: 'Llamada', info: 'Revisar', muted: 'Programar' }[a.tone];
    return '<button type="button" class="dash-row" onclick="navGo(null,\'' + a.ruta + '\')">' + lead +
      '<span class="dash-row-tx"><b>' + dashEsc(a.titulo) + '</b><span>' + dashIc(a.ic, 'dash-row-ic') + dashEsc(a.det) + '</span></span>' +
      '<span class="dash-row-end"><span class="dash-pill p-' + a.tone + '">' + pill + '</span></span>' + dashIc('i-chevron', 'dash-go') + '</button>';
  }).join('');
  return dashCard('dashTareas', 'i-alert', 'Tareas y avisos', D.tareas.length, '',
    D.tareas.length ? '<div class="dash-list">' + rows + '</div>' + dashMoreBtn('tareas', D.tareas.length, 6)
      : dashNone('i-check', 'Todo al día: sin cobros vencidos, renovaciones por agendar ni seguimientos por revisar.'), 'dash-a-tareas');
}

function dashCitas(D) {
  var rows = dashSlice('citas', D.citas, 5).map(function (e) {
    var dl = dashDayLabel(e.iso, e.d), t, pill;
    if (e.tipo === 'cierre') { t = 'Videollamada de cierre'; pill = e.ok ? '<span class="dash-pill p-ok">' + dashIc('i-check') + 'Agendada</span>' : '<span class="dash-pill p-warn">Por agendar</span>'; }
    else { t = 'Empieza su plan' + (e.c.plan ? ' · ' + e.c.plan : ''); pill = '<span class="dash-pill p-info">Bienvenida</span>'; }
    var ruta = e.tipo === 'cierre' ? 'negocio/renov' : 'negocio/contratos';
    return '<button type="button" class="dash-ev t-' + e.tipo + '" onclick="navGo(null,\'' + ruta + '\')"><span class="dash-date' + (e.d === 0 ? ' today' : '') + '"><b>' + dl[0] + '</b>' + (dl[1] ? '<span>' + dl[1] + '</span>' : '') + '</span>' +
      '<span class="dash-row-tx"><b>' + dashEsc(e.c.nombre) + '</b><span>' + dashEsc(t) + '</span></span><span class="dash-row-end">' + pill + '</span></button>';
  }).join('');
  return dashCard('dashCitas', 'i-video', 'Videollamadas y citas', D.citas.length, dashLink('Calendario', "navGo(null,'calendario')"),
    (D.citas.length ? '<div class="dash-list">' + rows + '</div>' + dashMoreBtn('citas', D.citas.length, 5)
      : dashNone('i-calendar', 'No hay videollamadas ni inicios de plan en las próximas 3 semanas.')) +
    '<p class="dash-note">Salen de las fechas de tus contratos (próximas 3 semanas). La hora de cada videollamada se podrá guardar con el calendario completo, en una fase posterior.</p>', 'dash-a-citas');
}

function dashProgramas(D) {
  var rows = dashSlice('progs', D.progs, 5).map(function (o) {
    var pct = Math.round(o.sem / o.total * 100);
    var est = o.d < 0 ? '<span class="dash-pill p-danger">Terminado</span>' : o.d <= 7 ? '<span class="dash-pill p-warn">' + (o.d === 0 ? 'Hoy' : o.d + (o.d === 1 ? ' día' : ' días')) + '</span>' : '<span class="dash-pill p-muted">' + o.d + ' días</span>';
    return '<button type="button" class="dash-row" onclick="navGo(null,\'cliente/' + o.id + '/' + o.b.id + '/programa\')">' + dashAvatar(o.c.name) +
      '<span class="dash-row-tx"><b>' + dashEsc(o.c.name) + '</b><span>Semana ' + o.sem + ' de ' + o.total + ' · ' + (o.d < 0 ? 'terminó' : 'termina') + ' el ' + dashEsc(negFmt(o.fin)) + '</span>' +
      '<i class="dash-bar"><i style="width:' + pct + '%"></i></i></span><span class="dash-row-end">' + est + '</span>' + dashIc('i-chevron', 'dash-go') + '</button>';
  }).join('');
  return dashCard('dashProg', 'i-dumbbell', 'Programas que terminan', D.progs.length, dashLink('Clientes', "navGo(null,'clientes')"),
    D.progs.length ? '<div class="dash-list">' + rows + '</div>' + dashMoreBtn('progs', D.progs.length, 5)
      : dashNone('i-check', 'Ningún programa termina en las próximas 2 semanas.'), 'dash-a-prog');
}

function dashPagos(D) {
  var rows = dashSlice('pagos', D.pagos, 5).map(function (p) {
    var tone = p.d < 0 ? 'p-danger' : p.d <= 3 ? 'p-warn' : 'p-muted';
    return '<button type="button" class="dash-row" onclick="navGo(null,\'negocio/pagos\')">' + dashAvatar(p.c.nombre) +
      '<span class="dash-row-tx"><b>' + dashEsc(p.c.nombre) + '</b><span>' + dashEsc(p.c.plan || 'Pago pendiente') + '</span></span>' +
      '<span class="dash-row-end dash-row-end-col"><span class="dash-amount">' + negEur(p.importe) + '</span><span class="dash-pill ' + tone + '">' + dashWhen(p.d) + '</span></span></button>';
  }).join('');
  var resumen = '<div class="dash-paysum"><span><b>' + negEur(D.pendiente) + '</b> pendiente en total</span>' + (D.vencidos.length ? '<span class="dash-paysum-bad">' + negEur(D.vencidoTotal) + ' vencido</span>' : '') + '</div>';
  return dashCard('dashPagos', 'i-wallet', 'Pagos y vencimientos', D.pagos.length, dashLink('Pagos', "navGo(null,'negocio/pagos')"),
    resumen + (D.pagos.length ? '<div class="dash-list">' + rows + '</div>' + dashMoreBtn('pagos', D.pagos.length, 5)
      : dashNone('i-check', 'No hay cobros pendientes en los próximos 30 días.')), 'dash-a-pagos');
}

function dashQuick() {
  var q = function (tone, ic, t, d, fn) {
    return '<button type="button" class="dash-q t-' + tone + '" onclick="' + fn + '"><span class="dash-q-ic">' + dashIc(ic) + '</span><b>' + t + '</b><span>' + d + '</span></button>';
  };
  return '<section class="dash-card dash-a-quick" aria-labelledby="dashQH"><div class="dash-card-h"><h3 id="dashQH">' + dashIc('i-bolt') + '<span>Accesos rápidos</span></h3></div><div class="dash-quick">' +
    q('teal', 'i-user-plus', 'Nuevo cliente', 'Ficha y primer bloque', 'openAddClient()') +
    q('amber', 'i-euro', 'Registrar pago', 'Contratos y pagos', "navGo(null,'negocio/pagos')") +
    q('violet', 'i-calendar', 'Calendario', 'Tu semana', "navGo(null,'calendario')") +
    q('green', 'i-dumbbell', 'Biblioteca', 'Ejercicios y vídeos', "navGo(null,'biblioteca')") +
    q('blue', 'i-layers', 'Plantillas', 'Entrenos y dietas', "navGo(null,'plantillas')") +
    q('slate', 'i-shield', 'Copia de seguridad', 'Descarga tus datos', "navGo(null,'copias')") +
    '</div></section>';
}

/* ---------- vista ---------- */
function viewCoachDashboard() {
  var D = dashData();
  setTimeout(function () { try { coachMaybeNotifyRenovaciones(); } catch (_) {} }, 0); // como hacía el inicio anterior
  if (!D.ok) return '<div class="ds-empty"><h2>No se ha podido preparar el inicio</h2><p>Puedes seguir usando Clientes y Contratos y pagos desde el menú.</p></div>';

  var hora = new Date().getHours();
  var saludo = hora < 6 ? 'Buenas noches' : hora < 14 ? 'Buenos días' : hora < 21 ? 'Buenas tardes' : 'Buenas noches';
  var fecha = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  fecha = fecha.charAt(0).toUpperCase() + fecha.slice(1);
  var urg = D.tareas.filter(function (t) { return t.prio <= 1; }).length;

  var h = '<div class="dash">';
  h += '<div class="dash-head"><div class="dash-hello"><h2>' + saludo + ', Jorge</h2><p>' + dashEsc(fecha) + ' · ' +
    (urg ? '<b>' + urg + (urg === 1 ? ' asunto importante' : ' asuntos importantes') + '</b> hoy' : 'todo en orden') + '</p></div>' +
    '<div class="dash-head-act"><label class="dash-search">' + dashIc('i-search') + '<input type="search" placeholder="Buscar cliente…" aria-label="Buscar cliente" onkeydown="if(event.key===\'Enter\'){UI.homeQ=this.value;navTo(\'clientes\')}"></label>' +
    '<button type="button" class="ds-btn ds-btn-primary dash-new" onclick="openAddClient()">' + dashIc('i-plus') + '<span>Nuevo cliente</span></button></div></div>';

  // 1. Resumen del negocio
  var kpi = function (tone, ic, label, val, sub, fn, extra) {
    return '<button type="button" class="dash-kpi t-' + tone + '" onclick="' + fn + '">' +
      '<span class="dash-kpi-ic">' + dashIc(ic) + '</span><span class="dash-kpi-tx"><span class="dash-kpi-l">' + label + '</span>' +
      '<span class="dash-kpi-v">' + val + '</span><span class="dash-kpi-s">' + sub + '</span>' + (extra || '') + '</span></button>';
  };
  var pctObj = D.objetivo ? Math.min(100, Math.round(D.ingresos / D.objetivo * 100)) : 0;
  h += '<section class="dash-kpis" aria-label="Resumen del negocio">' +
    kpi('teal', 'i-users', 'Clientes activos', String(D.activos), D.fichas + (D.fichas === 1 ? ' ficha abierta' : ' fichas abiertas'), "navGo(null,'clientes')") +
    kpi('gold', 'i-euro', 'Ingresos del mes', negEur(D.ingresos), D.objetivo ? pctObj + '% del objetivo de ' + negEur(D.objetivo) : 'cobrado: ' + negEur(D.cobrado), "navGo(null,'negocio/resumen')",
      D.objetivo ? '<i class="dash-bar dash-bar-gold"><i style="width:' + pctObj + '%"></i></i>' : '') +
    kpi('amber', 'i-wallet', 'Cobros pendientes', negEur(D.pendiente), D.vencidos.length ? '<b class="dash-bad">' + negEur(D.vencidoTotal) + ' vencido</b>' : 'nada vencido', "navGo(null,'negocio/pagos')") +
    kpi('violet', 'i-dumbbell', 'Programas por terminar', String(D.progs.length), 'en las próximas 2 semanas', "document.getElementById('dashProg').scrollIntoView({behavior:'smooth',block:'start'})") +
    '</section>';

  // 2–5: dos columnas en ordenador; una sola (por prioridad) en el móvil
  h += '<div class="dash-grid"><div class="dash-colA">' + dashTareas(D) + dashProgramas(D) + '</div>' +
    '<div class="dash-colB">' + dashCitas(D) + dashPagos(D) + '</div></div>';
  // 6. Accesos rápidos
  h += dashQuick();
  h += '</div>';
  return h;
}
