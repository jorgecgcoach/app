#!/usr/bin/env node
/* Prepara las reglas con el UID real (scripts/preparar-reglas.js) y pasa TODAS las pruebas de reglas en el
   emulador contra esas reglas generadas, no contra las del repositorio. Solo emulador; no despliega nada.
     npm run test:reglas-despliegue */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const { preparar, leerUid } = require('./preparar-reglas');

const ROOT = path.join(__dirname, '..');
let r;
try { r = preparar(leerUid()); }
catch (e) { console.error('No se han preparado las reglas: ' + e.message); process.exit(1); }

const pruebas = ['firestore/uid-entrenador.test.js', 'firestore/exposicion.test.js', 'firestore/catalogo.test.js', 'firestore/storage-rules.test.js',
  'firestore/rules.test.js', 'firestore/campos-cliente.test.js', 'firestore/safe-save-rules.test.js', 'firestore/congelado.test.js', 'firestore/envio-cliente.test.js'];
const firebase = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase');
const res = spawnSync(firebase, ['emulators:exec', '--only', 'firestore,storage', '--project', 'demo-jcg-seguridad', '--config', 'firebase.seguridad.json',
  '"node --test --test-concurrency=1 ' + pruebas.join(' ') + '"'], { cwd: ROOT, stdio: 'inherit', shell: true, env: Object.assign({}, process.env, { REGLAS_DIR: r.salida }) });
process.exit(res.status === null ? 1 : res.status);
