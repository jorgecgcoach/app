// C1 — Qué campos de SU ficha puede cambiar un cliente con las reglas estrictas. Emulador y datos ficticios.
// El cliente debe poder seguir registrando (series, notas, formularios, avisos); no puede tocar lo que
// decide el entrenador (nombre, código, pagos, módulos, tipo de servicio, avisos configurados).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteField } = require('firebase/firestore');

const RULES = require('./reglas').leer('firestore.rules');
const BASE = () => ({
  name: 'Cliente Ficticio A', code: 'COD-A', authUid: 'uid-a', _rev: 4, _updatedBy: 'x', _writers: ['x'],
  mods: { semana: true, programa: false }, serviceType: 'training', notifs: { seguimiento: { mode: 'auto' } },
  pagos: [{ id: 1, importe: 60 }], push: { enabled: false, tokens: [] },
  fichas: { entrenamiento: {}, nutricion: {} }, fichasDone: false,
  blocks: [{ id: 'b1', data: { _logv: 2, log: { 'e1|0': { kg: '60', reps: '8', rir: '2' } }, exNotes: {} } }]
});
let env;
test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-jcg-campos', firestore: { rules: RULES } }); });
test.after(async () => { if (env) await env.cleanup(); });
async function sembrar(datos) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'clients/client-a'), datos || BASE()); });
}
const cliente = () => env.authenticatedContext('uid-a').firestore();
const coach = () => env.authenticatedContext('uid-coach', { role: 'coach' }).firestore();
// Escritura completa como la del guardado seguro (transacción → set del documento entero).
async function guardar(db, cambiar) {
  const ref = doc(db, 'clients/client-a');
  const d = BASE(); cambiar(d); d._rev = 5; d._updatedBy = 'tab~0123456789abcdef~1'; d._writers = ['x', d._updatedBy];
  return setDoc(ref, d);
}

test('el cliente registra series, notas de dolor, formularios y avisos', async () => {
  await sembrar();
  await assertSucceeds(guardar(cliente(), d => {
    d.blocks[0].data.log['e1|1'] = { kg: '62,5', reps: '7', rir: '1', done: true };
    d.blocks[0].data.exNotes.e1 = { pain: 3, txt: 'molestia' };
    d.fichas.entrenamiento.objetivo = 'fuerza'; d.fichasDone = true; d.fichasFecha = '2026-11-09';
    d.push = { enabled: true, tokens: ['token-ficticio'] };
  }));
});
for (const [campo, cambiar] of [
  ['nombre', d => { d.name = 'Otro'; }],
  ['código', d => { d.code = 'OTRO'; }],
  ['pagos', d => { d.pagos = []; }],
  ['módulos (activar uno oculto)', d => { d.mods.programa = true; }],
  ['tipo de servicio', d => { d.serviceType = 'premium'; }],
  ['avisos configurados', d => { d.notifs = {}; }],
  ['dueño de la ficha', d => { d.authUid = 'uid-x'; }]
]) {
  test('el cliente NO puede cambiar: ' + campo + ' (y la serie que iba en la misma escritura tampoco entra)', async () => {
    await sembrar();
    await assertFails(guardar(cliente(), d => { cambiar(d); d.blocks[0].data.log['e1|1'] = { kg: '1' }; }));
  });
  test('el entrenador sí puede cambiar: ' + campo, async () => {
    await sembrar();
    await assertSucceeds(guardar(coach(), cambiar));
  });
}
test('el cliente tampoco puede BORRAR esos campos', async () => {
  await sembrar();
  await assertFails(updateDoc(doc(cliente(), 'clients/client-a'), { pagos: deleteField() }));
  await assertFails(updateDoc(doc(cliente(), 'clients/client-a'), { mods: deleteField() }));
});
test('ficha antigua sin módulos/servicio/avisos: la app del cliente puede rellenarlos por defecto y seguir registrando', async () => {
  const vieja = BASE(); delete vieja.mods; delete vieja.serviceType; delete vieja.notifs;
  await sembrar(vieja);
  const ref = doc(cliente(), 'clients/client-a');
  const d = Object.assign({}, vieja, { mods: { semana: true }, serviceType: null, notifs: { seguimiento: { mode: 'auto' } }, _rev: 5 });
  d.blocks = [{ id: 'b1', data: { _logv: 2, log: { 'e1|0': { kg: '60' }, 'e1|1': { kg: '61' } }, exNotes: {} } }];
  await assertSucceeds(setDoc(ref, d));
  // …pero una vez existen, ya no los cambia.
  await assertFails(updateDoc(ref, { mods: { semana: true, programa: true } }));
  assert.equal((await getDoc(ref)).get('blocks')[0].data.log['e1|1'].kg, '61');
});
test('otro cliente no puede escribir nada en esta ficha', async () => {
  await sembrar();
  await assertFails(guardar(env.authenticatedContext('uid-b').firestore(), d => { d.blocks[0].data.log['e1|1'] = { kg: '1' }; }));
});
