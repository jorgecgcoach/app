#!/usr/bin/env node
/* Migración de clientes a cuentas de Firebase Auth con CÓDIGOS ALEATORIOS NUEVOS (C1, 11-11-2026).

   Decisión del dueño: los códigos de hoy (a menudo un documento de identidad) NO se migran. Cada ficha recibe
   un código aleatorio de 60 bits (auth/code-identity.js, generateClientCode) y una cuenta nueva para él.
   El entrenador ve el código en la app («Código de acceso») y se lo envía a su cliente. Este script no
   imprime códigos, nombres, correos ni uids: solo ids de ficha y conteos.

   Identidades dudosas: si una ficha ya tiene cuentas vinculadas (authUid/authUids) que no son de esta
   migración para ESA ficha, o si ya existe una cuenta para el código nuevo, la ficha NO se migra y queda
   en «revisar». No se borra ni se reasigna ninguna cuenta automáticamente.

   Cuándo: con las reglas definitivas YA desplegadas (los códigos nuevos se escriben en coach_data y en la
   ficha; con las reglas abiertas los vería cualquiera) y con la app del entrenador cerrada.

     Ensayo con una copia (sin red):  node scripts/migrate-client-auth.js --backup copia.json
     Ensayo con lo que hay ahora (solo lee):  node scripts/migrate-client-auth.js --comprobar
     Simular --aislar (solo lee):  node scripts/migrate-client-auth.js --simular-aislar
     Aplicar:  ALLOW_AUTH_MIGRATION_APPLY=yes node scripts/migrate-client-auth.js --apply [--aislar --confirmar-aislar=<huella>]
       --aislar: las fichas con cuentas dudosas, además de quedar «a revisar», pierden el acceso de esas cuentas
       (se mueven a cuentasEnRevision; ninguna cuenta se borra, desactiva ni reasigna).
   Contra los emuladores basta con FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST. */
const fs = require('fs');
const id = require('../auth/code-identity');

const CLAIM = 'jcgCliente';        // marca de procedencia en la cuenta (solo la pone el Admin SDK)
const MARCA = 'migracion-c1';      // _updatedBy de lo que escribe este script (como el guardado seguro)
const WRITERS_KEEP = 12;
// Fichas que NO son de clientes reales (pruebas). No reciben código ni cuenta, y la migración no las toca.
// «demo»: ficha de pruebas confirmada por el entrenador el 11-11-2026.
const FICHAS_EXCLUIDAS = Object.freeze(['demo']);
function excluida(cid) { return FICHAS_EXCLUIDAS.indexOf(cid) >= 0; }

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] || null;
}

function sello(actual) {
  const previos = (actual && Array.isArray(actual._writers)) ? actual._writers.filter(function (w) { return typeof w === 'string' && w !== MARCA; }) : [];
  return {
    _rev: ((actual && Number(actual._rev)) || 0) + 1,
    _updatedAt: new Date().toISOString(),
    _updatedBy: MARCA,
    _writers: previos.concat(MARCA).slice(-WRITERS_KEEP)
  };
}

// Solo el código técnico del error (p. ej. auth/quota-exceeded): nunca el mensaje, que podría llevar datos.
function codigoError(e) {
  const c = e && e.code;
  return (typeof c === 'string' && /^[a-z0-9/_-]{1,60}$/i.test(c)) ? c : 'error';
}

function enRevision(ficha) {
  return !!(ficha && Array.isArray(ficha.cuentasEnRevision) && ficha.cuentasEnRevision.length);
}

function uidsDe(ficha) {
  return [ficha && ficha.authUid].concat(ficha && Array.isArray(ficha.authUids) ? ficha.authUids : []).filter(Boolean);
}

