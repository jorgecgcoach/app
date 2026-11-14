#!/usr/bin/env node
/* Comprueba (SOLO LECTURA) que cada cuenta vinculada a una ficha (authUid / authUids) es la cuenta de uno de
   los códigos que valen hoy para esa ficha. Mientras las reglas de producción siguen abiertas, cualquiera
   podría escribir en una ficha el uid de una cuenta suya; con las reglas cerradas conservaría el acceso.
   Este informe lo detecta. Se ejecuta después de crear las cuentas (F2) y justo después de cerrar las
   reglas (F4). No imprime códigos, nombres, correos ni uids: solo ids de ficha y el tipo de problema.

     Emulador: FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST definidos.
     Proyecto real: node scripts/verificar-vinculos.js --proyecto-real  (con GOOGLE_APPLICATION_CREDENTIALS)
   Sale con código 0 si todo cuadra y 4 si hay vínculos que no corresponden. */
'use strict';
const id = require('../auth/code-identity');

async function verificarVinculos(admin) {
  const db = admin.firestore();
  const snap = await db.collection('clients').get();
  const metaDoc = snap.docs.find(d => d.id === 'coach_data');
  const codes = (metaDoc && metaDoc.data().codes) || {};
  const problemas = [];
  let fichas = 0, vinculadas = 0, cuentas = 0;
  for (const d of snap.docs) {
    const c = d.data() || {};
    const uids = [c.authUid].concat(Array.isArray(c.authUids) ? c.authUids : []).filter(Boolean);
    if (d.id === 'coach_data') { if (uids.length) problemas.push({ ficha: d.id, tipo: 'coach_data-con-cuenta' }); continue; }
    fichas++;
    if (!uids.length) continue;
    vinculadas++;
    if (c.authUids && c.authUid && c.authUids.indexOf(c.authUid) < 0) problemas.push({ ficha: d.id, tipo: 'authUid-fuera-de-authUids' });
    const validos = new Set();
    Object.keys(codes).forEach(k => { if (codes[k] && codes[k].client === d.id) validos.add(id.normAuthCode(k)); });
    if (c.code) validos.add(id.normAuthCode(c.code));
    const correos = new Set();
    for (const code of validos) if (code.length >= 3) correos.add((await id.clientEmailFromCode(code)).toLowerCase());
    for (const uid of new Set(uids)) {
      cuentas++;
      let u = null;
      try { u = await admin.auth().getUser(uid); } catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
      if (!u) { problemas.push({ ficha: d.id, tipo: 'cuenta-inexistente' }); continue; }
      if (u.disabled) problemas.push({ ficha: d.id, tipo: 'cuenta-desactivada' });
      if (!u.email || !correos.has(u.email.toLowerCase())) { problemas.push({ ficha: d.id, tipo: 'cuenta-que-no-es-de-sus-codigos' }); continue; }
      if ((u.providerData || []).some(p => p.providerId !== 'password')) problemas.push({ ficha: d.id, tipo: 'cuenta-con-otro-proveedor' });
    }
  }
  return { fichas, vinculadas, cuentas, problemas };
}

/* Cuentas de cliente (correo del dominio de códigos) que no están vinculadas a ninguna ficha. Las deja, p. ej.,
   una migración interrumpida entre crear la cuenta y vincularla: no dan acceso a nada (las reglas exigen el
   vínculo y nadie conoce su código), pero conviene contarlas. Solo lee; no borra ni cambia nada.
   Necesita poder listar cuentas (en el proyecto real, mientras dura el permiso temporal de F5). */
async function cuentasSinVincular(admin) {
  const snap = await admin.firestore().collection('clients').get();
  const vinculadas = new Set();
  snap.docs.forEach(d => {
    const c = d.data() || {};
    [c.authUid].concat(Array.isArray(c.authUids) ? c.authUids : [], Array.isArray(c.cuentasEnRevision) ? c.cuentasEnRevision : [])
      .filter(Boolean).forEach(u => vinculadas.add(u));
  });
  const dominio = '@' + id.DOMAIN;
  let total = 0, sinVincular = 0, token;
  do {
    const pag = await admin.auth().listUsers(1000, token);
    for (const u of pag.users) {
      if (!u.email || !u.email.toLowerCase().endsWith(dominio)) continue;
      total++;
      if (!vinculadas.has(u.uid)) sinVincular++;
    }
    token = pag.pageToken;
  } while (token);
  return { cuentasDeCliente: total, sinVincular };
}

async function main() {
  const admin = require('firebase-admin');
  const emulador = !!(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
  if (!emulador && !process.argv.includes('--proyecto-real')) {
    console.error('Sin emuladores hace falta --proyecto-real (solo lee).'); process.exit(1);
  }
  admin.initializeApp(emulador ? { projectId: process.env.GCLOUD_PROJECT || 'demo-appjorgecgcoach' } : { credential: admin.credential.applicationDefault(), projectId: 'appjorgecgcoach' });
  const r = await verificarVinculos(admin);
  console.log('Fichas: ' + r.fichas + '. Con cuenta: ' + r.vinculadas + '. Cuentas vinculadas: ' + r.cuentas + '. Problemas: ' + r.problemas.length + '.');
  r.problemas.forEach(p => console.log('! ' + p.ficha + ' ' + p.tipo));
  if (process.argv.includes('--sin-vincular')) {
    const s = await cuentasSinVincular(admin);
    console.log('Cuentas de cliente: ' + s.cuentasDeCliente + '. Sin vincular a ninguna ficha (no dan acceso): ' + s.sinVincular + '.');
  }
  if (r.problemas.length) {
    console.log('Quita esos vínculos (el entrenador vuelve a guardar el código de esa ficha) antes de dar el cambio por bueno.');
    process.exit(4);
  }
}

module.exports = { verificarVinculos, cuentasSinVincular };
if (require.main === module) main().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
