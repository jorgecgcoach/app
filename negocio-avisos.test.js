'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const job = require('./negocio-avisos');
const report = require('./shared/job-report');

const TOKEN_POR_ID = 'fake-token-por-id';
const TOKEN_POR_NOMBRE = 'fake-token-por-nombre';
const TOKEN_COACH = 'fake-token-coach';
const TOKEN_LARGO = 'fake-token-' + 'z'.repeat(40);

function memoryDb({ meta, clients, contacts, contactsError }) {
  return {
    collection(name) {
      if (name === 'contacts') {
        return {
          async get() {
            if (contactsError) throw new Error(contactsError);
            const docs = (contacts || []).map((contact) => ({
              id: 'ct_' + contact.id,
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
                if (id === 'coach_data') return { exists: meta != null, data: () => meta };
                const row = clients && clients[id];
                return row ? { exists: true, data: () => row } : { exists: false, data: () => undefined };
              }
            };
          },
          async get() {
            const docs = Object.entries(clients || {}).map(([id, data]) => ({ id, data: () => data }));
            return { docs };
          }
        };
      }
      throw new Error('colección ' + name);
    }
  };
}

function transports() {
  const sent = { mail: [], push: [] };
  return {
    sent,
    mailer: {
      async sendMail(msg) { sent.mail.push(msg); }
    },
    messaging: {
      async sendEachForMulticast(msg) {
        sent.push.push(msg);
        return {
          successCount: msg.tokens.length,
          failureCount: 0,
          responses: msg.tokens.map(() => ({ success: true }))
        };
      }
    }
  };
}

function baseMeta(contracts, extra) {
  return Object.assign({
    negocio: Object.assign({
      cfg: { avisoDias: 14, emailCoach: 'coach@example.test' },
      contacts: [{ id: 7, nombre: 'Ana Ejemplo', clientId: 'cli-real' }],
      contracts,
      coachPush: { enabled: true, tokens: [TOKEN_COACH] }
    }, extra || {})
  });
}

function clients() {
  return {
    'cli-real': {
      name: 'Otra Persona',
      push: { enabled: true, tokens: [TOKEN_POR_ID] }
    },
    'cli-nombre': {
      name: 'Ana Ejemplo',
      push: { enabled: true, tokens: [TOKEN_POR_NOMBRE] }
    }
  };
}

function pago(over) {
  return Object.assign({
    id: 1,
    nombre: 'Ana Ejemplo',
    correo: 'ana@example.test',
    plan: 'Entreno 3m',
    estado: 'pendiente',
    inicio: '2026-01-01',
    dur: 3,
    congelado: 0,
    importe: 300,
    pagado: 0,
    prox: '2026-03-01',
    contactId: 7
  }, over || {});
}

async function run(opts) {
  const io = opts.io || transports();
  const summary = await job.runAvisos({
    db: opts.db,
    mailer: opts.mailer || io.mailer,
    messaging: opts.messaging || io.messaging,
    today: opts.today || '2026-03-01'
  });
  return { summary, sent: io.sent };
}

test('con contactId el push usa clientId y no el nombre', async () => {
  const { summary, sent } = await run({
    db: memoryDb({ meta: baseMeta([pago()]), clients: clients(), contacts: [] })
  });
  const clientPush = sent.push.find((msg) => msg.notification.title === 'Recordatorio de pago');
  assert.deepEqual(clientPush.tokens, [TOKEN_POR_ID]);
  assert.equal(JSON.stringify(report.summaryLines(summary)).includes(TOKEN_POR_ID), false);
  assert.equal(summary.fail, 0);
  assert.equal(report.exitCode(summary), 0);
  assert.ok(summary.ok >= 3);
  const tos = sent.mail.map((msg) => msg.to).sort();
  assert.deepEqual(tos, ['ana@example.test', 'coach@example.test']);
});

test('clientId directo gana al nombre si no hay contact.clientId', async () => {
  const meta = baseMeta([pago({ contactId: null, clientId: 'cli-real' })]);
  meta.negocio.contacts = [];
  const { sent } = await run({ db: memoryDb({ meta, clients: clients() }) });
  const clientPush = sent.push.find((msg) => msg.notification.title === 'Recordatorio de pago');
  assert.deepEqual(clientPush.tokens, [TOKEN_POR_ID]);
});

test('sin ids hace fallback por nombre en minúsculas, sin quitar tildes', async () => {
  const meta = baseMeta([pago({ contactId: null, nombre: 'Ana Ejemplo' })]);
  meta.negocio.contacts = [];
  const { sent } = await run({ db: memoryDb({ meta, clients: clients() }) });
  const clientPush = sent.push.find((msg) => msg.notification.title === 'Recordatorio de pago');
  assert.deepEqual(clientPush.tokens, [TOKEN_POR_NOMBRE]);

  const accent = baseMeta([pago({ contactId: null, nombre: 'Ána Ejemplo' })]);
  accent.negocio.contacts = [];
  const second = await run({ db: memoryDb({ meta: accent, clients: clients() }) });
  const missed = second.sent.push.find((msg) => msg.notification.title === 'Recordatorio de pago');
  assert.equal(missed, undefined);
  assert.equal(second.summary.fail, 0);
  assert.ok(second.summary.skips.some((skip) => skip.reason === 'sin match por nombre'));
});

test('un clientId sin tokens no cae al nombre y no es FAIL', async () => {
  const meta = baseMeta([pago({ contactId: null, clientId: 'cli-vacio' })]);
  const people = clients();
  people['cli-vacio'] = { name: 'Nadie', push: { enabled: true, tokens: [] } };
  const { summary, sent } = await run({ db: memoryDb({ meta, clients: people }) });
  assert.equal(sent.push.some((msg) => (msg.tokens || []).includes(TOKEN_POR_NOMBRE) && msg.notification.title === 'Recordatorio de pago'), false);
  assert.equal(summary.fail, 0);
  assert.ok(summary.skips.some((skip) => skip.detail === 'cliente via=clientId' && skip.reason === 'sin tokens'));
  assert.equal(report.exitCode(summary), 0);
});

test('la colección contacts aporta clientId si es más reciente', async () => {
  const meta = baseMeta([pago()]);
  meta.negocio.contacts = [{ id: 7, nombre: 'Ana Ejemplo', updatedAt: '2026-01-01T00:00:00Z' }];
  const { sent } = await run({
    db: memoryDb({
      meta,
      clients: clients(),
      contacts: [{ id: 7, clientId: 'cli-real', updatedAt: '2026-02-01T00:00:00Z' }]
    })
  });
  const clientPush = sent.push.find((msg) => msg.notification.title === 'Recordatorio de pago');
  assert.deepEqual(clientPush.tokens, [TOKEN_POR_ID]);
});

test('si falla la lectura de contacts el job no sigue a ciegas', async () => {
  await assert.rejects(
    () => run({
      db: memoryDb({
        meta: baseMeta([pago()]),
        clients: clients(),
        contactsError: 'contacts mock down'
      })
    }),
    /contacts mock down/
  );
});

test('fallo de sendMail y de sendEachForMulticast suben FAIL', async () => {
  const db = memoryDb({ meta: baseMeta([pago({ contactId: null })]), clients: clients() });
  const mailSummary = await job.runAvisos({
    db,
    today: '2026-03-01',
    messaging: transports().messaging,
    mailer: { async sendMail() { throw new Error('smtp mock down'); } }
  });
  assert.ok(mailSummary.fail >= 1);
  assert.equal(report.exitCode(mailSummary), 1);
  assert.match(report.summaryLines(mailSummary).join('\n'), /smtp mock down/);

  const pushSummary = await job.runAvisos({
    db,
    today: '2026-03-01',
    mailer: transports().mailer,
    messaging: {
      async sendEachForMulticast() {
        const err = new Error('fcm mock down ' + TOKEN_LARGO);
        throw err;
      }
    }
  });
  assert.ok(pushSummary.fail >= 1);
  assert.equal(report.summaryLines(pushSummary).join('\n').includes(TOKEN_LARGO), false);
  assert.match(report.summaryLines(pushSummary).join('\n'), /FAIL=\d+/);
  assert.match(report.summaryLines(pushSummary).join('\n'), /OK=/);
});

test('respuesta parcial de FCM cuenta como FAIL', async () => {
  const summary = await job.runAvisos({
    db: memoryDb({ meta: baseMeta([pago()]), clients: clients() }),
    today: '2026-03-01',
    mailer: transports().mailer,
    messaging: {
      async sendEachForMulticast(msg) {
        return {
          successCount: 0,
          failureCount: msg.tokens.length,
          responses: msg.tokens.map(() => ({ success: false, error: { message: 'fcm mock rejected' } }))
        };
      }
    }
  });
  assert.ok(summary.fail >= 1);
  assert.match(report.summaryLines(summary).join('\n'), /fcm mock rejected/);
});

test('sin contratos no envía y el código es 0 aunque el mailer explote', async () => {
  let called = false;
  const summary = await job.runAvisos({
    db: memoryDb({ meta: baseMeta([]), clients: {} }),
    today: '2026-03-01',
    mailer: { async sendMail() { called = true; throw new Error('no'); } },
    messaging: { async sendEachForMulticast() { called = true; throw new Error('no'); } }
  });
  assert.equal(called, false);
  assert.equal(summary.fail, 0);
  assert.equal(report.exitCode(summary), 0);
});

test('congelado, llamada agendada y días de congelación no disparan el aviso de ese día', async () => {
  const today = '2026-01-31';
  const renov = {
    nombre: 'Luis Ejemplo',
    correo: 'luis@example.test',
    plan: 'Entreno 1m',
    estado: 'pendiente',
    inicio: '2026-01-15',
    dur: 1,
    importe: 80,
    pagado: 0,
    prox: '2026-06-01'
  };
  const meta = baseMeta([renov]);
  meta.negocio.contacts = [];
  const open = await run({ db: memoryDb({ meta, clients: {} }), today });
  assert.equal(open.summary.renovs, 1);
  assert.ok(open.sent.mail.some((msg) => msg.subject.includes('Renovación')));
  assert.equal(open.sent.mail.some((msg) => msg.to === 'luis@example.test'), false);

  const frozen = Object.assign({}, renov, { frozenFrom: today });
  const frozenMeta = baseMeta([frozen]);
  frozenMeta.negocio.contacts = [];
  const held = await run({ db: memoryDb({ meta: frozenMeta, clients: {} }), today });
  assert.equal(held.summary.renovs, 0);
  assert.equal(held.sent.mail.length, 0);

  const scheduled = Object.assign({}, renov, { callDoneFor: '2026-02-14' });
  const scheduledMeta = baseMeta([scheduled]);
  scheduledMeta.negocio.contacts = [];
  const done = await run({ db: memoryDb({ meta: scheduledMeta, clients: {} }), today });
  assert.equal(done.summary.renovs, 0);

  const shifted = Object.assign({}, renov, { congeladoDias: 1 });
  const shiftedMeta = baseMeta([shifted]);
  shiftedMeta.negocio.contacts = [];
  const later = await run({ db: memoryDb({ meta: shiftedMeta, clients: {} }), today });
  assert.equal(later.summary.renovs, 0);
});

test('el push del coach sale de negocio.coachPush', async () => {
  const { sent } = await run({
    db: memoryDb({ meta: baseMeta([pago()]), clients: clients() })
  });
  const coach = sent.push.find((msg) => msg.notification.title === 'Cobro pendiente hoy');
  assert.deepEqual(coach.tokens, [TOKEN_COACH]);

  const legacy = baseMeta([pago()]);
  delete legacy.negocio.coachPush;
  legacy.push = { tokens: ['fake-token-legacy'] };
  const second = await run({ db: memoryDb({ meta: legacy, clients: clients() }) });
  const old = second.sent.push.find((msg) => msg.notification.title === 'Cobro pendiente hoy');
  assert.deepEqual(old.tokens, ['fake-token-legacy']);

  const off = baseMeta([pago()]);
  off.negocio.coachPush = { enabled: false, tokens: [TOKEN_COACH] };
  off.push = { tokens: ['fake-token-legacy'] };
  const third = await run({ db: memoryDb({ meta: off, clients: clients() }) });
  assert.equal(third.sent.push.some((msg) => msg.notification.title === 'Cobro pendiente hoy'), false);
});

function quietEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (/SECRET|PASSWORD|TOKEN|CREDENTIAL|FIREBASE_SERVICE|GMAIL|PRIVATE/i.test(key)) delete env[key];
  }
  return Object.assign(env, extra || {});
}

