'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const report = require('./job-report');

test('redacta secretos y tokens largos', () => {
  const token = 'a'.repeat(48);
  const text = report.redact('fallo ' + token + ' clave secret-value-xyz', {
    GMAIL_APP_PASSWORD: 'secret-value-xyz'
  });
  assert.equal(text.includes(token), false);
  assert.equal(text.includes('secret-value-xyz'), false);
  assert.match(text, /\[redactado\]/);
});

test('FAIL>0 da código 1 y el log lleva OK= y FAIL=', () => {
  const summary = report.emptySummary();
  report.addOk(summary, 1);
  report.addFail(summary, { channel: 'email', detail: 'ana@example.test', reason: 'smtp mock down' });
  report.addSkip(summary, { channel: 'push', detail: 'cliente via=name', reason: 'sin tokens' });
  const lines = report.summaryLines(summary);
  assert.match(lines.join('\n'), /FAIL email · ana@example\.test · smtp mock down/);
  assert.match(lines.join('\n'), /SKIP push · cliente via=name · sin tokens/);
  assert.match(lines.join('\n'), /OK=1 FAIL=1 SKIP=1/);
  assert.equal(report.exitCode(summary), 1);
  assert.equal(report.exitCode(report.emptySummary()), 0);
});
