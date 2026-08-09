import { upsertFocusCandidate } from '../focuses/candidate-repository.js';

import type {
  WorkContextSnapshot,
  WorkDiscoveryResult,
  WorkUnderstandingEvidenceItem,
  WorkUnderstandingThread,
  WorkUnderstandingThreadCandidate,
} from './types.js';

function confidenceValue(value: WorkUnderstandingThreadCandidate['confidence']): number {
  return value === 'high' ? 0.9 : value === 'medium' ? 0.72 : 0.55;
}

/**
 * Discovery produces suggestions only. The user turns a suggestion into a Focus explicitly.
 * The legacy thread-shaped return value remains local to the discovery result renderer; it is
 * not a second persisted domain model.
 */
export function persistWorkThreadsFromDiscovery(input: {
  projectId: string;
  result: WorkDiscoveryResult;
  snapshot: WorkContextSnapshot;
  evidence: WorkUnderstandingEvidenceItem[];
  nowMs?: number;
}): WorkUnderstandingThread[] {
  const nowMs = input.nowMs ?? Date.now();
  const candidates = input.result.workThreadCandidates ?? [];
  return candidates.flatMap((candidate) => {
    const evidence = candidate.evidenceRefs.flatMap((ref) => {
      const item = input.evidence.find((entry) => entry.sourceRef === ref);
      return item ? [{ label: item.observation.slice(0, 300), source: item.sourceRef }] : [];
    });
    if (evidence.length === 0) return [];
    const canonicalKey = `${input.projectId}:${candidate.horizon}:${candidate.topicKey}`.slice(0, 300);
    const stored = upsertFocusCandidate({
      canonicalKey,
      title: candidate.title,
      summary: candidate.summary,
      confidence: confidenceValue(candidate.confidence),
      evidence,
      projectIds: [input.projectId],
      nowMs,
    });
    return [{
      id: stored.id,
      canonicalKey,
      title: stored.title,
      summary: stored.summary,
      status: candidate.status,
      horizon: candidate.horizon,
      focusScore: Math.round(stored.confidence * 100),
      confidence: stored.confidence,
      userStatus: 'unreviewed',
      projectIds: stored.projectIds,
      evidenceIds: [],
      firstObservedAt: stored.discoveredAt,
      lastObservedAt: stored.updatedAt,
      createdAt: stored.discoveredAt,
      updatedAt: stored.updatedAt,
    }];
  });
}
