import type { Context, Hono } from 'hono';
import {
  PersonalFeedbackSchema,
  PersonalProactivitySettingsSchema,
  PersonalStrategyRollbackSchema,
  StopPersonalOneShotFollowUpRequestSchema,
} from '@xopcai/gateway-contract';
import { z } from 'zod';

import type { AuthenticatedRouteDeps } from '../../gateway/hono/routes/deps.js';
import { getGatewayPrincipal } from '../../gateway/security/gateway-principal.js';
import { hasGatewayScope } from '../../gateway/security/gateway-scopes.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { getPersonalAgent } from '../repository.js';
import {
  getOneShotFollowUpDto,
  OneShotFollowUpConflictError,
  stopOneShotFollowUp,
} from './one-shot-follow-up.js';
import {
  getAttention,
  getProactivitySettings,
  listInterestCandidates,
  patchAttention,
  patchProactivitySettings,
  provenanceDetail,
  recordFeedback,
  rollbackStrategy,
  strategyState,
} from './repository.js';

const AttentionPatch = z.object({ revision: z.number().int().positive(), status: z.enum(['active', 'paused', 'completed']).optional(),
  nextCheckAt: z.number().int().positive().optional() }).strict();
const SettingsPatch = z.object({ revision: z.number().int().positive(),
  mode: z.enum(['off', 'follow_up', 'balanced']).optional(), timezone: z.string().max(100).optional(),
  quietStart: z.number().int().min(0).max(23).optional(), quietEnd: z.number().int().min(0).max(23).optional(),
  dailyMessages: z.number().int().min(0).max(10).optional(), dailyModelCalls: z.number().int().min(0).max(100).optional(),
}).strict();

export function registerProactivityRoutes(app: Hono, deps: AuthenticatedRouteDeps,
  owner: (context: Context) => string | null): void {
  const canReadTasks = (c: Context): boolean => {
    const principal = getGatewayPrincipal(c);
    const personal = owner(c) ? getPersonalAgent(owner(c)!) : null;
    const contextAccess = personal
      ? resolveUserContextSessionAccess(deps.service.currentConfig, personal.conversationId).userModel
      : false;
    return contextAccess && hasGatewayScope(principal.scopes, 'tasks.read');
  };

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
  app.get('/api/personal-agent/attention/:threadId', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const threadId = c.req.param('threadId');
    const readable = canReadTasks(c);
    const oneShot = getOneShotFollowUpDto(threadId, ownerId, { canReadTask: () => readable });
    if (oneShot) {
      return c.json({ ok: true, payload: oneShot });
    }
    const thread = getAttention(threadId, ownerId);
    if (!thread) return c.json({ ok: false, error: 'Follow-up not found' }, 404);
    return c.json({
      ok: true,
      payload: {
        id: thread.id,
        followUpMode: thread.follow_up_mode,
        subject: readable ? thread.subject : '',
        status: thread.status,
        revision: thread.revision,
        nextCheckAt: thread.next_check_at,
        strategy: strategyState(thread.id),
      },
    });
  });
  app.post('/api/personal-agent/attention/:threadId/stop', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = StopPersonalOneShotFollowUpRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid stop request' }, 400);
    const threadId = c.req.param('threadId');
    const readable = canReadTasks(c);
    try {
      const result = stopOneShotFollowUp({
        ownerId,
        followUpId: threadId,
        expectedRevision: input.data.expectedRevision,
        idempotencyKey: input.data.idempotencyKey,
        canReadTask: () => readable,
      });
      deps.service.emit?.('personal.follow_up.updated', {
        followUpId: result.followUp.followUpId,
        taskId: result.followUp.taskId,
        conversationId: result.followUp.conversationId,
        terminalReason: result.followUp.terminalReason,
      });
      deps.service.emit?.('task.changed', { taskId: result.followUp.taskId });
      return c.json({ ok: true, payload: result });
    } catch (error) {
      if (error instanceof OneShotFollowUpConflictError) {
        if (!error.followUp && error.message === 'Follow-up is unavailable') {
          return c.json({ ok: false, error: error.message }, 404);
        }
        return c.json({
          ok: false,
          error: error.message,
          ...(error.followUp ? { payload: error.followUp } : {}),
        }, 409);
      }
      throw error;
    }
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
