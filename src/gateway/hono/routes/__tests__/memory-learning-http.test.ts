import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../../../storage/sqlite/transcript-repository.js';
import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests, getLoadedLazyRouteBundleIdsForTests } from '../lazy-fallback.js';

const id = '4dffa204-0300-4d2d-89ce-55305490c550';
describe('memory learning through authenticated Gateway and lazy dispatch', () => {
  let server: ReturnType<typeof serve>;
  let origin: string;
  beforeEach(async () => {
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); resetLazyRouteBundlesForTests();
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat', sourceChatId: 'owner', sessionType: 'chat',
      routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    appendTranscriptEntry(id, { role: 'user', content: 'Use SQLite.', timestamp: Date.now() });
    appendTranscriptEntry(id, { role: 'assistant', content: 'Done.', timestamp: Date.now() } as never);
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'memory-test-token', allowTailscale: false }) }));
    registerAuthenticatedLazyRouteFallback(app, { service: { currentConfig: ConfigSchema.parse({}) },
      strictRateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => next() } as never);
    await new Promise<void>(resolve => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    resetLazyRouteBundlesForTests(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  });
  const request = (path: string, method = 'GET', body?: unknown, authorized = true) => fetch(origin + path, {
    method, headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer memory-test-token' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  it('authenticates diagnostics, queues rebuilds and maps evidence paths', async () => {
    expect((await request('/api/memory-learning/status', 'GET', undefined, false)).status).toBe(401);
    expect((await request('/api/memory-learning/status')).status).toBe(200);
    const rebuilt = await request('/api/memory-learning/rebuild', 'POST', { conversationId: id });
    expect(rebuilt.status).toBe(202);
    const { jobId } = await rebuilt.json();
    expect((await request(`/api/memory-learning/jobs/${jobId}`)).status).toBe(200);
    expect((await request('/api/knowledge-memory/missing/evidence')).status).toBe(404);
    expect((await request('/api/memory-learning-other')).status).toBe(404);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('user-model');
  });
  it('binds and revokes owner identities only through the authenticated write path', async () => {
    const identity = { channel: 'telegram', accountId: 'default', peerId: 'owner' };
    expect((await request('/api/memory-learning/owner-identities', 'POST', identity, false)).status).toBe(401);
    expect((await request('/api/memory-learning/owner-identities', 'POST', identity)).status).toBe(200);
    expect((await request('/api/memory-learning/owner-identities', 'DELETE', identity)).status).toBe(200);
  });
});
