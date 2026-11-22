import type { Hono } from 'hono';
import { z } from 'zod';

import {
  isManagedSetupScene,
  type SelfConfigDomain,
} from '../../../self-config/index.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-read-repository.js';
import { getPersonalOwnerId } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const DOMAIN_VALUES = new Set<SelfConfigDomain>([
  'all',
  'models',
  'voice',
  'web_search',
  'channels',
  'browser',
  'phone',
  'computer',
  'profile',
  'appearance',
  'compaction',
]);

const SetupRequestSchema = z.strictObject({
  conversationId: z.string().min(1).max(200),
  setupId: z.string().min(1).max(200).optional(),
  action: z.enum(['inspect', 'start', 'get', 'recheck', 'submit_secret', 'verify', 'cancel']),
  payload: z.record(z.string(), z.unknown()).optional(),
  resumeObjective: z.string().max(400).optional(),
});

export function registerSelfConfigRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/self-config/inspect', async (c) => {
    const domainParam = (c.req.query('domain') ?? 'all').trim() as SelfConfigDomain;
    if (!DOMAIN_VALUES.has(domainParam)) {
      return c.json({ ok: false, error: `Unsupported domain: ${domainParam}` }, 400);
    }
    const ownerId = getPersonalOwnerId(c) ?? 'local-owner';
    try {
      const result = await service.selfConfig.inspect(domainParam, ownerId);
      return c.json({ ok: true, payload: result });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.get('/api/self-config/changes', async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? 20);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20;
    return c.json({ ok: true, payload: { items: service.selfConfig.listChanges(limit) } });
  });

  authenticated.post('/api/self-config/changes/:changeId/rollback', strictRateLimitMiddleware, async (c) => {
    const changeId = c.req.param('changeId');
    const result = await service.selfConfig.rollback(changeId);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, result.error?.includes('not found') ? 404 : 409);
    }
    return c.json({ ok: true, payload: { receipt: result.receipt } });
  });

  authenticated.post('/api/setup/:scene', strictRateLimitMiddleware, async (c) => {
    const scene = c.req.param('scene');
    if (!isManagedSetupScene(scene)) {
      return c.json({ ok: false, error: `Unsupported setup scene: ${scene}` }, 404);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = SetupRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid setup request' }, 400);
    }
    const body = parsed.data;
    const metadata = getSessionMetadata(body.conversationId);
    const agentId = metadata?.agentId ?? 'main';

    try {
      if (body.action === 'submit_secret') {
        if (!body.setupId) {
          return c.json({ ok: false, error: 'setupId is required' }, 400);
        }
        const updated = await service.setupScenes.submitSecureInput(
          scene,
          body.setupId,
          body.conversationId,
          body.payload ?? {},
        );
        return c.json({ ok: true, payload: updated });
      }
      const res = await service.setupScenes.command(
        scene,
        body.action,
        {
          ...(body.setupId ? { setupId: body.setupId } : {}),
          ...(body.resumeObjective ? { resumeObjective: body.resumeObjective } : {}),
        },
        { conversationId: body.conversationId, agentId, canConfigure: true },
      );
      return c.json({ ok: true, payload: res.setup ?? res });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'SETUP_NOT_FOUND' ? 404 : 409;
      return c.json({ ok: false, error: message }, status);
    }
  });
}
