import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { EphemeralSideChatManager } from '../../../side-chat/manager.js';
import type { SessionMetadata } from '../../../../session/types.js';
import { registerSideChatRoutes } from '../side-chats.js';
import type { AuthenticatedRouteDeps } from '../deps.js';

describe('side chat lifecycle routes', () => {
  it('reports an authenticated expiry as 410 and refuses heartbeat or extension after the deadline', async () => {
    let now = 0;
    const manager = new EphemeralSideChatManager({
      now: () => now,
      idleTtlMs: 1000,
      startSweepTimer: false,
      getParentMetadata: async () => ({ sessionId: 'parent-id', key: 'parent' }) as SessionMetadata,
      loadParentMessages: async () => [],
      getDefaultModelRef: () => 'openai/test',
      getWorkspacePath: () => '/tmp',
    });
    const app = new Hono();
    registerSideChatRoutes(app, {
      service: { sideChats: manager },
      chatRateLimitMiddleware: async (_c, next) => { await next(); },
    } as unknown as AuthenticatedRouteDeps);
    const chat = await manager.create({ parentSessionKey: 'parent', clientInstanceId: 'owner' });
    const request = (operation: string, owner = 'owner') => app.request(`/api/side-chats/${chat.id}/${operation}`, {
      method: 'POST', headers: { 'x-xopc-client-instance-id': owner },
    });
    now = 500;
    const heartbeat = await request('heartbeat');
    expect((await heartbeat.json()).sideChat.expiresAt).toBe(new Date(1000).toISOString());
    const extended = await request('extend');
    expect((await extended.json()).sideChat.expiresAt).toBe(new Date(1500).toISOString());
    now = 1500;
    for (const operation of ['heartbeat', 'extend']) {
      const result = await request(operation);
      expect(result.status).toBe(410);
      expect(await result.json()).toMatchObject({ code: 'EXPIRED', reason: 'idle' });
    }
    expect((await request('heartbeat', 'other')).status).toBe(404);
    await manager.disposeAll();
  });

  it('accepts attachment-only inputs and passes validated attachments to the run service', async () => {
    const manager = new EphemeralSideChatManager({
      startSweepTimer: false,
      getParentMetadata: async () => ({ sessionId: 'parent-id', key: 'parent' }) as SessionMetadata,
      loadParentMessages: async () => [],
      getDefaultModelRef: () => 'openai/test',
      getWorkspacePath: () => '/tmp',
    });
    const submit = vi.fn(() => ({ runId: 'run-1' }));
    const app = new Hono();
    registerSideChatRoutes(app, {
      service: { sideChats: manager, sideChatRuns: { submit } },
      chatRateLimitMiddleware: async (_c, next) => { await next(); },
    } as unknown as AuthenticatedRouteDeps);
    const chat = await manager.create({ parentSessionKey: 'parent', clientInstanceId: 'owner' });
    const attachment = { type: 'file', name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' };

    const response = await app.request(`/api/side-chats/${chat.id}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xopc-client-instance-id': 'owner' },
      body: JSON.stringify({ content: '', attachments: [attachment] }),
    });

    expect(response.status).toBe(202);
    expect(submit).toHaveBeenCalledWith(chat.id, 'owner', { content: '', attachments: [attachment] });
    await manager.disposeAll();
  });
});
