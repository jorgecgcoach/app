/* Panel de INICIO del entrenador (etapa 2 del rediseño).
   SOLO LECTURA: no guarda nada ni cambia ningún cálculo. Todas las cifras salen de las funciones
   de Negocio que ya existían en index.html (negActivos, negReconocido, negCaja, negSaldo, negFin,
   negProx, negDaysTo, negIsFrozen, negCallScheduled, negCoachAlerts) y de los datos de los clientes.
   No inventa horas ni eventos: los eventos son fechas que ya están registradas en los contratos. */
'use strict';

var DASH_HORIZON = 30; // días que mira la agenda de próximos eventos

function dashEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function dashIc(id, cls) { return '<svg class="ds-ic' + (cls ? ' ' + cls : '') + '"><use href="#' + id + '"/></svg>'; }
function dashIni(name) { return String(name || '?').trim().split(/\s+/).map(function (x) { return x[0] || ''; }).slice(0, 2).join('').toUpperCase(); }
function dashNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' '); }
var DASH_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
var DASH_MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function dashDayLabel(iso, d) {
  if (d === 0) return ['HOY', ''];
  if (d === 1) return ['MAÑ.', ''];
  var p = String(iso).split('-');
  return [String(+p[2]), DASH_MES[(+p[1]) - 1] || ''];
}
function dashWhen(d) {
  if (d < 0) return d === -1 ? 'Venció ayer' : 'Venció hace ' + (-d) + ' días';
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  return 'En ' + d + ' días';
}

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

