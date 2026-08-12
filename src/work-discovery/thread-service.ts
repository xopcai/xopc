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
 * Discovery returns bounded suggestions for the current result only.
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
    const confidence = confidenceValue(candidate.confidence);
    return [{
      id: canonicalKey,
      canonicalKey,
      title: candidate.title,
      summary: candidate.summary,
      status: candidate.status,
      horizon: candidate.horizon,
      focusScore: Math.round(confidence * 100),
      confidence,
      userStatus: 'unreviewed',
      projectIds: [input.projectId],
      evidenceIds: [],
      firstObservedAt: nowMs,
      lastObservedAt: nowMs,
      createdAt: nowMs,
      updatedAt: nowMs,
    }];
  });
}
