import type { Hono } from 'hono';

import { resolveEffectiveAgentProfileForSession } from '../../../config/agent-profile.js';
import { getSessionConfig } from '../../../storage/sqlite/config-repository.js';
import { getKnowledgeItem, canUseKnowledge } from '../../../knowledge-memory/index.js';
import { knowledgeExclusion } from '../../../knowledge-memory/usage-policy.js';
import { enqueueConversationLearning, learningStatus } from '../../../memory-learning/repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { bindOwnerIdentity } from '../../../user-context/identity-bindings.js';
import { resolveKnowledgeReadPolicy } from '../../../user-context/config.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerMemoryLearningRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/memory-learning/status', c => c.json(learningStatus(deps.service.currentConfig)));
  app.get('/api/memory-learning/jobs/:id', c => {
    const job = getSqliteDatabase().prepare(`SELECT job_id AS id, state, attempts, error_code AS errorCode,
      created_at AS createdAt, updated_at AS updatedAt FROM memory_learning_jobs WHERE job_id = ? AND principal_id = 'local-owner'`)
      .get(c.req.param('id'));
    return job ? c.json({ job }) : c.json({ error: 'Learning job not found' }, 404);
  });
  app.post('/api/memory-learning/rebuild', deps.strictRateLimitMiddleware, async c => {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input.conversationId !== 'string') return c.json({ error: 'conversationId is required' }, 400);
    const session = getSessionMetadata(input.conversationId);
    if (!session) return c.json({ error: 'Conversation not found' }, 404);
    const jobId = enqueueConversationLearning(deps.service.currentConfig, input.conversationId,
      getSessionConfig(input.conversationId)?.workingDirectoryOverride
        ?? resolveEffectiveAgentProfileForSession(input.conversationId).resolvedWorkspacePath, true);
    return jobId ? c.json({ jobId }, 202) : c.json({ queued: false, reason: 'not_eligible_or_already_queued' });
  });
  app.post('/api/memory-learning/owner-identities', deps.strictRateLimitMiddleware, async c => {
    const input = await c.req.json().catch(() => null);
    if (!input || !['channel', 'accountId', 'peerId'].every(key => typeof input[key] === 'string' && input[key].trim())) {
      return c.json({ error: 'channel, accountId and peerId are required' }, 400);
    }
    bindOwnerIdentity(input);
    return c.json({ ok: true });
  });
  app.get('/api/memory-learning/owner-identities', c => c.json({ identities: getSqliteDatabase().prepare(`
    SELECT channel, account_id AS accountId, peer_id AS peerId, verified_at AS verifiedAt
    FROM owner_identity_bindings WHERE principal_id = 'local-owner' AND revoked_at IS NULL ORDER BY verified_at DESC`).all() }));
  app.delete('/api/memory-learning/owner-identities', deps.strictRateLimitMiddleware, async c => {
    const input = await c.req.json().catch(() => null);
    if (!input || !['channel', 'accountId', 'peerId'].every(key => typeof input[key] === 'string')) return c.json({ error: 'Identity fields are required' }, 400);
    getSqliteDatabase().prepare('UPDATE owner_identity_bindings SET revoked_at = ? WHERE channel = ? AND account_id = ? AND peer_id = ?')
      .run(Date.now(), input.channel, input.accountId, input.peerId);
    return c.json({ ok: true });
  });
  app.get('/api/knowledge-memory/:id/evidence', c => {
    const item = getKnowledgeItem(c.req.param('id'));
    const context = { agentId: c.req.query('agentId') ?? item?.sourceAgentId ?? 'main',
      workspaceId: c.req.query('workspaceId') ?? (item?.scope.type === 'workspace' ? item.scope.id! : ''),
      conversationId: c.req.query('conversationId') ?? item?.sourceConversationId ?? '',
      projectId: c.req.query('projectId') ?? (item?.scope.type === 'project' ? item.scope.id : undefined) };
    if (!item || !canUseKnowledge(item, context, resolveKnowledgeReadPolicy(deps.service.currentConfig.userContext.knowledgeMemory))) {
      return c.json({ error: 'Knowledge evidence not available', reason: item
        ? knowledgeExclusion(item, context, resolveKnowledgeReadPolicy(deps.service.currentConfig.userContext.knowledgeMemory))
        : 'not_found' }, 404);
    }
    const evidence = getSqliteDatabase().prepare(`SELECT e.source_type AS sourceType, e.source_ref AS sourceRef,
      e.observed_at AS observedAt, e.redacted_excerpt AS excerpt FROM knowledge_evidence_links l
      JOIN context_evidence e ON e.evidence_id = l.evidence_id WHERE l.knowledge_id = ?`).all(item.id);
    return c.json({ evidence });
  });
}
