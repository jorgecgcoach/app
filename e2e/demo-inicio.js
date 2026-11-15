/* Datos FICTICIOS para la vista previa del nuevo inicio del entrenador. SOLO EMULADOR.
     node e2e/demo-inicio.js
   Requiere los emuladores con Auth (npm run e2e:emulador-auth). Vacía el emulador y crea:
     - coach_data con contratos, pagos y plantillas inventados (fechas relativas a hoy)
     - 9 fichas de clientes inventadas con programas que terminan en fechas distintas
     - una cuenta de entrenador ficticia (claim role=coach) para entrar con el acceso de respaldo:
         correo: entrenador.demo@ejemplo.test   contraseña: demo-entrenador-2026
   Ninguno de estos datos es real. Se niega a ejecutarse si no va contra 127.0.0.1 con proyecto demo-. */
'use strict';
const PROJECT = 'demo-jcg-e2e';
const HOST = '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = HOST;
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
if (!PROJECT.startsWith('demo-')) { console.error('Rechazado: solo proyecto demo-'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const EMAIL = 'entrenador.demo@ejemplo.test';
const PASS = 'demo-entrenador-2026';

const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
const dia = n => { const d = new Date(hoy); d.setDate(d.getDate() + n); return iso(d); };
const lunes = n => { const d = new Date(hoy); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + n * 7); return iso(d); };
// inicio de contrato tal que su fin (inicio + dur meses - 1 día) caiga dentro de `dias` días
const inicioParaFin = (dias, meses) => { const d = new Date(hoy); d.setDate(d.getDate() + dias + 1); d.setMonth(d.getMonth() - meses); return iso(d); };

let uidN = 0;
const ex = n => ({ uid: 'demo' + (++uidN), n, muscles: [], sets: 3, reps: '10-12', rir: '2', int: '' });
const semana = () => ({ days: [
  { s: 'Día A', exs: [ex('Sentadilla goblet'), ex('Remo con mancuerna'), ex('Plancha frontal')] },
  { s: 'Día B', exs: [ex('Peso muerto rumano'), ex('Press banca'), ex('Bird dog')] }
] });
// programa de `semanas` semanas que empezó hace `hace` semanas (lunes)
const programa = (semanas, hace) => ({ weeks: Array.from({ length: semanas }, semana), coeffs: [1, 1, 1, 1], startDate: lunes(-hace) });

const CLIENTES = [
  // nombre, servicio, semanas, empezó hace (semanas), seguimiento esta semana
  ['Laura Ejemplo', 'training', 6, 5, true],
  ['Carlos Muestra', 'training_nutrition', 8, 7, false],
  ['Marta Prueba', 'training', 4, 4, true],
  ['Diego Ficticio', 'training', 8, 2, false],
  ['Sara Inventada', 'training_nutrition', 12, 6, false],
  ['Pablo Demo', 'training', 6, 6, false],
  ['Elena Simulada', 'nutrition', 0, 0, false],
  ['Jorge Ejemplar', 'training', 0, 0, false],
  ['Nuria Modelo', 'training', 10, 3, true]
];

async function main() {
  const r = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!r.ok) throw new Error('No se pudo vaciar el emulador: ' + r.status);
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

  const contactos = [], contratos = [], pagos = [];
  const con = (id, nombre, plan, inicio, dur, importe, pagado, extra) => {
    contactos.push({ id, nombre, telefono: '', correo: '', clientId: null, estadoManual: null, etiquetas: [], origen: 'manual', fechaPrimerContacto: inicio, fechaAlta: inicio, fechaBaja: '', motivoBaja: '', motivoBajaDetalle: '', notas: '', createdAt: '', updatedAt: '' });
    const c = Object.assign({ id: 100 + id, contactId: id, nombre, plan, tipo: 'alta', inicio, dur, importe, pagado, estado: pagado >= importe ? 'cobrado' : pagado > 0 ? 'parcial' : 'pendiente', correo: '' }, extra || {});
    contratos.push(c);
    if (pagado > 0) pagos.push({ id: 500 + id, contactId: id, nombre, importe: pagado, fecha: dia(-3 - id), concepto: plan });
    return c;
  };
  con(1, 'Laura Ejemplo', 'Entreno 3m', inicioParaFin(6, 3), 3, 300, 300);
  const carlos = con(2, 'Carlos Muestra', 'Entreno+Nutri 3m', inicioParaFin(3, 3), 3, 390, 390);
  carlos.callDoneFor = null; // se marca abajo como agendada
  con(3, 'Marta Prueba', 'Entreno 6m', dia(-40), 6, 540, 360, { prox: dia(-2) });
  con(4, 'Diego Ficticio', 'Entreno 3m', dia(-14), 3, 300, 100, { prox: dia(4) });
  con(5, 'Sara Inventada', 'Entreno+Nutri 6m', dia(-42), 6, 720, 480, { prox: dia(11) });
  con(6, 'Pablo Demo', 'Entreno 3m', inicioParaFin(12, 3), 3, 300, 300);
  con(7, 'Elena Simulada', 'Nutri 1m', dia(-10), 1, 60, 0, { prox: dia(0) });
  con(8, 'Nuria Modelo', 'Entreno 12m', dia(-20), 12, 960, 960);
  con(9, 'Jorge Ejemplar', 'Entreno 3m', dia(5), 3, 300, 0, { prox: dia(5) });
  // fin de Carlos con videollamada de cierre ya agendada (callDoneFor = su fecha de fin)
  { const d = new Date(carlos.inicio + 'T00:00:00'); d.setMonth(d.getMonth() + 3); d.setDate(d.getDate() - 1); carlos.callDoneFor = iso(d); }

  await db.collection('clients').doc('coach_data').set({
    coachCode: '1234', codes: {}, exLibrary: [],
    templates: {
      workouts: [{ id: 't1', name: 'Fuerza base 4 semanas', program: programa(4, 0) }, { id: 't2', name: 'Espalda sana — inicio', program: programa(6, 0) }],
      diets: [{ id: 'd1', name: 'Dieta 1.800 kcal', plan: { meals: [] } }]
    },
    negocio: { contacts: contactos, contracts: contratos, payments: pagos, cfg: { emailCoach: 'entrenador.demo@ejemplo.test', avisoDias: 14, target: 2000 } },
    _split: true
  });

  let i = 0;
  for (const [name, svc, sem, hace, seg] of CLIENTES) {
    i++;
    const data = { _logv: 2, log: {}, tracking: [] };
    if (sem) data.program = programa(sem, hace);
    if (seg) data.tracking.push({ date: lunes(0), _submittedAt: new Date().toISOString(), energia: 4, sueno: 3, dolor: 2 });
    await db.collection('clients').doc('cdemo' + i).set({
      name, serviceType: svc, mods: {}, menus: [], backRehab: { assessments: [], loadTests: [] },
      blocks: [{ id: 'b' + i, label: 'Bloque 1', cur: true, data }]
    });
  }

  const u = await admin.auth().createUser({ email: EMAIL, password: PASS, emailVerified: true });
  await admin.auth().setCustomUserClaims(u.uid, { role: 'coach' });
  console.log('Vista previa sembrada: ' + CLIENTES.length + ' fichas y ' + contratos.length + ' contratos ficticios; entrenador ficticio listo.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message || e); process.exit(1); });
