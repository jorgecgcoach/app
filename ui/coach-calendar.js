/* CALENDARIO del entrenador (etapa 3 del rediseño). SOLO LECTURA.
   - No guarda nada, no crea colecciones ni campos y no cambia ningún cálculo de Negocio.
   - Los eventos salen de "fuentes" (CCAL_SOURCES). Hoy solo existe la de Negocio (contratos), que usa
     las funciones que ya había en index.html: negContracts, negFin, negProx, negSaldo, negIsFrozen,
     negCallScheduled, negToday, negFmt, negEur.
   - Ninguna fecha de Negocio tiene hora, así que todos los eventos son "de todo el día" (allDay).
   - Modelo de evento (pensado para crecer: tareas, videollamadas con hora, calendario de contenido):
       { id, type, date:'AAAA-MM-DD', allDay:true, start:null|'HH:MM', end:null|'HH:MM',
         title, sub, client, plan, amount, status:[{t,tone}], cid, links:[{label,run}], src, ids:[] }
     Una fuente futura solo tiene que devolver objetos así; la vista semanal ya coloca en la rejilla
     de horas los que traigan start/end. */
'use strict';

var CCAL_TYPES = {
  fin:    { label: 'Fin de programa',  short: 'Fin',      tone: 'violet' },
  renov:  { label: 'Renovaciones',     short: 'Renueva',  tone: 'teal' },
  alta:   { label: 'Altas e inicios',  short: 'Alta',     tone: 'blue' },
  pago:   { label: 'Pagos previstos',  short: 'Pago',     tone: 'amber' }
  // Futuras (sin datos todavía): llamada (videollamadas con hora), tarea, contenido.
};
var CCAL_ORDER = ['fin', 'renov', 'alta', 'pago'];
var CCAL_DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
var CCAL_DOW_L = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
var CCAL_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
var CCAL_MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var CCAL_H0 = 7, CCAL_H1 = 22; // franja de horas visible en la vista semanal
var CCAL = { cache: {}, frozen: 0 };

/* ---------- utilidades de fechas (siempre a mediodía local para evitar saltos de horario) ---------- */
function calIsIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function calD(iso) { return new Date(iso + 'T12:00:00'); }
function calIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function calAdd(iso, n) { var d = calD(iso); d.setDate(d.getDate() + n); return calIso(d); }
function calMonday(iso) { var d = calD(iso); return calAdd(iso, -((d.getDay() + 6) % 7)); }
function calToday() { return typeof negToday === 'function' ? negToday() : calIso(new Date()); }
function calEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function calIc(id, cls) { return '<svg class="ds-ic' + (cls ? ' ' + cls : '') + '"><use href="#' + id + '"/></svg>'; }
function calNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' '); }
function calCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function calLong(iso) { var d = calD(iso); return calCap(CCAL_DOW_L[(d.getDay() + 6) % 7]) + ', ' + d.getDate() + ' de ' + CCAL_MES_L[d.getMonth()] + ' de ' + d.getFullYear(); }
function calClientId(nombre) {
  var n = calNorm(nombre); if (!n || !DATA || !DATA.clients) return null;
  var ids = Object.keys(DATA.clients).filter(function (id) { var c = DATA.clients[id]; return c && !c.archived && calNorm(c.name) === n; });
  return ids.length === 1 ? ids[0] : null; // si hay dos fichas con el mismo nombre no adivinamos
}

/* ---------- estado de la vista (solo en memoria) ---------- */
function calState() {
  if (!UI.coachCal) UI.coachCal = { view: 'semana', anchor: calToday(), off: {}, day: null, sel: null };
  return UI.coachCal;
}

