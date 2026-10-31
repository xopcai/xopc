import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESKTOP_HOST_MANIFEST, desktopPairingInvitationSchema } from '@xopcai/gateway-contract';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { auth } from '../../middleware/auth.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { registerDesktopHostRoutes } from '../desktop-host.js';
import type { AuthenticatedRouteDeps } from '../deps.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'xopc-desktop-credential-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'xopc.db') }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });
const deps = (mode = 'token', publicUrl = 'https://gateway.example.com') => ({ service: {
  getResolvedAuth: () => ({ mode, token: 'test-owner' }), currentConfig: { gateway: { publicUrl } },
} }) as unknown as AuthenticatedRouteDeps;
const headers = { Authorization: 'Bearer test-owner', 'Content-Type': 'application/json' };
it('requires authentication, advertises credentials only, and separates desktop invitations', async () => {
  const app = new Hono(); app.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-owner' }) })); registerDesktopHostRoutes(app, deps());
  expect((await app.request('/api/desktop-host/compatibility')).status).toBe(401);
  const response = await app.request('/api/desktop-host/compatibility', { headers });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).payload.manifest).toEqual(DESKTOP_HOST_MANIFEST);
  const paired = await app.request('/api/desktop-host/pairing-setups', { method: 'POST', headers, body: '{}' });
  expect(paired.status).toBe(201); const payload = (await paired.json()).payload;
  expect(desktopPairingInvitationSchema.parse(payload.invitation).targetKind).toBe('desktop');
  expect(payload).not.toHaveProperty('browserInvitation'); expect(payload).not.toHaveProperty('universalLink');
});
it.each(['device', 'trusted-proxy'] as const)('refuses %s pairing even with administrator scope', async kind => {
  const app = new Hono(); app.use('*', async (c, next) => { setGatewayPrincipal(c, { kind, principalId: 'test', scopes: ['gateway.admin'] }); await next(); }); registerDesktopHostRoutes(app, deps());
  expect((await app.request('/api/desktop-host/pairing-setups', { method: 'POST', headers, body: '{}' })).status).toBe(403);
});
it('refuses disabled authentication and missing secure routes', async () => {
  const app = new Hono(); app.use('*', auth({ getResolvedAuth: () => ({ mode: 'none' }) })); registerDesktopHostRoutes(app, deps('none'));
  expect((await app.request('/api/desktop-host/pairing-setups', { method: 'POST', headers, body: '{}' })).status).toBe(403);
  expect((await app.request('/api/desktop-host/compatibility', { headers })).status).toBe(403);
  const secure = new Hono(); secure.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-owner' }) })); registerDesktopHostRoutes(secure, deps('token', ''));
  expect((await secure.request('/api/desktop-host/pairing-setups', { method: 'POST', headers, body: '{}' })).status).toBe(409);
});
it('allows an explicitly selected desktop SSH loopback without broadening browser or mobile invitations', async () => {
  const app = new Hono(); app.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-owner' }) })); registerDesktopHostRoutes(app, deps('token', ''));
  for (const sshOrigin of ['http://remote.example.com:18790', 'http://127.0.0.1:18790/path', 'http://user@127.0.0.1:18790', 'https://127.0.0.1:18790']) {
    expect((await app.request('/api/desktop-host/pairing-setups', { method: 'POST', headers, body: JSON.stringify({ sshOrigin }) })).status).toBe(400);
  }
  const response = await app.request('/api/desktop-host/pairing-setups', { method: 'POST', headers, body: JSON.stringify({ sshOrigin: 'http://127.0.0.1:19340' }) });
  expect(response.status).toBe(201);
  const invitation = desktopPairingInvitationSchema.parse((await response.json()).payload.invitation);
  expect(invitation.targetKind).toBe('desktop'); expect(invitation.routes).toEqual([{ id: 'desktop-ssh', kind: 'ssh-loopback', url: 'http://127.0.0.1:19340' }]);
});