// Ensayo a partir de una copia: no contacta con Firebase.
async function planMigration(dump) {
  if (!dump || typeof dump !== 'object' || !dump.clients || typeof dump.clients !== 'object') {
    throw new Error('Esa copia no tiene clientes.');
  }
  const rows = [];
  for (const cid of Object.keys(dump.clients)) {
    if (cid === 'coach_data') continue;
    if (excluida(cid)) { rows.push({ clientId: cid, action: 'excluida', reason: 'ficha-de-pruebas' }); continue; }
    const c = dump.clients[cid] || {};
    if (uidsDe(c).length) rows.push({ clientId: cid, action: 'revisar', reason: 'ya-tiene-cuentas' });
    else rows.push({ clientId: cid, action: 'nuevo-codigo', reason: '' });
  }
  return {
    excluidas: rows.filter(function (r) { return r.action === 'excluida'; }).length,
    totalClients: rows.filter(function (r) { return r.action !== 'excluida'; }).length,
    nuevos: rows.filter(function (r) { return r.action === 'nuevo-codigo'; }).length,
    revisar: rows.filter(function (r) { return r.action === 'revisar'; }).length,
    ignoredCoachSecret: !!(dump.meta && dump.meta.coachCode),
    rows: rows
  };
}

function formatPlan(plan) {
  const lines = [];
  lines.push('Migración de cuentas de cliente (dry-run). No se ha escrito nada.');
  lines.push('Fichas de clientes: ' + plan.totalClients + (plan.excluidas ? ' (más ' + plan.excluidas + ' de pruebas excluida(s): sin código ni cuenta)' : ''));
  lines.push('Recibirán un código aleatorio nuevo y su cuenta: ' + plan.nuevos);
  lines.push('A revisar (ya tienen cuentas vinculadas; no se tocarán): ' + plan.revisar);
  lines.push('Los códigos de hoy no se migran: dejarán de valer cuando se publique la web con cuentas.');
  if (plan.ignoredCoachSecret) lines.push('La copia trae el código del entrenador. No se migra y no se imprime.');
  lines.push('No se imprimen códigos, nombres ni contraseñas.');
  plan.rows.forEach(function (r) { lines.push('- ' + r.clientId + ' accion=' + r.action + (r.reason ? ' (' + r.reason + ')' : '')); });
  return lines.join('\n');
}

function assertApplyAllowed() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error('Falta FIREBASE_AUTH_EMULATOR_HOST para aplicar en el emulador.');
    }
    return 'emulator';
  }
  if (process.env.ALLOW_AUTH_MIGRATION_APPLY !== 'yes') {
    const err = new Error('APPLY_BLOCKED');
    err.code = 'APPLY_BLOCKED';
    throw err;
  }
  return 'production';
}

function initAdmin(mode) {
  const admin = require('firebase-admin');
  if (admin.apps.length) return admin;
  if (mode === 'emulator') {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-appjorgecgcoach' });
    return admin;
  }
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credential = admin.credential.applicationDefault();
  } else {
    throw new Error('Falta la cuenta de servicio. No la guardes en el repositorio.');
  }
  admin.initializeApp({ credential: credential, projectId: 'appjorgecgcoach' });
  return admin;
}

// ¿Todas las cuentas vinculadas a la ficha son de esta migración para ESA ficha? (Si sí, ya está migrada.)
async function cuentasPropias(admin, cid, uids) {
  for (const uid of uids) {
    let u;
    try { u = await admin.auth().getUser(uid); } catch (e) { if (e && e.code === 'auth/user-not-found') return false; throw e; }
    if (!u.customClaims || u.customClaims[CLAIM] !== cid) return false;
    if ((u.providerData || []).some(function (p) { return p.providerId !== 'password'; })) return false;
  }
  return uids.length > 0;
}

