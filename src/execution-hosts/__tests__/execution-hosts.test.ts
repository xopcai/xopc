import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EXECUTION_HOST_PROTOCOL_VERSION,
  executionHostHelloSigningPayload,
  executionHostTicketSigningPayload,
  type ExecutionCommand,
  type ExecutionHostHelloPayload,
  type ExecutionHostRegistration,
  type ExecutionHostTicketRequest,
  type ServerExecutionHostMessage,
} from '@xopcai/realtime-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { ExecutionHostAuthenticator } from '../auth.js';
import { ExecutionHostEnrollmentStore } from '../enrollment.js';
import {
  createExecutionHostIdentity,
  loadExecutionHostIdentity,
  resolveExecutionHostIdentityPath,
} from '../identity.js';
import { ExecutionHostRegistry } from '../registry.js';
import {
  createExecutionHost,
  getExecutionHost,
  listExecutionHostEvents,
  revokeExecutionHost,
} from '../repository.js';

function identity(now: number) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const registration: ExecutionHostRegistration = {
    hostId: 'host-1',
    displayName: 'Build host',
    platform: 'linux',
    arch: 'x64',
    appVersion: '1.0.0',
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    capabilities: { git: true, shell: true, search: true, patch: true, snapshots: false },
    maxConcurrency: 2,
  };
  const ticket: ExecutionHostTicketRequest = {
    hostId: registration.hostId,
    nonce: 'ticket-nonce-0001',
    signedAt: now,
    signature: 'pending',
  };
  ticket.signature = crypto.sign(
    'sha256',
    Buffer.from(executionHostTicketSigningPayload(ticket)),
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  const hello: ExecutionHostHelloPayload = {
    protocolVersion: EXECUTION_HOST_PROTOCOL_VERSION,
    hostId: registration.hostId,
    platform: registration.platform,
    arch: registration.arch,
    appVersion: registration.appVersion,
    capabilities: registration.capabilities,
    maxConcurrency: registration.maxConcurrency,
    nonce: 'hello-nonce-00001',
    signedAt: now,
    signature: 'pending',
  };
  hello.signature = crypto.sign(
    'sha256',
    Buffer.from(executionHostHelloSigningPayload(hello)),
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  return { registration, ticket, hello };
}

describe('execution hosts', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-execution-host-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('consumes enrollment codes once', () => {
    const store = new ExecutionHostEnrollmentStore();
    const enrollment = store.issue(1_000);
    expect(store.consume(enrollment.code, 1_001)).toBe(true);
    expect(store.consume(enrollment.code, 1_002)).toBe(false);
  });

  it('stores a matching host key pair in a private file', () => {
    const identityDir = join(stateDir, 'identity');
    const created = createExecutionHostIdentity({
      stateDir: identityDir,
      displayName: 'Build host',
      appVersion: '1.0.0',
      capabilities: { git: true, shell: true, search: true, patch: true, snapshots: false },
      maxConcurrency: 2,
    });
    const identityPath = resolveExecutionHostIdentityPath(identityDir);
    expect(statSync(identityPath).mode & 0o777).toBe(0o600);
    expect(loadExecutionHostIdentity(identityDir)).toEqual(created);

    const tampered = JSON.parse(readFileSync(identityPath, 'utf8')) as typeof created;
    tampered.privateKey = createExecutionHostIdentity({
      stateDir: join(stateDir, 'other-identity'),
      displayName: 'Other host',
      appVersion: '1.0.0',
      capabilities: { git: true, shell: true, search: true, patch: true, snapshots: false },
      maxConcurrency: 1,
    }).privateKey;
    writeFileSync(identityPath, JSON.stringify(tampered));
    expect(() => loadExecutionHostIdentity(identityDir)).toThrow(/key pair does not match/);
  });

  it('persists, authenticates, and revokes a host', () => {
    const now = 10_000;
    const { registration, ticket, hello } = identity(now);
    expect(createExecutionHost(registration, now)).toMatchObject({
      id: registration.hostId,
      lifecycleStatus: 'active',
      credentialEpoch: 1,
    });
    const authenticator = new ExecutionHostAuthenticator(() => now);
    expect(authenticator.authenticateTicket(ticket).id).toBe(registration.hostId);
    expect(authenticator.authenticateHello(hello).id).toBe(registration.hostId);
    expect(() => authenticator.authenticateHello(hello)).toThrow(/nonce/);

    expect(revokeExecutionHost(registration.hostId, now + 1)).toMatchObject({
      lifecycleStatus: 'revoked',
      credentialEpoch: 2,
    });
    expect(getExecutionHost(registration.hostId)?.revokedAt).toBe(now + 1);
    expect(listExecutionHostEvents(registration.hostId).map((event) => event.type)).toEqual([
      'revoked',
      'enrolled',
    ]);
  });

  it('routes one operation to the connected host and resolves its result', async () => {
    const now = Date.now();
    const { registration, hello } = identity(now);
    createExecutionHost(registration, now);
    const sent: ServerExecutionHostMessage[] = [];
    const registry = new ExecutionHostRegistry();
    registry.connect(hello, 'connection-1', {
      send: (message) => sent.push(message),
      close: vi.fn(),
    }, now);
    const command: ExecutionCommand = {
      operationId: crypto.randomUUID(),
      environmentId: 'env-1',
      bindingEpoch: 1,
      deadlineAt: now + 10_000,
      idempotencyKey: 'operation-1',
      command: 'environment.inspect',
      payload: {},
    };

    const pending = registry.execute(registration.hostId, command);
    expect(sent).toEqual([{ type: 'execution.command', command }]);
    registry.handleMessage(registration.hostId, 'connection-1', {
      type: 'execution.result',
      operationId: command.operationId,
      result: { status: 'ready' },
    });
    await expect(pending).resolves.toEqual({ status: 'ready' });
  });

  it('disconnects hosts synchronously before gateway storage closes', () => {
    const now = Date.now();
    const { registration, hello } = identity(now);
    createExecutionHost(registration, now);
    const registry = new ExecutionHostRegistry();
    registry.connect(hello, 'connection-1', {
      send: vi.fn(),
      close: vi.fn(),
    }, now);

    registry.disconnectAll('gateway stopping');
    registry.disconnect(registration.hostId, 'connection-1', 'late socket close');

    expect(registry.get(registration.hostId)).toBeUndefined();
    expect(listExecutionHostEvents(registration.hostId).map((event) => event.type)).toEqual([
      'disconnected',
      'connected',
      'enrolled',
    ]);
  });

  it('rejects commands whose deadline already elapsed', async () => {
    const now = Date.now();
    const { registration, hello } = identity(now);
    createExecutionHost(registration, now);
    const registry = new ExecutionHostRegistry();
    registry.connect(hello, 'connection-1', {
      send: vi.fn(),
      close: vi.fn(),
    }, now);

    await expect(registry.execute(registration.hostId, {
      operationId: crypto.randomUUID(),
      environmentId: 'env-1',
      bindingEpoch: 1,
      deadlineAt: now - 1,
      idempotencyKey: 'expired-operation',
      command: 'environment.inspect',
      payload: {},
    })).rejects.toThrow(/deadline has elapsed/);
  });

  it('rejects a pending operation immediately when it is cancelled', async () => {
    const now = Date.now();
    const { registration, hello } = identity(now);
    createExecutionHost(registration, now);
    const sent: ServerExecutionHostMessage[] = [];
    const registry = new ExecutionHostRegistry();
    registry.connect(hello, 'connection-1', {
      send: (message) => sent.push(message),
      close: vi.fn(),
    }, now);
    const operationId = crypto.randomUUID();
    const pending = registry.execute(registration.hostId, {
      operationId,
      environmentId: 'env-1',
      bindingEpoch: 1,
      deadlineAt: now + 10_000,
      idempotencyKey: 'cancel-operation',
      command: 'environment.inspect',
      payload: {},
    });

    registry.cancel(registration.hostId, operationId, 'user cancelled');

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', message: 'user cancelled' });
    expect(sent.at(-1)).toEqual({ type: 'execution.cancel', operationId, reason: 'user cancelled' });
  });
});
