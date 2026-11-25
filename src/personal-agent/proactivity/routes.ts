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
  listAttention,
  listInterestCandidates,
  patchAttention,
  patchProactivitySettings,
  provenanceDetail,
  recordFeedback,
  rollbackStrategy,
  strategyState,
} from './repository.js';
import { getProactiveHubMetrics } from '../../proactive-hub/repository.js';
import {
  deleteMatter,
  getMatter,
  listMatters,
  patchMatter,
} from '../../proactive-hub/matters.js';

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

  app.get('/api/personal-agent/following', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const personal = getPersonalAgent(ownerId);
    const readable = canReadTasks(c);
    const threads = personal ? listAttention(personal.conversationId) : [];
    const oneShot = threads
      .filter(thread => thread.follow_up_mode === 'one_shot' && thread.status === 'active')
      .map(thread => getOneShotFollowUpDto(thread.id, ownerId, { canReadTask: () => readable }))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const recurring = threads
      .filter(thread => thread.follow_up_mode === 'recurring' && thread.kind !== 'interest' && (thread.status === 'active' || thread.status === 'paused'))
      .map(thread => ({
        id: thread.id,
        subject: readable ? thread.subject : '',
        summary: readable ? thread.summary : '',
        status: thread.status as 'active' | 'paused',
        authority: thread.authority,
        taskId: thread.task_id,
        projectId: thread.project_id,
        nextCheckAt: thread.next_check_at,
        lastCheckedAt: thread.last_checked_at,
        lastMeaningfulAt: thread.last_meaningful_at,
        expiresAt: thread.expires_at,
        revision: thread.revision,
        strategy: strategyState(thread.id),
      }));
    const matters = listMatters(ownerId, { includeClosed: false });
    const hubMetrics = getProactiveHubMetrics(ownerId);
    const waitingMatterCount = matters.filter(m => m.status === 'waiting_user').length;
    const activeCount = matters.filter(m => m.status === 'active' || m.status === 'waiting_user').length
      + oneShot.length
      + recurring.filter(item => item.status === 'active').length;
    return c.json({
      ok: true,
      payload: {
        matters,
        oneShot,
        recurring,
        waitingMatterCount,
        inboxPendingCount: hubMetrics.inboxPendingCount,
        digestBufferedCount: hubMetrics.digestBufferedCount,
        activeCount,
      },
    });
  });

  app.get('/api/personal-agent/matters/:matterId', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const matter = getMatter(ownerId, c.req.param('matterId'));
    return matter ? c.json({ ok: true, payload: matter }) : c.json({ ok: false, error: 'Follow-up matter not found' }, 404);
  });

  app.patch('/api/personal-agent/matters/:matterId', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const body = z.object({
      expectedRevision: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(140).optional(),
      goal: z.string().trim().min(1).max(800).optional(),
      notifyWhen: z.string().trim().min(1).max(400).optional(),
      doneCriteria: z.string().trim().max(400).optional(),
      status: z.enum(['active', 'paused', 'resolved']).optional(),
      deliveryPreference: z.enum(['auto', 'chat', 'inbox']).optional(),
      deadlineAt: z.number().int().positive().nullable().optional(),
      checkIntervalMs: z.number().int().min(15 * 60_000).max(7 * 86_400_000).optional(),
      userNote: z.string().trim().min(1).max(600).optional(),
      addUrls: z.array(z.string().max(2000)).max(4).optional(),
      addSearchQueries: z.array(z.string().max(200)).max(3).optional(),
    }).strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ok: false, error: 'Invalid follow-up matter update' }, 400);
    try {
      const { matter } = patchMatter(ownerId, c.req.param('matterId'), {
        ...body.data,
        blocklist: deps.service.currentConfig.tools?.web?.blocklist,
      });
      deps.service.emit?.('personal.follow_up.updated', { matterId: matter.id, status: matter.status });
      return c.json({ ok: true, payload: matter });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Follow-up matter update failed' }, 409);
    }
  });

  app.post('/api/personal-agent/matters/:matterId/check', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const matterId = c.req.param('matterId');
    const investigator = deps.service.matterInvestigatorInstance;
    if (!investigator) return c.json({ ok: false, error: 'Matter investigator is unavailable' }, 503);
    try {
      const updated = await investigator.checkNow(matterId, ownerId);
      return c.json({ ok: true, payload: updated });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Matter check failed' }, 409);
    }
  });

  app.delete('/api/personal-agent/matters/:matterId', deps.strictRateLimitMiddleware, c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const matterId = c.req.param('matterId');
    const deleted = deleteMatter(ownerId, matterId);
    if (!deleted) return c.json({ ok: false, error: 'Follow-up matter not found' }, 404);
    deps.service.emit?.('personal.follow_up.updated', { matterId, deleted: true });
    return c.json({ ok: true });
  });

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
