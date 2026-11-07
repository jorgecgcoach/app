/* Servidor local para probar la app contra el EMULADOR de Firestore.
   Sirve el repo tal cual, pero index.html sale reescrito:
     - firebaseConfig  -> proyecto "demo-jcg-e2e" (no existe en la nube)
     - db.useEmulator('127.0.0.1', 8080) justo después de crear db
     - sin clave VAPID ni service worker de avisos
   Si alguna reescritura no se aplica, o queda algún rastro del proyecto
   real, NO arranca. Nunca modifica index.html en disco.
   Uso: node e2e/serve.js   (http://127.0.0.1:5199) */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT || 5199);
const PROJECT = 'demo-jcg-e2e';
const EMU = { host: '127.0.0.1', port: 8080 };

function buildHtml() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

  const forbidden = ['appjorgecgcoach', 'AIzaSy', '268327197097'];
  for (const f of forbidden) if (html.includes(f)) throw new Error('Queda un rastro de producción en index.html: ' + f);
  if (!html.includes("db.useEmulator('127.0.0.1', 8080)")) throw new Error('Falta useEmulator');
  return html;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const html = buildHtml();

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    res.end(buildHtml());
    return;
  }
  if (url.includes('firebase-messaging-sw')) { res.writeHead(404); res.end(); return; }
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT) || file.includes('node_modules') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`e2e: app en http://127.0.0.1:${PORT} -> emulador ${EMU.host}:${EMU.port}, proyecto ${PROJECT} (${html.length} bytes)`);
});
