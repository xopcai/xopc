import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { installConnector } from '../../../../connectors/install.js';
import { startConnectorSupervisor } from '../../../../connectors/supervisor.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

it('checks a managed MCP through authenticated Gateway routes and persists supervisor results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-connector-health-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  openXopcDatabase({ path: ':memory:' });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root }] });
  buckets.resetAllForTests();
  let fail = false;
  const methods: string[] = [];
  const mcp = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    if (fail) { res.writeHead(401).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const q = JSON.parse(body);
    methods.push(q.method);
    if (q.id === undefined) { res.writeHead(202).end(); return; }
    const result = q.method === 'initialize'
      ? { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }
      : q.method === 'tools/list'
        ? { tools: [{ name: 'query', description: 'Query trains', inputSchema: { type: 'object' } }] }
        : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }));
  });
  mcp.listen(0, '127.0.0.1');
  await once(mcp, 'listening');
  const address = mcp.address();
  if (!address || typeof address === 'string') throw new Error('Expected MCP listener');
  const auth = { mode: 'token' as const, token: 'connector-health-test-token' };
  const config = ConfigSchema.parse({ gateway: { auth } });
  await installConnector(config, 'railway-12306', {});
  const server = config.mcp!.servers!.railway_12306!;
  delete server.command; delete server.args;
  server.url = `http://127.0.0.1:${address.port}/mcp`;
  const saveConfig = vi.fn(async () => ({ saved: true }));
  const service = { currentConfig: config, saveConfig,
    getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  const supervisor = startConnectorSupervisor({ getConfig: () => config, saveConfig, initialDelayMs: 60_000 });
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const bound = gateway.address();
    if (!bound || typeof bound === 'string') throw new Error('Expected Gateway listener');
    const base = `http://127.0.0.1:${bound.port}/api/connectors`;
    const headers = { Authorization: `Bearer ${auth.token}` };
    expect((await fetch(`${base}/railway_12306/test`, { method: 'POST' })).status).toBe(401);
    expect(methods).toEqual([]);
    const response = await fetch(`${base}/railway_12306/test`, { method: 'POST', headers });
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(200);
    expect(data.payload).toMatchObject({ ok: true, status: 'ok', toolCount: 1 });
    expect(data.payload.tools[0].name).toBe('mcp__railway_12306__query');
    expect(saveConfig).toHaveBeenCalled();
    const installed = await (await fetch(`${base}/installed`, { headers })).json();
    expect(installed.payload.instances[0]).toMatchObject({ connectionStatus: 'connected', usage: { lastHealthStatus: 'ok' } });
    expect(methods).not.toContain('tools/call');

    fail = true;
    await supervisor.runNow();
    const failed = await (await fetch(`${base}/installed`, { headers })).json();
    expect(failed.payload.instances[0]).toMatchObject({ connectionStatus: 'unauthorized', usage: { lastHealthStatus: 'unauthorized' } });
    expect(failed.payload.instances[0].lastError).toBeTruthy();
    expect((await fetch(`${base}/missing/test`, { method: 'POST', headers })).status).toBe(404);
  } finally {
    supervisor.stop();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await new Promise<void>(resolve => mcp.close(() => resolve()));
    closeXopcDatabase(); buckets.resetAllForTests(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
