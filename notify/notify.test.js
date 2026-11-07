'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const notify = require('./notify');
const report = require('../shared/job-report');

const TOKEN_OK = 'fake-token-ok';
const TOKEN_BAD = 'fake-token-bad';
const TOKEN_LARGO = 'fake-token-' + 'q'.repeat(40);

/* Mock con estado: get() entrega copias (lectura inicial) y runTransaction
   relee el estado actual, así se puede simular un cambio concurrente. */
function dbOf(clients, opts) {
  const updates = [];
  const store = new Map(clients.map((c) => [c.id, JSON.parse(JSON.stringify(c.data))]));
  const db = {
    updates,
    store,
    collection() {
      return {
        async get() {
          if (opts && opts.firestoreError) throw new Error(opts.firestoreError);
          return {
            docs: [...store.keys()].map((id) => {
              const copy = JSON.parse(JSON.stringify(store.get(id)));
              return { id, data: () => copy };
            })
          };
        },
        doc(id) {
          return { id };
        }
      };
    },
    async runTransaction(fn) {
      if (opts && opts.beforeTx) opts.beforeTx(store);
      return fn({
        async get(ref) {
          const cur = store.get(ref.id);
          const copy = cur === undefined ? undefined : JSON.parse(JSON.stringify(cur));
          return { exists: cur !== undefined, data: () => copy };
        },
        update(ref, payload) {
          if (opts && opts.updateError) throw new Error(opts.updateError);
          updates.push({ id: ref.id, payload });
          const doc = store.get(ref.id);
          for (const key of Object.keys(payload)) {
            const parts = key.split('.');
            let node = doc;
            for (const p of parts.slice(0, -1)) node = node[p] = node[p] || {};
            node[parts[parts.length - 1]] = payload[key];
          }
        }
      });
    }
  };
  return db;
}

function sendRejecting(bad) {
  return {
    async send(msg) {
      if (msg.token === bad) {
        const err = new Error('no registrado');
        err.code = 'messaging/registration-token-not-registered';
        throw err;
      }
      return {};
    }
  };
}

test('un send que falla hace FAIL y sale distinto de 0; el token inválido es SKIP', async () => {
  const badDb = dbOf([
    { id: 'cli-1', data: { name: 'Ana Ejemplo', push: { enabled: true, tokens: [TOKEN_OK] } } },
    { id: 'coach_data', data: { negocio: {} } }
  ]);
  const failed = await notify.sendNotifications({
    db: badDb,
    messaging: {
      async send() {
        const err = new Error('fcm mock down ' + TOKEN_LARGO);
        err.code = 'messaging/internal-error';
        throw err;
      }
    }
  });
  assert.equal(failed.fail, 1);
  assert.equal(report.exitCode(failed), 1);
  assert.equal(report.summaryLines(failed).join('\n').includes(TOKEN_LARGO), false);
  assert.match(report.summaryLines(failed).join('\n'), /OK=0 FAIL=1/);
  assert.equal(badDb.updates.length, 0);

  const cleanDb = dbOf([
    { id: 'cli-1', data: { name: 'Ana Ejemplo', push: { enabled: true, tokens: [TOKEN_OK, TOKEN_BAD] } } }
  ]);
  const cleaned = await notify.sendNotifications({
    db: cleanDb,
    messaging: {
      async send(msg) {
        if (msg.token === TOKEN_BAD) {
          const err = new Error('no registrado');
          err.code = 'messaging/registration-token-not-registered';
          throw err;
        }
        return {};
      }
    }
  });
  assert.equal(cleaned.fail, 0);
  assert.equal(cleaned.ok, 1);
  assert.equal(cleaned.skip, 1);
  assert.equal(report.exitCode(cleaned), 0);
  assert.equal(cleanDb.updates.length, 1);
  assert.deepEqual(cleanDb.updates[0].payload, { 'push.tokens': [TOKEN_OK] });
  assert.deepEqual(cleanDb.store.get('cli-1').push, { enabled: true, tokens: [TOKEN_OK] });
});

