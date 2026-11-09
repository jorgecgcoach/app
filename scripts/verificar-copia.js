#!/usr/bin/env node
/* Comprueba una copia SIN conectarse a nada: estructura, huellas y conteos.
   Acepta la copia de copia-firestore.js y la de la app («Descargar copia»).
   No imprime nombres, códigos ni PIN.
     node scripts/verificar-copia.js C:\Copias\firestore-AAAA-MM-DD.json */
const fs = require('fs');
const lib = require('./copia-lib');

function cargar(ruta) {
  const d = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (d && d._type === 'jcgcoach_backup') return { copia: lib.construirCopia(lib.desdeCopiaApp(d), d.exportedAt), origen: 'app' + (d._v === 2 ? '' : ' (formato antiguo: sin plantillas ni negocio)') };
  return { copia: d, origen: 'firestore' };
}

function main() {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node scripts/verificar-copia.js copia.json'); process.exit(1); }
  const { copia, origen } = cargar(ruta);
  const v = lib.verificar(copia);
  const horas = copia.exportedAt ? Math.round((Date.now() - Date.parse(copia.exportedAt)) / 36e5) : null;
  console.log('Origen: ' + origen + '. Hecha hace ' + (horas === null ? '?' : horas) + ' h.');
  console.log(JSON.stringify(v.resumen, null, 2));
  v.problemas.forEach(function (p) { console.log('✖ ' + p); });
  (v.avisos || []).forEach(function (p) { console.log('! ' + p); });
  console.log(v.ok ? 'Copia íntegra.' : 'Copia NO válida.');
  process.exit(v.ok ? 0 : 3);
}

module.exports = { cargar };
if (require.main === module) main();
