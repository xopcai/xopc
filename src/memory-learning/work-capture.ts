import { createHash } from 'node:crypto';
import { z } from 'zod';

import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import { writeKnowledgeItem, listKnowledgeItems } from '../knowledge-memory/index.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import type { CaptureEvidence } from '../user-model/capture/semantic.js';

export const WorkCandidateSchema = z.object({
  kind: z.enum(['work_thread', 'project_fact', 'workspace_fact', 'decision', 'task_lesson', 'commitment', 'open_question', 'episode', 'note']),
  topicKey: z.string().min(1).max(160), predicate: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
  statement: z.string().min(4).max(1200),
  scope: z.enum(['project', 'workspace', 'session']),
  confidence: z.number().min(0).max(1), importance: z.number().min(0).max(1),
  evidence: z.array(z.object({ ref: z.string(), quote: z.string().min(1) }).strict()).min(1).max(8),
}).strict();
export type WorkCandidate = z.infer<typeof WorkCandidateSchema>;

export function applyWorkCandidates(input: {
  candidates: WorkCandidate[]; evidence: CaptureEvidence[]; conversationId: string; agentId: string;
  workspaceId: string; projectId?: string; processingPolicy: 'local_only' | 'remote_allowed'; runId: string;
  source?: { instanceId: string; itemId: string; contentHash: string; consentReceiptId: string };
}): Array<{ candidateKey: string; objectType?: 'knowledge'; objectId?: string; outcome: 'created' | 'deduplicated' | 'rejected' }> {
  return input.candidates.map(candidate => {
    const canonicalKey = `work:${candidate.topicKey.normalize('NFKC').toLowerCase()}:${candidate.predicate}`;
    const sensitivity = inferMemorySensitivity(candidate.statement);
    if (sensitivity === 'secret' || sensitivity === 'regulated') return { candidateKey: canonicalKey, outcome: 'rejected' };
    if (candidate.evidence.some(claim => ['secret', 'regulated'].includes(inferMemorySensitivity(claim.quote)))) {
      return { candidateKey: canonicalKey, outcome: 'rejected' };
    }
    const sources = candidate.evidence.map(claim => input.evidence.find(entry => entry.ref === claim.ref
      && entry.text.normalize('NFKC').includes(claim.quote.normalize('NFKC'))));
    if (sources.some(source => !source) || (candidate.scope === 'project' && !input.projectId)) {
      return { candidateKey: canonicalKey, outcome: 'rejected' };
    }
    const scope = candidate.scope === 'project' ? { type: 'project' as const, id: input.projectId! }
      : candidate.scope === 'workspace' ? { type: 'workspace' as const, id: input.workspaceId }
        : { type: 'session' as const, id: input.conversationId };
    const independentSupport = sources.some(source => source?.role === 'user' || source?.role === 'toolResult');
    const evidence = sources.map(source => {
      const contentHash = createHash('sha256').update(source!.text).digest('hex');
      const record = createContextEvidence({
        sourceType: input.source ? 'connector' : 'conversation',
        sourceRef: input.source ? `knowledge-chunk:${source!.ref}` : `session:${input.conversationId}:entry:${source!.ref}`,
        ...(input.source ? { sourceInstanceId: input.source.instanceId, sourceItemId: input.source.itemId }
          : { conversationId: input.conversationId, messageId: source!.ref }), sourceRunId: input.runId,
        contentHash: input.source?.contentHash ?? contentHash, processingPolicy: input.processingPolicy,
        trustLevel: input.source ? 'untrusted' : 'trusted', observedAt: source!.createdAt,
        redactedExcerpt: candidate.evidence.find(claim => claim.ref === source!.ref)?.quote.slice(0, 400) });
      return { id: record.id, contentHash: input.source?.contentHash ?? contentHash, consentReceiptId: input.source?.consentReceiptId };
    });
    const existing = listKnowledgeItems({ canonicalKey, scope, limit: 1 })[0];
    // Conflicting automatic statements must not replace an established decision.
    const conflict = Boolean(existing && existing.content !== candidate.statement.trim()
      && candidate.kind === 'decision' && existing.originClass !== 'owner');
    if (conflict) return { candidateKey: canonicalKey, outcome: 'rejected' };
    const result = writeKnowledgeItem({ kind: candidate.kind, scope, content: candidate.statement,
      canonicalKey, confidence: candidate.confidence, importance: candidate.importance,
      verification: independentSupport && candidate.confidence >= 0.7 ? 'supported' : 'tentative',
      status: independentSupport && candidate.confidence >= 0.7 ? 'active' : 'candidate',
      sensitivity, claimMode: input.source ? 'reported' : 'observed', originClass: input.source ? 'untrusted' : 'agent', sourceAgentId: input.agentId,
      sourceConversationId: input.conversationId || undefined, evidence, replaceExisting: true,
      source: { extractor: 'work-synthesis', evidenceRefs: candidate.evidence.map(claim => claim.ref),
        ...(input.source ? { sourceInstanceId: input.source.instanceId, sourceItemId: input.source.itemId,
          consentReceiptId: input.source.consentReceiptId } : {}) },
      reviewAt: ['commitment', 'open_question', 'episode', 'work_thread'].includes(candidate.kind)
        ? Date.now() + 30 * 86_400_000 : undefined,
    });
    return { candidateKey: canonicalKey, ...(result.item ? { objectType: 'knowledge' as const, objectId: result.item.id } : {}),
      outcome: result.item ? result.created ? 'created' : 'deduplicated' : 'rejected' };
  });
}
