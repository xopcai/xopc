import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { PhoneSetupService } from '../../../../phone/setup/service.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { createConversation } from '../../../../storage/sqlite/conversation-repository.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';
import type { PhoneRuntime } from '../../../../phone/runtime.js';

it('serves Phone setup via real authenticated lazy routes without exposing upload or install authority to the model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-phone-setup-http-'));
  vi.stubEnv('XOPC_STATE_DIR', root); openXopcDatabase({ path: join(root, 'test.db') });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root }] });
  const conversation = createConversation({ agentId: 'main' }, root); buckets.resetAllForTests();
  const auth = { mode: 'token' as const, token: 'phone-setup-test-token' };
  const config = ConfigSchema.parse({ gateway: { bind: 'loopback', auth } });
  const setup = new PhoneSetupService({ runtime: { status: () => undefined } as unknown as PhoneRuntime,
    inspect: async () => ({ enabled: false, toolAllowed: true, model: { supported: false, configured: false }, dependencies: [], devices: [], localDiscovery: [] }),
    revision: () => 'one', connected: async () => false, leaseActive: () => false });
  const service = { currentConfig: config, getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    phoneSetup: setup, getExtensionLoader: () => null, isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }) } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const address = gateway.address(); if (!address || typeof address === 'string') throw new Error('No listener');
    const request = (body: unknown, authenticated = true) => fetch(`http://127.0.0.1:${address.port}/api/phone/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${auth.token}` } : {}) }, body: JSON.stringify(body) });
    expect((await request({ action: 'inspect', conversationId: conversation.key }, false)).status).toBe(401);
    const response = await request({ action: 'start', conversationId: conversation.key }); expect(response.status).toBe(200);
    const { payload } = await response.json() as { payload: { id: string; revision: number } };
    expect((await request({ action: 'source', conversationId: conversation.key, setupId: payload.id, source: 'aliyun', expectedRevision: payload.revision })).status).toBe(200);
    expect((await request({ action: 'get', conversationId: conversation.key, setupId: payload.id, privateKey: 'not-accepted' })).status).toBe(400);
    expect((await request({ action: 'install', conversationId: conversation.key, setupId: payload.id })).status).toBe(400);
    const result = await (await request({ action: 'get', conversationId: conversation.key, setupId: payload.id })).json();
    expect(result).toMatchObject({ payload: { source: 'aliyun', state: 'configuring', readiness: { enabled: false }, checks: { verified: false, released: false } } });
  } finally {
    gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve()));
    closeXopcDatabase(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
  }
}, 30_000);
