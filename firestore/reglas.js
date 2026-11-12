/* Reglas que usan las pruebas.
   - Por defecto, las del repositorio (con el marcador REEMPLAZAR_UID_DEL_COACH: el UID real nunca va a git).
   - Con REGLAS_DIR (lo pone scripts/probar-reglas-despliegue.js), las generadas para desplegar con el UID
     real, que viven en una carpeta ignorada por git. Así se prueba EXACTAMENTE lo que se desplegaría. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARCADOR = 'REEMPLAZAR_UID_DEL_COACH';
// Todas las reglas que llevan el UID del entrenador (las que genera scripts/preparar-reglas.js).
const ARCHIVOS_REGLAS = ['firestore.rules', 'firestore.transicion.rules', 'firestore.congelado.rules', 'storage.rules'];

function dir() { return process.env.REGLAS_DIR || ROOT; }
function leer(nombre) { return fs.readFileSync(path.join(dir(), nombre), 'utf8'); }
function generadas() { return !!process.env.REGLAS_DIR; }
// UID del entrenador escrito en unas reglas («request.auth.uid == '...'»). Debe haber exactamente uno.
function uidEntrenador(texto) {
  const m = texto.match(/request\.auth\.uid == '([^']+)'/g) || [];
  if (m.length !== 1) throw new Error('Se esperaba un único UID de entrenador en las reglas y hay ' + m.length);
  return m[0].replace(/^request\.auth\.uid == '|'$/g, '');
}
module.exports = { leer, generadas, uidEntrenador, MARCADOR, ROOT, ARCHIVOS_REGLAS };
