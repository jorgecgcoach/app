'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('./negocio-alert-rules');

/* Transcripción de negAddMonths / negAddDays / negDaysTo de index.html.
   En un entorno UTC el resultado de calendario coincide con la versión UTC
   del módulo. Si diverge, la paridad se ha roto. */
function appAddMonths(iso, n) {
  const [y, mo, d] = iso.split('-').map(Number);
  const idx = (mo - 1) + n;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const dim = new Date(ny, nm + 1, 0).getDate();
  const nd = Math.min(d, dim);
  return ny + '-' + String(nm + 1).padStart(2, '0') + '-' + String(nd).padStart(2, '0');
}

function appAddDays(iso, n) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(y, mo - 1, d + n);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

function appDays(today, iso) {
  if (!iso) return 9999;
  return Math.round((new Date(iso) - new Date(today)) / 86400000);
}

function appFin(c, today) {
  const active = !c || !c.frozenFrom
    ? 0
    : (c.frozenUntil
      ? Math.max(0, appDays(c.frozenFrom, c.frozenUntil))
      : Math.max(0, appDays(c.frozenFrom, today)));
  const total = ((c && c.congeladoDias) || 0) + active;
  return appAddDays(appAddDays(appAddMonths(c.inicio, (c.dur || 0) + (c.congelado || 0)), -1), total);
}

