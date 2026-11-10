#!/usr/bin/env node
/* Crea las cuentas sintéticas de los clientes a partir de una copia de seguridad.
   Por defecto solo hace dry-run: no llama a Firebase y no imprime códigos,
   nombres, DNIs ni contraseñas.
   No ejecutar contra producción desde un agente. El dueño lo lanza, si quiere,
   siguiendo docs/firestore-auth.md. */
const fs = require('fs');
const id = require('../auth/code-identity');

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] || null;
}

function collectCodes(dump) {
  const codes = (dump.meta && dump.meta.codes) || {};
  const clients = (dump.clients && typeof dump.clients === 'object') ? dump.clients : {};
  const byClient = {};
  function add(cid, raw) {
    if (!cid) return;
    const n = id.normAuthCode(raw);
    if (!n) return;
    if (!byClient[cid]) byClient[cid] = [];
    if (byClient[cid].indexOf(n) < 0) byClient[cid].push(n);
  }
  Object.keys(codes).forEach(function (code) {
    const info = codes[code];
    add(info && info.client, code);
  });
  Object.keys(clients).forEach(function (cid) {
    const c = clients[cid];
    if (c && c.code) add(cid, c.code);
  });
  return { clients: clients, byClient: byClient };
}

async function planMigration(dump) {
  if (!dump || typeof dump !== 'object' || !dump.clients || typeof dump.clients !== 'object') {
    throw new Error('Esa copia no tiene clientes.');
  }
  const collected = collectCodes(dump);
  const seenEmail = new Map();
  const rows = [];
  const warnings = [];
  let withoutCode = 0;
  const ids = Object.keys(collected.clients);
  for (const cid of ids) {
    const list = collected.byClient[cid] || [];
    if (!list.length) {
      withoutCode++;
      continue;
    }
    // Cada código que hoy funciona tendrá su cuenta: ningún cliente deja de poder entrar.
    if (list.length > 1) warnings.push({ clientId: cid, kind: 'varios-codigos (' + list.length + ', todos seguirán valiendo)' });
    for (let k = 0; k < list.length; k++) {
      const code = list[k];
      if (code.length < 3) {
        warnings.push({ clientId: cid, kind: 'demasiado-corto' });
        rows.push({ clientId: cid, codeIndex: k, codeLength: code.length, dniLike: false, action: 'skip', reason: 'demasiado-corto' });
        continue;
      }
      const email = await id.clientEmailFromCode(code);
      let action = 'create';
      let reason = '';
      if (seenEmail.has(email) && seenEmail.get(email) !== cid) {
        action = 'skip';
        reason = 'codigo-duplicado';
        warnings.push({ clientId: cid, kind: 'codigo-duplicado (lo usa también otra ficha)' });
      } else {
        seenEmail.set(email, cid);
      }
      rows.push({
        clientId: cid,
        codeIndex: k,
        codeLength: code.length,
        dniLike: id.looksLikeBareDni(code),
        action: action,
        reason: reason
      });
    }
  }
  Object.keys(collected.byClient).forEach(function (cid) {
    if (!collected.clients[cid]) warnings.push({ clientId: cid, kind: 'codigo-sin-ficha' });
  });
  return {
    totalClients: ids.length,
    withCode: ids.length - withoutCode,
    withoutCode: withoutCode,
    ignoredCoachSecret: !!(dump.meta && dump.meta.coachCode),
    rows: rows,
    warnings: warnings
  };
}

function formatPlan(plan) {
  const createN = plan.rows.filter(function (r) { return r.action === 'create'; }).length;
  const dniN = plan.rows.filter(function (r) { return r.dniLike && r.action === 'create'; }).length;
  const lines = [];
  lines.push('Migración de cuentas de cliente (dry-run). No se ha escrito nada.');
  lines.push('Clientes en la copia: ' + plan.totalClients);
  lines.push('Con código: ' + plan.withCode);
  lines.push('Sin código (no se crea cuenta): ' + plan.withoutCode);
  lines.push('Cuentas que se crearían: ' + createN);
  lines.push('Códigos que parecen un documento de identidad sin sufijo: ' + dniN + '. Se pueden dejar. Un sufijo opcional (por ejemplo -7K) los hace más difíciles de probar.');
  if (plan.ignoredCoachSecret) lines.push('La copia trae el código del entrenador. No se migra y no se imprime.');
  lines.push('No se imprimen códigos, nombres ni contraseñas.');
  plan.rows.forEach(function (r) {
    lines.push('- ' + r.clientId + ' longitud=' + r.codeLength + (r.dniLike ? ' dni-sin-sufijo' : '') + ' accion=' + r.action + (r.reason ? ' (' + r.reason + ')' : ''));
  });
  plan.warnings.forEach(function (w) {
    lines.push('! ' + w.clientId + ' ' + w.kind);
  });
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
    admin.initializeApp({ projectId: 'demo-appjorgecgcoach' });
    return admin;
  }
  const projectId = 'appjorgecgcoach';
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credential = admin.credential.applicationDefault();
  } else {
    throw new Error('Falta la cuenta de servicio. No la guardes en el repositorio.');
  }
  admin.initializeApp({ credential: credential, projectId: projectId });
  return admin;
}

