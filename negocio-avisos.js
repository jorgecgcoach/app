/* =======================================================================
   negocio-avisos.js  ·  Avisos diarios de Negocio (I'M FIT)
   -----------------------------------------------------------------------
   Lee clients/coach_data con el Admin SDK (la cuenta de servicio no pasa
   por firestore.rules: cuando el PR de Auth cierre las reglas, este job
   sigue leyendo). Cada día:

     • Pago con saldo y próximo pago HOY, si no está congelado
         → correo al cliente + correo al coach + push a ambos
     • Fin de contrato exactamente a avisoDias (por defecto 14), si no está
       congelado y la videollamada no está agendada
         → correo y push al coach

   Fechas y filtros: shared/negocio-alert-rules.js, paridad con negFin,
   negProx, negIsFrozen, negCallScheduled y negCoachAlerts. La app muestra
   una ventana (0..avisoDias / pagos a ≤14 días); aquí se avisa solo el
   día del borde para no repetir el correo cada mañana.

   Push al cliente, en este orden (no se inventan ids):
     1. contactId → negocio.contacts (y la colección contacts, si tiene
        un updatedAt más reciente) → contact.clientId → clients/{id}.push
     2. clientId directo en el contrato
     3. Fallback por nombre: trim + minúsculas, el índice de antes.
        No es el crmKey de la app (ese quita tildes). Si el id existe pero
        no hay tokens, no se salta al nombre: sería otra persona.
   Sin tokens → SKIP, no FAIL. Un envío que sí se intenta y falla → FAIL.
   Al final: OK=n FAIL=m. Si FAIL>0 el proceso sale 1.

   --fixture <json> es solo para pruebas locales con datos ficticios.
   El workflow no lo usa y no lee secretos.

   SECRETOS (Settings → Secrets), sin imprimirlos:
     FIREBASE_SERVICE_ACCOUNT, GMAIL_APP_PASSWORD
   ======================================================================= */
'use strict';

const rules = require('./shared/negocio-alert-rules');
const report = require('./shared/job-report');

const COACH_DOC = 'coach_data';
const EMAIL_COACH_DEFAULT = 'jorgecgcoach@gmail.com';

function normName(s) {
  return String(s || '').trim().toLowerCase();
}

function snapshotDocs(snapshot) {
  if (!snapshot) return [];
  if (Array.isArray(snapshot.docs)) return snapshot.docs;
  const docs = [];
  if (typeof snapshot.forEach === 'function') snapshot.forEach((doc) => docs.push(doc));
  return docs;
}

function tokensOf(client) {
  if (!client || !client.push || !client.push.enabled) return [];
  if (!Array.isArray(client.push.tokens)) return [];
  return client.push.tokens.filter((token) => typeof token === 'string' && token.trim());
}

/* Tokens del coach. La app los guarda en negocio.coachPush (enableCoachNotifications).
   meta.push se mantiene solo como legado si coachPush aún no existe. Si el coach
   lo apagó (enabled false), no se usa el legado. */
function coachTokens(meta) {
  const neg = (meta && meta.negocio) || {};
  if (neg.coachPush && typeof neg.coachPush === 'object') {
    if (!neg.coachPush.enabled || !Array.isArray(neg.coachPush.tokens)) return [];
    return neg.coachPush.tokens.filter((token) => typeof token === 'string' && token.trim());
  }
  if (meta && meta.push && Array.isArray(meta.push.tokens)) {
    return meta.push.tokens.filter((token) => typeof token === 'string' && token.trim());
  }
  return [];
}

function rememberContact(map, contact, overlay) {
  if (!contact || contact.id == null || contact.id === '') return;
  const key = String(contact.id);
  const prev = map.get(key);
  if (!prev) {
    map.set(key, contact);
    return;
  }
  if (overlay && String(contact.updatedAt || '') > String(prev.updatedAt || '')) map.set(key, contact);
}

