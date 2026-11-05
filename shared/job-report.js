'use strict';

/* Resumen de un job de avisos. FAIL>0 → código 1.
   No imprime secretos: redacta contraseñas conocidas y ristras largas
   (tokens) antes de guardar el motivo. */

function emptySummary() {
  return { ok: 0, fail: 0, skip: 0, failures: [], skips: [], notes: [] };
}

function addOk(summary, n) {
  summary.ok += n > 0 ? n : 1;
}

function addFail(summary, failure) {
  const count = failure && failure.count > 0 ? failure.count : 1;
  summary.fail += count;
  summary.failures.push(Object.assign({}, failure, { count }));
}

function addSkip(summary, skip) {
  summary.skip += 1;
  summary.skips.push(skip || {});
}

function redact(msg, env) {
  let out = String(msg == null ? 'error' : msg);
  const src = env || {};
  const secrets = [src.GMAIL_APP_PASSWORD, src.FIREBASE_SERVICE_ACCOUNT];
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join('[redactado]');
  }
  return out.replace(/[A-Za-z0-9:_\-]{40,}/g, '[redactado]').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function safeReason(err, env) {
  const msg = err && err.message ? err.message : err;
  return redact(msg, env || process.env);
}

function line(prefix, row) {
  let head = prefix + ' ' + (row.channel || 'envio');
  if (row.count > 1) head += ' ×' + row.count;
  const tail = [row.detail, row.reason].filter(Boolean).join(' · ');
  return tail ? head + ' · ' + tail : head;
}

function summaryLines(summary) {
  const lines = [];
  for (const failure of summary.failures) lines.push(line('FAIL', failure));
  for (const skip of summary.skips) lines.push(line('SKIP', skip));
  for (const note of summary.notes || []) lines.push(String(note));
  lines.push('OK=' + summary.ok + ' FAIL=' + summary.fail + ' SKIP=' + summary.skip);
  return lines;
}

function exitCode(summary) {
  return summary && summary.fail > 0 ? 1 : 0;
}

function reportAndExit(summary) {
  const code = summary ? exitCode(summary) : 1;
  const text = summary ? summaryLines(summary).join('\n') + '\n' : 'FAIL sin resumen\n';
  process.exitCode = code;
  process.stdout.write(text, () => process.exit(code));
}

module.exports = {
  emptySummary,
  addOk,
  addFail,
  addSkip,
  redact,
  safeReason,
  summaryLines,
  exitCode,
  reportAndExit
};
