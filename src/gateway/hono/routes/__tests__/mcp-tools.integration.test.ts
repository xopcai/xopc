import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

it('discovers paginated HTTP tools through a running authenticated Gateway and lazy bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-gateway-mcp-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  openXopcDatabase({ path: ':memory:' });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root }] });
  buckets.resetAllForTests();
  const methods: string[] = [];
  const mcp = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const q = JSON.parse(body);
    methods.push(q.method);
    if (q.id === undefined) { res.writeHead(202).end(); return; }
    const result = q.method === 'initialize' ? { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }
      : q.method === 'tools/list' ? { tools: [{ name: q.params?.cursor ? 'second' : 'first', description: 'Search notes',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }], ...(q.params?.cursor ? {} : { nextCursor: 'page-2' }) }
      : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }));
  });
  mcp.listen(0, '127.0.0.1');
  await once(mcp, 'listening');
  const address = mcp.address();
  if (!address || typeof address === 'string') throw new Error('Expected MCP listener');
  const auth = { mode: 'token' as const, token: 'mcp-catalog-test-token' };
  const service = {
    currentConfig: ConfigSchema.parse({ gateway: { auth }, mcp: { servers: { docs: { url: `http://127.0.0.1:${address.port}/mcp` } } } }),
    getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const bound = gateway.address();
    if (!bound || typeof bound === 'string') throw new Error('Expected Gateway listener');
    const url = `http://127.0.0.1:${bound.port}/api/mcp/servers/docs/tools`;
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    expect(methods).toEqual([]);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` } });
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(200);
    expect(data.payload.tools.map((tool: { name: string }) => tool.name)).toEqual(['mcp__docs__first', 'mcp__docs__second']);
    expect(data.payload.tools[0].inputSchema.properties.query.type).toBe('string');
    expect(methods).not.toContain('tools/call');
    expect((await fetch(url.replace('/docs/', '/missing/'), { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` } })).status).toBe(404);
  } finally {
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await new Promise<void>(resolve => mcp.close(() => resolve()));
    closeXopcDatabase(); buckets.resetAllForTests(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
