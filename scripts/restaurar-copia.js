#!/usr/bin/env node
/* Restauración que NO pisa lo posterior a la copia (shared/copia-aditiva.js).

   1) SIMULACRO (por defecto): lista CADA cosa que se añadiría, con su identificador
        coleccion/documento|ruta      p. ej.  clients/ID|blocks[id:b3]   clients/ID|menus
      y una HUELLA del plan, calculada con la ruta Y el contenido de cada cambio (otra copia con los
      mismos huecos pero otros valores da otra huella). No escribe nada.
   2) Revisa la lista. Lo que se borró A PROPÓSITO después de la copia se excluye con --excluir
      (documento entero «clients/ID», o una parte «clients/ID|blocks[id:b3]»; se puede repetir, o poner
      una por línea en un archivo con --excluir-archivo).
   3) APLICAR: --apply --plan HUELLA. Solo se aplica si el plan sigue siendo EXACTAMENTE el revisado
      (mismas exclusiones y la nube sin cambios en lo que afecta). Si no coincide, no escribe nada.
      Además, en cada documento se vuelve a calcular dentro de la transacción: si la nube cambió entre
      medias, ese documento NO se toca y el informe lo marca como RESTAURACIÓN PARCIAL, con el motivo.
      Con --con-credenciales, dentro de esa transacción también se vuelve a mirar a quién da acceso cada
      código o cuenta: si alguno ha pasado a otra ficha, esa ficha no se recrea (nunca se duplican).
   Fichas que ya no existen: se recrean SIN sus credenciales ni vinculaciones (código, códigos, cuentas,
   push; PIN y lista de códigos del entrenador). Solo para recuperar un desastre: --con-credenciales, y
   aun así no se repone un código o una cuenta que ya use otra ficha.
   Para el proyecto real hace falta además ALLOW_RESTORE_APPLY=yes.

     node scripts/restaurar-copia.js copia.json [--solo clients/ID] [--excluir X]... [--excluir-archivo f.txt]
                                     [--con-credenciales] [--apply --plan HUELLA] [--proyecto-real]
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
    // Para no repetir un código o una cuenta que ya tenga otra ficha, con --con-credenciales se mira toda la colección.
    let todos = null;
    if (opciones.credenciales) { todos = {}; (await db.collection(col).get()).forEach(function (d) { todos[d.id] = d.data(); }); }
    planes.push(aditiva.planificar(col, actuales, docsCopia, opciones.excluir, { credenciales: !!opciones.credenciales, todos: todos }));
  }
  const ids = [].concat.apply([], planes.map(function (p) { return p.ids; }));
  const firmas = [].concat.apply([], planes.map(function (p) { return p.firmas; }));
  return { planes, ids, firmas, huella: aditiva.huellaPlan(firmas) };
}

async function restaurar(db, copia, opciones) {
  opciones = opciones || {};
  const plan = await planificar(db, copia, opciones);
  const informe = { huella: plan.huella, documentosNuevos: 0, documentosConAñadidos: 0, sinCambios: 0, cambios: [], credenciales: [], aplicados: [], noAplicados: [], motivos: {}, parcial: false, aplicado: false };
  plan.planes.forEach(function (p) {
    p.docs.forEach(function (d) {
      if (d.nuevo) informe.documentosNuevos++; else informe.documentosConAñadidos++;
      d.cambios.forEach(function (c) { informe.cambios.push(c.id + '  (' + c.tipo + ')'); });
      (d.credenciales || []).forEach(function (c) { informe.credenciales.push(p.col + '/' + d.id + '|' + c.campo + '  (' + (c.motivo === 'en-uso-parcial' ? 'SE REPONE en parte: ' + c.quitados + ' ya los usa otra ficha' : c.repuesta ? 'SE REPONE' : c.motivo === 'en-uso' ? 'no: ya la usa otra ficha' : 'no se repone') + ')'); });
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
      // Solo para las pruebas: simula otro dispositivo que escribe entre un documento y el siguiente.
      if (typeof opciones.antesDeDocumento === 'function') await opciones.antesDeDocumento(p.col, d.id);
      // Se compara ruta Y contenido de cada cambio (las firmas), no solo las rutas.
      const esperado = d.cambios.map(function (c) { return c.firma; }).sort().join('\n');
      const r = await db.runTransaction(async function (t) {
        const snap = await t.get(ref);
        const actual = snap.exists ? snap.data() : undefined;
        // Ficha que se recrea: solo si sigue sin existir.
        if (d.nuevo && actual !== undefined) return { ok: false, motivo: 'ya-existe' };
        // Si se reponen credenciales, se vuelve a mirar DENTRO de la transacción a quién da acceso cada código
        // o cuenta (toda la colección): si alguno ha pasado a otra ficha desde el plan, no se recrea. Leerla aquí
        // hace que la transacción se repita si otra ficha cambia antes de escribir.
        let op;
        if (d.nuevo && opciones.credenciales && (d.credenciales || []).length) {
          const todos = {};
          (await t.get(db.collection(p.col))).forEach(function (x) { todos[x.id] = x.data(); });
          op = { credenciales: true, todos: todos };
        }
        const rehecho = aditiva.planificar(p.col, { [d.id]: actual }, { [d.id]: copia.colecciones[p.col][d.id] }, opciones.excluir, op);
        const doc = rehecho.docs[0];
        const ahora = doc ? doc.cambios.map(function (c) { return c.firma; }).sort().join('\n') : '';
        if (ahora !== esperado) return { ok: false, motivo: d.nuevo ? 'credenciales' : 'cambio-nube' };   // no se toca
        const extra = p.col === 'clients' ? lib.selloRestauracion(actual) : {};
        t.set(ref, Object.assign({}, doc.valor, extra));
        return { ok: true };
      });
      const ruta = p.col + '/' + d.id;
      if (r.ok) informe.aplicados.push(ruta);
      else { informe.noAplicados.push(ruta); informe.motivos[ruta] = r.motivo; }
    }
  }
  informe.aplicado = true;
  informe.parcial = informe.noAplicados.length > 0;
  return informe;
}

const MOTIVOS = {
  'cambio-nube': 'cambió en la nube durante la restauración (otro dispositivo); no se ha tocado',
  'ya-existe': 'se ha creado en la nube durante la restauración; no se ha tocado',
  'credenciales': 'un código o una cuenta suya ha pasado a otra ficha durante la restauración; no se ha recreado'
};
/* Texto del informe (lo que imprime la línea de órdenes). Nunca lleva valores: solo identificadores y rutas. */
function textoInforme(inf, o) {
  o = o || {};
  const l = [];
  const exclusiones = (o.excluir || []).length;
  if (o.apply && inf.parcial) l.push('⚠ RESTAURACIÓN PARCIAL: ' + inf.noAplicados.length + ' documento(s) NO restaurado(s). Lee el final.');
  l.push((o.apply ? (inf.parcial ? 'APLICADO EN PARTE' : 'APLICADO') : 'SIMULACRO (no se ha escrito nada)') + ' en ' + (o.modo || '?') + '. Exclusiones: ' + exclusiones + '.');
  l.push('Documentos que se recrean: ' + inf.documentosNuevos + '. Con datos que se añaden: ' + inf.documentosConAñadidos + '.');
  l.push('Cambios (' + inf.cambios.length + ')' + (o.apply ? ':' : '. Revisa y excluye lo que se borró a propósito:'));
  inf.cambios.forEach(function (c) { l.push('  + ' + c); });
  if (inf.credenciales.length) {
    l.push('Credenciales de fichas que se recrean (' + (o.credenciales ? 'con --con-credenciales' : 'sin --con-credenciales: ninguna se repone') + '):');
    inf.credenciales.forEach(function (c) { l.push('  · ' + c); });
  }
  l.push('HUELLA DEL PLAN: ' + inf.huella + (o.apply ? '' : '   → para aplicar: --apply --plan ' + inf.huella + ' (con las mismas --excluir' + (o.credenciales ? ' y --con-credenciales' : '') + ')'));
  if (o.apply) {
    inf.aplicados.forEach(function (d) { l.push('  ✔ ' + d + '  restaurado'); });
    if (inf.parcial) {
      l.push('⚠ NO restaurados (' + inf.noAplicados.length + '). Lo demás sí se ha restaurado, documento a documento:');
      inf.noAplicados.forEach(function (d) { l.push('  ! ' + d + '  NO restaurado: ' + (MOTIVOS[inf.motivos[d]] || inf.motivos[d])); });
      l.push('Para terminarlo: repite el simulacro (dará otra huella) y revísalo antes de aplicar.');
    }
  }
  return l.join('\n');
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
  const credenciales = process.argv.includes('--con-credenciales');
  const inf = await restaurar(admin.firestore(), copia, { apply, plan: planRevisado || undefined, solo: arg('--solo'), excluir, credenciales });
  console.log(textoInforme(inf, { apply, modo, excluir, credenciales }));
  if (inf.parcial) process.exitCode = 4;
}

module.exports = { restaurar, planificar, textoInforme };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(e && e.code === 'SIN_PERMISO' ? 2 : (e && e.code === 'PLAN_DISTINTO' ? 5 : 1)); });
