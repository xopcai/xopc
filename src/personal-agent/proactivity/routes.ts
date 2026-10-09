import type { Context, Hono } from 'hono';
import { PersonalFeedbackSchema, PersonalProactivitySettingsSchema, PersonalStrategyRollbackSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import type { AuthenticatedRouteDeps } from '../../gateway/hono/routes/deps.js';
import { getPersonalAgent } from '../repository.js';
import { getProactivitySettings, listInterestCandidates, patchAttention, patchProactivitySettings, provenanceDetail, recordFeedback, rollbackStrategy, strategyState } from './repository.js';

const AttentionPatch = z.object({ revision: z.number().int().positive(), status: z.enum(['active', 'paused', 'completed']).optional(),
  nextCheckAt: z.number().int().positive().optional() }).strict();
const SettingsPatch = z.object({ revision: z.number().int().positive(),
  mode: z.enum(['off', 'follow_up', 'balanced']).optional(), timezone: z.string().max(100).optional(),
  quietStart: z.number().int().min(0).max(23).optional(), quietEnd: z.number().int().min(0).max(23).optional(),
  dailyMessages: z.number().int().min(0).max(10).optional(), dailyModelCalls: z.number().int().min(0).max(100).optional(),
}).strict();

export function registerProactivityRoutes(app: Hono, deps: AuthenticatedRouteDeps,
  owner: (context: Context) => string | null): void {
  app.get('/api/personal-agent/proactivity', c => {
    const ownerId = owner(c);
    return ownerId ? c.json({ ok: true, payload: getProactivitySettings(ownerId) })
      : c.json({ ok: false, error: 'Owner access is required' }, 403);
  });
  app.get('/api/personal-agent/interests', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const personal = getPersonalAgent(ownerId);
    if (!personal || !resolveUserContextSessionAccess(deps.service.currentConfig, personal.conversationId).userModel) {
      return c.json({ ok: false, error: 'Interest access is unavailable' }, 403);
    }
    return c.json({ ok: true, payload: listInterestCandidates(personal.conversationId) });
  });
  app.post('/api/personal-agent/attention/:threadId/strategy/rollback', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = PersonalStrategyRollbackSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid strategy rollback' }, 400);
    try {
      const thread = rollbackStrategy(ownerId, c.req.param('threadId'), input.data);
      return c.json({ ok: true, payload: { thread, strategy: strategyState(thread.id) } });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : 'Strategy changed' }, 409); }
  });
  app.patch('/api/personal-agent/proactivity', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = SettingsPatch.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid proactivity settings' }, 400);
    const merged = PersonalProactivitySettingsSchema.safeParse({ ...getProactivitySettings(ownerId), ...input.data });
    if (!merged.success) return c.json({ ok: false, error: 'Invalid proactivity settings' }, 400);
    try { return c.json({ ok: true, payload: patchProactivitySettings(ownerId, merged.data) }); }
    catch { return c.json({ ok: false, error: 'Settings changed; reload before saving' }, 409); }
  });
  app.get('/api/personal-agent/outreach/:outreachId/provenance', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const personal = getPersonalAgent(ownerId);
    if (!personal || !resolveUserContextSessionAccess(deps.service.currentConfig, personal.conversationId).userModel) {
      return c.json({ ok: false, error: 'Source access is unavailable' }, 403);
    }
    const detail = provenanceDetail(ownerId, c.req.param('outreachId'));
    return detail ? c.json({ ok: true, payload: detail }) : c.json({ ok: false, error: 'Message is unavailable' }, 404);
  });
  app.post('/api/personal-agent/outreach/:outreachId/feedback', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = PersonalFeedbackSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid feedback' }, 400);
    try { recordFeedback(ownerId, c.req.param('outreachId'), input.data); return c.json({ ok: true }); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : 'Feedback failed' }, 409); }
  });
  app.patch('/api/personal-agent/attention/:threadId', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = AttentionPatch.safeParse(await c.req.json().catch(() => null));
    if (!input.success || input.data.nextCheckAt && (input.data.nextCheckAt <= Date.now() || input.data.nextCheckAt > Date.now() + 30 * 86_400_000)) {
      return c.json({ ok: false, error: 'Invalid attention update' }, 400);
    }
    try { return c.json({ ok: true, payload: patchAttention(ownerId, c.req.param('threadId'), input.data.revision, input.data) }); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : 'Attention changed' }, 409); }
  });
}
