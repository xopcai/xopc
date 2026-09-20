import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { upsertUnderstandingSourceGrant } from '../../../../user-context/sources/repository.js';
import { auth } from '../../middleware/auth.js';
import { getLoadedLazyRouteBundleIdsForTests, registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';

describe('understanding refresh through authenticated Gateway HTTP', () => {
  let server: ReturnType<typeof serve>; let origin: string; let grantId: string;
  beforeEach(async () => {
    resetXopcDatabaseSingletonForTest(); resetLazyRouteBundlesForTests();
    openXopcDatabase({ path: ':memory:' });
    grantId = upsertUnderstandingSourceGrant({ sourceKey: 'apple-notes', adapterId: 'apple-notes',
      category: 'notes', platform: 'darwin', displayName: 'Notes', accessMode: 'once', retentionPolicy: 'derived_only',
      processingPolicy: 'remote_allowed', config: {} }).id;
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'refresh-test', allowTailscale: false }) }));
    registerAuthenticatedLazyRouteFallback(app, { service: { currentConfig: ConfigSchema.parse({}), emit: vi.fn() },
      strictRateLimitMiddleware: async (_c, next) => next() } as never);
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    resetLazyRouteBundlesForTests(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  });
  const request = (path: string, body?: unknown) => fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer refresh-test', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it('starts, deduplicates, collects and reads a durable batch using the correct lazy bundle', async () => {
    expect((await fetch(`${origin}/api/user-model/refresh`, { method: 'POST', body: '{}' })).status).toBe(401);
    const response = await request('/api/user-model/refresh', { sourceIds: [grantId] });
    expect(response.status).toBe(202);
    const first = (await response.json()).batch;
    const second = (await (await request('/api/user-model/refresh', { sourceIds: [grantId] })).json()).batch;
    expect(second.sources[0].id).toBe(first.sources[0].id);
    expect((await request(`/api/user-model/refresh/sources/${first.sources[0].id}/collection`, { items: [] })).status).toBe(202);
    const completed = (await (await request(`/api/user-model/refresh/${first.id}`)).json()).batch;
    expect(completed.status).toBe('completed');
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('user-model-refresh');
    expect((await request('/api/user-model/refresh-other')).status).toBe(404);
    expect((await request('/api/user-model/refresh', { sourceIds: ['unknown'] })).status).toBe(400);
  });
});
