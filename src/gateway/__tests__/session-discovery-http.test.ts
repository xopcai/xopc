import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { buildSessionListPath } from '@xopcai/gateway-contract';
import { expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { listSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('filters sessions through the authenticated Gateway HTTP path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-session-http-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const token = 'session-filter-test-token';
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }),
    getAuthToken: () => token,
    isGatewayReady: () => true,
    sessions: { listSessions: listSessionMetadata },
    getExtensionLoader: () => null,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test Gateway address');
    const base = `http://127.0.0.1:${address.port}`;
    for (const [name, customData] of [['extension', { createdSurface: 'browser_extension' }], ['workbench', {}]] as const) {
      ensureSessionRecord(`agent:main:webchat:default:dm:${name}`, dir, { name, sourceChannel: 'webchat', customData, hiddenFromSessionList: false });
    }
    const path = buildSessionListPath({ sources: ['browser'], purposes: ['chat'], excludeArchived: true, limit: 20 });
    expect((await fetch(base + path)).status).toBe(401);
    const response = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, items: [{ name: 'extension' }] });
    expect((await fetch(`${base}/api/sessions?sources=invalid`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(400);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
