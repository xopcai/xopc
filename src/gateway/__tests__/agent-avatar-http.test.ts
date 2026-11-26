import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { listGatewayAgents, updateGatewayAgent } from '../agents-admin.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('serves configured native avatars through authenticated HTTP and the Agent lazy route', async () => {
  const state = mkdtempSync(join(tmpdir(), 'xopc-avatar-http-'));
  vi.stubEnv('XOPC_STATE_DIR', state);
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(state, 'xopc.db') });
  seedTestAgentCatalog({
    agents: [
      { id: 'main', enabled: true, profile: { name: '我的助手' } },
      { id: 'claude-dev', enabled: true, profile: { name: 'Claude Dev' }, execution: { kind: 'claude' } },
    ],
  });
  const token = 'avatar-fixture-token';
  const emit = vi.fn();
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true,
    emit,
    refreshAgentCatalog: vi.fn(),
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const base = `http://127.0.0.1:${address.port}/api/agents/main/avatar`;
    expect((await fetch(base + '?resolve=1')).status).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    const generated = await fetch(base + '?resolve=1', { headers });
    expect(generated.status).toBe(200);
    expect(generated.headers.get('content-type')).toBe('image/png');
    const original = Buffer.from(await generated.arrayBuffer());
    expect(original.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await fetch(base, { headers })).status).toBe(404);
    expect((await updateGatewayAgent('main', { profile: { name: '我的助手', avatar: 'xopc:dicebear:thumbs:review' } })).ok).toBe(true);
    const changed = await fetch(base + '?resolve=1', { headers });
    expect(changed.status).toBe(200);
    expect(Buffer.from(await changed.arrayBuffer()).equals(original)).toBe(false);

    // External agent: defaults to runtime avatar, supports uploading a custom avatar & saving profile.avatar
    const extUrl = `http://127.0.0.1:${address.port}/api/agents/claude-dev/avatar`;
    const initialList = await listGatewayAgents();
    expect(initialList.agents.find((a) => a.id === 'claude-dev')?.avatar).toBe('xopc:runtime:claude');

    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const putRes = await fetch(extUrl, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ base64: png1x1.toString('base64'), mimeType: 'image/png' }),
    });
    expect(putRes.status).toBe(200);
    expect(emit).toHaveBeenCalledWith('agent.avatar.updated', { agentId: 'claude-dev' });

    expect((await updateGatewayAgent('claude-dev', {
      profile: { name: 'Claude Dev', avatar: 'xopc:custom' },
    })).ok).toBe(true);
    const updatedList = await listGatewayAgents();
    expect(updatedList.agents.find((a) => a.id === 'claude-dev')?.avatar).toBe('xopc:custom');

    const servedCustom = await fetch(extUrl, { headers });
    expect(servedCustom.status).toBe(200);
    expect(Buffer.from(await servedCustom.arrayBuffer()).equals(png1x1)).toBe(true);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
}, 30000);
