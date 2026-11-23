import type { Hono } from 'hono';
import { z } from 'zod';

import { getPersonalOwnerId } from '../../security/gateway-principal.js';
import {
  CreateProactiveSubscriptionSchema,
  PatchProactiveSubscriptionSchema,
  ProactiveItemResolutionSchema,
  createProactiveSubscription,
  getProactiveHubMetrics,
  listBufferedDigestCandidates,
  listProactiveInboxItems,
  listProactiveSubscriptions,
  listPulseDigests,
  patchProactiveSubscription,
} from '../../../proactive-hub/index.js';
import {
  RsiArtifactKindSchema,
  listRsiCandidates,
} from '../../../rsi/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const InboxQuerySchema = z.object({
  includeActed: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const DigestFlushBodySchema = z.object({
  windowLabel: z.string().trim().min(1).max(80).optional(),
}).strict();

const RsiCandidatesQuerySchema = z.object({
  status: z.enum(['staged', 'inbox_pending', 'adopted', 'rejected', 'rolled_back']).optional(),
  artifactKind: RsiArtifactKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export function registerProactiveRsiRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/proactive/inbox', c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const parsed = InboxQuerySchema.safeParse({
      includeActed: c.req.query('includeActed'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid inbox query parameters' }, 400);
    return c.json({
      ok: true,
      payload: {
        items: listProactiveInboxItems(ownerId, parsed.data),
        metrics: getProactiveHubMetrics(ownerId),
      },
    });
  });

  authenticated.post('/api/proactive/inbox/:itemId/act', deps.strictRateLimitMiddleware, async c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = ProactiveItemResolutionSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid proactive item resolution' }, 400);
    try {
      const item = await deps.service.proactiveHubInstance.resolveItem(c.req.param('itemId'), input.data);
      // If approving an RSI skill/routine card directly from Inbox, adopt the referenced candidate too.
      if (
        input.data.action === 'approve'
        && item.proposedAction?.kind === 'adopt_rsi_candidate'
        && item.proposedAction.targetRef
      ) {
        await deps.service.rsiCapabilityInstance.adoptCandidate(ownerId, item.proposedAction.targetRef);
      }
      return c.json({ ok: true, payload: item });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to resolve item' }, 409);
    }
  });

  authenticated.get('/api/proactive/digests', c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    return c.json({
      ok: true,
      payload: {
        digests: listPulseDigests(ownerId),
        bufferedCount: listBufferedDigestCandidates(ownerId).length,
      },
    });
  });

  authenticated.post('/api/proactive/digests/flush', deps.strictRateLimitMiddleware, async c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const body = DigestFlushBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ ok: false, error: 'Invalid digest flush request' }, 400);
    const digest = deps.service.proactiveHubInstance.flushDigest(body.data.windowLabel);
    return c.json({ ok: true, payload: { digest } });
  });

  authenticated.get('/api/proactive/subscriptions', c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    return c.json({ ok: true, payload: listProactiveSubscriptions(ownerId) });
  });

  authenticated.post('/api/proactive/subscriptions', deps.strictRateLimitMiddleware, async c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = CreateProactiveSubscriptionSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid subscription definition' }, 400);
    const created = createProactiveSubscription(ownerId, input.data, 'user_explicit');
    return c.json({ ok: true, payload: created }, 201);
  });

  authenticated.patch('/api/proactive/subscriptions/:subscriptionId', deps.strictRateLimitMiddleware, async c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const input = PatchProactiveSubscriptionSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid subscription patch' }, 400);
    try {
      const updated = patchProactiveSubscription(ownerId, c.req.param('subscriptionId'), input.data);
      return c.json({ ok: true, payload: updated });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Subscription update conflict' }, 409);
    }
  });

  authenticated.get('/api/rsi/candidates', c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const parsed = RsiCandidatesQuerySchema.safeParse({
      status: c.req.query('status'),
      artifactKind: c.req.query('artifactKind'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid RSI candidate query' }, 400);
    return c.json({ ok: true, payload: listRsiCandidates(ownerId, parsed.data) });
  });

  authenticated.post('/api/rsi/candidates/:candidateId/adopt', deps.strictRateLimitMiddleware, async c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    try {
      const adopted = await deps.service.rsiCapabilityInstance.adoptCandidate(ownerId, c.req.param('candidateId'));
      return c.json({ ok: true, payload: adopted });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to adopt candidate' }, 409);
    }
  });

  authenticated.post('/api/rsi/candidates/:candidateId/reject', deps.strictRateLimitMiddleware, c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    try {
      const rejected = deps.service.rsiCapabilityInstance.rejectCandidate(ownerId, c.req.param('candidateId'));
      return c.json({ ok: true, payload: rejected });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to reject candidate' }, 409);
    }
  });

  authenticated.post('/api/rsi/candidates/:candidateId/rollback', deps.strictRateLimitMiddleware, async c => {
    const ownerId = getPersonalOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    try {
      const rolledBack = await deps.service.rsiCapabilityInstance.rollbackCandidate(ownerId, c.req.param('candidateId'));
      return c.json({ ok: true, payload: rolledBack });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to roll back candidate' }, 409);
    }
  });
}