// Estado actual (solo lee): qué fichas recibirían código nuevo y cuáles hay que revisar.
async function comprobar(admin) {
  const snap = await admin.firestore().collection('clients').get();
  const rows = [];
  for (const d of snap.docs) {
    if (d.id === 'coach_data') continue;
    if (excluida(d.id)) { rows.push({ clientId: d.id, action: 'excluida', reason: 'ficha-de-pruebas' }); continue; }
    const uids = uidsDe(d.data());
    if (enRevision(d.data())) rows.push({ clientId: d.id, action: 'revisar', reason: 'cuentas-aisladas-en-revision' });
    else if (!uids.length) rows.push({ clientId: d.id, action: 'nuevo-codigo', reason: '' });
    else if (await cuentasPropias(admin, d.id, uids)) rows.push({ clientId: d.id, action: 'hecha', reason: '' });
    else rows.push({ clientId: d.id, action: 'revisar', reason: 'cuentas-no-verificadas' });
  }
  return rows;
}

// ---------- Simulación de --aislar (solo lee) ----------
// Huella no reversible de una cuenta para el informe: permite ver si la misma cuenta está en varias fichas sin
// mostrar su uid.
function huellaCuenta(uid) {
  return require('crypto').createHash('sha256').update('jcg-cuenta|' + uid).digest('hex').slice(0, 8);
}
function fecha(t) { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d.toISOString().slice(0, 10) : null; }

async function describirCuenta(admin, cid, uid, apariciones) {
  let u = null;
  try { u = await admin.auth().getUser(uid); } catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
  const motivos = [];
  const proveedores = u ? (u.providerData || []).map(function (p) { return p.providerId; }) : [];
  if (!u) motivos.push('no-existe');
  else {
    const marca = u.customClaims && u.customClaims[CLAIM];
    if (!marca) motivos.push('sin-marca');
    else if (marca !== cid) motivos.push('marca-de-otra-ficha');
    if (proveedores.some(function (p) { return p !== 'password'; })) motivos.push('otro-proveedor');
    if (u.disabled) motivos.push('desactivada');
    if (u.customClaims && u.customClaims.role === 'coach') motivos.push('es-del-entrenador');
  }
  if (apariciones > 1) motivos.push('en-' + apariciones + '-fichas');
  return {
    huella: huellaCuenta(uid), existe: !!u, proveedores: proveedores,
    creada: u && u.metadata ? fecha(u.metadata.creationTime) : null,
    ultimoAcceso: u && u.metadata ? fecha(u.metadata.lastSignInTime) : null,
    motivos: motivos
  };
}

// Qué haría --aislar AHORA, sin cambiar nada. La huella identifica exactamente el conjunto (ficha, cuenta):
// aplicar exige pasarla, y si algo cambia entre la simulación y la aplicación, no se aplica nada.
async function simularAislamiento(admin) {
  const docs = (await admin.firestore().collection('clients').get()).docs.filter(function (d) { return d.id !== 'coach_data' && !excluida(d.id); });
  const apariciones = new Map();
  docs.forEach(function (d) { new Set(uidsDe(d.data())).forEach(function (u) { apariciones.set(u, (apariciones.get(u) || 0) + 1); }); });
  const fichas = [];
  let hayMigradas = false;
  for (const d of docs) {
    const data = d.data();
    if (enRevision(data)) continue;
    const uids = Array.from(new Set(uidsDe(data)));
    if (!uids.length) continue;
    if (await cuentasPropias(admin, d.id, uids)) { hayMigradas = true; continue; }
    const cuentas = [];
    for (const u of uids) cuentas.push(Object.assign({ uid: u }, await describirCuenta(admin, d.id, u, apariciones.get(u))));
    fichas.push({ clientId: d.id, cuentas: cuentas });
  }
  const pares = [];
  fichas.forEach(function (fi) { fi.cuentas.forEach(function (c) { pares.push(fi.clientId + ':' + c.uid); }); });
  pares.sort();
  const distintas = new Set(pares.map(function (p) { return p.slice(p.indexOf(':') + 1); }));
  const huella = pares.length ? require('crypto').createHash('sha256').update('jcg-aislar|' + pares.join('|')).digest('hex').slice(0, 12) : 'ninguna';
  // El uid no sale de aquí: el informe solo lleva huellas.
  fichas.forEach(function (fi) { fi.cuentas.forEach(function (c) { delete c.uid; }); });
  return { fichas: fichas, totalFichas: fichas.length, totalCuentas: distintas.size, huella: huella, permitido: !hayMigradas };
}