async function applyMigration(dump) {
  const mode = assertApplyAllowed();
  const admin = initAdmin(mode);
  const collected = collectCodes(dump);
  let created = 0;
  let existed = 0;
  let linked = 0;
  let skipped = 0;
  const seenEmail = new Map();
  const unlinked = [];
  let missing = 0;
  let codeChanged = 0;
  for (const cid of Object.keys(collected.clients)) {
    if (cid === 'coach_data') { skipped++; continue; } // el meta del entrenador nunca lleva dueño
    const list = (collected.byClient[cid] || []).filter(function (c) { return c.length >= 3; });
    if (!list.length) {
      skipped++;
      continue;
    }
    const uids = [];
    for (const code of list) {
      const email = await id.clientEmailFromCode(code);
      if (seenEmail.has(email) && seenEmail.get(email) !== cid) {
        skipped++;
        continue;
      }
      seenEmail.set(email, cid);
      const password = id.clientPasswordFromCode(code);
      let user;
      try {
        user = await admin.auth().createUser({ email: email, password: password });
        created++;
      } catch (e) {
        if (e && e.code === 'auth/email-already-exists') {
          user = await admin.auth().getUserByEmail(email);
          existed++;
        } else {
          throw e;
        }
      }
      if (uids.indexOf(user.uid) < 0) uids.push(user.uid);
    }
    if (!uids.length) continue;
    // Se decide con la ficha ACTUAL de Firestore (no con la de la copia), dentro de una transacción:
    // - si la ficha se borró después de la copia, no se vuelve a crear;
    // - si el entrenador ya le dio otro código con Auth (otro authUid), no se toca;
    // - si la ficha tiene ahora un código que no está en la copia, no se vincula a la cuenta del viejo.
    const ref = admin.firestore().collection('clients').doc(cid);
    const res = await admin.firestore().runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'missing';
      const live = snap.data() || {};
      const liveCode = live.code ? id.normAuthCode(live.code) : '';
      if (liveCode && list.indexOf(liveCode) < 0) return 'code-changed';
      const liveUid = live.authUid || null;
      if (liveUid && uids.indexOf(liveUid) < 0) return 'unlinked';
      // Solo se añaden estos campos; el resto de la ficha no se toca.
      const patch = { authUid: liveUid || uids[0] };
      const all = (Array.isArray(live.authUids) ? live.authUids.slice() : []);
      uids.forEach(function (u) { if (all.indexOf(u) < 0) all.push(u); });
      if (all.length > 1) patch.authUids = all;
      tx.update(ref, patch);
      return 'linked';
    });
    if (res === 'linked') linked++;
    else {
      skipped++;
      if (res === 'missing') missing++;
      else if (res === 'code-changed') codeChanged++;
      else unlinked.push(cid);
    }
  }
  return { mode: mode, created: created, existed: existed, linked: linked, skipped: skipped, unlinked: unlinked.length, missing: missing, codeChanged: codeChanged };
}

async function main() {
  const backup = argValue('--backup');
  const apply = process.argv.includes('--apply');
  if (!backup) {
    console.error('Uso: node scripts/migrate-client-auth.js --backup copia.json');
    console.error('Sin --apply solo imprime el plan. No contacta con Firebase.');
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(backup, 'utf8'));
  const plan = await planMigration(dump);
  console.log(formatPlan(plan));
  if (!apply) return;
  try {
    assertApplyAllowed();
  } catch (e) {
    if (e && e.code === 'APPLY_BLOCKED') {
      console.error('No se ha aplicado nada. --apply contra el proyecto real exige ALLOW_AUTH_MIGRATION_APPLY=yes y la cuenta de servicio que ya usa el aviso diario (GOOGLE_APPLICATION_CREDENTIALS o FIREBASE_SERVICE_ACCOUNT). No pongas ese JSON en el repositorio.');
      process.exit(2);
    }
    throw e;
  }
  const result = await applyMigration(dump);
  console.log('Aplicado (' + result.mode + '). Creadas: ' + result.created + '. Ya existían: ' + result.existed + '. Fichas con authUid: ' + result.linked + '. Omitidas: ' + result.skipped +
    ' (ficha borrada después de la copia: ' + result.missing + '; código cambiado después de la copia: ' + result.codeChanged + '; ya vinculada a otra cuenta: ' + result.unlinked + ').');
  if (result.missing || result.codeChanged || result.unlinked) console.log('Revisa esas fichas en la app: no se ha tocado nada en ellas. Si hace falta, guarda otra vez su código en «Código de acceso».');
}

module.exports = {
  planMigration: planMigration,
  formatPlan: formatPlan,
  assertApplyAllowed: assertApplyAllowed,
  applyMigration: applyMigration
};

if (require.main === module) {
  main().catch(function (e) {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
