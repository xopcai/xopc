import { isOwnerAuthoredSpan, isFullyOwnerAuthoredSpan } from '../user-model/capture/evidence-policy.js';
import { createHash } from 'node:crypto';

import { projectUnadmittedForgottenFields } from './forgotten-history.js';
import { createLogger } from '../utils/logger.js';
import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import { writeKnowledgeItem, listKnowledgeItems } from '../knowledge-memory/index.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import type { CaptureEvidence } from '../user-model/capture/semantic.js';

import type { WorkCandidate } from './work-candidate.js';

export { WorkCandidateSchema, type WorkCandidate } from './work-candidate.js';

const log = createLogger('MemoryLearning:Admission');

export function isPersonalWorkClaim(statement: string): boolean {
  return /^(?:偏好|习惯|倾向|喜欢|长期偏好|prefers?\b|likes?\b|tends? to\b)/iu.test(statement)
      || /(?:用户|主人|\b(?:the user|owner)\b).{0,35}(?:喜欢|偏好|习惯|职业|身份|(?:可能|也许)?.{0,2}是|prefer|likes|habit|profession|works? as|(?:is|might be|could be|may be)\b)/iu.test(statement);
}

export function applyWorkCandidates(input: {
  candidates: WorkCandidate[]; evidence: CaptureEvidence[]; conversationId: string; agentId: string;
  workspaceId: string; projectId?: string; processingPolicy: 'local_only' | 'remote_allowed'; runId: string;
  source?: { instanceId: string; itemId: string; contentHash: string; consentReceiptId: string };
}): Array<{ candidateKey: string; objectType?: 'knowledge'; objectId?: string; outcome: 'created' | 'deduplicated' | 'rejected'; reasonCode?: string }> {
  return input.candidates.map((candidate, ordinal) => {
    const statement = candidate.lesson
      ? `Condition: ${candidate.lesson.condition.quote}\nAction: ${candidate.lesson.action.quote}\nObserved verification: ${candidate.lesson.verification.quote}`
      : candidate.statement;
    const canonicalKey = `work:${candidate.topicKey.normalize('NFKC').toLowerCase()}:${candidate.predicate}`;
    const reject = (reasonCode: string) => {
      log.info({ phase: 'work_admission', runId: input.runId, ordinal, reasonCode }, 'Work candidate rejected');
      return { candidateKey: canonicalKey, outcome: 'rejected' as const, reasonCode };
    };
    const scopedClaim = `${candidate.topicKey} ${statement}`;
    if (projectUnadmittedForgottenFields(scopedClaim, input) !== scopedClaim) return reject('forgotten_field_boundary');
    const sensitivity = inferMemorySensitivity(statement);
    if (sensitivity === 'secret' || sensitivity === 'regulated') return reject('statement_sensitive');
    if (candidate.evidence.some(claim => ['secret', 'regulated'].includes(inferMemorySensitivity(claim.quote)))) {
      return reject('evidence_sensitive');
    }
    if (candidate.evidence.some(claim => !input.evidence.some(entry => entry.ref === claim.ref))) return reject('evidence_ref_missing');
    const sources = candidate.evidence.map(claim => input.evidence.find(entry => entry.ref === claim.ref
      && entry.text.normalize('NFKC').includes(claim.quote.normalize('NFKC'))));
    if (sources.some(source => !source)) return reject('evidence_quote_mismatch');
    if (!input.source && sources.some((source, index) => source?.role === 'user'
      && (!isOwnerAuthoredSpan(source.text, candidate.evidence[index].quote)
        || (/(?:翻译|润色|改写|引文|引用|\b(?:translate|rewrite|quotation|quoted)\b)/iu.test(source.text)
          && !isFullyOwnerAuthoredSpan(source.text, candidate.evidence[index].quote))))) return reject('work_quote_not_owned');
    if (candidate.lesson) {
      if (input.source) return reject('lesson_runtime_verification_required');
      if (candidate.kind !== 'task_lesson') return reject('lesson_kind_mismatch');
      for (const claim of Object.values(candidate.lesson)) {
        if (!candidate.evidence.some(e => e.ref === claim.ref && e.quote === claim.quote)) return reject('lesson_evidence_missing');
        const source = input.evidence.find(e => e.ref === claim.ref);
        if (source?.role === 'assistant' || (source?.role === 'user' && !isFullyOwnerAuthoredSpan(source.text, claim.quote))) {
          return reject('lesson_source_not_owned');
        }
      }
      const verification = candidate.lesson.verification;
      const source = input.evidence.find(e => e.ref === verification.ref);
      if (source?.role !== 'toolResult' || !/(?:\bpassed\b|\bsuccess(?:ful)?\b|exit(?: code)?[=: ]+0\b|验证通过|测试通过|全部通过)/iu.test(verification.quote)
        || /(?:\b(?:not|never|failed|failure|error)\b|未通过|失败|尚未|没有通过)/iu.test(source.text)) return reject('lesson_verification_not_successful');
    }
    if (isPersonalWorkClaim(statement)) return reject('personal_profile_requires_assertion');
    if (candidate.scope === 'project' && !input.projectId) return reject('missing_project_scope');
    const scope = candidate.scope === 'project' ? { type: 'project' as const, id: input.projectId! }
      : candidate.scope === 'workspace' ? { type: 'workspace' as const, id: input.workspaceId }
        : { type: 'session' as const, id: input.conversationId };
    const independentSupport = sources.some((source, index) => source?.role === 'toolResult'
      || (source?.role === 'user' && isOwnerAuthoredSpan(source.text, candidate.evidence[index].quote)));
    const usableSupport = independentSupport && (candidate.kind !== 'task_lesson' || Boolean(candidate.lesson));
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
    const conflict = Boolean(existing && existing.content !== statement.trim()
      && candidate.kind === 'decision' && existing.originClass !== 'owner');
    if (conflict) return reject('protected_decision_conflict');
    const result = writeKnowledgeItem({ kind: candidate.kind, scope, content: statement,
      canonicalKey, confidence: candidate.confidence, importance: candidate.importance,
      verification: usableSupport && candidate.confidence >= 0.7 ? 'supported' : 'tentative',
      status: usableSupport && candidate.confidence >= 0.7 ? 'active' : 'candidate',
      sensitivity, claimMode: input.source ? 'reported' : 'observed', originClass: input.source ? 'untrusted' : 'agent', sourceAgentId: input.agentId,
      sourceConversationId: input.conversationId || undefined, evidence, replaceExisting: true,
      source: { extractor: 'work-synthesis', evidenceRefs: [...new Set(candidate.evidence.map(claim => claim.ref))], evidenceQuotes: candidate.evidence,
        ...(candidate.lesson ? { lesson: candidate.lesson } : {}),
        ...(input.source ? { sourceInstanceId: input.source.instanceId, sourceItemId: input.source.itemId,
          consentReceiptId: input.source.consentReceiptId } : {}) },
      reviewAt: ['commitment', 'open_question', 'episode', 'work_thread'].includes(candidate.kind)
        ? Date.now() + 30 * 86_400_000 : undefined,
    });
    if (!result.item) return reject('write_policy_or_suppression');
    return { candidateKey: canonicalKey, ...(result.item ? { objectType: 'knowledge' as const, objectId: result.item.id } : {}),
      outcome: result.item ? result.created ? 'created' : 'deduplicated' : 'rejected' };
  });
}
