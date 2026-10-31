import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildDevicePairingProof, desktopPairingInvitationSchema, DESKTOP_HOST_MANIFEST } from '@xopcai/gateway-contract';

import { desktopAuthTransport } from '../electron/desktop/device-transport.js';
import { DesktopDeviceAuth } from '../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../electron/desktop/device-identity.js';
import { installedAppFingerprint, macPackagedTarget, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

import { buildRefreshProofMessage } from '../src/storage/sqlite/device-access-repository.js';
import { proofDigest, requestProofMessage } from '../src/gateway/security/device-request-proof.js';
import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';

const root = resolve(import.meta.dirname, '..'), output = await createAcceptanceOutput(join(root, 'reports/p2a2-desktop-device-auth.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-desktop-auth-')), token = randomUUID();
const report: Record<string, any> = { passed: false, startedAt: new Date().toISOString(), scope: 'Actual authenticated Node Gateway and lazy route selection; desktop credential client in Node supervisor, no native safeStorage, consent UI or local tools', checks: {} };
const listener = createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()));
const config = join(state, 'xopc.json');
await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, publicUrl: 'https://desktop-auth-fixture.invalid', auth: { mode: 'token', token } }, browser: { enabled: false } }), { mode: 0o600 });
const appIndex = process.argv.indexOf('--server-app');
const packaged = appIndex < 0 ? undefined : await macPackagedTarget(process.argv[appIndex + 1]);
if (packaged) report.packageBefore = await installedAppFingerprint(packaged.application);
const baseEnv = localConnectionEnvironment(process.env, root, state, config, join(state, 'workspace'));
const child = spawn(packaged?.executablePath ?? process.execPath, [packaged?.server ?? join(root, 'dist/src/cli/bin.js'), 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], {
  cwd: root, env: packaged ? packagedGatewayEnvironment(baseEnv, packaged) : baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
const redact = (value: unknown) => String(value).replaceAll(token, '[redacted]').replace(/xopc_(?:at|rt|pair)_[A-Za-z0-9_-]+/g, '[redacted-device-credential]').replace(/Token: [^\n]+/g, 'Token: [redacted]');
const origin = `http://127.0.0.1:${port}`;
const request = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
  const mergedHeaders = new Headers({ 'content-type': 'application/json' }); for (const [name, value] of Object.entries(headers)) mergedHeaders.set(name, value);
  const response = await fetch(origin + path, { method, headers: mergedHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
};
const owner = (path: string, method = 'GET', body?: unknown) => request(path, method, body, { Authorization: `Bearer ${token}` });
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { if ((await owner('/api/desktop-host/compatibility').catch(() => ({ status: 0 }))).status === 200) break; await delay(200); }
  const compatibility = await owner('/api/desktop-host/compatibility'); assert.equal(compatibility.status, 200); assert.deepEqual(compatibility.body.payload.manifest, DESKTOP_HOST_MANIFEST);
  assert.equal((await request('/api/desktop-host/compatibility')).status, 401);
  const originalChat = await owner('/api/desktop-chat/bootstrap?chat=1'); assert.equal(originalChat.status, 200);
  const setup = await owner('/api/desktop-host/pairing-setups', 'POST', {}); assert.equal(setup.status, 201);
  const invitation = desktopPairingInvitationSchema.parse(setup.body.payload.invitation);
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), requestId = randomUUID();
  const base = { gatewayId: invitation.gatewayId, requestId, pairingToken: invitation.pairingToken };
  const signed = (action: 'request' | 'status' | 'complete', extra: Record<string, unknown> = {}) => {
    const body = { ...base, ...extra, timestamp: Date.now(), nonce: randomBytes(24).toString('base64url') };
    return { ...body, signature: sign('sha256', Buffer.from(buildDevicePairingProof(action, body)), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
  };
  const decode = (envelope: any) => {
    assert(verify(null, Buffer.from(envelope.signedPayload), createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: invitation.gatewayPublicKey } }), Buffer.from(envelope.signature, 'base64url')));
    const value = JSON.parse(Buffer.from(envelope.signedPayload, 'base64url').toString()); assert.equal(value.gateway?.id ?? value.gatewayId, invitation.gatewayId); return value;
  };
  const submit = await request('/api/device-pairing/requests', 'POST', signed('request', { device: { displayName: 'Synthetic desktop auth', platform: 'desktop', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) } }));
  assert.equal(submit.status, 200); const pending = decode(submit.body).request; assert.equal(pending.status, 'pending');
  const refreshToken = () => `xopc_rt_${randomUUID()}_${randomBytes(32).toString('base64url')}`;
  const initialRefreshToken = refreshToken(), completionKey = randomUUID();
  const complete = () => request(`/api/device-pairing/requests/${requestId}/complete`, 'POST', signed('complete', { idempotencyKey: completionKey, initialRefreshToken }));
  assert.equal((await complete()).body.error.code, 'PAIRING_NOT_APPROVED');
  const decision = await owner(`/api/device-pairing/requests/${requestId}/decision`, 'POST', { decision: 'approve', expectedRevision: pending.revision }); assert.equal(decision.status, 200);
  const completed = await complete(); assert.equal(completed.status, 200); const result = decode(completed.body); assert.deepEqual(result.scopes, ['gateway.status', 'device.self']); const deviceId = result.request.deviceId;
  assert.equal(decode((await complete()).body).request.deviceId, deviceId);
  report.checks.explicitApprovalAndIdempotentCompletion = true;
  const refresh = { refreshToken: initialRefreshToken, nextRefreshToken: refreshToken(), requestId: randomUUID(), timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), requestProofVersion: 1 };
  const refreshBody = { ...refresh, signature: sign('sha256', Buffer.from(buildRefreshProofMessage({ ...refresh, credentialId: initialRefreshToken.slice(8).split('_')[0] })), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
  const rotated = await request('/api/device-auth/refresh', 'POST', refreshBody); assert.equal(rotated.status, 200); const tokens = decode(rotated.body).tokens;
  const recoveredTokens = decode((await request('/api/device-auth/refresh', 'POST', refreshBody)).body).tokens;
  assert.equal(recoveredTokens.refreshToken, tokens.refreshToken); assert.equal(recoveredTokens.refreshTokenExpiresAt, tokens.refreshTokenExpiresAt);
  report.checks.boundRefreshAndLostResponseRecovery = true;
  const deviceHeaders = (path: string, method = 'GET', body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', Authorization: `Bearer ${tokens.accessToken}` };
    const proof = { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), digest: proofDigest(body === undefined ? '' : JSON.stringify(body)) };
    const signature = sign('sha256', Buffer.from(requestProofMessage({ gatewayId: invitation.gatewayId, credential: tokens.accessToken, method, target: path, headers: name => headers[name], proof })), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return { ...headers, 'X-Xopc-Proof': `${proof.timestamp}.${proof.nonce}.${proof.digest}.${signature}` };
  };
  const device = (path: string, method = 'GET', body?: unknown) => request(path, method, body, deviceHeaders(path, method, body));
  assert.equal((await device('/api/desktop-host/compatibility')).status, 200);
  const me = await device('/api/devices/me'); assert.equal(me.status, 200); assert.equal(me.body.device.id, deviceId); assert.deepEqual(me.body.device.scopes, ['gateway.status', 'device.self']);
  const replay = deviceHeaders('/api/devices/me'); assert.equal((await request('/api/devices/me', 'GET', undefined, replay)).status, 200); assert.equal((await request('/api/devices/me', 'GET', undefined, replay)).status, 401);
  report.checks.requestProofAndReplayRejection = true;
  report.denied = [];
  for (const [path, method, body] of [['/api/sessions', 'GET'], ['/api/endpoint-tools/devices', 'GET'], ['/api/endpoint-tools/principals', 'POST', {}], ['/api/realtime/tickets', 'POST', {}], ['/api/desktop-host/pairing-setups', 'POST', {}], ['/api/device-pairing/requests/other/decision', 'POST', {}], ['/api/desktop-chat/bootstrap', 'GET']] as const) {
    const result = await device(path, method, body); assert.equal(result.status, 403, path); report.denied.push({ path, method, status: result.status });
  }
  report.checks.noOwnerMobileBrowserEndpointOrRealtimeAuthority = true;
  assert.equal((await device('/api/devices/me', 'DELETE')).status, 200);
  assert.equal((await device('/api/devices/me')).status, 401);
  assert.equal((await request('/api/device-auth/refresh', 'POST', refreshBody)).status, 401);
  assert.equal((await complete()).body.error.code, 'DEVICE_REVOKED');
  assert.deepEqual((await owner('/api/desktop-chat/bootstrap?chat=1')).body, originalChat.body);
  report.checks.revocationAndChatIndependence = true;
  // The client store uses authenticated encryption here; OS safeStorage and native consent remain D2 installation checks.
  const encryptionKey = randomBytes(32), encryption = { available: async () => true,
    encrypt: async (value: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: async (bytes: Buffer) => { const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(); },
  };
  const binding = { profileId: randomUUID(), gatewayId: invitation.gatewayId, publicKey: compatibility.body.payload.publicKey, origin };
  const identityStore = new DesktopIdentityStore(join(state, 'desktop-identities'), encryption);
  const deviceChannel = desktopAuthTransport(binding, 'ssh');
  let loseCompletion = true, loseRefresh = true, clientDeviceId = '', clientConsent = false, setupCalls = 0;
  const transport = async (path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, headers?: Record<string, string>) => {
    const response = await deviceChannel.request(path, method, body, headers);
    if (path.endsWith('/complete') && response.status === 200 && loseCompletion) { loseCompletion = false; throw new Error('Synthetic completion response loss'); }
    if (path === '/api/device-auth/refresh' && response.status === 200 && loseRefresh) { loseRefresh = false; throw new Error('Synthetic refresh response loss'); }
    return response;
  };
  const enrollment = { displayName: 'Durable synthetic desktop', consent: async () => clientConsent,
    setup: async () => { setupCalls++; const response = await owner('/api/desktop-host/pairing-setups', 'POST', {}); assert.equal(response.status, 201); return response.body.payload.invitation; },
    approve: async (id: string, revision: number) => { const response = await owner(`/api/device-pairing/requests/${id}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); assert.equal(response.status, 200); },
  };
  let client = new DesktopDeviceAuth(binding, identityStore, transport);
  await assert.rejects(client.enroll(enrollment), /DESKTOP_LOCAL_CONSENT_DENIED/); assert.equal(setupCalls, 0);
  clientConsent = true;
  await assert.rejects(client.enroll(enrollment), /Synthetic completion response loss/);
  client = new DesktopDeviceAuth(binding, identityStore, transport);
  clientDeviceId = (await client.enroll(enrollment)).deviceId; assert.equal(setupCalls, 1);
  await assert.rejects(client.readSelf(), /Synthetic refresh response loss/);
  const pendingRotation = (await identityStore.load(binding))!.rotation; assert(pendingRotation);
  client = new DesktopDeviceAuth(binding, identityStore, transport);
  assert.equal((await client.readSelf()).deviceId, clientDeviceId);
  assert.equal((await identityStore.load(binding))!.refreshToken, pendingRotation.nextRefreshToken);
  assert.equal((await identityStore.load(binding))!.rotation, undefined);
  await Promise.all([client.readSelf(), client.readSelf()]);
  const revoked = await owner('/api/endpoint-tools/devices/revoke', 'POST', { ids: [clientDeviceId] }); assert.equal(revoked.status, 200);
  await assert.rejects(client.readSelf(), /DESKTOP_AUTH_REVOKED/);
  await assert.rejects(client.enroll(enrollment), /DESKTOP_REENROLLMENT_REQUIRED/); assert.equal(setupCalls, 1);
  report.checks.clientConsentBeforeEnrollmentDurableCompletionAndRefresh = true;
  report.checks.clientRevocationNeverAutoReenrolls = true; deviceChannel.close();
  if (packaged) { report.packageAfter = await installedAppFingerprint(packaged.application); assert.equal(report.packageAfter.sha256, report.packageBefore.sha256); report.scope = 'Actual installed bundled Electron Gateway runtime plus Node-supervised desktop auth client; no native safeStorage, consent UI or local tools'; }
  report.passed = true;
} catch (error) { report.error = redact((error as Error).stack ?? error); report.logs = redact(logs); process.exitCode = 1; }
finally {
  try { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await withTimeout(stopped, 10000, 'Gateway stop'); } report.cleanupConfirmed = true; }
  catch (error) { child.kill('SIGKILL'); report.cleanupConfirmed = false; report.cleanupError = String(error); report.passed = false; process.exitCode = 1; }
  if (report.passed) await rm(state, { recursive: true, force: true }); else report.failureStateDirectory = state;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