/* coach_data.negocio.contacts es la copia que usa la app hoy.
   La colección contacts (flag del PR de Auth, aún apagado) se mezcla igual
   que mergeContactsFromCollection: gana el updatedAt más nuevo. Si esa
   lectura falla, el job falla: no queremos el fallback por nombre con el
   vínculo a medias. */
async function loadContacts(db, embedded) {
  const map = new Map();
  for (const contact of embedded || []) rememberContact(map, contact, false);
  const snap = await db.collection('contacts').get();
  for (const doc of snapshotDocs(snap)) {
    const data = typeof doc.data === 'function' ? doc.data() : doc.data;
    rememberContact(map, data || {}, true);
  }
  return map;
}

function indexClients(docs) {
  const clientsById = new Map();
  const clientsByName = new Map();
  for (const doc of docs) {
    if (!doc || doc.id === COACH_DOC) continue;
    const data = typeof doc.data === 'function' ? doc.data() : doc.data;
    const row = Object.assign({ id: doc.id }, data || {});
    clientsById.set(doc.id, row);
    const name = normName(row.name);
    if (name) clientsByName.set(name, row);
  }
  return { clientsById, clientsByName };
}

function resolveClientPush(row, ctx) {
  const notes = [];
  let clientId = '';
  let via = '';
  const contactId = row && row.contactId != null && String(row.contactId).trim() !== ''
    ? String(row.contactId).trim()
    : '';
  if (contactId) {
    const contact = ctx.contactsById.get(contactId);
    if (!contact) notes.push('contactId ' + contactId + ' no está en contacts');
    else if (contact.clientId != null && String(contact.clientId).trim()) {
      clientId = String(contact.clientId).trim();
      via = 'contact.clientId';
    }
  }
  if (!clientId && row && row.clientId != null && String(row.clientId).trim()) {
    clientId = String(row.clientId).trim();
    via = 'clientId';
  }
  if (clientId) {
    if (clientId === COACH_DOC) {
      return { tokens: [], skip: true, via, clientId, reason: 'clientId es coach_data', notes };
    }
    const doc = ctx.clientsById.get(clientId);
    if (!doc) return { tokens: [], skip: true, via, clientId, reason: 'cliente no encontrado', notes };
    const tokens = tokensOf(doc);
    if (!tokens.length) return { tokens: [], skip: true, via, clientId, reason: 'sin tokens', notes };
    return { tokens, skip: false, via, clientId, notes };
  }
  const name = normName(row && row.nombre);
  via = 'name';
  if (!name) return { tokens: [], skip: true, via, reason: 'sin nombre ni clientId', notes };
  const doc = ctx.clientsByName.get(name);
  if (!doc) return { tokens: [], skip: true, via, reason: 'sin match por nombre', notes };
  const tokens = tokensOf(doc);
  if (!tokens.length) return { tokens: [], skip: true, via, clientId: doc.id, reason: 'sin tokens', notes };
  return { tokens, skip: false, via, clientId: doc.id, notes };
}

async function deliverEmail(mailer, summary, to, subject, text) {
  if (!to) {
    report.addSkip(summary, { channel: 'email', detail: subject, reason: 'sin destinatario' });
    return;
  }
  try {
    await mailer.sendMail({
      from: 'JorgeCGCoach <' + EMAIL_COACH_DEFAULT + '>',
      to,
      subject,
      text
    });
    report.addOk(summary, 1);
    summary.notes.push('email ' + to + ' · ' + subject);
  } catch (err) {
    report.addFail(summary, {
      channel: 'email',
      detail: String(to),
      reason: report.safeReason(err)
    });
  }
}

function pushReason(res) {
  const responses = (res && res.responses) || [];
  const msgs = [];
  for (const row of responses) {
    if (row && row.success === false && row.error) {
      const reason = report.safeReason(row.error);
      if (reason && msgs.indexOf(reason) === -1) msgs.push(reason);
    }
  }
  return msgs.join('; ');
}