function formatSimulacion(sim) {
  const l = ['Simulación de --aislar (solo lee; no se ha cambiado nada).'];
  if (!sim.permitido) l.push('ATENCIÓN: ya hay fichas migradas. --aislar ya no se puede usar (podría quitar el acceso a cuentas buenas creadas desde la app).');
  l.push('Fichas que perderían el acceso de sus cuentas: ' + sim.totalFichas);
  l.push('Cuentas distintas afectadas: ' + sim.totalCuentas + ' (ninguna se borra, desactiva ni reasigna; quedan anotadas en cuentasEnRevision).');
  sim.fichas.forEach(function (fi) {
    l.push('- ' + fi.clientId + ': ' + fi.cuentas.length + ' cuenta(s)');
    fi.cuentas.forEach(function (c) {
      l.push('    · cuenta ' + c.huella + ': ' + (c.existe ? 'existe' : 'no existe') +
        (c.proveedores.length ? ', proveedores ' + c.proveedores.join('+') : '') +
        (c.creada ? ', creada ' + c.creada : '') + (c.ultimoAcceso ? ', último acceso ' + c.ultimoAcceso : '') +
        '; motivos: ' + c.motivos.join(', '));
    });
  });
  l.push('Huella de este conjunto: ' + sim.huella);
  if (sim.totalFichas && sim.permitido) {
    l.push('Para aplicarlo (solo con autorización): --apply --aislar --confirmar-aislar=' + sim.huella);
    l.push('Si algo cambia antes de aplicarlo, la huella no coincidirá y no se aplicará nada.');
  }
  l.push('No se imprimen uids, correos, códigos ni nombres.');
  return l.join(String.fromCharCode(10));
}