/* ---------- datos (todo de lectura) ---------- */
function dashData() {
  var out = { ok: true };
  try {
    var hoy = negToday(), m = negYm(hoy);
    var cs = negContracts();
    var al = negCoachAlerts();
    var avisoDias = al.av || 14;
    out.hoy = hoy;
    out.avisoDias = avisoDias;
    // KPIs (mismas fórmulas que Negocio → Resumen y Negocio → Pagos)
    out.activos = negActivos(m);
    out.ingresos = negReconocido(m);
    out.cobrado = negCaja(m);
    out.pendiente = cs.reduce(function (s, c) { return s + negSaldo(c); }, 0);
    out.pendProximos = al.pend.length;
    var finan = cs.map(function (c) { return { c: c, d: negDaysTo(negFin(c)) }; })
      .filter(function (o) { return o.d >= 0 && o.d <= avisoDias && !negIsFrozen(o.c); });
    out.renovProximas = finan.length;
    out.renovSinLlamada = finan.filter(function (o) { return !negCallScheduled(o.c); }).length;
    out.fichas = Object.values(DATA.clients || {}).filter(function (c) { return c && !c.archived; }).length;

    // Agenda: fechas registradas en los próximos DASH_HORIZON días
    var ev = [];
    cs.forEach(function (c) {
      if (negIsFrozen(c)) return;
      var fin = negFin(c), dF = negDaysTo(fin);
      if (dF >= 0 && dF <= DASH_HORIZON) ev.push({ tipo: 'fin', iso: fin, d: dF, c: c, call: negCallScheduled(c) });
      if (negSaldo(c) > 0) { var px = negProx(c), dP = negDaysTo(px); if (dP >= 0 && dP <= DASH_HORIZON) ev.push({ tipo: 'pago', iso: px, d: dP, c: c, importe: negSaldo(c) }); }
      if (c.inicio) { var dI = negDaysTo(c.inicio); if (dI >= 0 && dI <= DASH_HORIZON) ev.push({ tipo: 'inicio', iso: c.inicio, d: dI, c: c }); }
    });
    ev.sort(function (a, b) { return a.d - b.d || String(a.c.nombre).localeCompare(String(b.c.nombre)); });
    out.eventos = ev;

    // Acciones pendientes (por prioridad)
    var acc = [];
    al.pend.forEach(function (o) {
      acc.push({ prio: o.d < 0 ? 0 : 1, tipo: 'pago', nombre: o.c.nombre, det: (o.c.plan || 'Pago pendiente'), importe: negSaldo(o.c), d: o.d, ruta: 'negocio/pagos' });
    });
    al.renov.forEach(function (o) {
      acc.push({ prio: 2, tipo: 'renov', nombre: o.c.nombre, det: 'Termina el ' + negFmt(negFin(o.c)) + ' · sin videollamada de cierre', d: o.d, ruta: 'negocio/renov' });
    });
    // Seguimientos semanales enviados esta semana (lectura directa, sin migrar nada)
    var lunes = (typeof calMondayISO === 'function') ? calMondayISO() : null;
    Object.keys(DATA.clients || {}).forEach(function (id) {
      var c = DATA.clients[id]; if (!c || c.archived || !lunes) return;
      var b = (c.blocks || []).find(function (x) { return x && x.cur; }) || (c.blocks || [])[0];
      var tr = b && b.data && Array.isArray(b.data.tracking) ? b.data.tracking : [];
      var e = tr.find(function (t) { return t && t.date === lunes && t._submittedAt; });
      if (e) acc.push({ prio: 3, tipo: 'seg', nombre: c.name, det: 'Seguimiento recibido para revisar', d: null, ruta: 'cliente/' + id + '/' + b.id + '/seguimiento', cid: id });
    });
    // Clientes de entrenamiento sin programa en su bloque actual
    Object.keys(DATA.clients || {}).forEach(function (id) {
      var c = DATA.clients[id]; if (!c || c.archived) return;
      if (c.serviceType !== 'training' && c.serviceType !== 'training_nutrition') return;
      var b = (c.blocks || []).find(function (x) { return x && x.cur; }) || (c.blocks || [])[0];
      var tiene = b && b.data && b.data.program && Array.isArray(b.data.program.weeks) && b.data.program.weeks.some(function (w) { return (w.days || []).some(function (d) { return (d.exs || []).length; }); });
      if (!tiene) acc.push({ prio: 4, tipo: 'prog', nombre: c.name, det: b ? 'Su bloque actual no tiene ejercicios' : 'No tiene ningún bloque', d: null, ruta: b ? 'cliente/' + id + '/' + b.id + '/programa' : 'clientes', cid: id });
    });
    acc.sort(function (a, b) { return a.prio - b.prio || ((a.d == null ? 99 : a.d) - (b.d == null ? 99 : b.d)); });
    out.acciones = acc;
  } catch (e) { console.warn('Inicio:', e); out.ok = false; out.error = e; }
  return out;
}

