import { Hono } from 'hono';
import { z } from 'zod';

import { CredentialResolver } from '../../../auth/credentials.js';
import { TracingConfigSchema } from '../../../observability/config.js';
import { configureTracing, localStore, testLangfuse, tracingConfig, tracingStatus } from '../../../observability/runtime.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(/^\d{1,16}:[0-9a-f]{32}$/).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().positive().optional(),
  status: z.enum(['running', 'success', 'error', 'cancelled', 'suspended', 'interrupted']).optional(),
  conversationId: z.string().max(200).optional(), runId: z.string().max(200).optional(), agentId: z.string().max(200).optional(),
});

export function registerObservabilityRoutes(authenticated: Hono, { service, strictRateLimitMiddleware }: AuthenticatedRouteDeps): void {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'Invalid tracing request' }, 400);
    return c.json({ error: 'Tracing service unavailable' }, 503);
  });
  app.get('/tracing/settings', async c => {
    const resolver = new CredentialResolver();
    const secret = process.env.LANGFUSE_SECRET_KEY || await resolver.revealGatewayStoredApiKey('langfuse');
    const pub = process.env.LANGFUSE_PUBLIC_KEY || await resolver.revealGatewayStoredApiKey('langfuse-public');
    return c.json({ config: tracingConfig(), credentials: {
      publicKeyConfigured: Boolean(pub), secretKeyConfigured: Boolean(secret),
      publicKeySource: process.env.LANGFUSE_PUBLIC_KEY ? 'environment' : pub ? 'stored' : 'none',
      secretKeySource: process.env.LANGFUSE_SECRET_KEY ? 'environment' : secret ? 'stored' : 'none',
      baseUrlSource: process.env.LANGFUSE_BASE_URL ? 'environment' : 'config',
    } });
  });
  app.patch('/tracing/settings', strictRateLimitMiddleware, async c => {
    const parsed = TracingConfigSchema.parse(await c.req.json());
    if (parsed.capture === 'detailed') parsed.detailedUntil = Date.now() + 30 * 60 * 1000;
    else delete parsed.detailedUntil;
    const next = { ...service.currentConfig, observability: { tracing: parsed } };
    const result = await service.saveConfig(next);
    if (!result.saved) return c.json({ error: 'Could not save tracing configuration' }, 500);
    await configureTracing(parsed);
    return c.json({ ok: true, config: parsed });
  });
  app.put('/tracing/langfuse/credentials', strictRateLimitMiddleware, async c => {
    const body = z.object({ publicKey: z.string().trim().min(1).max(512).optional(), secretKey: z.string().trim().min(1).max(512).optional() }).strict().parse(await c.req.json());
    const resolver = new CredentialResolver();
    if (body.publicKey) await resolver.saveApiKey('langfuse-public', body.publicKey, { profileName: 'default' });
    if (body.secretKey) await resolver.saveApiKey('langfuse', body.secretKey, { profileName: 'default' });
    await configureTracing(service.currentConfig.observability?.tracing);
    return c.json({ ok: true });
  });
  app.delete('/tracing/langfuse/credentials', strictRateLimitMiddleware, async c => {
    const resolver = new CredentialResolver();
    await resolver.deleteProviderCredential('langfuse'); await resolver.deleteProviderCredential('langfuse-public');
    await configureTracing(service.currentConfig.observability?.tracing);
    return c.json({ ok: true });
  });
  app.post('/tracing/langfuse/test', strictRateLimitMiddleware, async c => c.json({ ok: await testLangfuse() }));
  app.get('/tracing/status', async c => c.json(await tracingStatus()));
  app.get('/traces', async c => c.json(await localStore().request('list', querySchema.parse(c.req.query()))));
  app.post('/traces/prune', strictRateLimitMiddleware, async c => { await localStore().request('prune'); return c.json({ ok: true }); });
  app.delete('/traces', strictRateLimitMiddleware, async c => { await localStore().clear(); return c.json({ ok: true }); });
  app.get('/traces/:traceId/export', async c => {
    const id = traceIdSchema.parse(c.req.param('traceId'));
    const data = await localStore().request('detail', id);
    if (!data) return c.json({ error: 'Trace not found' }, 404);
    c.header('Content-Disposition', `attachment; filename="trace-${id}.json"`);
    return c.json(data);
  });
  app.get('/traces/:traceId', async c => {
    const data = await localStore().request('detail', traceIdSchema.parse(c.req.param('traceId')));
    return data ? c.json(data) : c.json({ error: 'Trace not found' }, 404);
  });
  authenticated.route('/api/observability', app);
}