async function deliverPush(messaging, summary, tokens, title, body, detail) {
  const list = (tokens || []).filter((token) => typeof token === 'string' && token.trim());
  if (!list.length) {
    report.addSkip(summary, { channel: 'push', detail, reason: 'sin tokens' });
    return;
  }
  try {
    const res = await messaging.sendEachForMulticast({
      tokens: list,
      notification: { title, body }
    });
    const successCount = res && typeof res.successCount === 'number' ? res.successCount : list.length;
    const failureCount = res && typeof res.failureCount === 'number' ? res.failureCount : 0;
    if (successCount > 0) report.addOk(summary, successCount);
    if (failureCount > 0) {
      report.addFail(summary, {
        channel: 'push',
        detail,
        reason: pushReason(res) || 'envío rechazado',
        count: failureCount
      });
    }
  } catch (err) {
    report.addFail(summary, {
      channel: 'push',
      detail,
      reason: report.safeReason(err),
      count: 1
    });
  }
}

async function runAvisos(deps) {
  const summary = report.emptySummary();
  const metaSnap = await deps.db.collection('clients').doc(COACH_DOC).get();
  if (!metaSnap || !metaSnap.exists) {
    summary.notes.push('No hay coach_data.');
    summary.notes.push('Hecho. Pagos avisados: 0 · Renovaciones avisadas: 0');
    return summary;
  }
  const meta = metaSnap.data() || {};
  const neg = meta.negocio || {};
  const contracts = Array.isArray(neg.contracts) ? neg.contracts : [];
  const cfg = neg.cfg || {};
  const emailCoach = cfg.emailCoach || EMAIL_COACH_DEFAULT;
  const today = deps.today || rules.todayISOMadrid(deps.now);
  const avisos = rules.dailyAvisos(contracts, { today, cfg });
  const ctx = indexClients(snapshotDocs(await deps.db.collection('clients').get()));
  ctx.contactsById = await loadContacts(deps.db, neg.contacts);
  const coachTok = coachTokens(meta);

  let pagos = 0;
  let renovs = 0;
  for (const item of avisos.pagos) {
    const c = item.c;
    pagos += 1;
    await deliverEmail(
      deps.mailer,
      summary,
      c.correo,
      "Recordatorio de pago — I'M FIT",
      'Hola ' + (c.nombre || '') + ':\n\nTe recuerdo que hoy toca renovar/pagar tu plan (' + (c.plan || '') + '). En cuanto lo tengas hecho, avísame.\n\n¡Gracias!\nJorge'
    );
    await deliverEmail(
      deps.mailer,
      summary,
      emailCoach,
      '💶 Cobro pendiente hoy · ' + (c.nombre || ''),
      'Vence hoy el pago de ' + (c.nombre || '') + ' (' + (c.plan || '') + '). Importe: ' + c.importe + ' €.'
    );
    await deliverPush(
      deps.messaging,
      summary,
      coachTok,
      'Cobro pendiente hoy',
      (c.nombre || '') + ' — ' + c.importe + ' €',
      'coach'
    );
    const resolved = resolveClientPush(c, ctx);
    for (const note of resolved.notes) summary.notes.push(note);
    if (resolved.skip) {
      report.addSkip(summary, {
        channel: 'push',
        detail: 'cliente via=' + resolved.via,
        reason: resolved.reason
      });
    } else {
      await deliverPush(
        deps.messaging,
        summary,
        resolved.tokens,
        'Recordatorio de pago',
        'Hoy toca renovar tu plan (' + (c.plan || '') + ').',
        'cliente via=' + resolved.via
      );
    }
  }
  for (const item of avisos.renovaciones) {
    const c = item.c;
    renovs += 1;
    await deliverEmail(
      deps.mailer,
      summary,
      emailCoach,
      '🔔 Renovación en ' + avisos.avisoDias + ' días · ' + (c.nombre || ''),
      'A ' + (c.nombre || '') + ' se le acaba el plan (' + (c.plan || '') + ') el ' + item.fin + '. Agenda la llamada de cierre.'
    );
    await deliverPush(
      deps.messaging,
      summary,
      coachTok,
      'Renovación en ' + avisos.avisoDias + ' días',
      (c.nombre || '') + ' acaba el ' + item.fin + '. Agenda la llamada.',
      'coach'
    );
  }
  summary.pagos = pagos;
  summary.renovs = renovs;
  summary.notes.push(
    'Hecho. Pagos avisados: ' + pagos +
    ' · Renovaciones avisadas: ' + renovs +
    ' · Congelados omitidos: ' + avisos.congelados +
    ' · Llamadas ya agendadas: ' + avisos.llamadasAgendadas
  );
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

function dbFromFixture(fixture) {
  const clients = fixture.clients || {};
  const contacts = Array.isArray(fixture.contacts) ? fixture.contacts : [];
  const meta = Object.prototype.hasOwnProperty.call(fixture, 'meta') ? fixture.meta : null;
  return {
    collection(name) {
      if (name === 'contacts') {
        if (fixture.contactsError) {
          return { get: async () => { throw new Error(fixture.contactsError); } };
        }
        return {
          async get() {
            const docs = contacts.map((contact, index) => ({
              id: contact.docId || ('ct_' + (contact.id != null ? contact.id : index)),
              data: () => contact
            }));
            return { docs };
          }
        };
      }
      if (name === 'clients') {
        return {
          doc(id) {
            return {
              async get() {
                if (id === COACH_DOC) return { exists: meta != null, data: () => meta };
                if (!Object.prototype.hasOwnProperty.call(clients, id)) {
                  return { exists: false, data: () => undefined };
                }
                return { exists: true, data: () => clients[id] };
              }
            };
          },
          async get() {
            const docs = Object.keys(clients).map((id) => ({ id, data: () => clients[id] }));
            return { docs };
          }
        };
      }
      throw new Error('colección no usada: ' + name);
    }
  };
}

function transportsFromFixture(fixture) {
  return {
    mailer: {
      async sendMail() {
        if (fixture.failMail) throw new Error(fixture.mailError || 'smtp mock down');
        return { mock: true };
      }
    },
    messaging: {
      async sendEachForMulticast(msg) {
        if (fixture.failPush) throw new Error(fixture.pushError || 'fcm mock down');
        const tokens = msg.tokens || [];
        const n = Math.min(fixture.pushFailureCount || 0, tokens.length);
        return {
          successCount: tokens.length - n,
          failureCount: n,
          responses: tokens.map((_, index) => (
            index < n
              ? { success: false, error: { message: fixture.pushError || 'fcm mock rejected' } }
              : { success: true }
          ))
        };
      }
    }
  };
}

async function runFixture(file) {
  const fixture = readJsonFile(file);
  const transports = transportsFromFixture(fixture);
  return runAvisos({
    db: dbFromFixture(fixture),
    mailer: transports.mailer,
    messaging: transports.messaging,
    today: fixture.today
  });
}

async function runProduction(env) {
  const source = env || process.env;
  const serviceAccount = parseServiceAccount(source.FIREBASE_SERVICE_ACCOUNT);
  if (!source.GMAIL_APP_PASSWORD) throw new Error('Falta GMAIL_APP_PASSWORD');
  const admin = require('firebase-admin');
  const nodemailer = require('nodemailer');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  const mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_COACH_DEFAULT, pass: source.GMAIL_APP_PASSWORD }
  });
  return runAvisos({
    db: admin.firestore(),
    messaging: admin.messaging(),
    mailer,
    now: new Date()
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

module.exports = {
  runAvisos,
  resolveClientPush,
  coachTokens,
  cli,
  parseServiceAccount,
  COACH_DOC,
  EMAIL_COACH_DEFAULT
};