/* ---------- vista ---------- */
function viewCoachDashboard() {
  var D = dashData();
  setTimeout(function () { try { coachMaybeNotifyRenovaciones(); } catch (_) {} }, 0); // como hacía el inicio anterior
  if (!D.ok) return '<div class="ds-empty"><h2>No se ha podido preparar el inicio</h2><p>Puedes seguir usando Clientes y Negocio desde el menú.</p></div>';

  var hora = new Date().getHours();
  var saludo = hora < 6 ? 'Buenas noches' : hora < 14 ? 'Buenos días' : hora < 21 ? 'Buenas tardes' : 'Buenas noches';
  var f = new Date();
  var fecha = f.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  fecha = fecha.charAt(0).toUpperCase() + fecha.slice(1);

  var h = '<div class="dash">';
  // Cabecera
  h += '<div class="dash-head"><div class="dash-hello"><h2>' + saludo + ', Jorge</h2><p>' + dashEsc(fecha) + ' · tu negocio y tus clientes de un vistazo.</p></div>' +
    '<label class="dash-search">' + dashIc('i-search') + '<input type="search" placeholder="Buscar cliente…" aria-label="Buscar cliente" onkeydown="if(event.key===\'Enter\'){UI.homeQ=this.value;navTo(\'clientes\')}"></label></div>';

  // 1. Resumen del negocio
  var kpi = function (tone, ic, label, val, sub, ruta, title) {
    return '<button type="button" class="dash-kpi t-' + tone + '" onclick="navGo(null,\'' + ruta + '\')" title="' + dashEsc(title) + '">' +
      '<span class="dash-kpi-ic">' + dashIc(ic) + '</span><span class="dash-kpi-tx"><span class="dash-kpi-l">' + label + '</span>' +
      '<span class="dash-kpi-v">' + val + '</span><span class="dash-kpi-s">' + sub + '</span></span>' + dashIc('i-chevron', 'dash-kpi-go') + '</button>';
  };
  h += '<section class="dash-kpis" aria-label="Resumen del negocio">' +
    kpi('teal', 'i-users', 'Clientes activos', String(D.activos), 'con contrato este mes · ' + D.fichas + ' fichas', 'negocio/resumen', 'Contratos en vigor este mes (Negocio → Resumen)') +
    kpi('green', 'i-euro', 'Ingresos del mes', negEur(D.ingresos), 'cobrado: ' + negEur(D.cobrado), 'negocio/resumen', 'Ingresos reconocidos del mes y cobros de caja (Negocio → Resumen)') +
    kpi('amber', 'i-wallet', 'Cobros pendientes', negEur(D.pendiente), D.pendProximos ? D.pendProximos + (D.pendProximos === 1 ? ' vence' : ' vencen') + ' en 14 días' : 'nada vence en 14 días', 'negocio/pagos', 'Saldo por cobrar de todos los contratos (Negocio → Pagos)') +
    kpi('violet', 'i-refresh', 'Renovaciones próximas', String(D.renovProximas), D.renovProximas ? (D.renovSinLlamada ? D.renovSinLlamada + ' sin videollamada agendada' : 'todas con videollamada agendada') : 'próximos ' + D.avisoDias + ' días', 'negocio/renov', 'Contratos que terminan en los próximos ' + D.avisoDias + ' días (Negocio → Renovaciones)') +
    '</section>';

  // 2 y 3. Acciones pendientes + Próximos eventos
  var MAXA = 6, acc = D.acciones, verTodas = UI && UI.dashMore;
  var accRows = (verTodas ? acc : acc.slice(0, MAXA)).map(function (a) {
    var pill = '';
    if (a.tipo === 'pago') pill = '<span class="dash-pill ' + (a.d < 0 ? 'p-danger' : a.d <= 2 ? 'p-danger' : 'p-warn') + '">' + dashWhen(a.d) + '</span>';
    else if (a.tipo === 'renov') pill = '<span class="dash-pill p-violet">' + (a.d === 0 ? 'Termina hoy' : 'En ' + a.d + ' d') + '</span>';
    else if (a.tipo === 'seg') pill = '<span class="dash-pill p-info">Recibido</span>';
    else pill = '<span class="dash-pill p-muted">Programar</span>';
    var amount = a.tipo === 'pago' ? '<span class="dash-amount">' + negEur(a.importe) + '</span>' : '';
    var ic = { pago: 'i-wallet', renov: 'i-phone', seg: 'i-clipboard', prog: 'i-dumbbell' }[a.tipo];
    return '<button type="button" class="dash-row" onclick="navGo(null,\'' + a.ruta + '\')">' + dashAvatar(a.nombre) +
      '<span class="dash-row-tx"><b>' + dashEsc(a.nombre) + '</b><span>' + dashIc(ic, 'dash-row-ic') + dashEsc(a.det) + '</span></span><span class="dash-row-end">' + amount + pill + '</span>' + dashIc('i-chevron', 'dash-go') + '</button>';
  }).join('');
  var more = acc.length > MAXA ? '<button type="button" class="dash-link" onclick="UI.dashMore=!UI.dashMore;renderView()">' + (verTodas ? 'Ver menos' : 'Ver las ' + acc.length + ' acciones') + '</button>' : '';
  h += '<div class="dash-cols">';
  h += '<section class="dash-card" aria-labelledby="dashAcc"><div class="dash-card-h"><h3 id="dashAcc">' + dashIc('i-alert') + 'Acciones pendientes' + (acc.length ? '<span class="dash-count">' + acc.length + '</span>' : '') + '</h3>' + more + '</div>' +
    (acc.length ? '<div class="dash-list">' + accRows + '</div>' : '<div class="dash-none">' + dashIc('i-check') + 'Todo al día: no hay pagos ni renovaciones pendientes, ni seguimientos recibidos esta semana.</div>') + '</section>';

  var MAXE = 7;
  var evRows = D.eventos.slice(0, MAXE).map(function (e) {
    var dl = dashDayLabel(e.iso, e.d);
    var t, sub, pill;
    if (e.tipo === 'fin') { t = 'Fin de plan'; sub = e.c.plan || ''; pill = e.call ? '<span class="dash-pill p-violet">' + dashIc('i-phone') + 'Cierre agendado</span>' : '<span class="dash-pill p-muted">Sin videollamada</span>'; }
    else if (e.tipo === 'pago') { t = 'Pago previsto'; sub = negEur(e.importe) + (e.c.plan ? ' · ' + e.c.plan : ''); pill = '<span class="dash-pill p-warn">Cobro</span>'; }
    else { t = 'Inicio de plan'; sub = e.c.plan || ''; pill = '<span class="dash-pill p-info">Alta</span>'; }
    var ruta = e.tipo === 'pago' ? 'negocio/pagos' : e.tipo === 'fin' ? 'negocio/renov' : 'negocio/contratos';
    return '<button type="button" class="dash-ev t-' + e.tipo + '" onclick="navGo(null,\'' + ruta + '\')"><span class="dash-date' + (e.d === 0 ? ' today' : '') + '"><b>' + dl[0] + '</b>' + (dl[1] ? '<span>' + dl[1] + '</span>' : '') + '</span>' +
      '<span class="dash-row-tx"><b>' + dashEsc(e.c.nombre) + '</b><span>' + t + (sub ? ' · ' + dashEsc(sub) : '') + '</span></span><span class="dash-row-end">' + pill + '</span></button>';
  }).join('');
  h += '<section class="dash-card" aria-labelledby="dashEv"><div class="dash-card-h"><h3 id="dashEv">' + dashIc('i-calendar') + 'Próximos eventos</h3><button type="button" class="dash-link" onclick="navGo(null,\'calendario\')">Ver calendario' + dashIc('i-arrow') + '</button></div>' +
    (D.eventos.length ? '<div class="dash-list">' + evRows + '</div>' + (D.eventos.length > MAXE ? '<div class="dash-foot">y ' + (D.eventos.length - MAXE) + ' más en los próximos ' + DASH_HORIZON + ' días</div>' : '')
      : '<div class="dash-none">' + dashIc('i-calendar') + 'No hay fechas registradas en los próximos ' + DASH_HORIZON + ' días.</div>') +
    '<p class="dash-note">Fechas de fin de plan, pagos previstos e inicios registrados en Negocio. Las videollamadas solo se muestran cuando están agendadas.</p></section>';
  h += '</div>';

  // Calendario del mes + accesos rápidos
  h += '<div class="dash-cols dash-cols-b">' + dashMiniCal(D.eventos) + dashQuick() + '</div>';
  h += '</div>';
  return h;
}

