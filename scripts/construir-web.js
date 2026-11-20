#!/usr/bin/env node
/* Monta la carpeta que se publica en Firebase Hosting (web-publicada/, ignorada por git).
   Solo copia los archivos que necesita la app: nada de pruebas, documentos, scripts internos ni reglas.
   Cambia authDomain por el dominio de Hosting: allí Firebase sirve el ayudante de Google (/__/auth/)
   en la misma dirección que la app.
     node scripts/construir-web.js [--auth-domain appjorgecgcoach.web.app] [--destino web-publicada]
   Además minifica el JavaScript (archivos y bloques <script> del HTML) para que el código publicado
   no se lea ni se reutilice con facilidad. Los nombres globales se conservan (los usan los onclick).
     --sin-minificar  publica el código tal cual (para depurar)
   No despliega nada. */
'use strict';
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = path.join(__dirname, '..');
const ARCHIVOS = [
  'index.html',
  'manifest.webmanifest',
  'firebase-messaging-sw.js',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'auth/code-identity.js',
  'shared/campos-cliente.js',
  'shared/client-catalog.js',
  'shared/copia-aditiva.js',
  'shared/safe-save.js',
  'ui/coach-calendar.js',
  'ui/coach-home.js',
  'ui/coach-library.js',
  'ui/coach-nav.js',
  'ui/design-system.css'
];
const AUTH_DOMAIN_GITHUB = 'authDomain: "jorgecgcoach.github.io"';

function arg(nombre, defecto) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : defecto;
}

const OPCIONES_TERSER = {
  compress: { passes: 2, drop_debugger: true },
  mangle: true,
  toplevel: false,          // las funciones globales siguen llamándose igual
  format: { comments: false, ascii_only: true },
  ecma: 2020
};

async function minificarJs(codigo, nombre) {
  try {
    const r = await minify(codigo, OPCIONES_TERSER);
    if (typeof r.code !== 'string') throw new Error('sin resultado');
    return r.code;
  } catch (e) {
    throw new Error('No se pudo minificar ' + nombre + ': ' + (e.message || e));
  }
}

// Solo los <script> sin atributos (código); los de datos (type="application/json") y los externos no se tocan.
async function minificarHtml(html) {
  const partes = html.split(/(<script>[\s\S]*?<\/script>)/);
  let bloques = 0;
  for (let i = 1; i < partes.length; i += 2) {
    const codigo = partes[i].slice('<script>'.length, -'</script>'.length);
    let min = await minificarJs(codigo, 'index.html (bloque ' + (++bloques) + ')');
    // Un "</script" dentro de un texto cerraría el bloque antes de tiempo.
    min = min.replace(/<\/script/gi, '<\\/script');
    partes[i] = '<script>' + min + '</script>';
  }
  // Comentarios HTML fuera de los scripts (no hay condicionales de IE en la app).
  for (let i = 0; i < partes.length; i += 2) partes[i] = partes[i].replace(/<!--[\s\S]*?-->/g, '');
  return { html: partes.join(''), bloques };
}

async function construir(opciones) {
  const minificar = opciones.minificar !== false;
  let bloquesHtml = 0, jsMinificados = 0;
  const destino = path.resolve(ROOT, opciones.destino || 'web-publicada');
  const authDomain = opciones.authDomain || 'appjorgecgcoach.web.app';
  if (!/^[a-z0-9.-]+$/.test(authDomain)) throw new Error('authDomain no válido');
  if (path.relative(ROOT, destino).startsWith('..')) throw new Error('El destino tiene que estar dentro del proyecto');
  fs.rmSync(destino, { recursive: true, force: true });
  for (const rel of ARCHIVOS) {
    const origen = path.join(ROOT, rel);
    const final = path.join(destino, rel);
    fs.mkdirSync(path.dirname(final), { recursive: true });
    if (rel === 'index.html') {
      const html = fs.readFileSync(origen, 'utf8');
      const veces = html.split(AUTH_DOMAIN_GITHUB).length - 1;
      if (veces !== 1) throw new Error('index.html: se esperaba authDomain de GitHub una vez y aparece ' + veces);
      let salida = html.replace(AUTH_DOMAIN_GITHUB, 'authDomain: "' + authDomain + '"');
      if (minificar) { const r = await minificarHtml(salida); salida = r.html; bloquesHtml = r.bloques; }
      fs.writeFileSync(final, salida);
    } else if (minificar && rel.endsWith('.js')) {
      fs.writeFileSync(final, await minificarJs(fs.readFileSync(origen, 'utf8'), rel));
      jsMinificados++;
    } else {
      fs.copyFileSync(origen, final);
    }
  }
  // Ningún archivo del HTML puede apuntar a algo que no se publica.
  const html = fs.readFileSync(path.join(destino, 'index.html'), 'utf8');
  const locales = new Set();
  for (const m of html.matchAll(/(?:src|href)="((?:auth|shared|ui)\/[^"?#]+)/g)) locales.add(m[1]);
  for (const rel of locales) {
    if (!fs.existsSync(path.join(destino, rel))) throw new Error('Falta en la publicación: ' + rel);
  }
  return { destino, archivos: ARCHIVOS.length, authDomain, minificado: minificar, bloquesHtml, jsMinificados };
}

if (require.main === module) {
  construir({ destino: arg('--destino'), authDomain: arg('--auth-domain'), minificar: !process.argv.includes('--sin-minificar') })
    .then((r) => {
      const min = r.minificado ? ', minificado: ' + r.jsMinificados + ' archivos JS y ' + r.bloquesHtml + ' bloques del HTML' : ', sin minificar';
      console.log('Web montada en ' + path.relative(ROOT, r.destino) + ' (' + r.archivos + ' archivos, authDomain ' + r.authDomain + min + '). No se ha desplegado nada.');
    })
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { construir, ARCHIVOS, minificarHtml, minificarJs };
