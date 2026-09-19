import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';
import { ConfigSchema } from '../../config/schema.js';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorConnection } from '../../storage/sqlite/index.js';
import { getConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import { activateComposioBackend, addComposioBackend } from '../../connectors/composio-backends.js';
import { saveAuthorizationAttempt } from '../../connectors/authorization-attempts.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('manages account policy through authenticated HTTP and the lazy route loader', async () => {
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: ':memory:' });
  const token = 'connector-account-test-token';
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const base = `http://127.0.0.1:${address.port}`;
    const account = upsertConnectorConnection({ id: 'auth', connectorId: 'composio-gmail', provider: 'composio',
      principalId: 'local-owner', providerConnectionId: 'ca-test', identity: {}, status: 'active', isDefault: false, metadata: {} });
    const path = `${base}/api/connectors/composio/accounts/${encodeURIComponent(account.accountId!)}`;
    expect((await fetch(path, { method: 'PATCH' })).status).toBe(401);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const response = await fetch(path, { method: 'PATCH', headers, body: JSON.stringify({ label: 'Work', enabled: false, allowedAgentIds: [] }) });
    expect(response.status).toBe(200);
    expect(getConnectorAccount(account.accountId!)).toMatchObject({ label: 'Work', enabled: false, allowedAgentIds: [] });
    const attemptId = saveAuthorizationAttempt({ connectionId: account.id, principalId: 'local-owner', connectorId: account.connectorId });
    const attemptPath = `${base}/api/connectors/composio/authorizations/${attemptId}`;
    expect((await fetch(attemptPath)).status).toBe(401);
    const attemptResponse = await fetch(attemptPath, { headers });
    expect(attemptResponse.status).toBe(200);
    expect(await attemptResponse.json()).toMatchObject({ payload: { attempt: { status: 'succeeded', accountId: account.accountId, authorizationUrl: null } } });
    expect((await fetch(path, { method: 'PATCH', headers, body: '{"enabled":"false"}' })).status).toBe(400);
    const backend = addComposioBackend({ mode: 'byok', label: 'Test', credentialRef: 'nonexistent-test-credential' });
    activateComposioBackend(backend.id);
    const setup = await fetch(`${base}/api/connectors/composio/setup-status`, { headers });
    expect(setup.status).toBe(200);
    expect(await setup.json()).toMatchObject({ payload: { backendId: backend.id, mode: 'byok', configured: false } });
    expect((await fetch(`${base}/api/connectors-other`, { headers })).status).toBe(404);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  }
}, 30_000);