test('limpiar un token inválido no pisa cambios hechos durante los envíos', async () => {
  const TOKEN_NUEVO = 'fake-token-nuevo';
  const db = dbOf(
    [{ id: 'cli-1', data: { name: 'Ana Ejemplo', notas: 'n1', push: { enabled: true, tokens: [TOKEN_OK, TOKEN_BAD] } } }],
    {
      beforeTx(store) {
        // Otro dispositivo registra un token y el coach edita la ficha.
        const doc = store.get('cli-1');
        doc.push.tokens.push(TOKEN_NUEVO);
        doc.push.lang = 'es';
        doc.notas = 'n2';
      }
    }
  );
  const summary = await notify.sendNotifications({ db, messaging: sendRejecting(TOKEN_BAD) });
  assert.equal(summary.fail, 0);
  const doc = db.store.get('cli-1');
  assert.deepEqual(doc.push, { enabled: true, tokens: [TOKEN_OK, TOKEN_NUEVO], lang: 'es' });
  assert.equal(doc.notas, 'n2');
  assert.equal(doc.name, 'Ana Ejemplo');
});

test('si el token inválido ya no está, no se escribe nada', async () => {
  const db = dbOf(
    [{ id: 'cli-1', data: { name: 'Ana Ejemplo', push: { enabled: true, tokens: [TOKEN_BAD] } } }],
    { beforeTx(store) { store.get('cli-1').push.tokens = ['fake-token-otro']; } }
  );
  const summary = await notify.sendNotifications({ db, messaging: sendRejecting(TOKEN_BAD) });
  assert.equal(summary.fail, 0);
  assert.equal(db.updates.length, 0);
  assert.deepEqual(db.store.get('cli-1').push.tokens, ['fake-token-otro']);
});

test('si limpiar el token falla, el job sale en error', async () => {
  const db = dbOf(
    [{ id: 'cli-1', data: { name: 'Ana Ejemplo', push: { enabled: true, tokens: [TOKEN_BAD] } } }],
    { updateError: 'update mock down' }
  );
  const summary = await notify.sendNotifications({
    db,
    messaging: {
      async send() {
        const err = new Error('token inválido');
        err.code = 'messaging/invalid-registration-token';
        throw err;
      }
    }
  });
  assert.ok(summary.fail >= 1);
  assert.match(report.summaryLines(summary).join('\n'), /update mock down/);
});

test('sin push que enviar sale 0', async () => {
  const db = dbOf([
    { id: 'cli-1', data: { name: 'Ana Ejemplo', push: { enabled: false, tokens: [] } } },
    { id: 'coach_data', data: {} }
  ]);
  const summary = await notify.sendNotifications({
    db,
    messaging: { async send() { throw new Error('no debía enviar'); } }
  });
  assert.equal(summary.ok, 0);
  assert.equal(summary.fail, 0);
  assert.equal(report.exitCode(summary), 0);
});

function quietEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (/SECRET|PASSWORD|TOKEN|CREDENTIAL|FIREBASE_SERVICE|GMAIL|PRIVATE/i.test(key)) delete env[key];
  }
  return Object.assign(env, extra || {});
}

function spawnNotify(args, extraEnv) {
  return spawnSync(process.execPath, [path.join(__dirname, 'notify.js'), ...args], {
    encoding: 'utf8',
    env: quietEnv(extraEnv),
    cwd: __dirname
  });
}

test('el proceso de notify sale distinto de 0 cuando send falla', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-'));
  const file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, JSON.stringify({
    failSend: true,
    clients: [{ id: 'cli-1', data: { name: 'Ana Ejemplo', push: { enabled: true, tokens: [TOKEN_LARGO] } } }]
  }));
  const res = spawnNotify(['--fixture', file]);
  const out = (res.stdout || '') + (res.stderr || '');
  assert.notEqual(res.status, 0);
  assert.match(out, /fcm mock down/);
  assert.match(out, /OK=\d+ FAIL=[1-9]/);
  assert.equal(out.includes(TOKEN_LARGO), false);
});

test('notify sin trabajo y un Firestore caído', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-'));
  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({ clients: [] }));
  const ok = spawnNotify(['--fixture', empty]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /OK=0 FAIL=0/);

  const down = path.join(dir, 'down.json');
  fs.writeFileSync(down, JSON.stringify({ firestoreError: 'firestore mock down', clients: [] }));
  const bad = spawnNotify(['--fixture', down]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /firestore mock down/);
  assert.equal((bad.stdout + bad.stderr).includes('private_key'), false);
});

test('sin el secreto no se imprime el valor', () => {
  const res = spawnNotify([], { FIREBASE_SERVICE_ACCOUNT: 'not-json' });
  const out = (res.stdout || '') + (res.stderr || '');
  assert.notEqual(res.status, 0);
  assert.match(out, /no es JSON válido/);
  assert.equal(out.includes('not-json'), false);
});