/* ---------- fuentes de eventos ---------- */
function calSourceNegocio(from, to) {
  var out = [], frozen = 0;
  var cs = (typeof negContracts === 'function') ? negContracts() : [];
  var inR = function (iso) { return calIsIso(iso) && iso >= from && iso <= to; };
  cs.forEach(function (c) {
    if (!c || !calIsIso(c.inicio)) return;
    var cid = calClientId(c.nombre), base = { client: c.nombre || 'Sin nombre', plan: c.plan || '', cid: cid, src: 'Negocio', ids: [c.id] };
    var congelado = negIsFrozen(c);
    if (congelado) frozen++;
    // Fin de programa (vencimiento del contrato). Los congelados no tienen fecha de fin fija.
    var fin = negFin(c);
    if (!congelado && inR(fin)) {
      var st = [];
      var siguiente = cs.filter(function (x) { return x !== c && calNorm(x.nombre) === calNorm(c.nombre) && calIsIso(x.inicio) && x.inicio > c.inicio; })
        .sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; })[0];
      if (siguiente) st.push({ t: 'Contrato posterior desde el ' + negFmt(siguiente.inicio), tone: 'teal' });
      if (negCallScheduled(c)) st.push({ t: 'Videollamada de cierre agendada', tone: 'violet', ic: 'i-phone' });
      else if (!siguiente) st.push({ t: 'Sin videollamada de cierre agendada', tone: 'muted' });
      out.push(Object.assign({ type: 'fin', date: fin, title: 'Fin de programa', status: st, negTab: 'renov' }, base));
    }
    // Inicio del contrato: alta o renovación según el tipo registrado en Negocio
    if (inR(c.inicio)) {
      var esRenov = c.tipo === 'renov';
      out.push(Object.assign({ type: esRenov ? 'renov' : 'alta', date: c.inicio, title: esRenov ? 'Renovación' : (c.tipo === 'alta' ? 'Alta de cliente' : 'Inicio de plan'),
        status: c.dur ? [{ t: c.dur + (c.dur === 1 ? ' mes' : ' meses'), tone: 'muted' }] : [], negTab: 'contratos' }, base));
    }
    // Pago previsto: solo si queda saldo por cobrar (misma regla que los avisos de Negocio)
    var saldo = negSaldo(c);
    if (!congelado && saldo > 0) {
      var px = negProx(c);
      if (inR(px)) {
        var vencido = px < calToday();
        out.push(Object.assign({ type: 'pago', date: px, title: 'Pago previsto', amount: saldo, overdue: vencido,
          status: [{ t: 'Pendiente: ' + negEur(saldo), tone: vencido ? 'danger' : 'warn' }].concat(vencido ? [{ t: 'Fecha ya pasada', tone: 'danger' }] : []), negTab: 'pagos' }, base));
      }
    }
  });
  CCAL.frozen = frozen;
  return out;
}
var CCAL_SOURCES = [calSourceNegocio]; // aquí se añadirán tareas, videollamadas con hora, contenido…

/* Une las fuentes y quita duplicados: mismo tipo, mismo día, mismo cliente y mismo plan = un solo evento. */
function calEvents(from, to) {
  var all = [];
  CCAL_SOURCES.forEach(function (fn) { try { all = all.concat(fn(from, to) || []); } catch (e) { console.warn('Calendario:', e); } });
  var map = {}, list = [];
  all.forEach(function (e) {
    var k = [e.type, e.date, e.start || '', calNorm(e.client), calNorm(e.plan)].join('|');
    if (map[k]) { map[k].ids = map[k].ids.concat(e.ids || []); map[k].dupes = (map[k].dupes || 1) + 1; if (e.amount) map[k].amount = (map[k].amount || 0) + e.amount; return; }
    e.allDay = !e.start; e.id = e.type + '_' + e.date + '_' + list.length;
    map[k] = e; list.push(e);
  });
  list.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (CCAL_ORDER.indexOf(a.type) - CCAL_ORDER.indexOf(b.type)) || String(a.client).localeCompare(String(b.client));
  });
  CCAL.cache = {}; list.forEach(function (e) { CCAL.cache[e.id] = e; });
  return list;
}