async function applyMigration(opciones) {
  const mode = assertApplyAllowed();
  const admin = initAdmin(mode);
  const generar = (opciones && opciones.generar) || id.generateClientCode;
  const aislar = !!(opciones && opciones.aislar);
  const db = admin.firestore();
  const metaRef = db.collection('clients').doc('coach_data');
  const r = { mode: mode, migradas: 0, yaHechas: 0, excluidas: [], revisar: [], errores: [] };
  // --aislar solo en la PRIMERA ejecución: después, las cuentas creadas desde la app (que no llevan la marca)
  // parecerían dudosas y se les quitaría el acceso por error.
  // Además exige la huella de una simulación previa (--simular-aislar): nunca se aísla nada sin que alguien
  // haya visto antes exactamente qué fichas y cuentas se verían afectadas.
  let aislables = null;
  if (aislar) {
    const sim = await simularAislamiento(admin);
    if (!sim.permitido) {
      const err = new Error('--aislar solo se puede usar en la primera ejecución de la migración.');
      err.code = 'AISLAR_SOLO_PRIMERA_VEZ';
      throw err;
    }
    if (!opciones.confirmarAislar || opciones.confirmarAislar !== sim.huella) {
      const err = new Error('--aislar exige --confirmar-aislar con la huella de --simular-aislar, y que nada haya cambiado desde entonces. No se ha aplicado nada.');
      err.code = 'AISLAR_SIN_CONFIRMAR';
      throw err;
    }
    aislables = new Set(sim.fichas.map(function (fi) { return fi.clientId; }));
  }
  const fichas = (await db.collection('clients').get()).docs.filter(function (d) { return d.id !== 'coach_data'; });
  for (const d of fichas) {
    const cid = d.id;
    if (excluida(cid)) { r.excluidas.push(cid); continue; } // ficha de pruebas: ni código ni cuenta ni escritura
    try {
      if (enRevision(d.data())) { r.revisar.push({ clientId: cid, motivo: 'cuentas-aisladas-en-revision' }); continue; }
      const uids0 = uidsDe(d.data());
      if (uids0.length) {
        if (await cuentasPropias(admin, cid, uids0)) { r.yaHechas++; continue; }
        // Identidad dudosa: no se migra. Con --aislar, además se le quita el acceso a esas cuentas moviéndolas a
        // cuentasEnRevision (no se borran, no se desactivan y no se asignan a nadie). Sin --aislar, no se toca.
        if (aislar && aislables.has(cid)) {
          const ref = db.collection('clients').doc(cid);
          const hecho = await db.runTransaction(async function (tx) {
            const snap = await tx.get(ref);
            if (!snap.exists) return false;
            const live = snap.data() || {};
            const uids = uidsDe(live);
            if (!uids.length) return false;
            const previas = Array.isArray(live.cuentasEnRevision) ? live.cuentasEnRevision : [];
            tx.update(ref, Object.assign({
              authUid: admin.firestore.FieldValue.delete(),
              authUids: [],
              cuentasEnRevision: Array.from(new Set(previas.concat(uids)))
            }, sello(live)));
            return true;
          });
          r.revisar.push({ clientId: cid, motivo: hecho ? 'cuentas-no-verificadas-aisladas' : 'ya-tiene-cuentas-no-verificadas' });
          if (hecho) r.aisladas = (r.aisladas || 0) + 1;
        } else {
          r.revisar.push({ clientId: cid, motivo: 'ya-tiene-cuentas-no-verificadas' });
        }
        continue;
      }
      const code = id.normAuthCode(generar());
      if (!id.isStrongCode(code)) throw new Error('codigo-no-aleatorio');
      const email = await id.clientEmailFromCode(code);
      // Una cuenta que ya existe para un código recién generado no se da por buena nunca.
      let existe = null;
      try { existe = await admin.auth().getUserByEmail(email); } catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
      if (existe) { r.revisar.push({ clientId: cid, motivo: 'ya-existia-una-cuenta-para-el-codigo' }); continue; }
      const user = await admin.auth().createUser({ email: email, password: id.clientPasswordFromCode(code) });
      await admin.auth().setCustomUserClaims(user.uid, { [CLAIM]: cid });
      // Vincular en una transacción que vuelve a comprobar la ficha y el meta con lo último del servidor.
      const ref = db.collection('clients').doc(cid);
      const res = await db.runTransaction(async function (tx) {
        const [snap, meta] = await Promise.all([tx.get(ref), tx.get(metaRef)]);
        if (!snap.exists) return 'ficha-borrada';
        const live = snap.data() || {};
        if (uidsDe(live).length || enRevision(live)) return 'cuentas-nuevas-durante-la-migracion';
        const m = meta.exists ? (meta.data() || {}) : {};
        const codes = Object.assign({}, m.codes || {});
        Object.keys(codes).forEach(function (k) { if (codes[k] && codes[k].client === cid) delete codes[k]; });
        if (codes[code]) return 'codigo-repetido';
        codes[code] = { client: cid };
        tx.update(ref, Object.assign({ code: code, authUid: user.uid, authUids: [user.uid] }, sello(live)));
        if (meta.exists) tx.update(metaRef, Object.assign({ codes: codes }, sello(m)));
        else tx.set(metaRef, Object.assign({ codes: codes }, sello(null)));
        return 'ok';
      });
      if (res === 'ok') r.migradas++;
      // La cuenta creada queda sin vincular: no da acceso a nada. No se borra (se revisa a mano).
      else r.revisar.push({ clientId: cid, motivo: res });
    } catch (e) {
      // Un fallo en una ficha no para las demás. Sin la transacción final, la ficha no queda vinculada.
      r.errores.push({ clientId: cid, codigo: codigoError(e) });
    }
  }
  return r;
}

