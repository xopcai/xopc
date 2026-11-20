import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import type { CapabilityDescriptor } from '@xopcai/gateway-contract';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { createMcpConnection, MCP_BRIDGE_PATH, revokeMcpConnection } from '../../mcp/connection-grants.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('authenticates and limits MCP grants through the real Gateway HTTP route', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-mcp-http-'));
  vi.stubEnv('XOPC_STATE_DIR', directory);
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });

  const owner = randomUUID();
  const listNotes = vi.fn(async () => ({
    items: [{ id: 'note', markdown: 'private full text', title: 'Fixture', kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 1 }],
    total: 1, limit: 25, offset: 0, hasMore: false,
  }));
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token: owner } } }),
    getResolvedAuth: () => ({ mode: 'token', token: owner }),
    getAuthToken: () => owner, isGatewayReady: () => true, getExtensionLoader: () => null,
    notesServiceInstance: { listNotes },
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing Gateway listener');
    const base = `http://127.0.0.1:${address.port}`;
    const connection = createMcpConnection(['xopc.notes.list']);
    const headers = { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' };
    const bridge = base + MCP_BRIDGE_PATH;
    expect((await fetch(bridge)).status).toBe(403);
    expect((await fetch(bridge, { headers: { Authorization: `Bearer ${owner}` } })).status).toBe(403);
    expect((await fetch(bridge, { headers: { ...headers, 'X-Forwarded-For': '192.0.2.1' } })).status).toBe(403);
    expect((await fetch(base + '/api/capabilities/operations', { headers })).status).toBe(401);

    const discovery = await fetch(bridge, { headers });
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get('Cache-Control')).toBe('no-store');
    const { capabilities } = await discovery.json() as { capabilities: CapabilityDescriptor[] };
    expect(capabilities.map(tool => tool.id)).toEqual(['xopc.notes.list']);
    const { id, majorVersion, descriptorDigest } = capabilities[0]!;
    const invoke = (capability: string, input: unknown) => fetch(bridge, {
      method: 'POST', headers, body: JSON.stringify({ capability, majorVersion, descriptorDigest, input }),
    });
    expect((await invoke('xopc.notes.create', {})).status).toBe(403);
    expect((await invoke(id, { principalId: 'owner' })).status).toBe(400);
    const response = await invoke(id, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: {
      items: [{ id: 'note', title: 'Fixture', kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 1 }],
      total: 1, limit: 25, offset: 0, hasMore: false,
    } });
    expect(listNotes).toHaveBeenCalledTimes(1);
    revokeMcpConnection(connection.connectionId);
    expect((await fetch(bridge, { headers })).status).toBe(403);
    expect((await invoke(id, {})).status).toBe(403);
    expect(listNotes).toHaveBeenCalledTimes(1);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
