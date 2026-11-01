import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson, ENDPOINT_TEXT_OUTPUT_SCHEMA, type EndpointHelloPayload, type EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';
import { REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { executeExternalOperation } from '../../capabilities/runtime/external-operations.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createDevice, getDevice } from '../../storage/sqlite/device-access-repository.js';
import { revokeDesktopExecutionGrant, setDesktopExecutionGrant } from '../../storage/sqlite/desktop-execution-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { assertDesktopExecutionHello } from '../desktop-execution.js';
import { desktopDeviceEndpointKey } from '../desktop-observation.js';
import { EndpointInvocationService } from '../invocation-service.js';
import { EndpointRegistry, endpointToolRevision } from '../registry.js';

let root: string;
let service: EndpointInvocationService | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'xopc-execution-gateway-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') }); });
afterEach(() => { service?.close(); service = undefined; vi.useRealTimers(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });
it('rejects remote Computer calls from a legacy owner endpoint without independent device execution authority', async () => {
  const registry = new EndpointRegistry(), send = vi.fn();
  registry.register({ principalId: 'owner', endpointId: 'owner-desktop', connectionInstanceId: randomUUID(), displayName: 'Legacy owner', kind: 'desktop', platform: 'desktop',
    appVersion: 'fixture', availability: 'foreground', nonce: 'fixture', signedAt: Date.now(), signature: 'fixture', tools: [REMOTE_COMPUTER_DESCRIPTOR as never] }, randomUUID(), { readyState: 1, send, close: vi.fn() });
  service = new EndpointInvocationService(registry);
  await expect(service.invoke({ endpointId: 'owner-desktop', toolName: REMOTE_COMPUTER_DESCRIPTOR.name, toolCallId: 'fixture', descriptorRevision: endpointToolRevision(REMOTE_COMPUTER_DESCRIPTOR as never),
    operationId: randomUUID(), arguments: { op: 'observe', owner: 'conversation', sessionId: 'session' } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', confirmedNoEffect: true });
  expect(send).not.toHaveBeenCalled();
});
function fixture() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const device = createDevice({ displayName: 'Fixture desktop', platform: 'desktop', scopes: ['gateway.status', 'device.self'], publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) });
  const descriptor: EndpointToolDescriptor = { name: 'desktop.clipboard.write', title: 'Fixture', description: 'Fixture write',
    inputSchema: { type: 'object' }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA, policyId: 'user.foreground-write', sensitivity: 'personal',
    effect: 'write', confirmation: 'always', requiresForeground: true, requiredPermissions: ['clipboard-write'], timeoutMs: 10000,
    maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['text'] };
  const revision = endpointToolRevision(descriptor), expiresAt = Date.now() + 60000;
  const grant = setDesktopExecutionGrant(device.id, 0, { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt, toolRevisions: { 'desktop.clipboard.write': revision } });
  const hello: EndpointHelloPayload = { principalId: device.id, endpointId: randomUUID(), connectionInstanceId: randomUUID(), kind: 'desktop', platform: 'desktop',
    displayName: 'Fixture', appVersion: '1', availability: 'foreground', nonce: randomUUID(), signedAt: Date.now(), signature: 'fixture-signature', tools: [descriptor],
    deviceFrames: { version: 1, authorizationRevision: grant.revision }, execution: { version: 1, grantId: grant.grant!.grantId, authorizationRevision: grant.revision, expiresAt } };
  const clientId = randomUUID(), gatewayId = getOrCreateGatewayIdentity().id, key = desktopDeviceEndpointKey(device), capabilities = ['desktop.device-frames.v1', 'desktop.durable-execution.v1'];
  const authority = assertDesktopExecutionHello(getDevice(device.id)!, hello, key, gatewayId, clientId, capabilities);
  const sent: any[] = [], registry = new EndpointRegistry();
  registry.register(hello, randomUUID(), { readyState: 1, send: value => {
    const frame = JSON.parse(value);
    if (frame.type === 'tool.invoke') expect(getSqliteDatabase().prepare('SELECT desktop_intent_json FROM capability_operations WHERE operation_id=?').get(frame.payload.execution.operationId)?.desktop_intent_json).toBe(canonicalJson(frame.payload.execution));
    sent.push(frame);
  }, close: () => {} }, Date.now(), authority);
  service = new EndpointInvocationService(registry);
  const args = { text: 'fixture only' };
  const invoke = (signal?: AbortSignal, idempotencyKey = randomUUID()) => executeExternalOperation({ principalId: device.id, capabilityId: 'fixture', idempotencyKey,
    requestDigest: createHash('sha256').update(canonicalJson(args)).digest('hex'), descriptorDigest: revision, surface: 'fixture', recovery: 'manual' },
  operationId => service!.invoke({ endpointId: hello.endpointId, toolCallId: 'fixture', toolName: descriptor.name, arguments: args, descriptorRevision: revision, operationId, signal }));
  const message = (type: string, payload: Record<string, unknown>) => service!.handleMessage(hello.endpointId, {
    protocolVersion: 2, messageId: randomUUID(), type, sentAt: Date.now(), payload: { invocationId: sent[0].payload.invocationId, ...payload },
  } as any);
  const receipt = (state: string, extra = {}) => ({ operationId: sent[0].payload.execution.operationId, invocationId: sent[0].payload.invocationId,
    connectionInstanceId: hello.connectionInstanceId, state, executionStopped: ['succeeded', 'failed', 'stopped'].includes(state), updatedAt: Date.now(), ...extra });
  return { device, hello, key, gatewayId, clientId, capabilities, grant, sent, invoke, message, receipt, registry };
}
it('binds executor registration to exact device grant, descriptor, capabilities and expiry', () => {
  const f = fixture(), device = getDevice(f.device.id)!;
  for (const hello of [{ ...f.hello, tools: [] }, { ...f.hello, tools: [{ ...f.hello.tools[0], description: 'changed' }] },
    { ...f.hello, deviceFrames: undefined }, { ...f.hello, execution: { ...f.hello.execution!, grantId: randomUUID() } }]) {
    expect(() => assertDesktopExecutionHello(device, hello, f.key, f.gatewayId, f.clientId, f.capabilities)).toThrow('EXECUTION_DENIED');
  }
  expect(() => assertDesktopExecutionHello(device, f.hello, f.key, f.gatewayId, f.clientId, ['desktop.device-frames.v1'])).toThrow();
  expect(() => assertDesktopExecutionHello(device, f.hello, f.key, f.gatewayId, f.clientId, f.capabilities, f.grant.grant!.expiresAt)).toThrow();
  revokeDesktopExecutionGrant(device.id, f.grant.grant!.grantId, f.grant.revision);
  expect(() => assertDesktopExecutionHello(device, f.hello, f.key, f.gatewayId, f.clientId, f.capabilities)).toThrow();
});
it('commits intent before dispatch and validates terminal evidence before committing a result; repeated intent never executes again', async () => {
  const f = fixture(), id = randomUUID(), promise = f.invoke(undefined, id);
  expect(f.sent).toHaveLength(1); f.message('tool.received', {});
  const result = { content: [{ type: 'text', text: 'done' }] }, operationReceipt = f.receipt('succeeded', { resultHash: createHash('sha256').update(canonicalJson(result)).digest('hex') });
  f.message('tool.result', { ...result, operationReceipt }); await expect(promise).resolves.toEqual(result);
  const row = getSqliteDatabase().prepare('SELECT state, desktop_receipt_json FROM capability_operations WHERE operation_id=?').get(operationReceipt.operationId);
  expect(row?.state).toBe('succeeded'); expect(row?.desktop_receipt_json).toBe(canonicalJson(operationReceipt));
  await expect(f.invoke(undefined, id)).resolves.toEqual(result); expect(f.sent).toHaveLength(1);
});
it.each(['missing', 'hash', 'attempt', 'connection'])('treats %s evidence as unknown and refuses automatic replay', async mutation => {
  const f = fixture(), id = randomUUID(), promise = f.invoke(undefined, id); f.message('tool.received', {});
  const result = { content: [{ type: 'text', text: 'done' }] }, receipt = f.receipt('succeeded', { resultHash: createHash('sha256').update(canonicalJson(result)).digest('hex') });
  if (mutation === 'hash') receipt.resultHash = 'f'.repeat(64);
  if (mutation === 'attempt') receipt.invocationId = randomUUID();
  if (mutation === 'connection') receipt.connectionInstanceId = randomUUID();
  f.message('tool.result', { ...result, ...(mutation === 'missing' ? {} : { operationReceipt: receipt }) });
  await expect(promise).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  await expect(f.invoke(undefined, id)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  await expect(f.invoke()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(f.sent).toHaveLength(1);
});
it('rejects a hash-matching failed receipt whose result violates the registered output contract', async () => {
  const f = fixture(), promise = f.invoke(); f.message('tool.received', {});
  const result = { content: [{ type: 'json', value: { ok: false, error: 'WORKSPACE_VERSION_CONFLICT' } }] };
  f.message('tool.error', { code: 'TOOL_EXECUTION_FAILED', message: 'Untrusted failure', operationResult: result,
    operationReceipt: f.receipt('failed', { resultHash: createHash('sha256').update(canonicalJson(result)).digest('hex') }) });
  await expect(promise).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(getSqliteDatabase().prepare('SELECT desktop_receipt_json FROM capability_operations').get()?.desktop_receipt_json).toBeNull();
});
it('waits for confirmed executor stop instead of treating cancel transmission as completion', async () => {
  const f = fixture(), controller = new AbortController(), promise = f.invoke(controller.signal); f.message('tool.received', {});
  let settled = false; void promise.then(() => { settled = true; }, () => { settled = true; });
  controller.abort(); await Promise.resolve(); expect(settled).toBe(false); expect(f.sent.at(-1).type).toBe('tool.cancel');
  f.message('tool.cancelled', { operationReceipt: f.receipt('stopped') });
  await expect(promise).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  // Stopped is durable evidence, but a cancelled write can have partial effects and remains manually reconciled.
  expect(JSON.parse(String(getSqliteDatabase().prepare('SELECT desktop_receipt_json FROM capability_operations').get()?.desktop_receipt_json)).state).toBe('stopped');
});
it('bounds an unconfirmed cancel and records an unknown outcome', async () => {
  vi.useFakeTimers(); const f = fixture(), controller = new AbortController(), promise = f.invoke(controller.signal);
  const rejection = expect(promise).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  controller.abort(); await vi.advanceTimersByTimeAsync(3001); await rejection;
});
it('refuses dispatch after the local grant is revoked, even if the old endpoint is still registered', async () => {
  const f = fixture(); revokeDesktopExecutionGrant(f.device.id, f.grant.grant!.grantId, f.grant.revision);
  await expect(f.invoke()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(f.sent).toHaveLength(0);
});
