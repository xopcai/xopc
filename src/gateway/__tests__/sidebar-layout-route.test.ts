import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../service.js';
import { registerSessionsRoutes } from '../hono/routes/sessions.js';
import { useTestDatabase } from '../../storage/sqlite/__tests__/test-database.js';

describe('sidebar layout route', () => {
  useTestDatabase();

  it('persists an authenticated session reorder and detects stale revisions', async () => {
    const sessions = [
      { key: 'a', status: 'active', projectId: undefined },
      { key: 'b', status: 'active', projectId: undefined },
    ];
    const service = {
      isGatewayReady: () => true,
      projects: {
        get: vi.fn(),
        listWithSidebarSessions: vi.fn(() => ({ items: [], total: 0, limit: 50, offset: 0, hasMore: false })),
      },
      sessions: {
        getSession: vi.fn(async (key: string) => sessions.find((session) => session.key === key) ?? null),
        listSessions: vi.fn(async () => ({ items: sessions, total: 2, limit: 5000, offset: 0, hasMore: false })),
      },
    } as unknown as GatewayService;
    const app = new Hono();
    registerSessionsRoutes(app, { service });

    const first = await app.request('/api/sidebar/layouts/inbox', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemIds: ['b', 'a'], expectedRevision: 0 }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      ok: true,
      layout: { containerId: 'inbox', itemIds: ['b', 'a'], revision: 1 },
    });

    const stale = await app.request('/api/sidebar/layouts/inbox', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemIds: ['a', 'b'], expectedRevision: 0 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ layout: { itemIds: ['b', 'a'], revision: 1 } });
  });
});