/* ---------- vista ---------- */
function viewCoachCalendar() {
  var S = calState(), hoy = calToday();
  var mes = S.view === 'mes';
  var from, to, title;
  if (mes) {
    var a = calD(S.anchor), y = a.getFullYear(), m = a.getMonth();
    var first = calIso(new Date(y, m, 1, 12)), last = calIso(new Date(y, m + 1, 0, 12));
    from = calMonday(first); to = calAdd(calMonday(last), 6);
    title = calCap(CCAL_MES_L[m]) + ' ' + y;
  } else {
    from = calMonday(S.anchor); to = calAdd(from, 6);
    var f = calD(from), t = calD(to);
    title = f.getMonth() === t.getMonth()
      ? f.getDate() + ' – ' + t.getDate() + ' ' + CCAL_MES[t.getMonth()] + ' ' + t.getFullYear()
      : f.getDate() + ' ' + CCAL_MES[f.getMonth()] + (f.getFullYear() !== t.getFullYear() ? ' ' + f.getFullYear() : '') + ' – ' + t.getDate() + ' ' + CCAL_MES[t.getMonth()] + ' ' + t.getFullYear();
  }
  var evAll = calEvents(from, to);
  var ev = evAll.filter(function (e) { return !S.off[e.type]; });
  var byDay = {}; ev.forEach(function (e) { (byDay[e.date] = byDay[e.date] || []).push(e); });
  var enRango = from <= hoy && hoy <= to;
  if (!S.day || S.day < from || S.day > to) S.day = enRango ? hoy : (mes ? calIso(new Date(calD(S.anchor).getFullYear(), calD(S.anchor).getMonth(), 1, 12)) : from);

  var h = '<div class="kc" id="calRoot">';
  // Barra de herramientas
  h += '<div class="kc-bar">' +
    '<div class="kc-nav"><button type="button" class="ds-btn ds-btn-secondary kc-today" onclick="calGo(0)"' + (enRango ? ' aria-pressed="true"' : '') + '>Hoy</button>' +
    '<button type="button" class="kc-arrow" aria-label="' + (mes ? 'Mes anterior' : 'Semana anterior') + '" onclick="calGo(-1)">' + calIc('i-chevron', 'rot90') + '</button>' +
    '<button type="button" class="kc-arrow" aria-label="' + (mes ? 'Mes siguiente' : 'Semana siguiente') + '" onclick="calGo(1)">' + calIc('i-chevron', 'rot-90') + '</button>' +
    '<h2 class="kc-title">' + calEsc(title) + '</h2></div>' +
    '<div class="kc-seg" role="tablist" aria-label="Vista">' +
    '<button type="button" role="tab" aria-selected="' + !mes + '" class="' + (mes ? '' : 'on') + '" onclick="calView(\'semana\')">Semana</button>' +
    '<button type="button" role="tab" aria-selected="' + mes + '" class="' + (mes ? 'on' : '') + '" onclick="calView(\'mes\')">Mes</button></div></div>';
  // Filtros por categoría (con nº de eventos en el periodo visible)
  h += '<div class="kc-filters" role="group" aria-label="Mostrar u ocultar categorías">' + CCAL_ORDER.map(function (k) {
    var n = evAll.filter(function (e) { return e.type === k; }).length, on = !S.off[k];
    return '<button type="button" class="kc-chip t-' + CCAL_TYPES[k].tone + (on ? ' on' : '') + '" aria-pressed="' + on + '" onclick="calToggle(\'' + k + '\')"><i></i>' + CCAL_TYPES[k].label + '<span>' + n + '</span></button>';
  }).join('') + '</div>';

  h += mes ? calMonthHtml(from, to, byDay, hoy, calD(S.anchor).getMonth()) : calWeekHtml(from, byDay, hoy);
  h += calAgendaHtml(mes ? null : from, byDay, hoy, mes);

  h += '<p class="kc-note">Fechas registradas en Negocio: fin de programa, inicio de contratos (altas y renovaciones) y pagos previstos con saldo pendiente. ' +
    'Ninguna tiene hora, por eso aparecen como «todo el día». La app guarda si la videollamada de cierre está agendada, pero no su fecha ni su hora.' +
    (CCAL.frozen ? ' ' + CCAL.frozen + (CCAL.frozen === 1 ? ' contrato congelado no muestra' : ' contratos congelados no muestran') + ' fin ni pago porque su fecha no es fija.' : '') + '</p>';
  h += S.sel && CCAL.cache[S.sel] ? calDetailHtml(CCAL.cache[S.sel]) : '';
  h += '</div>';
  return h;
}

