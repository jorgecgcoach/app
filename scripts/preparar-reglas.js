#!/usr/bin/env node
/* Genera las reglas LISTAS PARA DESPLEGAR con el UID real del entrenador, sin que el UID entre en git
   (el repositorio es público). No despliega nada ni se conecta a Firebase.

   El UID se lee de config/uid-entrenador.txt (ignorado por git) o de --uid.
   Escribe en reglas-despliegue/ (ignorada por git):
     firestore.rules, firestore.transicion.rules, firestore.congelado.rules, storage.rules   con el UID
     firebase.json             reglas estrictas de Firestore y Storage (firebase deploy --config reglas-despliegue/firebase.json)
     firebase.transicion.json  SOLO Firestore, reglas de transición
     firebase.congelado.json     SOLO Firestore, parada de emergencia: clientes solo lectura, entrenador todo
     huellas.txt          sha256 de cada archivo, para comprobar que lo desplegado es lo probado
   Se niega si el UID no tiene el formato de Firebase, si falta el marcador en el origen o si queda en el destino.

     node scripts/preparar-reglas.js            (o: npm run reglas:preparar)
   Solo muestra el UID abreviado. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MARCADOR = 'REEMPLAZAR_UID_DEL_COACH';
const ARCHIVOS = require('../firestore/reglas').ARCHIVOS_REGLAS;
const SALIDA = path.join(ROOT, 'reglas-despliegue');
const ARCHIVO_UID = path.join(ROOT, 'config', 'uid-entrenador.txt');

function abreviar(uid) { return uid.slice(0, 4) + '…' + uid.slice(-4); }

function leerUid() {
  const i = process.argv.indexOf('--uid');
  let uid = i >= 0 ? process.argv[i + 1] : null;
  if (!uid) {
    if (!fs.existsSync(ARCHIVO_UID)) throw new Error('Falta config/uid-entrenador.txt (una línea con el UID del entrenador).');
    uid = fs.readFileSync(ARCHIVO_UID, 'utf8');
  }
  uid = String(uid).trim();
  // UID de Firebase Auth: 28 caracteres alfanuméricos (cuentas de Google y de correo).
  if (!/^[A-Za-z0-9]{28}$/.test(uid)) throw new Error('El UID no tiene el formato de Firebase (28 letras y números).');
  if (uid === MARCADOR) throw new Error('El UID es el marcador de ejemplo.');
  return uid;
}

function preparar(uid, salida) {
  salida = salida || SALIDA;
  fs.mkdirSync(salida, { recursive: true });
  const huellas = [];
  for (const nombre of ARCHIVOS) {
    const origen = fs.readFileSync(path.join(ROOT, nombre), 'utf8');
    const veces = origen.split("'" + MARCADOR + "'").length - 1;
    if (veces !== 1) throw new Error(nombre + ': se esperaba el marcador exactamente una vez y aparece ' + veces);
    const final = origen.replace("'" + MARCADOR + "'", "'" + uid + "'");
    if (final.includes(MARCADOR)) throw new Error(nombre + ': sigue apareciendo el marcador');
    if (final.split("'" + uid + "'").length - 1 !== 1) throw new Error(nombre + ': el UID no aparece exactamente una vez');
    fs.writeFileSync(path.join(salida, nombre), final);
    huellas.push(crypto.createHash('sha256').update(final).digest('hex') + '  ' + nombre);
  }
  const config = {
    _comentario: 'Generado por scripts/preparar-reglas.js. Despliega SOLO reglas. No editar a mano.',
    firestore: { rules: 'firestore.rules' },
    storage: { rules: 'storage.rules' }
  };
  fs.writeFileSync(path.join(salida, 'firebase.json'), JSON.stringify(config, null, 2) + '\n');
  for (const [nombre, reglas] of [['firebase.transicion.json', 'firestore.transicion.rules'], ['firebase.congelado.json', 'firestore.congelado.rules']]) {
    fs.writeFileSync(path.join(salida, nombre), JSON.stringify({ firestore: { rules: reglas } }, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(salida, 'huellas.txt'), huellas.join('\n') + '\n');
  return { salida, huellas };
}

// Opción C: el UID del entrenador para la función altaCliente, en functions/.env.appjorgecgcoach (ignorado por
// git). Firebase lo carga al desplegar las funciones. Preparar no despliega nada.
function prepararFunciones(uid, dir) {
  dir = dir || path.join(ROOT, 'functions');
  const archivo = path.join(dir, '.env.appjorgecgcoach');
  fs.writeFileSync(archivo, 'COACH_UID=' + uid + '\n');
  return archivo;
}

if (require.main === module) {
  try {
    const uid = leerUid();
    const r = preparar(uid);
    console.log('Reglas preparadas con el UID ' + abreviar(uid) + ' en ' + path.relative(ROOT, r.salida) + path.sep);
    r.huellas.forEach(function (h) { console.log('  ' + h); });
    console.log('Configuración de las funciones (sin desplegar): ' + path.relative(ROOT, prepararFunciones(uid)));
    console.log('No se ha desplegado nada.');
  } catch (e) { console.error('No se han preparado las reglas: ' + e.message); process.exit(1); }
}
module.exports = { preparar, prepararFunciones, leerUid, MARCADOR, ARCHIVOS };
