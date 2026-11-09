#!/usr/bin/env node
/* Restauración que NO pisa lo posterior a la copia.
   Por defecto es un simulacro: dice qué añadiría y no escribe nada.
   Con --apply, en una transacción por documento:
     - documento que ya no existe → se recrea tal como estaba en la copia;
     - documento existente → solo se añaden campos y elementos de lista (id/uid/date) que faltan;
     - lo que existe con otro valor se deja como está (el cambio posterior gana); nunca se borra nada;
     - si añade algo, sube _rev para que los dispositivos abiertos recarguen en vez de pisar.
   Para el proyecto real hace falta además ALLOW_RESTORE_APPLY=yes.
     node scripts/restaurar-copia.js copia.json [--solo clients/ID] [--apply] [--proyecto-real] */
const lib = require('./copia-lib');
const { cargar } = require('./verificar-copia');
const { iniciar } = require('./firebase-admin-init');

function arg(nombre) { const i = process.argv.indexOf(nombre); return i < 0 ? null : process.argv[i + 1] || null; }

async function restaurar(db, copia, opciones) {
  opciones = opciones || {};
  const informe = { documentosNuevos: 0, documentosConAñadidos: 0, sinCambios: 0, cambios: [] };
  const v = lib.verificar(copia);
  if (!v.ok) throw new Error('La copia no es válida: ' + v.problemas.join('; '));
  for (const col of Object.keys(copia.colecciones)) {
    for (const id of Object.keys(copia.colecciones[col])) {
      if (opciones.solo && opciones.solo !== col + '/' + id) continue;
      const ref = db.collection(col).doc(id);
      const desdeCopia = lib.sinSync(copia.colecciones[col][id]);
      const r = await db.runTransaction(async function (t) {
        const snap = await t.get(ref);
        const actual = snap.exists ? snap.data() : undefined;
        const f = lib.fusionAditiva(actual === undefined ? undefined : lib.sinSync(actual), desdeCopia);
        if (!f.cambios.length) return { tipo: 'igual', cambios: [] };
        if (opciones.apply) {
          // Sube _rev y conserva las marcas _writers de la nube (ver copia-lib.selloRestauracion).
          const extra = col === 'clients' ? lib.selloRestauracion(actual) : {};
          t.set(ref, Object.assign({}, f.valor, extra));
        }
        return { tipo: snap.exists ? 'añadidos' : 'nuevo', cambios: f.cambios };
      });
      if (r.tipo === 'igual') { informe.sinCambios++; continue; }
      if (r.tipo === 'nuevo') informe.documentosNuevos++; else informe.documentosConAñadidos++;
      r.cambios.forEach(function (c) { informe.cambios.push(col + '/' + id + ' ' + c.tipo + ' ' + c.ruta); });
    }
  }
  return informe;
}

async function main() {
  const ruta = process.argv[2];
  if (!ruta || ruta.startsWith('--')) { console.error('Uso: node scripts/restaurar-copia.js copia.json [--solo clients/ID] [--apply] [--proyecto-real]'); process.exit(1); }
  const apply = process.argv.includes('--apply');
  const { admin, modo } = iniciar({ escribe: apply });
  if (apply && modo === 'real' && process.env.ALLOW_RESTORE_APPLY !== 'yes') {
    console.error('No se ha escrito nada. Escribir en el proyecto real exige ALLOW_RESTORE_APPLY=yes.'); process.exit(2);
  }
  const { copia } = cargar(ruta);
  const inf = await restaurar(admin.firestore(), copia, { apply, solo: arg('--solo') });
  console.log((apply ? 'APLICADO' : 'SIMULACRO (no se ha escrito nada)') + ' en ' + modo + '.');
  console.log('Documentos recreados: ' + inf.documentosNuevos + '. Con datos añadidos: ' + inf.documentosConAñadidos + '. Sin cambios: ' + inf.sinCambios + '.');
  // Solo rutas de campos (p. ej. clients/ID campo blocks[id]); nunca valores.
  inf.cambios.slice(0, 200).forEach(function (c) { console.log('  + ' + c); });
  if (inf.cambios.length > 200) console.log('  … y ' + (inf.cambios.length - 200) + ' más');
}

module.exports = { restaurar };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(e && e.code === 'SIN_PERMISO' ? 2 : 1); });
