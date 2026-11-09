#!/usr/bin/env node
/* Copia de los ARCHIVOS de Storage (fotos y analíticas). Las copias de Firestore y la «Descargar copia»
   de la app solo guardan los ENLACES; si se borrara un archivo, el enlace dejaría de funcionar.

   Tres órdenes:
     copiar     descarga todos los archivos a una carpeta (SOLO LECTURA en Firebase) y escribe manifiesto.json
                con tamaño, tipo, huella sha256 y el token de descarga de cada uno.
     verificar  comprueba la carpeta contra el manifiesto (archivos que faltan o cambiados). Sin red.
                Con --firestore copia.json comprueba además que cada enlace de las fichas tiene su archivo.
     restaurar  sube SOLO los archivos que ya no están en Storage, con su tipo y su token de siempre, para
                que los enlaces guardados en las fichas vuelvan a funcionar. No toca los que existen.
                Simulacro por defecto; con --apply escribe. En el proyecto real exige ALLOW_RESTORE_APPLY=yes.

   Uso (lo ejecuta Jorge; la carpeta va FUERA del repositorio, contiene fotos y tokens):
     node scripts/copia-storage.js copiar    C:\Copias\storage-AAAA-MM-DD --proyecto-real
     node scripts/copia-storage.js verificar C:\Copias\storage-AAAA-MM-DD [--firestore C:\Copias\firestore.json]
     node scripts/copia-storage.js restaurar C:\Copias\storage-AAAA-MM-DD [--apply] --proyecto-real
   Nunca imprime tokens ni nombres: solo conteos y rutas internas (clients/ID/photos/ID.jpg). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUCKET_REAL = 'appjorgecgcoach.firebasestorage.app';
const MANIFIESTO = 'manifiesto.json';

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function dentroDelRepo(abs) { return abs.startsWith(path.resolve(__dirname, '..') + path.sep); }
function rutaLocal(dir, nombre) {
  const abs = path.resolve(dir, ...nombre.split('/'));
  if (!abs.startsWith(path.resolve(dir) + path.sep)) throw new Error('Ruta de archivo no válida en el bucket');
  return abs;
}

function iniciarStorage(opciones) {
  const admin = require('firebase-admin');
  const emu = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const projectEmu = process.env.GCLOUD_PROJECT || 'demo-jcg-copias';
  const nombre = emu ? (process.env.STORAGE_BUCKET || projectEmu + '.appspot.com') : BUCKET_REAL;
  if (admin.apps.length) {
    // Ya inicializado (p. ej. por la copia de Firestore): el bucket se nombra explícitamente.
    if (!emu && !process.argv.includes('--proyecto-real')) { const e = new Error('Sin emulador hace falta --proyecto-real.'); e.code = 'SIN_PERMISO'; throw e; }
    return { bucket: admin.storage().bucket(nombre), modo: emu ? 'emulador' : 'real' };
  }
  {
    if (emu) {
      const projectId = process.env.GCLOUD_PROJECT || 'demo-jcg-copias';
      admin.initializeApp({ projectId, storageBucket: process.env.STORAGE_BUCKET || projectId + '.appspot.com' });
    } else {
      if (!process.argv.includes('--proyecto-real')) {
        const e = new Error('Sin emulador hace falta --proyecto-real' + (opciones && opciones.escribe ? ' (y además el permiso explícito de escritura)' : '') + '.');
        e.code = 'SIN_PERMISO'; throw e;
      }
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const e = new Error('Falta GOOGLE_APPLICATION_CREDENTIALS (ruta al JSON de la cuenta de servicio, fuera del repositorio).');
        e.code = 'SIN_PERMISO'; throw e;
      }
      admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'appjorgecgcoach', storageBucket: BUCKET_REAL });
    }
  }
  return { bucket: admin.storage().bucket(), modo: emu ? 'emulador' : 'real' };
}

async function copiar(bucket, dir) {
  const [files] = await bucket.getFiles();
  const archivos = [];
  for (const f of files) {
    if (f.name.endsWith('/')) continue; // «carpetas» vacías
    const [buf] = await f.download();
    const md = f.metadata || {};
    const destino = rutaLocal(dir, f.name);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, buf);
    archivos.push({
      ruta: f.name,
      bytes: buf.length,
      tipo: md.contentType || null,
      sha256: sha256(buf),
      token: (md.metadata && md.metadata.firebaseStorageDownloadTokens) || null
    });
  }
  archivos.sort(function (a, b) { return a.ruta < b.ruta ? -1 : 1; });
  const manifiesto = { _type: 'jcgcoach_storage', _v: 1, exportedAt: new Date().toISOString(), bucket: bucket.name, archivos };
  fs.writeFileSync(path.join(dir, MANIFIESTO), JSON.stringify(manifiesto, null, 1));
  return manifiesto;
}

/* Enlaces a Storage dentro de una copia de Firestore (fotos, analíticas…): ruta del objeto y token. */
function enlacesEnCopia(copiaFirestore) {
  const out = [];
  const re = /\/o\/([^?"'\s]+)\?alt=media(?:&token=([0-9a-fA-F-]+))?/g;
  const txt = JSON.stringify(copiaFirestore);
  let m;
  while ((m = re.exec(txt))) out.push({ ruta: decodeURIComponent(m[1]), token: m[2] || null });
  return out;
}

function verificar(dir, copiaFirestore) {
  const problemas = [];
  const avisos = [];
  const man = JSON.parse(fs.readFileSync(path.join(dir, MANIFIESTO), 'utf8'));
  if (!man || man._type !== 'jcgcoach_storage' || !Array.isArray(man.archivos)) return { ok: false, problemas: ['no es una copia de Storage de esta app'] };
  let faltan = 0, cambiados = 0, bytes = 0;
  const porRuta = new Map();
  for (const a of man.archivos) {
    porRuta.set(a.ruta, a);
    bytes += a.bytes;
    let buf;
    try { buf = fs.readFileSync(rutaLocal(dir, a.ruta)); } catch (_) { faltan++; continue; }
    if (sha256(buf) !== a.sha256 || buf.length !== a.bytes) cambiados++;
  }
  if (faltan) problemas.push(faltan + ' archivo(s) del manifiesto no están en la carpeta');
  if (cambiados) problemas.push(cambiados + ' archivo(s) no coinciden con su huella (dañados o editados)');
  const resumen = {
    archivos: man.archivos.length,
    fotos: man.archivos.filter(function (a) { return /\/photos\//.test(a.ruta); }).length,
    analiticas: man.archivos.filter(function (a) { return /\/analitica\//.test(a.ruta); }).length,
    megas: Math.round(bytes / 1e4) / 100
  };
  if (copiaFirestore) {
    const enlaces = enlacesEnCopia(copiaFirestore);
    let sinArchivo = 0, tokenDistinto = 0;
    for (const e of enlaces) {
      const a = porRuta.get(e.ruta);
      if (!a) sinArchivo++;
      else if (e.token && a.token && String(a.token).split(',').indexOf(e.token) < 0) tokenDistinto++;
    }
    resumen.enlacesEnFichas = enlaces.length;
    if (sinArchivo) problemas.push(sinArchivo + ' enlace(s) de las fichas apuntan a archivos que NO están en esta copia');
    if (tokenDistinto) avisos.push(tokenDistinto + ' enlace(s) usan un token distinto del archivo copiado (el enlace no funcionaría tras restaurar)');
  }
  return { ok: problemas.length === 0, problemas, avisos, resumen };
}

async function restaurar(bucket, dir, opciones) {
  opciones = opciones || {};
  const v = verificar(dir);
  if (!v.ok) throw new Error('La copia de Storage no es válida: ' + v.problemas.join('; '));
  const man = JSON.parse(fs.readFileSync(path.join(dir, MANIFIESTO), 'utf8'));
  const informe = { repuestos: [], yaExistian: 0 };
  for (const a of man.archivos) {
    const file = bucket.file(a.ruta);
    const [existe] = await file.exists();
    if (existe) { informe.yaExistian++; continue; }
    informe.repuestos.push(a.ruta);
    if (!opciones.apply) continue;
    const metadata = { contentType: a.tipo || undefined, metadata: a.token ? { firebaseStorageDownloadTokens: a.token } : {} };
    // ifGenerationMatch: 0 → solo si sigue sin existir; si alguien lo subió mientras tanto, no se pisa.
    await file.save(fs.readFileSync(rutaLocal(dir, a.ruta)), { resumable: false, metadata, preconditionOpts: { ifGenerationMatch: 0 } });
  }
  return informe;
}

function arg(nombre) { const i = process.argv.indexOf(nombre); return i < 0 ? null : process.argv[i + 1] || null; }

async function main() {
  const orden = process.argv[2];
  const dir = process.argv[3] && !process.argv[3].startsWith('--') ? path.resolve(process.argv[3]) : null;
  if (!['copiar', 'verificar', 'restaurar'].includes(orden) || !dir) {
    console.error('Uso: node scripts/copia-storage.js copiar|verificar|restaurar CARPETA [--firestore copia.json] [--apply] [--proyecto-real]');
    process.exit(1);
  }
  if (dentroDelRepo(dir)) { console.error('La carpeta debe estar FUERA del repositorio (contiene fotos y tokens).'); process.exit(1); }
  if (orden === 'verificar') {
    let copiaF = null;
    if (arg('--firestore')) copiaF = require('./verificar-copia').cargar(arg('--firestore')).copia;
    const v = verificar(dir, copiaF);
    console.log(JSON.stringify(v.resumen || {}, null, 2));
    (v.problemas || []).forEach(function (p) { console.log('✖ ' + p); });
    (v.avisos || []).forEach(function (p) { console.log('! ' + p); });
    console.log(v.ok ? 'Copia de archivos íntegra.' : 'Copia de archivos NO válida.');
    process.exit(v.ok ? 0 : 3);
  }
  const apply = orden === 'restaurar' && process.argv.includes('--apply');
  const { bucket, modo } = iniciarStorage({ escribe: apply });
  if (orden === 'copiar') {
    fs.mkdirSync(dir, { recursive: true });
    const man = await copiar(bucket, dir);
    const v = verificar(dir);
    console.log('Copia de archivos (' + modo + '): ' + man.archivos.length + ' archivo(s). Verificación: ' + (v.ok ? 'OK' : 'CON PROBLEMAS'));
    console.log(JSON.stringify(v.resumen, null, 2));
    if (!v.ok) process.exit(3);
    return;
  }
  if (apply && modo === 'real' && process.env.ALLOW_RESTORE_APPLY !== 'yes') {
    console.error('No se ha escrito nada. Escribir en el proyecto real exige ALLOW_RESTORE_APPLY=yes.'); process.exit(2);
  }
  const inf = await restaurar(bucket, dir, { apply });
  console.log((apply ? 'APLICADO' : 'SIMULACRO (no se ha escrito nada)') + ' en ' + modo + '. Repuestos: ' + inf.repuestos.length + '. Ya existían (sin tocar): ' + inf.yaExistian + '.');
  inf.repuestos.slice(0, 200).forEach(function (r) { console.log('  + ' + r); });
}

module.exports = { copiar, verificar, restaurar, enlacesEnCopia, iniciarStorage, MANIFIESTO };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(e && e.code === 'SIN_PERMISO' ? 2 : 1); });