function spawnJob(args, extraEnv) {
  return spawnSync(process.execPath, [path.join(__dirname, 'negocio-avisos.js'), ...args], {
    encoding: 'utf8',
    env: quietEnv(extraEnv),
    cwd: __dirname
  });
}

function writeFixture(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-'));
  const file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

test('el proceso sale distinto de 0 si sendMail falla y resume OK/FAIL', () => {
  const file = writeFixture({
    today: '2026-03-01',
    failMail: true,
    meta: baseMeta([pago({ contactId: null })]),
    clients: {},
    contacts: []
  });
  const res = spawnJob(['--fixture', file]);
  const out = (res.stdout || '') + (res.stderr || '');
  assert.notEqual(res.status, 0);
  assert.match(out, /smtp mock down/);
  assert.match(out, /OK=\d+ FAIL=[1-9]\d*/);
  assert.equal(out.includes(TOKEN_POR_ID), false);
});

test('sin trabajo el proceso sale 0', () => {
  const file = writeFixture({
    today: '2026-03-01',
    failMail: true,
    meta: baseMeta([]),
    clients: {},
    contacts: []
  });
  const res = spawnJob(['--fixture', file]);
  const out = (res.stdout || '') + (res.stderr || '');
  assert.equal(res.status, 0, out);
  assert.match(out, /OK=0 FAIL=0/);
});

test('sin secretos el proceso sale 1 y no vuelca el valor', () => {
  const res = spawnJob([], {
    FIREBASE_SERVICE_ACCOUNT: 'not-json',
    GMAIL_APP_PASSWORD: 'mock-app-password'
  });
  const out = (res.stdout || '') + (res.stderr || '');
  assert.notEqual(res.status, 0);
  assert.match(out, /no es JSON válido/);
  assert.equal(out.includes('not-json'), false);
  assert.equal(out.includes('mock-app-password'), false);
});

test('los workflows quedan en Node 20 y el cron de negocio tiene margen', () => {
  const negocio = fs.readFileSync(path.join(__dirname, '.github/workflows/negocio-avisos.yml'), 'utf8');
  const notify = fs.readFileSync(path.join(__dirname, '.github/workflows/notify.yml'), 'utf8');
  assert.match(negocio, /node-version:\s*'20'/);
  assert.match(negocio, /cron:\s*'0 5 \* \* \*'/);
  assert.match(negocio, /1 h/);
  assert.match(negocio, /npm install firebase-admin nodemailer/);
  assert.match(notify, /node-version:\s*'20'/);
  assert.doesNotMatch(notify, /node-version:\s*'18'/);
  assert.match(notify, /npm install firebase-admin/);
  assert.match(notify, /cron:\s*'0 17 \* \* \*'/);
  const src = fs.readFileSync(path.join(__dirname, 'negocio-avisos.js'), 'utf8');
  assert.match(src, /negCoachAlerts/);
  assert.match(src, /negFin/);
  assert.doesNotMatch(src, /BEGIN PRIVATE KEY/);
});
