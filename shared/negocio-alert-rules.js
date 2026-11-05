/* =======================================================================
   Reglas de avisos de negocio (fechas y filtros).
   -----------------------------------------------------------------------
   Fuente de verdad para el job diario. Réplica, sin bundler, de las
   fórmulas de index.html. La app no carga este archivo: index.html es un
   único script y el PR de reglas de Firestore también lo modifica. Meter
   un <script src> ahí ahora chocaría con ese PR. Los tests de este módulo
   fijan la paridad.

   Funciones de la app y qué copia esto:
     negAddMonths / negAddDays     → addMonths / addDays
     negDaysTo                     → daysTo
     negFin                        → finContrato
       addDays(addDays(addMonths(inicio, (dur||0)+(congelado||0)), -1),
               negFrozenDaysTotal)
     negProx                       → proxPago
       prox || addMonths(inicio, (dur||0)+(congelado||0))
     negFrozenActiveDays           → frozenActiveDays
     negFrozenDaysTotal            → frozenDaysTotal
       (congeladoDias||0) + días de la congelación abierta
     negIsFrozen                   → isFrozen
       sin frozenFrom → no; sin frozenUntil → sí; si no, días hasta
       frozenUntil >= 0 (sigue congelado hoy)
     negCallScheduled              → callScheduled
       callDoneFor === finContrato
     negSaldo / negPaid            → saldo / paid
     normNegocio (pagado vacío)    → si pagado no viene y estado es
       "cobrado", se toma el importe como pagado (lo que ve el coach
       al abrir la app)
     negCoachAlerts                → coachAlerts (la VENTANA de la app)
       renovación: 0 <= días hasta fin <= avisoDias, no congelado,
                   llamada no agendada
       pago: saldo > 0 y días hasta prox <= 14, no congelado
       (avisoDias usa `cfg.avisoDias||14`, igual que la app)

   El job diario NO recorre toda la ventana: si lo hiciera, el correo
   saldría cada mañana durante 14 días. Avisa el borde, con las mismas
   fórmulas:
     pago:       prox === hoy y saldo > 0 y no congelado
     renovación: días hasta fin === avisoDias, no congelado,
                 llamada no agendada
   ======================================================================= */
'use strict';

const PAGO_VENTANA_DIAS = 14;

function pad(n) { return String(n).padStart(2, '0'); }

function addMonths(iso, n) {
  const [y, mo, d] = String(iso).split('-').map(Number);
  const idx = (mo - 1) + n;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return ny + '-' + pad(nm + 1) + '-' + pad(nd);
}

function addDays(iso, n) {
  const [y, mo, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
}

function daysTo(today, iso) {
  if (!iso) return 9999;
  const a = Date.parse(today + 'T00:00:00Z');
  const b = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 9999;
  return Math.round((b - a) / 86400000);
}

/* Día civil en Europa/Madrid, el mismo "hoy" que negToday() en el navegador
   del coach. El cron va en UTC; a las 05:00 UTC ya es por la mañana en España
   y la fecha coincide. */
function todayISOMadrid(now) {
  const dt = now instanceof Date ? now : new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dt);
  const pick = (type) => parts.find((p) => p.type === type).value;
  return pick('year') + '-' + pick('month') + '-' + pick('day');
}

function num(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  if (s == null || s === '') return 0;
  let t = String(s).replace(/[€\s]/g, '');
  if (t.indexOf(',') > -1 && t.indexOf('.') > -1) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.indexOf(',') > -1) t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isNaN(n) ? 0 : n;
}

function paid(c) {
  if (!c) return 0;
  if (c.pagado === undefined || c.pagado === null || c.pagado === '') {
    return c.estado === 'cobrado' ? num(c.importe) : 0;
  }
  return num(c.pagado);
}

function saldo(c) {
  return Math.max(0, num(c && c.importe) - paid(c));
}