function calChip(e, compact) {
  var T = CCAL_TYPES[e.type] || { tone: 'muted', short: '' };
  return '<button type="button" class="kc-ev t-' + T.tone + (e.overdue ? ' overdue' : '') + (compact ? ' compact' : '') + '" onclick="calOpen(\'' + e.id + '\')" title="' + calEsc(T.short + ' · ' + e.client) + '">' +
    '<b>' + calEsc(e.client) + '</b>' + (compact ? '' : '<span>' + calEsc(e.title) + (e.amount ? ' · ' + negEur(e.amount) : '') + '</span>') + '</button>';
}

/* Semana: columnas por día, fila de «todo el día» y rejilla de horas */
function calWeekHtml(from, byDay, hoy) {
  var days = []; for (var i = 0; i < 7; i++) days.push(calAdd(from, i));
  var head = '<div class="kcw-corner"></div>' + days.map(function (d, i) {
    var dd = calD(d);
    return '<div class="kcw-dh' + (d === hoy ? ' today' : '') + (d < hoy ? ' past' : '') + '"><span>' + CCAL_DOW[i] + '</span><b>' + dd.getDate() + '</b></div>';
  }).join('');
  var allday = '<div class="kcw-lbl">Todo el día</div>' + days.map(function (d) {
    var es = byDay[d] || [];
    return '<div class="kcw-ad' + (d === hoy ? ' today' : '') + '">' + (es.length ? es.map(function (e) { return calChip(e); }).join('') : '<span class="kcw-none">Sin eventos</span>') + '</div>';
  }).join('');
  var rows = '';
  for (var hr = CCAL_H0; hr < CCAL_H1; hr++) {
    rows += '<div class="kcw-hl"><span>' + String(hr).padStart(2, '0') + ':00</span></div>' + days.map(function (d) { return '<div class="kcw-cell' + (d === hoy ? ' today' : '') + '"></div>'; }).join('');
  }
  // Línea de «ahora» en el día de hoy
  var now = '', idx = days.indexOf(hoy), n = new Date(), mins = n.getHours() * 60 + n.getMinutes();
  if (idx >= 0 && mins >= CCAL_H0 * 60 && mins < CCAL_H1 * 60) {
    now = '<div class="kcw-now" style="--col:' + idx + ';--top:' + ((mins - CCAL_H0 * 60) / 60) + '"></div>';
  }
  return '<section class="kcw" aria-label="Vista semanal"><div class="kcw-head">' + head + '</div><div class="kcw-allday">' + allday + '</div>' +
    '<div class="kcw-scroll"><div class="kcw-grid">' + rows + now + '</div></div>' +
    '<div class="kcw-foot">Sin eventos con hora esta semana: las fechas registradas no incluyen horario.</div></section>';
}

