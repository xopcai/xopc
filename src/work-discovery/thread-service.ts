import type {
  WorkContextSnapshot,
  WorkDiscoveryResult,
  WorkUnderstandingEvidenceItem,
  WorkUnderstandingThread,
  WorkUnderstandingThreadCandidate,
} from './types.js';
import {
  listWorkUnderstandingThreads,
  upsertWorkUnderstandingThread,
} from './thread-repository.js';

function confidenceValue(value: WorkUnderstandingThreadCandidate['confidence']): number {
  return value === 'high' ? 0.9 : value === 'medium' ? 0.72 : 0.55;
}

function recencyPoints(observedAt: number | undefined, nowMs: number): number {
  if (!observedAt) return 8;
  const days = Math.max(0, (nowMs - observedAt) / 86_400_000);
  if (days <= 2) return 40;
  if (days <= 7) return 32;
  if (days <= 14) return 24;
  if (days <= 30) return 14;
  return 5;
}

function focusScore(input: {
  candidate: WorkUnderstandingThreadCandidate;
  evidence: WorkUnderstandingEvidenceItem[];
  snapshot: WorkContextSnapshot;
  nowMs: number;
}): number {
  const latest = input.evidence.reduce<number | undefined>((value, item) =>
    item.observedAt != null && (value == null || item.observedAt > value) ? item.observedAt : value, undefined);
  const commitDays = new Set((input.snapshot.git?.recentCommits ?? []).flatMap((commit) =>
    commit.committedAt ? [new Date(commit.committedAt).toISOString().slice(0, 10)] : []));
  const sourceTypes = new Set(input.evidence.map((item) => item.sourceType));
  const continuity = Math.min(20, commitDays.size * 5);
  const corroboration = Math.min(15, input.evidence.length * 3 + Math.max(0, sourceTypes.size - 1) * 5);
  const unfinished = input.candidate.status === 'active' ? 15 : input.candidate.status === 'blocked' ? 12 : 3;
  const confidence = Math.round(confidenceValue(input.candidate.confidence) * 10);
  const horizonAdjustment = input.candidate.horizon === 'current' ? 0 : input.candidate.horizon === 'ongoing' ? -4 : -8;
  return Math.max(0, Math.min(100, Math.round(
    recencyPoints(latest, input.nowMs) + continuity + corroboration + unfinished + confidence + horizonAdjustment,
  )));
}

function fallbackCandidate(result: WorkDiscoveryResult, evidence: WorkUnderstandingEvidenceItem[]): WorkUnderstandingThreadCandidate {
  return {
    topicKey: 'current-project-work',
    title: result.projectSummary.slice(0, 200),
    summary: result.currentState.slice(0, 2_000),
    status: result.lowConfidence ? 'uncertain' : 'active',
    horizon: 'current',
    confidence: result.lowConfidence ? 'low' : 'medium',
    evidenceRefs: evidence.slice(0, 6).map((item) => item.sourceRef),
  };
}

function titleTokens(value: string): Set<string> {
  return new Set(value
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.filter((token) => !['the', 'and', 'for', 'with', 'from', 'this', 'that'].includes(token))
    .slice(0, 30) ?? []);
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function canonicalKeyForCandidate(input: {
  projectId: string;
  candidate: WorkUnderstandingThreadCandidate;
}): string {
  const proposed = `${input.projectId}:${input.candidate.horizon}:${input.candidate.topicKey}`.slice(0, 300);
  const existing = listWorkUnderstandingThreads({
    projectId: input.projectId,
    includeRejected: true,
    limit: 100,
  });
  const exact = existing.find((thread) => thread.canonicalKey === proposed);
  if (exact) return exact.canonicalKey;
  const similar = existing
    .filter((thread) => thread.horizon === input.candidate.horizon && thread.userStatus !== 'rejected')
    .map((thread) => ({ thread, similarity: titleSimilarity(thread.title, input.candidate.title) }))
    .filter((item) => item.similarity >= 0.5)
    .sort((left, right) => right.similarity - left.similarity)[0];
  return similar?.thread.canonicalKey ?? proposed;
}

export function persistWorkThreadsFromDiscovery(input: {
  projectId: string;
  result: WorkDiscoveryResult;
  snapshot: WorkContextSnapshot;
  evidence: WorkUnderstandingEvidenceItem[];
  nowMs?: number;
}): WorkUnderstandingThread[] {
  const nowMs = input.nowMs ?? Date.now();
  const candidates = input.result.workThreadCandidates?.length
    ? input.result.workThreadCandidates
    : input.evidence.length
      ? [fallbackCandidate(input.result, input.evidence)]
      : [];
  const persist = (candidate: WorkUnderstandingThreadCandidate): WorkUnderstandingThread[] => {
    const evidence = candidate.evidenceRefs.flatMap((ref) => {
      const match = input.evidence.find((item) => item.sourceRef === ref);
      return match ? [match] : [];
    });
    if (!evidence.length) return [];
    const canonicalKey = canonicalKeyForCandidate({ projectId: input.projectId, candidate });
    return [upsertWorkUnderstandingThread({
      canonicalKey,
      title: candidate.title,
      summary: candidate.summary,
      status: candidate.status,
      horizon: candidate.horizon,
      focusScore: focusScore({ candidate, evidence, snapshot: input.snapshot, nowMs }),
      confidence: confidenceValue(candidate.confidence),
      projectIds: [input.projectId],
      evidenceIds: evidence.map((item) => item.id),
      observedAt: evidence.reduce((latest, item) => Math.max(latest, item.observedAt ?? nowMs), 0) || nowMs,
      nowMs,
    })];
  };
  const persisted = candidates.flatMap(persist);
  if (persisted.length || !input.evidence.length || !input.result.workThreadCandidates?.length) return persisted;
  return persist(fallbackCandidate(input.result, input.evidence));
}
