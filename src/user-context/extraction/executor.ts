import type { Config } from '../../config/schema.js';
import {
  createContextEvidence,
  getSessionMetadata,
  getTurnPersonalization,
  getUnderstanding,
  recordContextFeedback,
  rejectUnderstanding,
  setUnderstandingStatus,
} from '../../storage/sqlite/index.js';
import type { MemoryManager } from '../../agent/memory/manager.js';
import type { UnderstandingReviewResult } from '../../agent/memory/understanding/types.js';
import { extractionInputHash, type ExtractorId } from './registry.js';
import type { SemanticEvidence, SemanticUnderstandingInterpretation } from './semantic.js';

export type UnderstandingEvidenceMessage = SemanticEvidence & {
  createdAt: number;
  message: unknown;
};

export function emptyUnderstandingReview(): UnderstandingReviewResult {
  return { proposed: 0, created: 0, deduplicated: 0, rejected: 0, createdRecords: [], writeOutputs: [] };
}

function resolveWritePolicy(config: Config | undefined): 'deny' | 'confirm' | 'allow' {
  const memory = config?.userContext.memory;
  if (!memory || memory.mode === 'off' || memory.mode === 'readOnly') return 'deny';
  return memory.writePolicy?.understanding ?? (memory.mode === 'auto' ? 'allow' : 'confirm');
}

function recordTargetFeedback(
  turnId: string | undefined,
  targetIds: string[],
  rating: 'helpful' | 'irrelevant' | 'wrong',
  reason: string,
): void {
  if (!turnId || targetIds.length === 0) return;
  const personalization = getTurnPersonalization(turnId);
  if (!personalization) return;
  for (const objectId of targetIds) {
    recordContextFeedback({
      turnId,
      runId: personalization.runId,
      objectType: 'understanding',
      objectId,
      rating,
      reason,
    });
  }
}

export async function executeUnderstandingInterpretation(params: {
  interpretation: SemanticUnderstandingInterpretation;
  evidence: UnderstandingEvidenceMessage[];
  extractionRunId: string;
  extractorId: ExtractorId;
  sessionKey: string;
  turnId?: string;
  memoryManager: MemoryManager;
  getConfig: () => Config | undefined;
  reviewSource: 'turn' | 'background';
  processingPolicy: 'local_only' | 'remote_allowed';
}): Promise<UnderstandingReviewResult> {
  const { interpretation } = params;
  const result = emptyUnderstandingReview();
  const targets = interpretation.targetUnderstandingIds.flatMap((id) => {
    const item = getUnderstanding(id);
    return item ? [item] : [];
  });
  const targetIds = targets.map((item) => item.id);
  const policy = resolveWritePolicy(params.getConfig());

  if (interpretation.intent === 'memory_forget') {
    for (const target of targets) {
      const rejected = rejectUnderstanding(target.id, 'explicit user forget request', 'user');
      result.writeOutputs!.push({ candidateKey: rejected.canonicalKey, objectId: rejected.id, versionId: rejected.versionId, outcome: 'rejected' });
    }
    result.rejected += targets.length;
    recordTargetFeedback(params.turnId, targetIds, 'irrelevant', 'explicit_user_forget_request');
    return result;
  }
  if (interpretation.intent === 'memory_confirm' && policy !== 'deny') {
    for (const target of targets) {
      const confirmed = setUnderstandingStatus(target.id, 'active', {
        explicitness: 'explicit', confidence: 1, actorType: 'user', source: 'semantic-memory-confirmation',
      });
      result.createdRecords.push({ id: confirmed.id, content: confirmed.statement, kind: confirmed.kind, status: confirmed.status });
      result.writeOutputs!.push({ candidateKey: confirmed.canonicalKey, objectId: confirmed.id, versionId: confirmed.versionId, outcome: 'deduplicated' });
      result.deduplicated += 1;
    }
    recordTargetFeedback(params.turnId, targetIds, 'helpful', 'explicit_user_confirmation');
  }
  if (interpretation.intent === 'memory_correct' && targets.length && interpretation.candidates.length === 0) {
    for (const target of targets) setUnderstandingStatus(target.id, 'needs_review', {
      actorType: 'user', source: 'semantic-memory-correction',
    });
    recordTargetFeedback(params.turnId, targetIds, 'wrong', 'explicit_user_correction_without_replacement');
    return result;
  }
  if (interpretation.candidates.length === 0) return result;
  if (policy === 'deny') {
    result.proposed = interpretation.candidates.length;
    result.rejected = interpretation.candidates.length;
    return result;
  }

  const evidenceByRef = new Map(params.evidence.map((entry) => [entry.ref, entry]));
  const candidates = interpretation.candidates.map((candidate) => ({
    ...candidate,
    explicitness: policy === 'confirm' && candidate.explicitness === 'explicit'
      ? 'observed' as const
      : candidate.explicitness,
  }));
  const evidenceIdsByRef = new Map<string, string>();
  for (const ref of new Set(candidates.flatMap((candidate) => candidate.evidenceRefs))) {
    const entry = evidenceByRef.get(ref);
    if (!entry || entry.role !== 'user') continue;
    const evidence = createContextEvidence({
      sourceType: 'conversation',
      sourceRef: `session:${params.sessionKey}:entry:${entry.ref}`,
      sourceRunId: params.extractionRunId,
      sessionId: params.sessionKey,
      ...(params.turnId ? { turnId: params.turnId } : {}),
      messageId: entry.ref,
      contentHash: extractionInputHash(JSON.stringify(entry.message)),
      retentionPolicy: 'derived_only',
      processingPolicy: params.processingPolicy,
      extractorId: params.extractorId,
      extractorVersion: '1',
      trustLevel: 'owner',
      observedAt: entry.createdAt,
    });
    evidenceIdsByRef.set(ref, evidence.id);
  }

  const projectId = getSessionMetadata(params.sessionKey)?.projectId;
  for (const candidate of candidates) {
    const applied = await params.memoryManager.applyUnderstandingCandidates([candidate], {
      sessionKey: params.sessionKey,
      ...(projectId ? { projectId } : {}),
      evidenceIds: candidate.evidenceRefs.flatMap((ref) => evidenceIdsByRef.get(ref) ?? []),
      reviewSource: params.reviewSource,
      extractionRunId: params.extractionRunId,
      ...(interpretation.intent === 'memory_correct' ? { supersedesRecordIds: targetIds } : {}),
    });
    result.proposed += applied.proposed;
    result.created += applied.created;
    result.deduplicated += applied.deduplicated;
    result.rejected += applied.rejected;
    result.createdRecords.push(...applied.createdRecords);
    result.writeOutputs!.push(...(applied.writeOutputs ?? []));
  }
  if (interpretation.intent === 'memory_correct' && result.created > 0) {
    recordTargetFeedback(params.turnId, targetIds, 'wrong', 'explicit_user_correction_with_replacement');
  }
  return result;
}
