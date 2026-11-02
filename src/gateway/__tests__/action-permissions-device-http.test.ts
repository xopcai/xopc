import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createDevice, issueDeviceTokenPair } from '../../storage/sqlite/device-access-repository.js';
import { createHonoApp } from '../hono/app.js';
import { signedDeviceHeaders } from '../security/__tests__/signed-device-headers.js';
import type { GatewayService } from '../service.js';

it('requires a dedicated permission grant through authenticated HTTP and lazy session routes', async () => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token: 'approval-fixture-owner' } } });
  const patchAgentConfig = vi.fn(async () => ({ ok: true }));
  const service = { currentConfig: config, getResolvedAuth: () => config.gateway.auth,
    getAuthToken: () => 'approval-fixture-owner', isGatewayReady: () => true, getExtensionLoader: () => null,
    sessions: { patchAgentConfig, getAgentConfig: async () => ({ actionApprovalMode: 'full', configVersion: 2 }) },
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
    const path = `/api/sessions/${randomUUID()}/agent-config`;
    const body = JSON.stringify({ actionApprovalMode: 'full', configVersion: 1 });
    for (const allowed of [false, true]) {
      const device = createDevice({ displayName: 'Approval test', platform: 'android',
        publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
        scopes: allowed ? ['sessions.write', 'sessions.permissions'] : ['sessions.write'],
      });
      const token = issueDeviceTokenPair(device.id).accessToken;
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'PATCH', body,
        headers: signedDeviceHeaders(keys.privateKey, token, path, 'PATCH', body, { 'Content-Type': 'application/json' }),
      });
      expect(response.status).toBe(allowed ? 200 : 403);
      const adminPath = '/api/config';
      const admin = await fetch(`http://127.0.0.1:${address.port}${adminPath}`, {
        headers: signedDeviceHeaders(keys.privateKey, token, adminPath),
      });
      expect(admin.status).toBe(403);
    }
    expect(patchAgentConfig).toHaveBeenCalledOnce();
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  }
});
