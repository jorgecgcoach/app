const test = require('node:test');
const assert = require('node:assert/strict');
const id = require('./code-identity');

test('normaliza mayúsculas y espacios', function () {
  assert.equal(id.normAuthCode('  demo-1234 '), 'DEMO-1234');
});

test('el email no contiene el código y es estable', async function () {
  const email = await id.clientEmailFromCode('demo-1234');
  const again = await id.clientEmailFromCode('DEMO-1234');
  assert.equal(email, again);
  assert.match(email, /^c[0-9a-f]{32}@clients\.appjorgecgcoach\.app$/);
  assert.equal(email.includes('DEMO'), false);
  assert.equal(email.includes('1234'), false);
  const other = await id.clientEmailFromCode('EJEMPLO-7K');
  assert.notEqual(email, other);
});

test('vector fijo del email de DEMO-1234', async function () {
  // Si este valor cambia, la app y la migración dejarían de reconocer las mismas cuentas.
  assert.equal(
    await id.clientEmailFromCode('DEMO-1234'),
    'c' + require('crypto').createHash('sha256').update('jcgcoach-client-v1|DEMO-1234').digest('hex').slice(0, 32) + '@clients.appjorgecgcoach.app'
  );
});

test('la contraseña cumple el mínimo de Auth sin ser el código a secas', function () {
  const password = id.clientPasswordFromCode('ANA');
  assert.equal(password.length >= 6, true);
  assert.equal(password, 'ANA' + id.PUBLIC_PASSWORD_SUFFIX);
  assert.notEqual(password, 'ANA');
});

test('rechaza códigos de menos de 3 caracteres', async function () {
  assert.throws(function () { id.clientPasswordFromCode('ab'); }, /short-code/);
  await assert.rejects(id.clientEmailFromCode('  a '), /short-code/);
});

test('detecta un documento de identidad sin sufijo y acepta el sufijo opcional', function () {
  assert.equal(id.looksLikeBareDni('00000000T'), true);
  assert.equal(id.looksLikeBareDni('00000000'), true);
  assert.equal(id.looksLikeBareDni('X0000000T'), true);
  assert.equal(id.looksLikeBareDni('00000000T-7K'), false);
  assert.equal(id.looksLikeBareDni('DEMO-1234'), false);
  assert.equal(id.looksLikeBareDni('EJEMPLO-7K'), false);
});

// Credenciales aleatorias (sustituyen a los códigos tipo documento de identidad).
test('genera códigos aleatorios de 60 bits con formato XXXX-XXXX-XXXX y sin letras confusas', function () {
  const vistos = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = id.generateClientCode();
    assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(id.isStrongCode(c), true);
    vistos.add(c);
  }
  assert.equal(vistos.size, 2000, 'sin repeticiones');
  assert.equal(id.CODE_BITS, 60);
  // Todos los símbolos aparecen (no hay sesgo grosero del generador).
  const letras = new Set([...Array.from(vistos).join('').replace(/-/g, '')]);
  assert.equal(letras.size, 32);
});

test('un código fuerte se reconoce aunque se escriba en minúsculas, con espacios o confundiendo O/0 e I/L/1', async function () {
  const c = '7K3M-Q9TB-0R1W';
  for (const escrito of ['7k3m-q9tb-0r1w', '7K3M Q9TB 0R1W', '7K3MQ9TB0R1W', '7K3M-Q9TB-OR1W', '7K3M-Q9TB-0RIW', '7k3m-q9tb-0rlw']) {
    assert.equal(id.normAuthCode(escrito), c, escrito);
    assert.equal(await id.clientEmailFromCode(escrito), await id.clientEmailFromCode(c));
    assert.equal(id.clientPasswordFromCode(escrito), id.clientPasswordFromCode(c));
  }
});

test('los códigos tipo documento de identidad o cortos NO son fuertes', function () {
  for (const debil of ['00000000T', 'X0000000T', 'DEMO-1234', 'ANA-3F9K', '00000000T-7K', '7K3M-Q9TB-0R1', '7K3M-Q9TB-0R1WX', 'UUUU-UUUU-UUUU']) {
    assert.equal(id.isStrongCode(debil), false, debil);
  }
});
