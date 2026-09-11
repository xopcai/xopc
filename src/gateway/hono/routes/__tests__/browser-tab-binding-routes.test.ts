import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createDevice,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { registerBrowserRoutes } from '../browser.js';

describe('browser tab binding routes', () => {
  let dir: string;
  let app: Hono;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-browser-bindings-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    for (const [id, extensionId] of [['device-a', 'a'.repeat(32)], ['device-b', 'b'.repeat(32)]]) {
      createDevice({
        id,
        displayName: id,
        platform: 'chrome',
        extensionId,
        publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        scopes: ['sessions.read', 'sessions.write', 'device.self'],
      });
    }
    app = new Hono();
    app.use('*', async (c, next) => {
      const deviceId = c.req.header('x-test-device') ?? 'device-a';
      setGatewayPrincipal(c, {
        kind: 'device', principalId: deviceId, deviceId,
        scopes: ['sessions.read', 'sessions.write', 'device.self'],
      });
      await next();
    });
    registerBrowserRoutes(app, {
      service: {
        currentConfig: { gateway: { bind: 'loopback' } },
        sessions: { getSession: async () => ({ key: 'session-1' }) },
        endpointTools: {
          registry: {
            verifyTurnClaim: () => true,
            get: (endpointId: string) => ({
              endpointId,
              principalId: endpointId === 'endpoint-a' ? 'device-a' : 'device-b',
              kind: 'browser',
            }),
          },
        },
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('binds a tab to the authenticated browser device and isolates other devices', async () => {
    const path = '/api/browser/tab-bindings/session-1';
    const created = await app.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-device': 'device-a' },
      body: JSON.stringify({
        endpointId: 'endpoint-a',
        turnToken: 't'.repeat(32),
        tabId: '12',
        windowId: '3',
        documentId: 'doc-1',
        urlOrigin: 'https://example.com',
        mode: 'read',
      }),
    });
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      payload: { principalId: 'device-a', tabId: '12', mode: 'read' },
    });

    expect((await app.request(path, { headers: { 'x-test-device': 'device-b' } })).status).toBe(403);
    expect((await app.request(path, { headers: { 'x-test-device': 'device-a' } })).status).toBe(200);
  });
});