async function main() {
  const backup = argValue('--backup');
  const apply = process.argv.includes('--apply');
  const check = process.argv.includes('--comprobar');
  const simular = process.argv.includes('--simular-aislar');
  if (simular && !apply) {
    const admin = initAdmin(process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : 'production-read');
    console.log(formatSimulacion(await simularAislamiento(admin)));
    return;
  }
  if (!backup && !apply && !check) {
    console.error('Uso: --backup copia.json (ensayo sin red) | --comprobar (solo lee) | --apply');
    process.exit(1);
  }
  if (backup) {
    const plan = await planMigration(JSON.parse(fs.readFileSync(backup, 'utf8')));
    console.log(formatPlan(plan));
    if (!apply && !check) return;
  }
  if (check && !apply) {
    const admin = initAdmin(process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : 'production-read');
    const rows = await comprobar(admin);
    console.log('Estado actual (solo lectura). Código nuevo: ' + rows.filter(x => x.action === 'nuevo-codigo').length +
      '. Ya migradas: ' + rows.filter(x => x.action === 'hecha').length + '. A revisar: ' + rows.filter(x => x.action === 'revisar').length +
      '. Excluidas (pruebas, sin código ni cuenta): ' + rows.filter(x => x.action === 'excluida').length + '.');
    rows.filter(x => x.action === 'revisar').forEach(x => console.log('! ' + x.clientId + ' ' + x.reason));
    return;
  }
  try {
    assertApplyAllowed();
  } catch (e) {
    if (e && e.code === 'APPLY_BLOCKED') {
      console.error('No se ha aplicado nada. --apply contra el proyecto real exige ALLOW_AUTH_MIGRATION_APPLY=yes y una cuenta de servicio (GOOGLE_APPLICATION_CREDENTIALS o FIREBASE_SERVICE_ACCOUNT). No pongas ese JSON en el repositorio.');
      process.exit(2);
    }
    throw e;
  }
  const conf = process.argv.find(function (a) { return a.indexOf('--confirmar-aislar=') === 0; });
  let r;
  try {
    r = await applyMigration({ aislar: process.argv.includes('--aislar'), confirmarAislar: conf ? conf.split('=')[1] : null });
  } catch (e) {
    if (e && (e.code === 'AISLAR_SIN_CONFIRMAR' || e.code === 'AISLAR_SOLO_PRIMERA_VEZ')) { console.error(e.message); process.exit(2); }
    throw e;
  }
  console.log('Aplicado (' + r.mode + '). Fichas con código nuevo: ' + r.migradas + '. Ya migradas antes: ' + r.yaHechas +
    '. Excluidas (pruebas): ' + r.excluidas.length + '. A revisar: ' + r.revisar.length + (r.aisladas ? ' (sin acceso hasta revisarlas: ' + r.aisladas + ')' : '') + '. Con error: ' + r.errores.length + '.');
  r.revisar.forEach(function (x) { console.log('! revisar ' + x.clientId + ' (' + x.motivo + '). No se ha tocado: decide a mano.'); });
  r.errores.forEach(function (x) { console.log('! error ' + x.clientId + ' (' + x.codigo + '). Se puede repetir el comando.'); });
  // Nada de esto se escribe en archivos: la salida es solo la pantalla, sin códigos, correos ni uids.
  console.log('Los códigos nuevos se ven en la app del entrenador («Código de acceso» de cada cliente). No se han impreso.');
  if (r.revisar.length || r.errores.length) process.exitCode = 3;
}

module.exports = {
  planMigration: planMigration,
  formatPlan: formatPlan,
  assertApplyAllowed: assertApplyAllowed,
  applyMigration: applyMigration,
  comprobar: comprobar,
  simularAislamiento: simularAislamiento,
  formatSimulacion: formatSimulacion,
  CLAIM: CLAIM,
  FICHAS_EXCLUIDAS: FICHAS_EXCLUIDAS
};

if (require.main === module) {
  main().catch(function (e) {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
