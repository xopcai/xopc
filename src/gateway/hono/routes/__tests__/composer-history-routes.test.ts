import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/connection.js';
import { createConversation } from '../../../../storage/sqlite/conversation-repository.js';
import { registerComposerHistoryRoutes } from '../composer-history.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('composer history routes', () => {
  let stateDir: string;
  let app: Hono;
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-composer-history-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    createConversation({ agentId: 'main' }, '', A);
    createConversation({ agentId: 'main' }, '', B);
    app = new Hono();
    emit = vi.fn();
    registerComposerHistoryRoutes(app, {
      service: { emit },
      strictRateLimitMiddleware: async (_c, next) => next(),
      chatRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('appends, lists, and broadcasts a scoped entry', async () => {
    const post = await app.request('/api/composer-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: A, text: ' hello ' }),
    });
    expect(post.status).toBe(200);
    expect(emit).toHaveBeenCalledWith('composer-history.appended', expect.objectContaining({ conversationId: A, text: 'hello' }));

    const get = await app.request(`/api/composer-history?conversationId=${A}`);
    await expect(get.json()).resolves.toMatchObject({ items: [{ text: 'hello' }] });
  });

  it('rejects missing or unknown conversations and isolates reads and clears', async () => {
    expect((await app.request('/api/composer-history')).status).toBe(400);
    expect((await app.request(`/api/composer-history?conversationId=33333333-3333-4333-8333-333333333333`)).status).toBe(404);
    for (const conversationId of [A, B]) {
      await app.request('/api/composer-history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId, text: conversationId }) });
    }
    await expect((await app.request(`/api/composer-history?conversationId=${A}`)).json()).resolves.toMatchObject({ items: [{ text: A }] });
    await app.request(`/api/composer-history?conversationId=${A}`, { method: 'DELETE' });
    expect(emit).toHaveBeenLastCalledWith('composer-history.cleared', { conversationId: A, cleared: 1 });
    await expect((await app.request(`/api/composer-history?conversationId=${B}`)).json()).resolves.toMatchObject({ items: [{ text: B }] });
  });

  it('does not broadcast an adjacent duplicate', async () => {
    const request = () => app.request('/api/composer-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: A, text: 'same' }),
    });
    await request();
    await request();
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
