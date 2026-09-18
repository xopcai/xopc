import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { REALTIME_CAPABILITIES, REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { expect, it } from 'vitest';

import { assertGatewayCompatibility } from '../../../electron/gateway-compatibility.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('checks compatibility through a running authenticated Gateway and its lazy route', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-compatibility-http-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const token = 'compatibility-test-token';
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing Gateway address');
    const url = `http://127.0.0.1:${address.port}/api/endpoint-tools/compatibility`;
    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ payload: {
      computerControl: COMPUTER_DESCRIPTOR,
      realtime: {
        minVersion: REALTIME_PROTOCOL_VERSION,
        maxVersion: REALTIME_PROTOCOL_VERSION,
        capabilities: REALTIME_CAPABILITIES,
      },
    } });
    await expect(assertGatewayCompatibility({ port: address.port, token })).resolves.toBeUndefined();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
