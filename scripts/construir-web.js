#!/usr/bin/env node
/* Monta la carpeta que se publica en Firebase Hosting (web-publicada/, ignorada por git).
   Solo copia los archivos que necesita la app: nada de pruebas, documentos, scripts internos ni reglas.
   Cambia authDomain por el dominio de Hosting: allí Firebase sirve el ayudante de Google (/__/auth/)
   en la misma dirección que la app.
     node scripts/construir-web.js [--auth-domain appjorgecgcoach.web.app] [--destino web-publicada]
   No despliega nada. */
'use strict';
const fs = require('fs');
const path = require('path');

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

function construir(opciones) {
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
      fs.writeFileSync(final, html.replace(AUTH_DOMAIN_GITHUB, 'authDomain: "' + authDomain + '"'));
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
  return { destino, archivos: ARCHIVOS.length, authDomain };
}

if (require.main === module) {
  const r = construir({ destino: arg('--destino'), authDomain: arg('--auth-domain') });
  console.log('Web montada en ' + path.relative(ROOT, r.destino) + ' (' + r.archivos + ' archivos, authDomain ' + r.authDomain + '). No se ha desplegado nada.');
}

module.exports = { construir, ARCHIVOS };
