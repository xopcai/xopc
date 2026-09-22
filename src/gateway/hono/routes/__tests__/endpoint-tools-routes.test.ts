import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createDevice,
  createEndpointPrincipal,
  finishEndpointToolInvocationAudit,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  revokeEndpointPrincipal,
  startEndpointToolInvocationAudit,
} from '../../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerEndpointToolRoutes } from '../endpoint-tools.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';

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
    app.use('*', async (c, next) => {
      setGatewayPrincipal(c, {
        kind: 'owner',
        principalId: 'local-owner',
        scopes: ['gateway.admin'],
      });
      await next();
    });
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

  it('aggregates access and tool identities and revokes both together', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const id = crypto.randomUUID();
    createDevice({
      id,
      displayName: 'Phone access',
      platform: 'android',
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      scopes: ['device.self'],
    });
    createEndpointPrincipal({
      id,
      displayName: 'Phone tools',
      kind: 'mobile',
      platform: 'android',
      publicKey: 'private-management-key',
    });
    const endpointOnlyId = crypto.randomUUID();
    createEndpointPrincipal({
      id: endpointOnlyId,
      displayName: 'Local browser',
      kind: 'web',
      platform: 'web',
      publicKey: 'second-private-management-key',
    });
    const endpoint = {
      principalId: id,
      endpointId: `${id}:mobile`,
      connectionId: crypto.randomUUID(),
      displayName: 'Phone tools',
      kind: 'mobile' as const,
      platform: 'android',
      appVersion: '1',
      availability: 'foreground' as const,
      lastHeartbeatAt: Date.now(),
      tools: [],
    };
    const disconnect = () => undefined;
    const app = new Hono();
    registerEndpointToolRoutes(app, {
      service: {
        realtime: { disconnectPrincipal: disconnect },
        voiceRealtime: { disconnectPrincipal: disconnect },
        endpointTools: { registry: { list: () => [endpoint] }, disconnect },
      },
    } as unknown as AuthenticatedRouteDeps);

    const listed = await app.request('/api/endpoint-tools/devices');
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    const listedBody = JSON.parse(listedText) as { payload: unknown[] };
    expect(listedBody.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id,
        displayName: 'Phone tools',
        access: expect.objectContaining({ scopes: ['device.self'] }),
        principal: expect.objectContaining({ createdAt: expect.any(Number) }),
        endpoints: expect.arrayContaining([
          expect.objectContaining({ endpointId: endpoint.endpointId }),
        ]),
      }),
    ]));
    expect(listedText).not.toContain('private-management-key');

    const revoked = await app.request('/api/endpoint-tools/devices/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id, endpointOnlyId] }),
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({ payload: { results: [
      { id, found: true, revoked: true },
      { id: endpointOnlyId, found: true, revoked: true },
    ] } });

    const after = await app.request('/api/endpoint-tools/devices');
    const afterBody = await after.json() as { payload: unknown[] };
    expect(afterBody.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id,
        access: expect.objectContaining({ revokedAt: expect.any(Number) }),
        principal: expect.objectContaining({ revokedAt: expect.any(Number) }),
      }),
      expect.objectContaining({
        id: endpointOnlyId,
        principal: expect.objectContaining({ revokedAt: expect.any(Number) }),
      }),
    ]));

    expect((await app.request('/api/endpoint-tools/principals')).status).toBe(404);
    expect((await app.request(`/api/endpoint-tools/principals/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('filters and paginates invocation audits', async () => {
    for (const [index, status] of (['succeeded', 'failed'] as const).entries()) {
      startEndpointToolInvocationAudit({
        id: `invocation-${index}`,
        principalId: `principal-${index}`,
        endpointId: `endpoint-${index}`,
        toolCallId: `call-${index}`,
        toolName: index === 0 ? 'web.page.read' : 'mobile.notify',
        effect: index === 0 ? 'read' : 'write',
        confirmationRequired: false,
        argumentsSha256: String(index).repeat(64),
        startedAt: 100 + index,
      });
      finishEndpointToolInvocationAudit({ id: `invocation-${index}`, status });
    }
    const app = new Hono();
    registerEndpointToolRoutes(app, { service: {} } as AuthenticatedRouteDeps);

    const response = await app.request('/api/endpoint-tools/invocations?page=1&pageSize=1&status=failed');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      payload: { page: 1, pageSize: 1, total: 1, totalPages: 1, items: [{ id: 'invocation-1' }] },
    });
    expect((await app.request('/api/endpoint-tools/invocations?page=0')).status).toBe(400);
  });

  it('creates and removes an explicit session endpoint binding', async () => {
    const binding = {
      conversationId: 'telegram:chat-1',
      endpointId: 'mobile-1',
      boundAt: 42,
    };
    const bindings = {
      get: () => binding,
      bind: () => binding,
      unbind: () => true,
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      setGatewayPrincipal(c, {
        kind: 'owner',
        principalId: 'local-owner',
        scopes: ['gateway.admin'],
      });
      await next();
    });
    registerEndpointToolRoutes(app, {
      service: { endpointTools: { bindings, registry: { get: () => undefined } } },
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

  it('prevents a device from binding a session to another device endpoint', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      setGatewayPrincipal(c, {
        kind: 'device',
        principalId: 'device-a',
        deviceId: 'device-a',
        scopes: ['device.self'],
      });
      await next();
    });
    registerEndpointToolRoutes(app, {
      service: {
        endpointTools: {
          registry: { get: () => ({ endpointId: 'browser:device-b', principalId: 'device-b' }) },
          bindings: { bind: () => { throw new Error('must not bind'); } },
        },
      },
    } as unknown as AuthenticatedRouteDeps);

    const response = await app.request('/api/endpoint-tools/bindings/webchat%3Asession-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpointId: 'browser:device-b' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