test('addMonths y addDays coinciden con negAddMonths / negAddDays', () => {
  const months = [
    ['2026-01-31', 1, '2026-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-05-15', 0, '2026-05-15'],
    ['2026-05-15', -1, '2026-04-15'],
    ['2026-01-15', 3, '2026-04-15']
  ];
  for (const [iso, n, expected] of months) {
    assert.equal(rules.addMonths(iso, n), expected);
    assert.equal(rules.addMonths(iso, n), appAddMonths(iso, n));
  }
  assert.equal(rules.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(rules.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(rules.addDays('2026-03-01', -1), appAddDays('2026-03-01', -1));
});

test('finContrato suma meses de congelado y días (negFin)', () => {
  const today = '2026-03-05';
  const plain = { inicio: '2026-01-31', dur: 1, congelado: 0 };
  assert.equal(rules.finContrato(plain, today), '2026-02-27');
  assert.equal(rules.finContrato(plain, today), appFin(plain, today));

  const extraMonth = { inicio: '2026-01-15', dur: 3, congelado: 1 };
  assert.equal(rules.finContrato(extraMonth, today), appFin(extraMonth, today));
  assert.equal(rules.finContrato(extraMonth, today), '2026-05-14');

  const days = { inicio: '2026-01-15', dur: 1, congeladoDias: 10 };
  assert.equal(rules.finContrato(days, today), '2026-02-24');
  assert.equal(rules.finContrato(days, today), appFin(days, today));

  const openFreeze = { inicio: '2026-01-15', dur: 1, frozenFrom: '2026-03-01' };
  assert.equal(rules.frozenActiveDays(openFreeze, today), 4);
  assert.equal(rules.finContrato(openFreeze, today), appFin(openFreeze, today));

  const dated = { inicio: '2026-01-15', dur: 1, frozenFrom: '2026-03-01', frozenUntil: '2026-03-10' };
  assert.equal(rules.frozenActiveDays(dated, '2026-03-11'), 9);
  assert.equal(rules.isFrozen(dated, '2026-03-10'), true);
  assert.equal(rules.isFrozen(dated, '2026-03-11'), false);
  assert.equal(rules.finContrato(dated, '2026-03-11'), appFin(dated, '2026-03-11'));
});

test('proxPago usa prox y, si falta, el alta de meses (negProx)', () => {
  assert.equal(rules.proxPago({ inicio: '2026-01-15', dur: 1, prox: '2026-02-01' }), '2026-02-01');
  assert.equal(rules.proxPago({ inicio: '2026-01-31', dur: 1, congelado: 0 }), '2026-02-28');
});

test('saldo trata el cobrado sin pagado como ya cobrado (normNegocio)', () => {
  assert.equal(rules.saldo({ importe: 300, pagado: 0, estado: 'pendiente' }), 300);
  assert.equal(rules.saldo({ importe: 300, estado: 'cobrado' }), 0);
  assert.equal(rules.saldo({ importe: '300,50', pagado: 100 }), 200.5);
  assert.equal(rules.saldo({ importe: 100, pagado: 40, estado: 'cobrado' }), 60);
});

test('hoy en Europe/Madrid, no en UTC', () => {
  assert.equal(rules.todayISOMadrid(new Date('2026-01-15T23:30:00Z')), '2026-01-16');
  assert.equal(rules.todayISOMadrid(new Date('2026-03-01T05:00:00Z')), '2026-03-01');
  assert.equal(rules.todayISOMadrid(new Date('2026-07-01T05:00:00Z')), '2026-07-01');
  assert.equal(rules.todayISOMadrid(new Date('2026-07-15T22:30:00Z')), '2026-07-16');
});

test('la ventana de negCoachAlerts y el día exacto del cron no son la misma lista', () => {
  const today = '2026-03-01';
  const renovLejos = { inicio: '2026-01-16', dur: 1, importe: 100, pagado: 100, estado: 'cobrado', prox: '2026-06-01' };
  // fin = 2026-02-15? inicio 2026-01-16 + 1 mes = 2026-02-16, fin = 2026-02-15, days negative.
  const renov7 = { inicio: '2026-02-09', dur: 1, importe: 100, pagado: 100, estado: 'cobrado', prox: '2026-06-01', nombre: 'siete' };
  const renov14 = { inicio: '2026-02-16', dur: 1, importe: 100, pagado: 0, estado: 'pendiente', prox: '2026-06-01', nombre: 'catorce' };
  const pagoHoy = { inicio: '2026-01-01', dur: 3, importe: 300, pagado: 0, estado: 'pendiente', prox: today, nombre: 'hoy' };
  const pagoEn9 = { inicio: '2026-01-01', dur: 6, importe: 300, pagado: 0, prox: '2026-03-10', nombre: 'nueve' };
  const pagoVencido = { inicio: '2025-01-01', dur: 12, importe: 100, pagado: 0, prox: '2026-02-20', nombre: 'vencido' };
  const frozen = {
    inicio: '2026-01-15', dur: 1, importe: 100, pagado: 0, prox: today,
    frozenFrom: today, nombre: 'hielo'
  };
  const list = [renovLejos, renov7, renov14, pagoHoy, pagoEn9, pagoVencido, frozen];
  assert.equal(rules.finContrato(renov14, today), '2026-03-15');
  assert.equal(rules.daysTo(today, rules.finContrato(renov14, today)), 14);
  assert.equal(rules.daysTo(today, rules.finContrato(renov7, today)), 7);

  const window = rules.coachAlerts(list, { today, avisoDias: 14 });
  const daily = rules.dailyAvisos(list, { today, cfg: { avisoDias: 14 } });

  assert.deepEqual(window.renov.map((row) => row.c.nombre).sort(), ['catorce', 'siete']);
  assert.deepEqual(window.pend.map((row) => row.c.nombre).sort(), ['hoy', 'nueve', 'vencido']);
  assert.deepEqual(daily.renovaciones.map((row) => row.c.nombre), ['catorce']);
  assert.deepEqual(daily.pagos.map((row) => row.c.nombre), ['hoy']);
  assert.equal(daily.congelados, 1);
  assert.equal(window.renov.some((row) => row.c.nombre === 'hielo'), false);
  assert.equal(window.pend.some((row) => row.c.nombre === 'hielo'), false);
});

test('la llamada agendada (callDoneFor === fin) sale de la renovación', () => {
  const today = '2026-01-31';
  const c = {
    inicio: '2026-01-15', dur: 1, importe: 80, pagado: 80, estado: 'cobrado',
    prox: '2026-06-01', callDoneFor: '2026-02-14'
  };
  assert.equal(rules.callScheduled(c, today), true);
  const daily = rules.dailyAvisos([c], { today, avisoDias: 14 });
  assert.equal(daily.renovaciones.length, 0);
  assert.equal(daily.llamadasAgendadas, 1);
});
