import { Hono } from 'hono';
import { expect, it } from 'vitest';

import { EndpointContextStore } from '../../../../endpoint-tools/context-store.js';
import { EndpointRegistry } from '../../../../endpoint-tools/registry.js';
import { setGatewayPrincipal, type GatewayPrincipal } from '../../../security/gateway-principal.js';
import { requiredGatewayScope } from '../../../security/gateway-scopes.js';
import { registerEndpointEnvironmentRoutes } from '../endpoint-environment.js';
import type { AuthenticatedRouteDeps } from '../deps.js';

it('does not allow device or proxy credentials to access another context source', async () => {
  const registry = new EndpointRegistry();
  const contexts = new EndpointContextStore(registry);
  registry.register({ principalId: 'device-a', endpointId: 'phone-a', connectionInstanceId: 'instance', displayName: 'Phone',
    kind: 'mobile', platform: 'android', appVersion: '1', availability: 'foreground', nonce: 'n', signedAt: Date.now(), signature: 's', tools: [] },
  'epoch', { readyState: 1, send() {}, close() {} });
  const app = new Hono();
  let actor: GatewayPrincipal = { kind: 'device', principalId: 'device-b', deviceId: 'device-b', scopes: ['device.self'] };
  app.use('*', async (c, next) => { setGatewayPrincipal(c, actor); await next(); });
  registerEndpointEnvironmentRoutes(app, { service: { endpointTools: { registry, contexts } } } as AuthenticatedRouteDeps);
  const root = '/api/user-context/environment';
  expect((await app.request(`${root}/endpoints/phone-a`)).status).toBe(403);
  expect((await (await app.request(root)).json()).payload).toEqual([]);
  actor = { kind: 'trusted-proxy', principalId: 'proxy', scopes: ['gateway.admin'] };
  expect((await app.request(`${root}/endpoints/phone-a`)).status).toBe(403);
  actor = { kind: 'device', principalId: 'device-a', deviceId: 'device-a', scopes: ['device.self'] };
  expect((await app.request(`${root}/endpoints/phone-a`)).status).toBe(200);
  expect(requiredGatewayScope('POST', `${root}/reports`)).toBe('device.self');
  expect(requiredGatewayScope('GET', '/api/user-context/environment-other')).toBe('gateway.admin');
  contexts.close();
});
