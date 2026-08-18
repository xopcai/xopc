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
import { registerComposerHistoryRoutes } from '../composer-history.js';

describe('composer history routes', () => {
  let stateDir: string;
  let app: Hono;
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-composer-history-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono();
    emit = vi.fn();
    registerComposerHistoryRoutes(app, {
      service: { emit },
      strictRateLimitMiddleware: async (_c, next) => next(),
      chatRateLimitMiddleware: async (_c, next) => next(),
      sseConfig: {},
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('appends, lists, and broadcasts a global entry', async () => {
    const post = await app.request('/api/composer-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: ' hello ' }),
    });
    expect(post.status).toBe(200);
    expect(emit).toHaveBeenCalledWith('composer-history.appended', expect.objectContaining({ text: 'hello' }));

    const get = await app.request('/api/composer-history');
    await expect(get.json()).resolves.toMatchObject({ items: [{ text: 'hello' }] });
  });

  it('does not broadcast an adjacent duplicate', async () => {
    const request = () => app.request('/api/composer-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'same' }),
    });
    await request();
    await request();
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
