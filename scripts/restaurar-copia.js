#!/usr/bin/env node
/* Restauración que NO pisa lo posterior a la copia (shared/copia-aditiva.js).

   1) SIMULACRO (por defecto): lista CADA cosa que se añadiría, con su identificador
        coleccion/documento|ruta      p. ej.  clients/ID|blocks[id:b3]   clients/ID|menus
      y una HUELLA del plan. No escribe nada.
   2) Revisa la lista. Lo que se borró A PROPÓSITO después de la copia se excluye con --excluir
      (documento entero «clients/ID», o una parte «clients/ID|blocks[id:b3]»; se puede repetir, o poner
      una por línea en un archivo con --excluir-archivo).
   3) APLICAR: --apply --plan HUELLA. Solo se aplica si el plan sigue siendo EXACTAMENTE el revisado
      (mismas exclusiones y la nube sin cambios en lo que afecta). Si no coincide, no escribe nada.
      Además, en cada documento se vuelve a calcular dentro de la transacción: si la nube cambió entre
      medias, ese documento NO se toca y se informa.
   Para el proyecto real hace falta además ALLOW_RESTORE_APPLY=yes.

     node scripts/restaurar-copia.js copia.json [--solo clients/ID] [--excluir X]... [--excluir-archivo f.txt]
                                     [--apply --plan HUELLA] [--proyecto-real]
   Nunca imprime valores: solo identificadores y rutas. */
const fs = require('fs');
const lib = require('./copia-lib');
const aditiva = require('../shared/copia-aditiva');
const { cargar } = require('./verificar-copia');
const { iniciar } = require('./firebase-admin-init');

function args(nombre) { const out = []; process.argv.forEach(function (a, i) { if (a === nombre && process.argv[i + 1]) out.push(process.argv[i + 1]); }); return out; }
function arg(nombre) { return args(nombre)[0] || null; }

async function leerActuales(db, col, ids) {
  const out = {};
  for (const id of ids) { const s = await db.collection(col).doc(id).get(); out[id] = s.exists ? s.data() : undefined; }
  return out;
}

/* Plan de toda la copia contra lo que hay ahora en la nube. */
async function planificar(db, copia, opciones) {
  opciones = opciones || {};
  const v = lib.verificar(copia);
  if (!v.ok) throw new Error('La copia no es válida: ' + v.problemas.join('; '));
  const planes = [];
  for (const col of Object.keys(copia.colecciones).sort()) {
    const docsCopia = {};
    Object.keys(copia.colecciones[col]).forEach(function (id) {
      if (opciones.solo && opciones.solo !== col + '/' + id) return;
      docsCopia[id] = copia.colecciones[col][id];
    });
    const actuales = await leerActuales(db, col, Object.keys(docsCopia));
    planes.push(aditiva.planificar(col, actuales, docsCopia, opciones.excluir));
  }
  const ids = [].concat.apply([], planes.map(function (p) { return p.ids; }));
  return { planes, ids, huella: aditiva.huellaPlan(ids) };
}

async function restaurar(db, copia, opciones) {
  opciones = opciones || {};
  const plan = await planificar(db, copia, opciones);
  const informe = { huella: plan.huella, documentosNuevos: 0, documentosConAñadidos: 0, sinCambios: 0, cambios: [], noAplicados: [], aplicado: false };
  plan.planes.forEach(function (p) {
    p.docs.forEach(function (d) {
      if (d.nuevo) informe.documentosNuevos++; else informe.documentosConAñadidos++;
      d.cambios.forEach(function (c) { informe.cambios.push(c.id + '  (' + c.tipo + ')'); });
    });
  });
  if (!opciones.apply) return informe;
  if (opciones.plan !== undefined && opciones.plan !== plan.huella) {
    const e = new Error('El plan ya no es el revisado (huella ' + plan.huella + ', se esperaba ' + opciones.plan + '). No se ha escrito nada: repite el simulacro.');
    e.code = 'PLAN_DISTINTO';
    throw e;
  }
  for (const p of plan.planes) {
    for (const d of p.docs) {
      const ref = db.collection(p.col).doc(d.id);
      const esperado = d.cambios.map(function (c) { return c.id; }).sort().join('\n');
      const r = await db.runTransaction(async function (t) {
        const snap = await t.get(ref);
        const actual = snap.exists ? snap.data() : undefined;
        const rehecho = aditiva.planificar(p.col, { [d.id]: actual }, { [d.id]: copia.colecciones[p.col][d.id] }, opciones.excluir);
        const doc = rehecho.docs[0];
        const ahora = doc ? doc.cambios.map(function (c) { return c.id; }).sort().join('\n') : '';
        if (ahora !== esperado) return { ok: false };                       // la nube cambió: no se toca
        const extra = p.col === 'clients' ? lib.selloRestauracion(actual) : {};
        t.set(ref, Object.assign({}, doc.valor, extra));
        return { ok: true };
      });
      if (!r.ok) informe.noAplicados.push(p.col + '/' + d.id);
    }
  }
  informe.aplicado = true;
  return informe;
}

function leerExclusiones() {
  const ex = args('--excluir');
  const f = arg('--excluir-archivo');
  if (f) fs.readFileSync(f, 'utf8').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; }).forEach(function (l) { ex.push(l); });
  return ex;
}

async function main() {
  const ruta = process.argv[2];
  if (!ruta || ruta.startsWith('--')) { console.error('Uso: node scripts/restaurar-copia.js copia.json [--solo clients/ID] [--excluir X]... [--excluir-archivo f] [--apply --plan HUELLA] [--proyecto-real]'); process.exit(1); }
  const apply = process.argv.includes('--apply');
  const planRevisado = arg('--plan');
  if (apply && !planRevisado) { console.error('Para aplicar hace falta --plan HUELLA (la del simulacro que has revisado). No se ha escrito nada.'); process.exit(2); }
  const { admin, modo } = iniciar({ escribe: apply });
  if (apply && modo === 'real' && process.env.ALLOW_RESTORE_APPLY !== 'yes') {
    console.error('No se ha escrito nada. Escribir en el proyecto real exige ALLOW_RESTORE_APPLY=yes.'); process.exit(2);
  }
  const { copia } = cargar(ruta);
  const excluir = leerExclusiones();
  const inf = await restaurar(admin.firestore(), copia, { apply, plan: planRevisado || undefined, solo: arg('--solo'), excluir });
  console.log((apply ? 'APLICADO' : 'SIMULACRO (no se ha escrito nada)') + ' en ' + modo + '. Exclusiones: ' + excluir.length + '.');
  console.log('Documentos que se recrean: ' + inf.documentosNuevos + '. Con datos que se añaden: ' + inf.documentosConAñadidos + '.');
  console.log('Cambios (' + inf.cambios.length + '). Revisa y excluye lo que se borró a propósito:');
  inf.cambios.forEach(function (c) { console.log('  + ' + c); });
  console.log('HUELLA DEL PLAN: ' + inf.huella + (apply ? '' : '   → para aplicar: --apply --plan ' + inf.huella + ' (con las mismas --excluir)'));
  if (inf.noAplicados.length) {
    console.log('⚠ NO aplicados porque la nube cambió durante la restauración (no se han tocado): ' + inf.noAplicados.length);
    inf.noAplicados.forEach(function (d) { console.log('  ! ' + d); });
    process.exitCode = 4;
  }
}

module.exports = { restaurar, planificar };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(e && e.code === 'SIN_PERMISO' ? 2 : (e && e.code === 'PLAN_DISTINTO' ? 5 : 1)); });
