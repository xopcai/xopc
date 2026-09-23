import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { PLUGIN_SCHEMA, MCP_SCHEMA } from '../../extensions/agent-plugins/validation.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('installs, activates, updates and removes through real authenticated HTTP and lazy routes', async () => {
  const state = mkdtempSync(join(tmpdir(), 'xopc-plugin-http-'));
  const source = mkdtempSync(join(tmpdir(), 'xopc-plugin-source-'));
  vi.stubEnv('XOPC_STATE_DIR', state);
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(state, 'xopc.db') });
  seedTestAgentCatalog();
  const token = 'agent-plugin-http-token';
  const refresh = vi.fn();
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
    marketplace: { reloadSkills: refresh },
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const base = `http://127.0.0.1:${address.port}`;
    const request = async (path: string, method: string, body?: unknown, expected = 200) => {
      const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(expected); return result;
    };
    writeFileSync(join(source, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'http-fixture' }));
    writeFileSync(join(source, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { main: { type: 'streamable-http', url: 'https://example.com/mcp' } } }));
    expect((await fetch(base + '/api/extensions/inspect', { method: 'POST' })).status).toBe(401);
    const plan = (await request('/api/extensions/inspect', 'POST', { source })).payload;
    await request('/api/extensions/install', 'POST', { source }, 400);
    const installed = (await request('/api/extensions/install', 'POST', { source, reviewHash: plan.reviewHash })).payload;
    expect(installed).toMatchObject({ format: 'agent-plugin', active: false });
    const path = '/api/extensions/agent-plugins/http-fixture';
    expect((await request(`${path}/activation`, 'POST', { enabled: true })).payload.active).toBe(true);
    expect((await request('/api/extensions', 'GET')).extensions).toHaveLength(1);
    expect((await request(path, 'GET')).payload.components.skills).toEqual([]);
    await request(`${path}/mcp/main/auth`, 'PUT', { mode: 'oauth' });
    const mcpPath = `/api/mcp/servers/${encodeURIComponent('plugin/http-fixture/main')}`;
    expect((await request(`${mcpPath}/oauth`, 'GET')).payload.status).toBe('disconnected');
    expect((await request(`${mcpPath}/test`, 'POST', {}, 409)).code).toBe('MCP_AUTHORIZATION_REQUIRED');
    await request(`${mcpPath}/oauth/callback`, 'POST', { callbackUrl: 'http://127.0.0.1/oauth/callback?code=unexpected' }, 400);
    writeFileSync(join(source, 'note.txt'), 'new revision');
    await request(`${path}/update`, 'POST', { source });
    await request(`${path}/rollback`, 'POST');
    await request(path, 'DELETE', { removeData: false, removeCredentials: true });
    expect((await request('/api/extensions', 'GET')).extensions).toHaveLength(0);
    expect(refresh).toHaveBeenCalledTimes(6);
  } finally {
    server.closeAllConnections?.(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs();
    rmSync(source, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true });
  }
}, 30000);
