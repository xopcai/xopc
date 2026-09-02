import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createEndpointPrincipal,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  revokeEndpointPrincipal,
} from '../../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerEndpointToolRoutes } from '../endpoint-tools.js';

describe('endpoint tool principal routes', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-endpoint-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns a distinct error for a revoked principal', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const registration = {
      principalId: crypto.randomUUID(),
      displayName: 'Browser',
      kind: 'web' as const,
      platform: 'web',
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    };
    createEndpointPrincipal({
      id: registration.principalId,
      displayName: registration.displayName,
      kind: registration.kind,
      platform: registration.platform,
      publicKey: registration.publicKey,
    });
    revokeEndpointPrincipal(registration.principalId);

    const app = new Hono();
    registerEndpointToolRoutes(app, { service: {} } as AuthenticatedRouteDeps);
    const response = await app.request('/api/endpoint-tools/principals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PRINCIPAL_REVOKED' },
    });
  });

  it('lists persisted principals with only their active endpoint snapshots', async () => {
    const principal = createEndpointPrincipal({
      id: crypto.randomUUID(),
      displayName: 'Desktop',
      kind: 'desktop',
      platform: 'darwin',
      publicKey: 'private-management-key',
    });
    const endpoint = {
      principalId: principal.id,
      endpointId: `${principal.id}:desktop`,
      connectionId: crypto.randomUUID(),
      displayName: principal.displayName,
      kind: principal.kind,
      platform: principal.platform,
      appVersion: '1',
      availability: 'foreground',
      lastHeartbeatAt: Date.now(),
      tools: [],
    };
    const app = new Hono();
    registerEndpointToolRoutes(app, {
      service: { endpointTools: { registry: { list: () => [endpoint] } } },
    } as unknown as AuthenticatedRouteDeps);

    const response = await app.request('/api/endpoint-tools/principals');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      payload: [{ id: principal.id, endpoints: [{ endpointId: endpoint.endpointId }] }],
    });
    expect(body).not.toContain('private-management-key');
  });

  it('creates and removes an explicit session endpoint binding', async () => {
    const binding = {
      sessionKey: 'telegram:chat-1',
      endpointId: 'mobile-1',
      boundAt: 42,
    };
    const bindings = {
      get: () => binding,
      bind: () => binding,
      unbind: () => true,
    };
    const app = new Hono();
    registerEndpointToolRoutes(app, {
      service: { endpointTools: { bindings } },
    } as unknown as AuthenticatedRouteDeps);

    const path = '/api/endpoint-tools/bindings/telegram%3Achat-1';
    const put = await app.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpointId: 'mobile-1' }),
    });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({ payload: binding });

    const get = await app.request(path);
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({ payload: binding });

    const remove = await app.request(path, { method: 'DELETE' });
    expect(remove.status).toBe(200);
    await expect(remove.json()).resolves.toMatchObject({ payload: { removed: true } });
  });
});
