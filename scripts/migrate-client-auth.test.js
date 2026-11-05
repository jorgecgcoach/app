const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { planMigration, formatPlan } = require('./migrate-client-auth');

const FIXTURE = path.join(__dirname, 'fixtures', 'backup.sample.json');
const SCRIPT = path.join(__dirname, 'migrate-client-auth.js');
const ROOT = path.join(__dirname, '..');

const SECRET_BITS = ['DEMO-1234', '00000000T', 'EJEMPLO-7K', '0000', 'Cliente Ejemplo'];

test('el plan de la copia de ejemplo no revela códigos ni nombres', async function () {
  const dump = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const plan = await planMigration(dump);
  assert.equal(plan.totalClients, 4);
  assert.equal(plan.withCode, 3);
  assert.equal(plan.withoutCode, 1);
  assert.equal(plan.ignoredCoachSecret, true);
  const creates = plan.rows.filter(function (r) { return r.action === 'create'; });
  assert.equal(creates.length, 3);
  assert.equal(creates.filter(function (r) { return r.dniLike; }).length, 1);
  const text = JSON.stringify(plan) + '\n' + formatPlan(plan);
  SECRET_BITS.forEach(function (bit) {
    assert.equal(text.includes(bit), false, 'no debería aparecer: ' + bit);
  });
  assert.match(formatPlan(plan), /dry-run/);
});

test('la CLI en dry-run termina sin red y sin datos de ejemplo en claro', function () {
  const env = Object.assign({}, process.env);
  delete env.FIRESTORE_EMULATOR_HOST;
  delete env.FIREBASE_AUTH_EMULATOR_HOST;
  delete env.ALLOW_AUTH_MIGRATION_APPLY;
  delete env.FIREBASE_SERVICE_ACCOUNT;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  const res = spawnSync(process.execPath, [SCRIPT, '--backup', FIXTURE], {
    env: env,
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /No se ha escrito nada/);
  SECRET_BITS.forEach(function (bit) {
    assert.equal(res.stdout.includes(bit), false);
    assert.equal((res.stderr || '').includes(bit), false);
  });
});

test('--apply no toca producción si nadie ha dado el permiso explícito', function () {
  const env = Object.assign({}, process.env);
  delete env.FIRESTORE_EMULATOR_HOST;
  delete env.FIREBASE_AUTH_EMULATOR_HOST;
  delete env.ALLOW_AUTH_MIGRATION_APPLY;
  delete env.FIREBASE_SERVICE_ACCOUNT;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  const res = spawnSync(process.execPath, [SCRIPT, '--backup', FIXTURE, '--apply'], {
    env: env,
    encoding: 'utf8'
  });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /No se ha aplicado nada/);
});

test('el flag de la app sigue apagado y las reglas siguen con el marcador', function () {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  assert.match(html, /const AUTH_ENABLED=false;/);
  assert.match(html, /const CONTACTS_COLLECTION=false;/);
  assert.match(html, /function ensureAuth\(/);
  assert.match(html, /function loadCoachDataAfterAuth\(/);
  assert.match(html, /function loadClientAfterAuth\(/);
  assert.match(rules, /REEMPLAZAR_UID_DEL_COACH/);
  assert.match(rules, /request\.auth\.token\.role == 'coach'/);
});