/* Mes: cuadrícula de 6 semanas */
function calMonthHtml(from, to, byDay, hoy, mo) {
  var S = calState(), h = '<section class="kcm" aria-label="Vista mensual"><div class="kcm-grid">' + CCAL_DOW.map(function (d) { return '<div class="kcm-w">' + d + '</div>'; }).join('');
  for (var d = from; d <= to; d = calAdd(d, 1)) {
    var dd = calD(d), es = byDay[d] || [], fuera = dd.getMonth() !== mo, MAX = 3;
    h += '<div class="kcm-d' + (fuera ? ' out' : '') + (d === hoy ? ' today' : '') + (d < hoy ? ' past' : '') + (d === S.day ? ' sel' : '') + (es.length ? '' : ' empty') + '" onclick="calPickDay(\'' + d + '\',event)">' +
      '<span class="kcm-n">' + dd.getDate() + '</span>' +
      '<div class="kcm-evs">' + es.slice(0, MAX).map(function (e) { return calChip(e, true); }).join('') +
      (es.length > MAX ? '<button type="button" class="kcm-more" onclick="event.stopPropagation();calWeekOf(\'' + d + '\')">+' + (es.length - MAX) + ' más</button>' : '') + '</div>' +
      '<div class="kcm-dots">' + es.slice(0, 4).map(function (e) { return '<i class="t-' + CCAL_TYPES[e.type].tone + '"></i>'; }).join('') + '</div></div>';
  }
  return h + '</div></section>';
}

/* Agenda (móvil): semana día a día, o el día elegido en la vista mensual. Los días sin eventos se ven. */
function calAgendaHtml(from, byDay, hoy, mes) {
  var S = calState(), days = [];
  if (mes) days = [S.day];
  else for (var i = 0; i < 7; i++) days.push(calAdd(from, i));
  var strip = '';
  if (!mes) {
    strip = '<div class="kca-strip">' + days.map(function (d, i) {
      var es = byDay[d] || [];
      return '<button type="button" class="kca-sd' + (d === hoy ? ' today' : '') + (d === S.day ? ' sel' : '') + '" onclick="calJump(\'' + d + '\')"><span>' + CCAL_DOW[i].charAt(0) + '</span><b>' + calD(d).getDate() + '</b>' +
        '<i class="kca-dots">' + es.slice(0, 3).map(function (e) { return '<i class="t-' + CCAL_TYPES[e.type].tone + '"></i>'; }).join('') + '</i></button>';
    }).join('') + '</div>';
  }
  var list = days.map(function (d) {
    var es = byDay[d] || [], dd = calD(d);
    return '<div class="kca-day' + (d === hoy ? ' today' : '') + '" id="kca-' + d + '"><div class="kca-dh"><b>' + (d === hoy ? 'Hoy · ' : '') + calCap(CCAL_DOW_L[(dd.getDay() + 6) % 7]) + ' ' + dd.getDate() + ' ' + CCAL_MES[dd.getMonth()] + '</b>' +
      (es.length ? '<span>' + es.length + (es.length === 1 ? ' evento' : ' eventos') + '</span>' : '') + '</div>' +
      (es.length ? es.map(function (e) {
        var T = CCAL_TYPES[e.type];
        return '<button type="button" class="kca-ev t-' + T.tone + (e.overdue ? ' overdue' : '') + '" onclick="calOpen(\'' + e.id + '\')"><i></i><span class="kca-tx"><b>' + calEsc(e.client) + '</b><span>' + calEsc(e.title) + (e.amount ? ' · ' + negEur(e.amount) : '') + (e.plan ? ' · ' + calEsc(e.plan) : '') + '</span></span><span class="kca-tag">Todo el día</span></button>';
      }).join('') : '<div class="kca-none">Sin eventos</div>') + '</div>';
  }).join('');
  return '<section class="kca" aria-label="Agenda">' + strip + '<div class="kca-list">' + list + '</div></section>';
}

