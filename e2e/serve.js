/* Servidor local para probar la app contra el EMULADOR de Firestore.
   Sirve el repo tal cual, pero index.html sale reescrito:
     - firebaseConfig  -> proyecto "demo-jcg-e2e" (no existe en la nube)
     - db.useEmulator('127.0.0.1', 8080) justo después de crear db
     - sin clave VAPID ni service worker de avisos
   Si alguna reescritura no se aplica, o queda algún rastro del proyecto
   real, NO arranca. Nunca modifica index.html en disco.
   Uso: node e2e/serve.js   (http://127.0.0.1:5199)
   Red local (probar en el iPhone por wifi): E2E_LAN=192.168.x.x node e2e/serve.js
     -> escucha en esa IP, apunta al emulador en esa IP y NO sirve docs/, scripts/, e2e/ ni carpetas ocultas.
   Con Auth (C1, solo emulador): E2E_AUTH=1 node e2e/serve.js, con npm run e2e:emulador-auth
     -> AUTH_ENABLED=true en la copia servida, Auth contra el emulador 9099 y reglas estrictas. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT || 5199);
const PROJECT = 'demo-jcg-e2e';
const LAN = process.env.E2E_LAN || '';
if (LAN && !/^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/.test(LAN)) { console.error('E2E_LAN debe ser una IP privada de tu red (192.168.x.x o 10.x.x.x)'); process.exit(1); }
const EMU = { host: LAN || '127.0.0.1', port: 8080 };
const AUTH = process.env.E2E_AUTH === '1';
// En red local solo se sirve la app: nada de documentación, scripts ni carpetas ocultas.
const BLOCKED_LAN = /^\/(docs|scripts|e2e|firestore|functions|node_modules)\/|\/\./;

function buildHtml() {
  // Con autocrlf la copia de trabajo puede venir en CRLF: se normaliza para que los reemplazos encajen.
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const cfgRe = /const firebaseConfig = \{[\s\S]*?\n\};/;
  if (!cfgRe.test(html)) throw new Error('No encuentro firebaseConfig');
  html = html.replace(cfgRe, `const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: "${PROJECT}.firebaseapp.com",
  projectId: "${PROJECT}",
  storageBucket: "",
  messagingSenderId: "0",
  appId: "demo-app"
};`);
  html = html.replace(/const VAPID_KEY = "[^"]*";/, 'const VAPID_KEY = "";');
  const dbLine = 'const db = firebase.firestore(app);';
  if (html.split(dbLine).length !== 2) throw new Error('No encuentro la creación de db');
  html = html.replace(dbLine, `${dbLine}\n  db.useEmulator('${EMU.host}', ${EMU.port}); window.__E2E_EMULATOR__ = '${EMU.host}:${EMU.port}';`);
  // Sin messaging: su service worker lleva la configuración real.
  html = html.replace('if(firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()){', 'if(false){');

  // Modo Auth (E2E_AUTH=1): activa AUTH_ENABLED SOLO en esta copia servida y conecta Firebase Auth
  // al emulador (puerto 9099). index.html en disco sigue con AUTH_ENABLED=false.
  if (AUTH) {
    const flag = 'const AUTH_ENABLED=false;';
    if (html.split(flag).length !== 2) throw new Error('No encuentro AUTH_ENABLED=false');
    html = html.replace(flag, 'const AUTH_ENABLED=true; /* E2E_AUTH: solo emulador */');
    const pers = 'await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);';
    if (html.split(pers).length !== 2) throw new Error('No encuentro setPersistence');
    html = html.replace(pers, `firebase.auth().useEmulator('http://${EMU.host}:9099'); ${pers}`);
    const sec = 'const auth=app.auth();\n  await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);';
    if (html.split(sec).length !== 2) throw new Error('No encuentro la app secundaria de altas');
    html = html.replace(sec, `const auth=app.auth();\n  try{auth.useEmulator('http://${EMU.host}:9099')}catch(_){}\n  await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);`);
  }

  const forbidden = ['appjorgecgcoach', 'AIzaSy', '268327197097'];
  for (const f of forbidden) if (html.includes(f)) throw new Error('Queda un rastro de producción en index.html: ' + f);
  if (!html.includes(`db.useEmulator('${EMU.host}', ${EMU.port})`)) throw new Error('Falta useEmulator');
  return html;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml','.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const html = buildHtml();

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    res.end(buildHtml());
    return;
  }
  if (url.includes('firebase-messaging-sw')) { res.writeHead(404); res.end(); return; }
  if (LAN && (BLOCKED_LAN.test(url) || /\.(md|ps1|log|rules)$/i.test(url))) { res.writeHead(404); res.end(); return; }
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT) || file.includes('node_modules') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, LAN || '127.0.0.1', () => {
  console.log(`e2e: app en http://${LAN || '127.0.0.1'}:${PORT} -> emulador ${EMU.host}:${EMU.port}, proyecto ${PROJECT} (${html.length} bytes)`);
});
