import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { writeKnowledgeItem } from '../../../../knowledge-memory/index.js';
import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests, getLoadedLazyRouteBundleIdsForTests } from '../lazy-fallback.js';

describe('memory management through authenticated Gateway HTTP', () => {
  let server: ReturnType<typeof serve>;
  let origin: string;
  beforeEach(async () => {
    resetXopcDatabaseSingletonForTest();
    resetLazyRouteBundlesForTests();
    openXopcDatabase({ path: ':memory:' });
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'memory-test-token', allowTailscale: false }) }));
    registerAuthenticatedLazyRouteFallback(app, {
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    resetLazyRouteBundlesForTests();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${origin}${path}`, {
    method, headers: { authorization: 'Bearer memory-test-token', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  it('edits and deletes both memory domains through the lazy bundle', async () => {
    const response = await request('/api/user-model/assertions', 'POST', {
      scope: { type: 'global' }, predicate: 'preference.detail', statement: 'Concise answers', value: 'concise',
    });
    expect(response.status).toBe(201);
    const { assertion } = await response.json();
    const path = `/api/user-model/assertions/${assertion.id}`;
    expect((await fetch(`${origin}${path}`, { method: 'DELETE' })).status).toBe(401);
    const changed = await request(path, 'PATCH', { statement: 'Detailed answers' });
    expect(changed.status).toBe(200);
    const corrected = (await changed.json()).assertion;
    expect((await request(`/api/user-model/assertions/${corrected.id}`, 'DELETE')).status).toBe(200);
    expect((await request(path)).status).toBe(404);

    const knowledge = writeKnowledgeItem({ kind: 'project_fact', scope: { type: 'project', id: 'one' },
      content: 'Atlas uses pnpm', canonicalKey: 'atlas', confidence: 0.8, importance: 0.7, originClass: 'agent' }).item;
    const knowledgePath = `/api/knowledge-memory/${knowledge.id}`;
    expect((await request(`${knowledgePath}/review`, 'POST', { action: 'edit_and_approve', content: 'Atlas uses bun', expectedStatus: 'active' })).status).toBe(200);
    expect((await request(knowledgePath, 'DELETE')).status).toBe(200);
    expect((await request(knowledgePath)).status).toBe(404);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('user-model');
    expect((await request('/api/user-model-other')).status).toBe(404);
    expect((await request('/api/knowledge-memory-other')).status).toBe(404);
  });
});