function dashMiniCal(eventos) {
  var off = (UI && UI.dashCal) || 0;
  var base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + off);
  var y = base.getFullYear(), mo = base.getMonth();
  var first = (new Date(y, mo, 1).getDay() + 6) % 7; // lunes = 0
  var days = new Date(y, mo + 1, 0).getDate();
  var hoy = negToday();
  // puntos: todas las fechas registradas del mes (no solo los 30 días de la agenda)
  var marks = {};
  try {
    negContracts().forEach(function (c) {
      if (negIsFrozen(c)) return;
      var add = function (iso, t) { if (!iso) return; var p = iso.split('-'); if (+p[0] === y && +p[1] === mo + 1) { (marks[+p[2]] = marks[+p[2]] || {})[t] = 1; } };
      add(negFin(c), 'fin'); if (negSaldo(c) > 0) add(negProx(c), 'pago'); add(c.inicio, 'inicio');
    });
  } catch (_) {}
  var cells = '';
  for (var i = 0; i < first; i++) cells += '<span class="mc-d empty"></span>';
  for (var d = 1; d <= days; d++) {
    var iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var mk = marks[d] || {};
    var dots = Object.keys(mk).map(function (t) { return '<i class="mc-dot t-' + t + '"></i>'; }).join('');
    var tip = Object.keys(mk).map(function (t) { return { fin: 'fin de plan', pago: 'pago previsto', inicio: 'inicio de plan' }[t]; }).join(', ');
    cells += '<span class="mc-d' + (iso === hoy ? ' today' : '') + (iso < hoy ? ' past' : '') + '"' + (tip ? ' title="' + tip + '"' : '') + '><span>' + d + '</span><span class="mc-dots">' + dots + '</span></span>';
  }
  return '<section class="dash-card dash-cal" aria-label="Calendario del mes"><div class="dash-card-h"><h3>' + DASH_MES_L[mo].charAt(0).toUpperCase() + DASH_MES_L[mo].slice(1) + ' ' + y + '</h3>' +
    '<span class="mc-nav"><button type="button" aria-label="Mes anterior" onclick="UI.dashCal=(UI.dashCal||0)-1;renderView()">' + dashIc('i-chevron', 'rot90') + '</button>' +
    '<button type="button" aria-label="Mes siguiente" onclick="UI.dashCal=(UI.dashCal||0)+1;renderView()">' + dashIc('i-chevron', 'rot-90') + '</button></span></div>' +
    '<div class="mc-grid"><span class="mc-w">L</span><span class="mc-w">M</span><span class="mc-w">X</span><span class="mc-w">J</span><span class="mc-w">V</span><span class="mc-w">S</span><span class="mc-w">D</span>' + cells + '</div>' +
    '<div class="mc-legend"><span><i class="mc-dot t-fin"></i>Fin de plan</span><span><i class="mc-dot t-pago"></i>Pago</span><span><i class="mc-dot t-inicio"></i>Inicio</span></div></section>';
}

