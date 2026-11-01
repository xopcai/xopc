import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, macPackagedTarget, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

const argument = (name: string) => { const index = process.argv.indexOf(name); assert(index >= 0 && process.argv[index + 1]); return process.argv[index + 1]; };
const target = await macPackagedTarget(argument('--app')), previous = await macPackagedTarget(argument('--from-app'));
const schemaArg = process.argv.indexOf('--to-schema');
const toSchema = schemaArg < 0 ? 266 : Number(process.argv[schemaArg + 1]);
assert(Number.isSafeInteger(toSchema) && toSchema >= 266 && toSchema <= 267, 'Unsupported audit upgrade target');
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/endpoint-audit-upgrade-installed.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-audit-upgrade-')), token = randomUUID(), auditId = randomUUID();
const report: any = { passed: false, scope: `Actual packaged v265 Gateway creates the isolated DB, then the candidate performs the offline v${toSchema} upgrade, backup and authenticated audit read. Synthetic historical metadata only.`, checks: {}, startedAt: new Date().toISOString() };
let child: ReturnType<typeof spawn> | undefined, logs = '';
async function stop() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  try { await withTimeout(ended, 10000, 'Upgrade Gateway cleanup timeout'); }
  catch { child.kill('SIGKILL'); await ended; throw new Error('Upgrade Gateway required forced cleanup'); }
  child = undefined;
}
try {
  report.previousBefore = await installedAppFingerprint(previous.application); report.packageBefore = await installedAppFingerprint(target.application);
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address(); assert(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`, config = join(state, 'xopc.json'), workspace = join(state, 'workspace'), path = join(state, 'xopc.db');
  await mkdir(workspace); await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }));
  const start = async (app: typeof target) => {
    let failed: Error | undefined;
    child = spawn(app.executablePath, [app.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'],
      { cwd: state, env: packagedGatewayEnvironment(localConnectionEnvironment(process.env, process.cwd(), state, config, workspace), app), stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', error => { failed = error; });
    const collect = (chunk: Buffer) => { logs = (logs + chunk.toString().replaceAll(token, '[owner-redacted]')).slice(-12000); };
    child.stdout!.on('data', collect); child.stderr!.on('data', collect);
    await withTimeout((async () => { for (;;) {
      if (failed) throw failed;
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error('Upgrade Gateway exited before readiness');
      try { if ((await fetch(origin + '/api/endpoint-tools/invocations', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* Still starting. */ }
      await delay(100);
    } })(), 30000, 'Upgrade Gateway readiness timeout');
  };
  await start(previous); await stop();
  const old = new DatabaseSync(path);
  try {
    assert.equal(old.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value, '265');
    assert(!(old.prepare('PRAGMA table_info(endpoint_tool_invocations)').all() as { name: string }[]).some(column => column.name === 'operation_id'));
    old.prepare(`INSERT INTO endpoint_tool_invocations(id,principal_id,endpoint_id,tool_call_id,tool_name,effect,confirmation_required,
      arguments_sha256,status,started_at,completed_at) VALUES (?,?,?,?,?,'write',1,?,'succeeded',10,20)`)
      .run(auditId, 'historical-device', 'historical-endpoint', 'historical-call', 'desktop.file.save', 'a'.repeat(64));
  } finally { old.close(); }
  report.checks.realPreviousSchema = true;
  await start(target);
  const response = await fetch(origin + '/api/endpoint-tools/invocations', { headers: { authorization: `Bearer ${token}` } }); assert.equal(response.status, 200);
  const page = (await response.json()).payload; assert.equal(page.total, 1);
  assert.equal(page.items[0].id, auditId); assert.equal(page.items[0].status, 'succeeded'); assert.equal(page.items[0].argumentsSha256, 'a'.repeat(64));
  assert(!('operationId' in page.items[0])); report.checks.historyPreservedOverHttp = true;
  await stop();
  const current = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(current.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value, String(toSchema));
    assert.equal(current.prepare('SELECT operation_id FROM endpoint_tool_invocations WHERE id=?').get(auditId)?.operation_id, null);
    if (toSchema >= 267) {
      assert.equal(current.prepare('SELECT count(*) AS count FROM desktop_execution_grants').get()?.count, 0);
      assert(current.prepare('PRAGMA table_info(capability_operations)').all().some(column => column.name === 'desktop_intent_json'));
      report.checks.reliableExecutionSchema = true;
    }
    assert.equal(current.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok'); assert.deepEqual(current.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { current.close(); }
  report.checks.newSchemaIntegrity = true;
  const backups = (await readdir(state)).filter(name => name.startsWith('xopc.db.pre-upgrade-v265-') && name.endsWith('.bak')); assert.equal(backups.length, 1);
  const backupPath = join(state, backups[0]); assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    assert.equal(backup.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value, '265');
    assert.equal(backup.prepare('SELECT status FROM endpoint_tool_invocations WHERE id=?').get(auditId)?.status, 'succeeded');
    assert.equal(backup.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally { backup.close(); }
  report.checks.offlineBackupPreserved = true; report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : String(error); report.logs = logs.replaceAll(token, '[owner-redacted]'); process.exitCode = 1; }
finally {
  try { await stop(); } catch (error) { report.passed = false; report.cleanupError = String(error); process.exitCode = 1; }
  report.previousAfter = await installedAppFingerprint(previous.application); report.packageAfter = await installedAppFingerprint(target.application);
  if (report.previousBefore?.sha256 !== report.previousAfter.sha256 || report.packageBefore?.sha256 !== report.packageAfter.sha256) { report.passed = false; report.packageChanged = true; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rm(state, { recursive: true, force: true }); console.log(JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error }));
}
