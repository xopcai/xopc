import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('XOPC_UI_STATIC_ROOT', `${process.cwd()}/web/public`); });

import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { BrowserSetupService } from '../../../../browser/setup/service.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { createConversation } from '../../../../storage/sqlite/conversation-repository.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';
import type { EndpointToolRuntime } from '../../../../endpoint-tools/index.js';

it('reaches Browser setup via real authenticated lazy Gateway routes and owner-scoped actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-browser-http-'));
  vi.stubEnv('XOPC_STATE_DIR', root);
  openXopcDatabase({ path: join(root, 'test.db') });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root }] });
  const conversation = createConversation({ agentId: 'main' }, root);
  buckets.resetAllForTests();
  const auth = { mode: 'token' as const, token: 'browser-setup-test-token' };
  let config = ConfigSchema.parse({ gateway: { bind: 'loopback', auth }, browser: { enabled: false, driver: { kind: 'extension' } } });
  const prepare = vi.fn(async () => ({}));
  const setup = new BrowserSetupService({ getConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; },
    endpoints: { registry: { list: () => [] } } as unknown as EndpointToolRuntime, canUseBrowser: () => true,
    prepare, open: vi.fn(async () => ({})), doctor: async () => ({ installed: true, nativeHost: { installed: true } }), release: vi.fn(),
  });
  const service = { get currentConfig() { return config; }, getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    get browserSetup() { return setup; }, getExtensionLoader: () => null, isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }) } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const address = gateway.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (body: unknown, authenticated = true) => fetch(`${base}/api/browser/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${auth.token}` } : {}) }, body: JSON.stringify(body) });
    expect((await request({ conversationId: conversation.key, action: 'inspect' }, false)).status).toBe(401);
    const demo = await fetch(`${base}/browser-setup-test.html`);
    expect(demo.status).toBe(200);
    expect(demo.headers.get('Content-Type')).toContain('text/html');
    expect(await demo.text()).toContain('Test input');
    expect((await fetch(`${base}/browser-setup-test.js`)).status).toBe(200);
    expect((await fetch(`${base}/browser-setup-test-secret`)).status).toBe(401);
    const started = await request({ conversationId: conversation.key, action: 'start' });
    expect(started.status).toBe(200);
    const { payload } = await started.json() as { payload: { id: string; revision: number } };
    const body = { conversationId: conversation.key, setupId: payload.id };
    expect((await request({ ...body, action: 'prepare' })).status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
    expect((await request({ ...body, action: 'approve', expectedRevision: payload.revision })).status).toBe(200);
    const prepared = await request({ ...body, action: 'prepare' });
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({ payload: { state: 'waiting_extension', checks: { configured: true, read: false, released: false } } });
    expect(prepare).toHaveBeenCalledOnce();
    expect((await request({ ...body, action: 'get', principalId: 'forged' })).status).toBe(400);
    expect((await request({ ...body, action: 'cancel' })).status).toBe(200);
    expect((await request({ ...body, action: 'prepare' })).status).toBe(403);
  } finally {
    gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve()));
    closeXopcDatabase(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
  }
}, 30_000);
