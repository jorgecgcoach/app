'use strict';
// Comprueba que la web publicada se monta bien y que el código minificado sigue siendo JavaScript válido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { construir, ARCHIVOS } = require('./construir-web.js');

const DESTINO = 'web-publicada-prueba';
const RAIZ = path.join(__dirname, '..');

test('monta la web minificada: authDomain cambiado, scripts válidos y sin comentarios HTML', async () => {
  const r = await construir({ destino: DESTINO, authDomain: 'appjorgecgcoach.web.app' });
  try {
    assert.strictEqual(r.archivos, ARCHIVOS.length);
    assert.ok(r.minificado);
    assert.ok(r.bloquesHtml >= 3, 'se esperaban los bloques <script> del HTML');
    const html = fs.readFileSync(path.join(r.destino, 'index.html'), 'utf8');
    assert.strictEqual(html.split('authDomain:"appjorgecgcoach.web.app"').length - 1, 1);
    assert.ok(!html.includes('jorgecgcoach.github.io"'), 'no debe quedar el authDomain de GitHub');
    assert.ok(!/<!--/.test(html), 'no deben quedar comentarios HTML');
    // Cada bloque de código del HTML y cada .js tiene que compilar.
    const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.strictEqual(bloques.length, r.bloquesHtml);
    for (const b of bloques) assert.doesNotThrow(() => new vm.Script(b));
    for (const rel of ARCHIVOS.filter((a) => a.endsWith('.js'))) {
      const js = fs.readFileSync(path.join(r.destino, rel), 'utf8');
      assert.doesNotThrow(() => new vm.Script(js), rel);
      assert.ok(js.length < fs.readFileSync(path.join(RAIZ, rel), 'utf8').length, rel + ' debería ocupar menos');
    }
    // Las funciones que usan los onclick siguen existiendo con su nombre.
    const publicado = html + ARCHIVOS.filter((a) => a.endsWith('.js')).map((a) => fs.readFileSync(path.join(r.destino, a), 'utf8')).join('\n');
    const llamadas = new Set([...fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8').matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]));
    for (const k of ["if", "return", "event", "this", "document", "window", "location", "history", "navigator", "alert", "confirm", "setTimeout", "void", "typeof", "new"]) llamadas.delete(k);
    assert.ok(llamadas.size > 10);
    for (const nombre of llamadas) {
      const n = nombre.replace(/\$/g, '\\$');
      assert.ok(new RegExp('function ' + n + '\\(|[\\s,;{(]' + n + '=|window\\.' + n + '=').test(publicado), 'falta la función global ' + nombre);
    }
  } finally {
    fs.rmSync(path.join(RAIZ, DESTINO), { recursive: true, force: true });
  }
});

test('--sin-minificar deja el código tal cual', async () => {
  const r = await construir({ destino: DESTINO, minificar: false });
  try {
    assert.strictEqual(r.minificado, false);
    const original = fs.readFileSync(path.join(RAIZ, 'ui/coach-nav.js'), 'utf8');
    assert.strictEqual(fs.readFileSync(path.join(r.destino, 'ui/coach-nav.js'), 'utf8'), original);
  } finally {
    fs.rmSync(path.join(RAIZ, DESTINO), { recursive: true, force: true });
  }
});