function dashQuick() {
  var q = function (tone, ic, t, d, fn) {
    return '<button type="button" class="dash-q t-' + tone + '" onclick="' + fn + '"><span class="dash-q-ic">' + dashIc(ic) + '</span><b>' + t + '</b><span>' + d + '</span>' + dashIc('i-arrow', 'dash-q-go') + '</button>';
  };
  return '<section class="dash-card dash-quick-card" aria-labelledby="dashQ"><div class="dash-card-h"><h3 id="dashQ">' + dashIc('i-bolt') + 'Accesos rápidos</h3></div><div class="dash-quick">' +
    q('teal', 'i-user-plus', 'Añadir cliente', 'Crea su primer bloque', 'openAddClient()') +
    q('blue', 'i-users', 'Clientes', 'Fichas y entrenamientos', "navGo(null,'clientes')") +
    q('violet', 'i-calendar', 'Calendario', 'Tu semana', "navGo(null,'calendario')") +
    q('green', 'i-dumbbell', 'Biblioteca', 'Ejercicios y vídeos', "navGo(null,'biblioteca')") +
    q('amber', 'i-chart', 'Negocio', 'Cobros y contratos', "navGo(null,'negocio/resumen')") +
    q('slate', 'i-layers', 'Plantillas', 'Entrenos y dietas', 'openLibrary()') +
    '</div></section>';
}