function frozenActiveDays(c, today) {
  if (!c || !c.frozenFrom) return 0;
  if (c.frozenUntil) return Math.max(0, daysTo(c.frozenFrom, c.frozenUntil));
  return Math.max(0, daysTo(c.frozenFrom, today));
}

function frozenDaysTotal(c, today) {
  return ((c && c.congeladoDias) || 0) + frozenActiveDays(c, today);
}

function finContrato(c, today) {
  const months = (c.dur || 0) + (c.congelado || 0);
  const base = addDays(addMonths(c.inicio, months), -1);
  return addDays(base, frozenDaysTotal(c, today));
}

function proxPago(c) {
  if (c.prox) return String(c.prox).slice(0, 10);
  return addMonths(c.inicio, (c.dur || 0) + (c.congelado || 0));
}

function isFrozen(c, today) {
  if (!c || !c.frozenFrom) return false;
  if (!c.frozenUntil) return true;
  return daysTo(today, c.frozenUntil) >= 0;
}

function callScheduled(c, today) {
  if (!c || !c.callDoneFor || !c.inicio) return false;
  return c.callDoneFor === finContrato(c, today);
}

function avisoDiasDe(cfg) {
  const n = cfg && cfg.avisoDias;
  return n || 14;
}

/* Ventana que muestra negCoachAlerts (banner y pestaña). No es lo que
   el cron envía: ver dailyAvisos. */
function coachAlerts(contracts, opts) {
  const today = opts.today;
  const av = avisoDiasDe(opts.cfg || { avisoDias: opts.avisoDias });
  const renov = [];
  const pend = [];
  for (const c of contracts || []) {
    if (!c || !c.inicio || isFrozen(c, today)) continue;
    const dFin = daysTo(today, finContrato(c, today));
    if (dFin >= 0 && dFin <= av && !callScheduled(c, today)) renov.push({ c, d: dFin });
    const dProx = daysTo(today, proxPago(c));
    if (saldo(c) > 0 && dProx <= PAGO_VENTANA_DIAS) pend.push({ c, d: dProx });
  }
  renov.sort((a, b) => a.d - b.d);
  pend.sort((a, b) => a.d - b.d);
  return { renov, pend, av };
}

/* Un solo día, para el correo/push diario. Mismas fórmulas que la ventana. */
function dailyAvisos(contracts, opts) {
  const today = opts.today;
  const av = avisoDiasDe(opts.cfg || { avisoDias: opts.avisoDias });
  const pagos = [];
  const renovaciones = [];
  let congelados = 0;
  let llamadasAgendadas = 0;
  for (const c of contracts || []) {
    if (!c || !c.inicio) continue;
    const fin = finContrato(c, today);
    const prox = proxPago(c);
    const dFin = daysTo(today, fin);
    const dProx = daysTo(today, prox);
    const pagoHoy = saldo(c) > 0 && dProx === 0;
    const renovHoy = dFin === av && !callScheduled(c, today);
    if (isFrozen(c, today)) {
      if (pagoHoy || (dFin === av)) congelados += 1;
      continue;
    }
    if (pagoHoy) pagos.push({ c, fin, prox, dFin, dProx });
    if (dFin === av && callScheduled(c, today)) llamadasAgendadas += 1;
    if (renovHoy) renovaciones.push({ c, fin, prox, dFin, dProx });
  }
  return { pagos, renovaciones, congelados, llamadasAgendadas, avisoDias: av, today };
}

const api = {
  PAGO_VENTANA_DIAS,
  addMonths,
  addDays,
  daysTo,
  todayISOMadrid,
  num,
  paid,
  saldo,
  frozenActiveDays,
  frozenDaysTotal,
  finContrato,
  proxPago,
  isFrozen,
  callScheduled,
  avisoDiasDe,
  coachAlerts,
  dailyAvisos
};

if (typeof module === 'object' && module.exports) {
  module.exports = api;
} else {
  const root = typeof globalThis !== 'undefined' ? globalThis : this;
  root.NegocioAlertRules = api;
}
