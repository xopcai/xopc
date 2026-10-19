import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('isolates composer history through the authenticated Gateway HTTP path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-composer-http-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const token = 'composer-history-test-token';
  const emit = vi.fn();
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }),
    getAuthToken: () => token,
    isGatewayReady: () => true,
    getExtensionLoader: () => null,
    emit,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test Gateway address');
    const base = `http://127.0.0.1:${address.port}/api/composer-history`;
    const a = createConversation({ agentId: 'main' }).key;
    const b = createConversation({ agentId: 'main' }).key;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect((await fetch(`${base}?conversationId=${a}`)).status).toBe(401);
    expect((await fetch(base, { headers })).status).toBe(400);
    for (const conversationId of [a, b]) {
      const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ conversationId, text: `first ${conversationId}` }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ item: { conversationId, text: `first ${conversationId}` } });
    }
    for (const conversationId of [a, b, a]) {
      const response = await fetch(`${base}?conversationId=${conversationId}`, { headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ items: [{ conversationId, text: `first ${conversationId}` }] });
    }
    expect((await fetch(`${base}?conversationId=${a}`, { method: 'DELETE', headers })).status).toBe(200);
    expect(emit).toHaveBeenLastCalledWith('composer-history.cleared', { conversationId: a, cleared: 1 });
    expect(await (await fetch(`${base}?conversationId=${b}`, { headers })).json()).toMatchObject({ items: [{ conversationId: b }] });
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
