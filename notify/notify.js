/* =======================================================================
   notify.js  ·  Recordatorio de seguimiento semanal
   -----------------------------------------------------------------------
   Lista clients con el Admin SDK. La cuenta de servicio no pasa por
   firestore.rules, así que sigue pudiendo leer todas las fichas cuando
   las reglas de Auth cierren el acceso de cliente.

   Un envío que falla cuenta como FAIL (el proceso sale 1), salvo el token
   inválido o no registrado: se quita de la ficha y cuenta como SKIP.
   Sin clientes con push no hay trabajo: exit 0.
   --fixture es solo para pruebas locales. El workflow no lo usa.
   ======================================================================= */
'use strict';

const report = require('../shared/job-report');

const COACH_DOC = 'coach_data';
const INVALID_TOKEN = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);

function snapshotDocs(snapshot) {
  if (!snapshot) return [];
  if (Array.isArray(snapshot.docs)) return snapshot.docs;
  const docs = [];
  if (typeof snapshot.forEach === 'function') snapshot.forEach((doc) => docs.push(doc));
  return docs;
}

async function sendNotifications(deps) {
  const summary = report.emptySummary();
  const snapshot = await deps.db.collection('clients').get();
  for (const doc of snapshotDocs(snapshot)) {
    if (!doc || doc.id === COACH_DOC) continue;
    const client = (typeof doc.data === 'function' ? doc.data() : doc.data) || {};
    const push = client.push;
    if (!push || !push.enabled || !Array.isArray(push.tokens) || !push.tokens.length) continue;
    const kept = [];
    let removed = false;
    for (const token of push.tokens) {
      if (typeof token !== 'string' || !token.trim()) continue;
      try {
        await deps.messaging.send({
          token,
          notification: {
            title: '📋 Completa tu seguimiento',
            body: '¡Hola ' + (client.name || '') + '! No olvides actualizar tu seguimiento semanal.'
          }
        });
        report.addOk(summary, 1);
        kept.push(token);
      } catch (err) {
        if (INVALID_TOKEN.has(err && err.code)) {
          removed = true;
          report.addSkip(summary, { channel: 'push', reason: err.code });
        } else {
          kept.push(token);
          report.addFail(summary, { channel: 'push', reason: report.safeReason(err) });
        }
      }
    }
    if (removed) {
      try {
        await deps.db.collection('clients').doc(doc.id).update({
          push: Object.assign({}, push, { tokens: kept })
        });
      } catch (err) {
        report.addFail(summary, {
          channel: 'push',
          detail: 'limpieza de token',
          reason: report.safeReason(err)
        });
      }
    }
  }
  summary.notes.push(summary.ok + summary.fail + summary.skip
    ? 'Seguimiento revisado'
    : 'Sin avisos de seguimiento');
  return summary;
}

function parseServiceAccount(raw) {
  if (raw == null || !String(raw).trim()) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no es JSON válido');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT incompleto');
  }
  return parsed;
}

function readJsonFile(file) {
  if (!file) throw new Error('Falta la ruta de --fixture');
  const fs = require('fs');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    throw new Error('No se pudo leer el fixture');
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error('Fixture no es JSON válido');
  }
}

async function runFixture(file) {
  const fixture = readJsonFile(file);
  const clients = Array.isArray(fixture.clients) ? fixture.clients : [];
  const db = {
    collection() {
      return {
        async get() {
          if (fixture.firestoreError) throw new Error(fixture.firestoreError);
          return {
            docs: clients.map((client) => ({
              id: client.id,
              data: () => client.data || client
            }))
          };
        },
        doc(id) {
          return {
            async update(payload) {
              if (fixture.updateError) throw new Error(fixture.updateError);
              if (!Array.isArray(fixture.updates)) fixture.updates = [];
              fixture.updates.push({ id, payload });
            }
          };
        }
      };
    }
  };
  const messaging = {
    async send(msg) {
      const bad = fixture.invalidTokens || [];
      if (bad.indexOf(msg.token) !== -1) {
        const err = new Error('token inválido');
        err.code = fixture.invalidCode || 'messaging/invalid-registration-token';
        throw err;
      }
      if (fixture.failSend) {
        const err = new Error(fixture.sendError || 'fcm mock down');
        err.code = 'messaging/internal-error';
        throw err;
      }
      return { mock: true };
    }
  };
  return sendNotifications({ db, messaging });
}

async function runProduction(env) {
  const source = env || process.env;
  const serviceAccount = parseServiceAccount(source.FIREBASE_SERVICE_ACCOUNT);
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://jcgcoach.firebaseio.com'
    });
  }
  return sendNotifications({
    db: admin.firestore(),
    messaging: admin.messaging()
  });
}

async function cli(argv, env) {
  const args = argv.slice(2);
  const fixtureAt = args.indexOf('--fixture');
  if (fixtureAt !== -1) return runFixture(args[fixtureAt + 1]);
  return runProduction(env || process.env);
}

if (require.main === module) {
  cli(process.argv, process.env).then((summary) => {
    report.reportAndExit(summary);
  }).catch((err) => {
    const msg = err && err.message ? err.message : 'error';
    process.exitCode = 1;
    process.stderr.write(msg + '\n', () => process.exit(1));
  });
}

module.exports = { sendNotifications, cli, parseServiceAccount };
