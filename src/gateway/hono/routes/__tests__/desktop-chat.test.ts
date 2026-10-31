import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DesktopChatBootstrapSchema } from '@xopcai/gateway-contract';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { auth } from '../../middleware/auth.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { registerDesktopChatRoutes } from '../desktop-chat.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'xopc-chat-identity-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'xopc.db') }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });
const deps = { service: { getResolvedAuth: () => ({ mode: 'token' }), currentConfig: { gateway: { auth: { mode: 'token' } } } } } as never;
it('requires real owner token authentication and returns only stable public identity', async () => {
  const app = new Hono(); app.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-owner' }) }));
  registerDesktopChatRoutes(app, deps);
  const path = '/api/desktop-chat/bootstrap';
  expect((await app.request(path)).status).toBe(401);
  expect((await app.request(path, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
  const response = await app.request(path, { headers: { Authorization: 'Bearer test-owner' } });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const identity = DesktopChatBootstrapSchema.parse(await response.json());
  expect(JSON.stringify(identity)).not.toMatch(/privateKey|test-owner|pairingCode|deviceId/);
  const again = await app.request(path, { headers: { Authorization: 'Bearer test-owner' } });
  expect(await again.json()).toEqual(identity);
});
it.each(['device', 'trusted-proxy'] as const)('rejects %s even with an administrator scope', async kind => {
  const app = new Hono();
  app.use('*', async (c, next) => { setGatewayPrincipal(c, { kind, principalId: 'test', scopes: ['gateway.admin'] }); await next(); });
  registerDesktopChatRoutes(app, deps);
  expect((await app.request('/api/desktop-chat/bootstrap')).status).toBe(403);
});
it('does not expose remote discovery when authentication is disabled', async () => {
  const app = new Hono(); app.use('*', auth({ getResolvedAuth: () => ({ mode: 'none' }) }));
  registerDesktopChatRoutes(app, { service: { getResolvedAuth: () => ({ mode: 'none' }), currentConfig: { gateway: { auth: { mode: 'token' } } } } } as never);
  expect((await app.request('/api/desktop-chat/bootstrap')).status).toBe(403);
});

it('advertises S3 only on explicit negotiation without changing the S2 response', async () => {
  const app = new Hono(); app.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-owner' }) })); registerDesktopChatRoutes(app, deps);
  const headers = { Authorization: 'Bearer test-owner' };
  const old = await (await app.request('/api/desktop-chat/bootstrap', { headers })).json();
  const next = await (await app.request('/api/desktop-chat/bootstrap?chat=1', { headers })).json();
  expect(old.payload.manifest.chat).toBeUndefined(); expect(next.payload.manifest.chat).toBe('text-receipt.v1');
  expect(DesktopChatBootstrapSchema.safeParse(next).success).toBe(true); expect(next.payload.gatewayId).toBe(old.payload.gatewayId);
});
