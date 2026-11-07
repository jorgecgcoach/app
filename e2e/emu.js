/* Utilidades del EMULADOR para las pruebas e2e (datos ficticios).
     node e2e/emu.js seed            borra el emulador y crea coach_data ficticio
     node e2e/emu.js dump [docId]    imprime los documentos de clients
   Se niega a ejecutarse si no va contra 127.0.0.1:8080 con proyecto demo-. */
'use strict';
const PROJECT = 'demo-jcg-e2e';
const HOST = '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = HOST;
process.env.GCLOUD_PROJECT = PROJECT;
if (!PROJECT.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('Rechazado: solo emulador local con proyecto demo-');
  process.exit(1);
}
const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

async function seed() {
  const r = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!r.ok) throw new Error('No se pudo vaciar el emulador: ' + r.status);
  await db.collection('clients').doc('coach_data').set({
    coachCode: '1234',
    codes: {},
    exLibrary: [],
    templates: { workouts: [], diets: [] },
    // Esquema real de normContact (id numérico, "nombre"): si no, la app lo normaliza al cargar.
    negocio: { contacts: [{ id: 9001, nombre: 'Contacto Ficticio E2E', telefono: '', correo: '', clientId: null, estadoManual: 'lead', etiquetas: [], origen: 'e2e', fechaPrimerContacto: '2026-11-01', fechaAlta: '', fechaBaja: '', motivoBaja: '', motivoBajaDetalle: '', notas: 'dato ficticio', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }] },
    _split: true
  });
  console.log('Emulador sembrado: coach_data ficticio (código entrenador 1234)');
}

async function dump(id) {
  const snap = id ? [await db.collection('clients').doc(id).get()] : (await db.collection('clients').get()).docs;
  const out = {};
  snap.forEach(d => { if (d.exists) out[d.id] = d.data(); });
  console.log(JSON.stringify(out, null, 1));
}

/* Resumen legible: revisión y lo que importa de cada documento. */
async function summary() {
  const docs = (await db.collection('clients').get()).docs;
  for (const d of docs) {
    const x = d.data();
    const head = `${d.id}  _rev=${x._rev === undefined ? '-' : x._rev}  por=${x._updatedBy || '-'}`;
    if (d.id === 'coach_data') {
      console.log(head, ' codes=' + Object.keys(x.codes || {}).join(','), ' contactos=' + ((x.negocio && x.negocio.contacts) || []).map(c => c.id + ':' + c.nombre).join(',') + ' pagos=' + ((x.negocio && x.negocio.payments) || []).length + ' contratos=' + ((x.negocio && x.negocio.contracts) || []).length);
      continue;
    }
    console.log(head, ' nombre=' + x.name);
    for (const b of x.blocks || []) {
      const data = b.data || {};
      const exs = [];
      ((data.program && data.program.weeks) || []).forEach((w, wi) => (w.days || []).forEach((dd, di) => (dd.exs || []).forEach(e => exs.push(`S${wi + 1}D${di + 1}:${e.n || e.name || '?'}`))));
      console.log(`   bloque ${b.id} "${b.label}" cur=${!!b.cur}`);
      console.log('     ejercicios: ' + (exs.join(' | ') || '-'));
      console.log('     series(log): ' + JSON.stringify(data.log || {}));
      console.log('     anotaciones(exNotes): ' + JSON.stringify(data.exNotes || {}));
      const meals = ((data.dietPlan && data.dietPlan.meals) || []).map(m => (m.name || m.n || '?') + '[' + (m.foods || []).map(f => (f.n || f.name || '?') + ':' + (f.g || f.q || '')).join(';') + ']');
      console.log('     dieta: ' + (meals.join(' ') || '-'));
      console.log('     fotos: ' + (data.photoSessions || []).length + '  medidas: ' + (x.anthroSessions || data.anthroSessions || []).length + '  tracking: ' + Object.keys(data.tracking || {}).join(','));
    }
  }
}

const [cmd, arg] = process.argv.slice(2);
(cmd === 'seed' ? seed() : cmd === 'dump' ? dump(arg) : cmd === 'summary' ? summary() : Promise.reject(new Error('uso: seed | dump [id] | summary')))
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message || e); process.exit(1); });
