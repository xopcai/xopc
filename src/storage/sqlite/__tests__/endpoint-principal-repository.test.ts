import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  bindEndpointPrincipal,
  createEndpointPrincipal,
  deleteEndpointSessionBinding,
  getEndpointSessionBinding,
  getEndpointPrincipal,
  listEndpointPrincipals,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  revokeEndpointPrincipal,
  setEndpointSessionBinding,
  touchEndpointPrincipal,
} from '../index.js';

describe('endpoint principal repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-endpoint-principal-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates, touches, and revokes a principal', () => {
    const created = createEndpointPrincipal({
      id: '0196d708-62f0-7000-8000-000000000001',
      kind: 'web',
      displayName: 'Browser',
      platform: 'chrome',
      publicKey: 'test-public-key',
    });

    expect(getEndpointPrincipal(created.id)).toEqual(created);

    touchEndpointPrincipal(created.id, 1234);
    expect(getEndpointPrincipal(created.id)?.lastSeenAt).toBe(1234);

    expect(revokeEndpointPrincipal(created.id, 5678)).toBe(true);
    expect(revokeEndpointPrincipal(created.id, 9999)).toBe(false);
    expect(getEndpointPrincipal(created.id)?.revokedAt).toBe(5678);
    expect(listEndpointPrincipals()).toEqual([expect.objectContaining({ id: created.id, revokedAt: 5678 })]);
  });

  it('does not overwrite an existing identity', () => {
    const principal = {
      id: '0196d708-62f0-7000-8000-000000000002',
      kind: 'desktop' as const,
      displayName: 'Desktop',
      platform: 'darwin',
      publicKey: 'test-public-key',
    };
    createEndpointPrincipal(principal);
    expect(() => createEndpointPrincipal(principal)).toThrow();
  });

  it('binds an endpoint instance to exactly one principal', () => {
    const first = createEndpointPrincipal({
      id: '0196d708-62f0-7000-8000-000000000003',
      kind: 'web', displayName: 'First', platform: 'web', publicKey: 'first-key',
    });
    const second = createEndpointPrincipal({
      id: '0196d708-62f0-7000-8000-000000000004',
      kind: 'web', displayName: 'Second', platform: 'web', publicKey: 'second-key',
    });
    expect(bindEndpointPrincipal('tab-1', first.id, 100)).toBe(true);
    expect(bindEndpointPrincipal('tab-1', first.id, 200)).toBe(true);
    expect(bindEndpointPrincipal('tab-1', second.id, 300)).toBe(false);
  });

  it('persists one explicit endpoint target per session', () => {
    const principal = createEndpointPrincipal({
      id: '0196d708-62f0-7000-8000-000000000005',
      kind: 'mobile', displayName: 'Phone', platform: 'ios', publicKey: 'phone-key',
    });
    expect(bindEndpointPrincipal('phone-1', principal.id, 100)).toBe(true);
    expect(setEndpointSessionBinding({
      sessionKey: 'telegram:chat-1', endpointId: 'phone-1', boundAt: 200,
    })).toEqual({ sessionKey: 'telegram:chat-1', endpointId: 'phone-1', boundAt: 200 });
    expect(getEndpointSessionBinding('telegram:chat-1')).toEqual({
      sessionKey: 'telegram:chat-1', endpointId: 'phone-1', boundAt: 200,
    });
    expect(deleteEndpointSessionBinding('telegram:chat-1')).toBe(true);
    expect(getEndpointSessionBinding('telegram:chat-1')).toBeUndefined();
  });
});
