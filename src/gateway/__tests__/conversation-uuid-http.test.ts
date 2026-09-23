import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { ConfigSchema } from '../../config/schema.js';
import { GatewayService } from '../service.js';
import { createHonoApp } from '../hono/app.js';
import { requireConversation } from '../../storage/sqlite/conversation-repository.js';

it('creates a UUID conversation through authenticated HTTP and the production route registry', async () => {
  const configPath = join(process.env.XOPC_STATE_DIR!, 'http-uuid-config.json');
  const token = 'conversation-uuid-test-token';
  const repository = new AgentCatalogRepository();
  const main = repository.get('main')!;
  repository.update('main', main.revision, { id: 'main', enabled: true, workspace: process.env.XOPC_STATE_DIR });
  const config = ConfigSchema.parse({
    gateway: { auth: { mode: 'token', token }, heartbeat: { enabled: false, intervalMs: 1800000 } },
  });
  writeFileSync(configPath, JSON.stringify(config));
  const service = new GatewayService({ configPath, enableHotReload: false });
  const app = createHonoApp({ service, listenHost: '127.0.0.1' });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`;
  try {
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ agentId: 'main', channel: 'tui' }) });
    const body = await response.json() as { conversationId: string; session: { transcriptId: string; agentId: string } };
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.session.transcriptId).not.toBe(body.conversationId);
    expect(body.session.agentId).toBe('main');
    expect(requireConversation(body.conversationId).customData?.genericNewChatShell).toBe(true);
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ conversationId: body.conversationId, agentId: 'main' }) })).status).toBe(409);
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ agentId: 'missing-agent' }) })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ conversationId: 'agent:main:main' }) })).status).toBe(400);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await service.stop();
  }
}, 30_000);
