#!/usr/bin/env node
/* Copia de seguridad COMPLETA de Firestore, SOLO LECTURA.
   Descarga clients (fichas + coach_data), contacts y catalog con sus _rev, y guarda un archivo
   con huellas por documento. No escribe nada en Firebase.

   Uso (lo ejecuta Jorge, no un agente):
     set GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\fuera\del\repo\cuenta.json
     node scripts/copia-firestore.js --proyecto-real --salida C:\Copias\firestore-AAAA-MM-DD.json
   El archivo contiene datos personales y el PIN: guárdalo fuera del repositorio. */
const fs = require('fs');
const path = require('path');
const lib = require('./copia-lib');
const { iniciar } = require('./firebase-admin-init');

// Colecciones que usa la app. Además se descubren TODAS las de la raíz: si mañana aparece otra,
// entra en la copia sin tener que acordarse de tocar este archivo.
const COLECCIONES = ['clients', 'contacts', 'catalog'];

async function descargar(db, informe) {
  const nombres = new Set(COLECCIONES);
  if (typeof db.listCollections === 'function') (await db.listCollections()).forEach(function (c) { nombres.add(c.id); });
  const colecciones = {};
  const subcolecciones = [];
  for (const col of Array.from(nombres).sort()) {
    const snap = await db.collection(col).get();
    colecciones[col] = {};
    for (const d of snap.docs) {
      colecciones[col][d.id] = d.data();
      // La app no usa subcolecciones. Si alguna aparece, se avisa: esta copia no la incluiría.
      if (typeof d.ref.listCollections === 'function') {
        (await d.ref.listCollections()).forEach(function (sc) { subcolecciones.push(col + '/' + d.id + '/' + sc.id); });
      }
    }
  }
  if (informe) informe.subcolecciones = subcolecciones;
  // La app no guarda Timestamps; si apareciera alguno se guardaría como JSON plano.
  return JSON.parse(JSON.stringify(colecciones));
}

function arg(nombre) { const i = process.argv.indexOf(nombre); return i < 0 ? null : process.argv[i + 1] || null; }

async function main() {
  const salida = arg('--salida');
  if (!salida) { console.error('Uso: node scripts/copia-firestore.js [--proyecto-real] --salida archivo.json'); process.exit(1); }
  const abs = path.resolve(salida);
  if (abs.startsWith(path.resolve(__dirname, '..') + path.sep)) {
    console.error('Guarda la copia FUERA del repositorio (contiene datos personales).'); process.exit(1);
  }
  const { admin, modo } = iniciar({ escribe: false });
  const inf = {};
  const copia = lib.construirCopia(await descargar(admin.firestore(), inf));
  fs.writeFileSync(abs, JSON.stringify(copia));
  const v = lib.verificar(JSON.parse(fs.readFileSync(abs, 'utf8')));
  console.log('Copia (' + modo + ') guardada. Verificación: ' + (v.ok ? 'OK' : 'CON PROBLEMAS'));
  console.log(JSON.stringify(v.resumen, null, 2));
  v.problemas.concat(v.avisos || []).forEach(function (p) { console.log('! ' + p); });
  if (inf.subcolecciones.length) { console.log('✖ Hay ' + inf.subcolecciones.length + ' subcolección(es) que esta copia NO incluye. Avisa antes de seguir.'); process.exit(3); }
  if (!v.ok) process.exit(3);
}

module.exports = { descargar, COLECCIONES };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(e && e.code === 'SIN_PERMISO' ? 2 : 1); });
