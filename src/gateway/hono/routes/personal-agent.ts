import type { Hono } from 'hono';
import { z } from 'zod';

import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getPersonalAgent } from '../../../personal-agent/repository.js';
import { TaskOriginRepository } from '../../../tasks/task-origin-repository.js';
import {
  createOrResumePersonalAgent, ensurePersonalConversationVisibility, listPersonalModels, patchPersonalProfile, refreshPersonalDelegationGuidance,
  PersonalAppearanceSchema, PersonalPreferencesSchema,
} from '../../../personal-agent/service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const CreateSchema = z.object({ model: z.string().trim().min(3).optional() }).strict();
const ProfileSchema = z.object({
  revision: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(60),
  appearance: PersonalAppearanceSchema,
  preferences: PersonalPreferencesSchema,
}).strict();
const ActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerPersonalAgentRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const owner = (c: Parameters<typeof getGatewayPrincipal>[0]) => {
    const principal = getGatewayPrincipal(c);
    // Browser sessions and bearer tokens have different principal IDs for the same local owner.
    return principal.kind === 'owner' ? 'local-owner' : null;
  };

  authenticated.get('/api/personal-agent', async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    await refreshPersonalDelegationGuidance(deps.service, ownerId);
    ensurePersonalConversationVisibility(ownerId);
    return c.json({ ok: true, payload: getPersonalAgent(ownerId) });
  });

  authenticated.get('/api/personal-agent/models', async c => {
    if (!owner(c)) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    return c.json({ ok: true, payload: await listPersonalModels() });
  });

  authenticated.get('/api/personal-agent/activity', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const query = ActivityQuerySchema.safeParse({ limit: c.req.query('limit'), offset: c.req.query('offset') });
    if (!query.success) return c.json({ ok: false, error: 'Invalid activity pagination' }, 400);
    const record = getPersonalAgent(ownerId);
    if (!record || record.state !== 'ready') return c.json({ ok: true, payload: { items: [], total: 0 } });
    return c.json({ ok: true, payload: new TaskOriginRepository().list(record.conversationId, query.data.limit,
      { offset: query.data.offset, order: 'recent' }) });
  });

  authenticated.post('/api/personal-agent', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const parsed = CreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid create request' }, 400);
    try {
      const record = await createOrResumePersonalAgent(deps.service, ownerId, parsed.data.model);
      return c.json({ ok: true, payload: record });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.patch('/api/personal-agent/profile', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const parsed = ProfileSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid profile' }, 400);
    const { revision, displayName, appearance, preferences } = parsed.data;
    const updated = await patchPersonalProfile(deps.service, ownerId, revision, displayName, preferences, appearance);
    return updated
      ? c.json({ ok: true, payload: updated })
      : c.json({ ok: false, error: 'Profile changed or personal Agent is unavailable' }, 409);
  });
}
