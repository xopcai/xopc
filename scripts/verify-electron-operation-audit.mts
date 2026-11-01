import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, macPackagedTarget, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../src/storage/sqlite/index.js';
import { startEndpointToolInvocationAudit } from '../src/storage/sqlite/endpoint-tool-invocation-repository.js';
import { createDevice, issueDeviceTokenPair } from '../src/storage/sqlite/device-access-repository.js';
import { getOrCreateGatewayIdentity } from '../src/storage/sqlite/gateway-identity-repository.js';
import { verifyDesktopAuthorityResponse } from '../src/endpoint-tools/desktop-authority-response.js';
import { proofDigest, requestProofMessage } from '../src/gateway/security/device-request-proof.js';

const index = process.argv.indexOf('--app'); assert(index >= 0 && process.argv[index + 1]);
const target = await macPackagedTarget(process.argv[index + 1]);
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/endpoint-operation-audit-installed.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-audit-installed-'));
const report: any = { passed: false, scope: 'Actual installed bundled Gateway HTTP auth/audit query with synthetic pre-seeded metadata; no OS tool execution or native consent claim.', checks: {}, startedAt: new Date().toISOString() };
let child: ReturnType<typeof spawn> | undefined, spawnError: Error | undefined, logs = '', accessToken = '';
const token = randomUUID(), ownId = randomUUID(), otherId = randomUUID(), operationId = randomUUID(), otherOperationId = randomUUID();
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const redact = (text: string) => text.replaceAll(token, '[owner-redacted]').replaceAll(accessToken || 'never-a-token', '[device-redacted]');
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address(); assert(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`, config = join(state, 'xopc.json'), workspace = join(state, 'workspace');
  await mkdir(workspace); await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }));
  // Seed while no Gateway owns this isolated DB; the packaged process is its sole owner afterward.
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(state, 'xopc.db') });
  const identity = getOrCreateGatewayIdentity(), gatewayId = identity.id;
  const executionDevice = process.argv.includes('--execution-grants') ? createDevice({ displayName: 'Execution grant fixture', platform: 'desktop',
    publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) as any, scopes: ['gateway.status', 'device.self'] }) : undefined;
  const executionToken = executionDevice ? issueDeviceTokenPair(executionDevice.id).accessToken : undefined;
  createDevice({ id: ownId, displayName: 'Audit fixture', platform: 'android', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) as any, scopes: ['device.self'] });
  accessToken = issueDeviceTokenPair(ownId).accessToken;
  for (const n of [0, 1, 2]) startEndpointToolInvocationAudit({ id: randomUUID(), principalId: n < 2 ? ownId : otherId,
    endpointId: 'fixture', toolCallId: 'fixture', toolName: 'desktop.file.save', effect: 'write', confirmationRequired: true,
    argumentsSha256: 'a'.repeat(64), operationId: n < 2 ? operationId : otherOperationId, startedAt: Date.now() });
  closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  child = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'],
    { cwd: state, env: packagedGatewayEnvironment(localConnectionEnvironment(process.env, process.cwd(), state, config, workspace), target), stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = (chunk: Buffer) => { logs = (logs + redact(chunk.toString())).slice(-12000); };
  child.on('error', error => { spawnError = error; });
  child.stdout!.on('data', collect); child.stderr!.on('data', collect);
  const route = '/api/endpoint-tools/invocations';
  await withTimeout((async () => {
    for (;;) {
      if (spawnError) throw spawnError;
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error('Bundled Gateway exited before readiness');
      try { if ((await fetch(origin + route, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* Startup may still be in progress. */ }
      await delay(100);
    }
  })(), 30000, 'Bundled audit route did not become ready');
  assert.equal((await fetch(origin + route)).status, 401); report.checks.unauthenticatedDenied = true;
  const owner = await fetch(origin + route + '?operationId=' + operationId, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(owner.status, 200); const page = (await owner.json()).payload;
  assert.equal(page.total, 2); assert(page.items.every((row: any) => row.operationId === operationId && !('arguments' in row))); report.checks.ownerOperationFilter = true;
  const deviceRequest = async (targetPath: string, method = 'GET', body?: unknown) => {
    const json = body === undefined ? undefined : JSON.stringify(body), contentType = json === undefined ? undefined : 'application/json';
    const proof = { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), digest: proofDigest(json ?? '') };
    const message = requestProofMessage({ gatewayId, credential: accessToken, method, target: targetPath,
      headers: name => name === 'content-type' ? contentType : undefined, proof });
    const signature = sign('sha256', Buffer.from(message), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const response = await fetch(origin + targetPath, { method, body: json, headers: { authorization: `Bearer ${accessToken}`,
      ...(contentType ? { 'content-type': contentType } : {}), 'X-Xopc-Proof': `${proof.timestamp}.${proof.nonce}.${proof.digest}.${signature}` } });
    if (targetPath === '/api/desktop-host/execution' && response.ok) verifyDesktopAuthorityResponse({ status: response.status, body: await response.clone().json() },
      { gatewayId, deviceId: executionDevice!.id, nonce: proof.nonce, method, target: targetPath }, identity.publicKey);
    return response;
  };
  const own = await deviceRequest(route); assert.equal(own.status, 200); assert.equal((await own.json()).payload.total, 2); report.checks.ownDeviceRowsOnly = true;
  const other = await deviceRequest(route + '?operationId=' + otherOperationId); assert.equal(other.status, 200); assert.equal((await other.json()).payload.total, 0);
  assert.equal((await deviceRequest(route + '?principalId=' + otherId)).status, 403); report.checks.crossDeviceDenied = true;
  assert.equal((await deviceRequest('/api/endpoint-tools/devices/revoke', 'POST', { ids: [ownId] })).status, 403);
  assert.equal((await deviceRequest('/api/devices/me')).status, 200); report.checks.deviceSelfCannotRevoke = true;
  assert.equal((await fetch(origin + route + '?operationId=', { headers: { authorization: `Bearer ${token}` } })).status, 400); report.checks.invalidFilterDenied = true;
  if (executionDevice && executionToken) {
    accessToken = executionToken;
    const route = '/api/desktop-host/execution';
    assert.equal((await deviceRequest('/api/realtime/tickets', 'POST', { clientId: randomUUID(), clientKind: 'desktop', protocolVersion: 2 })).status, 403);
    const empty = await deviceRequest(route); assert.equal(empty.status, 200); assert.equal((await empty.json()).payload.active, false);
    const grant = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 60000, toolRevisions: { 'desktop.clipboard.write': 'a'.repeat(64) } };
    assert.equal((await fetch(origin + route, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, grant }) })).status, 403);
    const granted = await deviceRequest(route, 'POST', { expectedRevision: 0, grant }); assert.equal(granted.status, 200);
    assert.equal((await granted.json()).payload.revision, 1);
    assert.equal((await deviceRequest('/api/desktop-host/observation', 'DELETE')).status, 200);
    const stillActive = await deviceRequest(route); assert.equal((await stillActive.json()).payload.active, true);
    const revoked = await deviceRequest(route, 'DELETE', { grantId: grant.grantId, expectedRevision: 1 }); assert.equal(revoked.status, 200);
    assert.equal((await revoked.json()).payload.revision, 2);
    assert.equal((await deviceRequest(route, 'POST', { expectedRevision: 2, grant })).status, 409);
    assert.equal((await deviceRequest('/api/realtime/tickets', 'POST', { clientId: randomUUID(), clientKind: 'desktop', protocolVersion: 2 })).status, 403);
    report.checks.packagedExecutionGrantAuthAndSignature = true;
    report.checks.packagedDeleteBodyAndRevocation = true;
    report.checks.defaultDesktopCannotExecute = true;
  }
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : String(error); report.logs = redact(logs); process.exitCode = 1; }
finally {
  closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'exit'); child.kill('SIGTERM');
    try { await withTimeout(closed, 10000, 'Gateway cleanup timeout'); }
    catch { child.kill('SIGKILL'); await closed; report.passed = false; report.forcedCleanup = true; process.exitCode = 1; }
  }
  report.packageAfter = await installedAppFingerprint(target.application);
  if (report.packageAfter.sha256 !== report.packageBefore?.sha256) { report.passed = false; report.packageChanged = true; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rm(state, { recursive: true, force: true }); console.log(JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error }));
}
