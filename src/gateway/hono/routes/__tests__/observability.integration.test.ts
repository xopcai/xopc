import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';
import { closeTracing, configureTracing, localStore, traceRun } from '../../../../observability/runtime.js';
import { defaultTracingConfig } from '../../../../observability/config.js';

let directory: string; let server: ReturnType<typeof serve>; let base: string;
const previous = process.env.XOPC_STATE_DIR;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'xopc-trace-http-')); process.env.XOPC_STATE_DIR = directory; await configureTracing(defaultTracingConfig());
  const app = new Hono(); app.use('/api/*', auth({ getResolvedAuth: () => ({ mode: 'token', token: 'trace-test-credential', allowTailscale: false }) }));
  registerAuthenticatedLazyRouteFallback(app, { service: {}, strictRateLimitMiddleware: async (_c, next) => next() } as never);
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>(resolve => { if (server.listening) resolve(); else server.once('listening', resolve); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await closeTracing(); await new Promise<void>(resolve => server.close(() => resolve())); resetLazyRouteBundlesForTests(); await rm(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.XOPC_STATE_DIR; else process.env.XOPC_STATE_DIR = previous; });
it('serves authenticated trace list/detail/export/clear through the real lazy HTTP path', async () => {
  const headers = { Authorization: 'Bearer trace-test-credential' };
  expect((await fetch(`${base}/api/observability/traces`)).status).toBe(401);
  await traceRun('agent.run', { conversationId: 'conversation', runId: 'http-test' }, async () => ({ ok: true })); await localStore().flush();
  const listResponse = await fetch(`${base}/api/observability/traces`, { headers }); expect(listResponse.status).toBe(200);
  const list = await listResponse.json() as any; expect(list.traces).toHaveLength(1);
  const id = list.traces[0].traceId;
  const detail = await fetch(`${base}/api/observability/traces/${id}`, { headers }); expect(detail.status).toBe(200); expect((await detail.json() as any).spans).toHaveLength(1);
  const exportResponse = await fetch(`${base}/api/observability/traces/${id}/export`, { headers }); expect(exportResponse.status).toBe(200); expect(exportResponse.headers.get('content-disposition')).toContain(id);
  expect((await fetch(`${base}/api/observability/traces/not-a-trace`, { headers })).status).toBe(400);
  expect((await fetch(`${base}/api/observability/traces?limit=10000`, { headers })).status).toBe(400);
  expect((await fetch(`${base}/api/observability/tracing/status`, { headers })).status).toBe(200);
  expect((await fetch(`${base}/api/observability/traces`, { headers, method: 'DELETE' })).status).toBe(200);
  expect((await (await fetch(`${base}/api/observability/traces`, { headers })).json() as any).traces).toHaveLength(0);
});
