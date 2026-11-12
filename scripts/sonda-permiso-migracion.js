#!/usr/bin/env node
/* Sonda del permiso temporal de F5 (SOLO LEE; no crea, cambia ni borra nada).
   Actúa como firestore-recuperador (suplantación con tus credenciales de usuario, sin claves) y pregunta a Google:
     1) testIamPermissions: qué permisos de Authentication tiene AHORA esa cuenta;
     2) una llamada REAL de solo lectura (buscar una cuenta inexistente): «PERMITIDO» o «DENEGADO».
   Así se comprueba de verdad, y no solo en papel, que el permiso funciona mientras dura, que deja de
   funcionar al caducar la condición de IAM y que deja de funcionar al retirarlo a mano.
   Uso: node scripts/sonda-permiso-migracion.js
   Sale con 0 si la llamada real está PERMITIDA y con 3 si está DENEGADA. No imprime datos de nadie. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROYECTO = 'appjorgecgcoach';
const SA = 'firestore-recuperador@appjorgecgcoach.iam.gserviceaccount.com';
const PERMISOS = ['firebaseauth.users.get', 'firebaseauth.users.create', 'firebaseauth.users.update', 'firebaseauth.users.delete', 'firebaseauth.configs.update'];
const NO_DEBE = ['firebaseauth.users.delete', 'firebaseauth.configs.update'];

function adcPorDefecto() {
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json')
    : path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

(async () => {
  const adc = JSON.parse(fs.readFileSync(adcPorDefecto(), 'utf8'));
  const origen = adc.type === 'impersonated_service_account' ? adc.source_credentials : adc;
  if (!origen || origen.type !== 'authorized_user') throw new Error('Las credenciales por defecto no son de un usuario.');
  const { Impersonated, UserRefreshClient } = require('google-auth-library');
  const fuente = new UserRefreshClient(origen.client_id, origen.client_secret, origen.refresh_token);
  const cliente = new Impersonated({ sourceClient: fuente, targetPrincipal: SA, lifetime: 600, delegates: [], targetScopes: ['https://www.googleapis.com/auth/cloud-platform'] });

  const t = await cliente.request({ url: 'https://cloudresourcemanager.googleapis.com/v1/projects/' + PROYECTO + ':testIamPermissions', method: 'POST', data: { permissions: PERMISOS } });
  const tiene = (t.data && t.data.permissions) || [];
  let real;
  try {
    await cliente.request({ url: 'https://identitytoolkit.googleapis.com/v1/projects/' + PROYECTO + '/accounts:lookup', method: 'POST', data: { email: ['sonda-inexistente@clients.appjorgecgcoach.app'] } });
    real = 'PERMITIDO';
  } catch (e) {
    const st = e && e.response && e.response.status;
    const msg = String((e && e.response && e.response.data && e.response.data.error && e.response.data.error.message) || '');
    // Identity Toolkit responde la falta de permiso con 403 PERMISSION_DENIED o con 400 INSUFFICIENT_PERMISSION.
    if (st === 403 || (st === 400 && /INSUFFICIENT_PERMISSION|PERMISSION_DENIED/.test(msg))) real = 'DENEGADO';
    else throw new Error('Respuesta inesperada de Google (' + (st || '') + ') ' + JSON.stringify((e && e.response && e.response.data && e.response.data.error && e.response.data.error.message) || (e && e.message)));
  }
  const peligrosos = NO_DEBE.filter(p => tiene.includes(p));
  console.log(new Date().toISOString() + ' · firestore-recuperador · permisos de Authentication: ' + (tiene.length ? tiene.join(', ') : 'ninguno') +
    ' · llamada real de solo lectura: ' + real + (peligrosos.length ? ' · ¡AVISO! tiene ' + peligrosos.join(', ') : ''));
  process.exitCode = real === 'PERMITIDO' ? 0 : 3;
})().catch(e => { console.error('✖ ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