/* Ficha del evento: información y accesos */
function calDetailHtml(e) {
  var T = CCAL_TYPES[e.type];
  var links = [];
  if (e.cid) links.push('<button type="button" class="ds-btn ds-btn-primary" onclick="calOpenClient(\'' + e.cid + '\')">' + calIc('i-users') + 'Abrir ficha del cliente</button>');
  var tabName = { renov: 'Renovaciones', contratos: 'Contratos', pagos: 'Pagos' }[e.negTab] || 'Resumen';
  links.push('<button type="button" class="ds-btn ' + (e.cid ? 'ds-btn-secondary' : 'ds-btn-primary') + '" onclick="calOpenNeg(\'' + e.negTab + '\')">' + calIc('i-chart') + 'Ver en Negocio · ' + tabName + '</button>');
  var rows = [['Fecha', calLong(e.date)], ['Horario', 'Todo el día (sin hora registrada)']];
  if (e.plan) rows.push(['Plan', e.plan]);
  if (e.amount) rows.push(['Importe pendiente', negEur(e.amount)]);
  rows.push(['Origen', 'Negocio → ' + (e.negTab === 'pagos' ? 'contrato (saldo y próximo pago)' : 'contratos')]);
  if (e.dupes > 1) rows.push(['Registros', e.dupes + ' registros iguales unidos en un solo evento']);
  if (!e.cid) rows.push(['Ficha', 'No hay una única ficha de cliente con este nombre']);
  return '<div class="kc-scrim" onclick="calClose()"></div><div class="kc-dlg t-' + T.tone + '" role="dialog" aria-modal="true" aria-labelledby="calDlgT">' +
    '<div class="kc-dlg-h"><span class="kc-dlg-tag"><i></i>' + calEsc(e.title) + '</span><button type="button" class="kc-x" aria-label="Cerrar" onclick="calClose()">×</button></div>' +
    '<h3 id="calDlgT">' + calEsc(e.client) + '</h3>' +
    (e.status && e.status.length ? '<div class="kc-dlg-st">' + e.status.map(function (s) { return '<span class="dash-pill p-' + s.tone + '">' + (s.ic ? calIc(s.ic) : '') + calEsc(s.t) + '</span>'; }).join('') + '</div>' : '') +
    '<dl>' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + calEsc(r[1]) + '</dd>'; }).join('') + '</dl>' +
    '<div class="kc-dlg-a">' + links.join('') + '</div></div>';
}

/* ---------- acciones (solo cambian lo que se ve) ---------- */
function calRefresh() {
  var el = document.getElementById('calRoot'); if (!el) return;
  var keep = el.querySelector('.kcw-scroll'), top = keep ? keep.scrollTop : null;
  el.outerHTML = viewCoachCalendar();
  var sc = document.querySelector('#calRoot .kcw-scroll'); if (sc && top != null) sc.scrollTop = top;
}
function calGo(dir) {
  var S = calState();
  if (dir === 0) { S.anchor = calToday(); S.day = calToday(); }
  else if (S.view === 'mes') { var a = calD(S.anchor); S.anchor = calIso(new Date(a.getFullYear(), a.getMonth() + dir, 1, 12)); S.day = null; }
  else { S.anchor = calAdd(calMonday(S.anchor), 7 * dir); S.day = null; }
  S.sel = null; calRefresh();
}
function calView(v) { var S = calState(); if (S.view === v) return; S.view = v; if (S.day) S.anchor = S.day; S.sel = null; calRefresh(); }
function calToggle(k) { var S = calState(); S.off[k] = !S.off[k]; calRefresh(); }
function calOpen(id) { calState().sel = id; calRefresh(); var b = document.querySelector('.kc-dlg .kc-x'); if (b) b.focus(); }
function calClose() { calState().sel = null; calRefresh(); }
function calPickDay(d, ev) { if (ev && ev.target && ev.target.closest && ev.target.closest('.kc-ev,.kcm-more')) return; var S = calState(); S.day = d; calRefresh(); }
function calWeekOf(d) { var S = calState(); S.view = 'semana'; S.anchor = d; S.day = d; S.sel = null; calRefresh(); }
function calJump(d) { calState().day = d; calRefresh(); var el = document.getElementById('kca-' + d); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function calOpenClient(cid) { calState().sel = null; if (typeof openClient === 'function') openClient(cid); }
function calOpenNeg(tab) { calState().sel = null; navGo(null, 'negocio/' + tab); }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && UI && UI.coachCal && UI.coachCal.sel && document.getElementById('calRoot')) calClose(); });
