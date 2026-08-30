import {
  listUnderstandings,
  listUnderstandingEvidence,
  searchActiveUnderstandings,
  summarizeUnderstandingFeedback,
} from '../storage/sqlite/index.js';
import { buildRetrievalQueryProfile } from '../retrieval/queryProfile.js';
import {
  normalizeRetrievalText,
  retrievalLexicalSimilarity,
} from '../retrieval/textFeatures.js';
import type { UserUnderstanding } from './domain.js';
import { matchesUserContextScope } from './scope.js';

export interface UnderstandingRetrievalResult {
  understanding: UserUnderstanding;
  score: number;
  reasons: string[];
}

function authorityBonus(item: UserUnderstanding): number {
  if (item.explicitness === 'explicit') return 0.1;
  if (item.explicitness === 'observed') return 0.05;
  return 0;
}

function baseline(item: UserUnderstanding): number {
  if (item.kind === 'boundary' && item.explicitness === 'explicit') return 0.8;
  if (item.kind === 'preference' && item.explicitness === 'explicit') return 0.12;
  return 0;
}

function temporalAdjustment(item: UserUnderstanding, hints: string[], now: number): number {
  if (!hints.length) return 0;
  let score = 0;
  if (hints.includes('historical')) {
    score += item.validTo !== undefined || item.status === 'archived' || item.status === 'stale' ? 0.14 : -0.6;
  }
  if (hints.includes('current')) {
    const isTemporalState = item.kind === 'current_state' || item.validFrom !== undefined || item.validTo !== undefined;
    if (isTemporalState) {
      const validNow = (item.validFrom === undefined || item.validFrom <= now)
        && (item.validTo === undefined || item.validTo > now);
      score += validNow ? 0.08 : -0.15;
      if (item.kind === 'current_state') score += 0.06;
    }
  }
  if (hints.includes('recent')) {
    score += now - item.updatedAt <= 90 * 24 * 60 * 60_000 ? 0.08 : -0.04;
  }
  if (hints.includes('future')) {
    if ((item.validFrom ?? 0) > now || item.kind === 'long_term_goal') score += 0.1;
  }
  return score;
}

function sourceBucket(item: UserUnderstanding): string {
  if (item.explicitness === 'explicit') return 'user';
  const evidence = listUnderstandingEvidence(item.id)[0];
  if (!evidence) return `unknown:${item.id}`;
  if (evidence.sourceInstanceId) return `${evidence.sourceType}:${evidence.sourceInstanceId}`;
  return `${evidence.sourceType}:${evidence.sourceRef.split(':entry:')[0]}`;
}

function diversify(results: UnderstandingRetrievalResult[], limit: number): UnderstandingRetrievalResult[] {
  const remaining = [...results];
  const selected: UnderstandingRetrievalResult[] = [];
  const sourceCounts = new Map<string, number>();
  const sourceBuckets = new Map(
    results.map((result) => [result.understanding.id, sourceBucket(result.understanding)]),
  );
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [index, candidate] of remaining.entries()) {
      const redundancy = selected.reduce((maximum, chosen) => Math.max(
        maximum,
        retrievalLexicalSimilarity(candidate.understanding.statement, chosen.understanding.statement),
      ), 0);
      const bucket = sourceBuckets.get(candidate.understanding.id)!;
      const sourcePenalty = candidate.understanding.explicitness === 'explicit'
        ? 0 : (sourceCounts.get(bucket) ?? 0) * 0.04;
      const adjusted = candidate.score - redundancy * 0.18 - sourcePenalty;
      if (adjusted > bestScore) { bestScore = adjusted; bestIndex = index; }
    }
    const candidate = remaining.splice(bestIndex, 1)[0]!;
    const bucket = sourceBuckets.get(candidate.understanding.id)!;
    sourceCounts.set(bucket, (sourceCounts.get(bucket) ?? 0) + 1);
    selected.push({
      ...candidate,
      score: Math.max(0, bestScore),
      reasons: bestScore < candidate.score ? [...candidate.reasons, 'diversified'] : candidate.reasons,
    });
  }
  return selected;
}

function feedbackAdjustment(summary: { helpful: number; irrelevant: number; total: number } | undefined): number {
  if (!summary || summary.total < 3) return 0;
  const helpfulRate = (summary.helpful + 1) / (summary.total + 2);
  const relevancePenalty = summary.irrelevant >= 3 ? 0.05 : 0;
  return Math.max(-0.1, Math.min(0.05, (helpfulRate - 0.5) * 0.1 - relevancePenalty));
}

export class UserUnderstandingRetriever {
  retrieve(params: {
    query: string;
    sessionKey: string;
    workspaceId: string;
    projectId?: string;
    maxCandidates: number;
  }): UnderstandingRetrievalResult[] {
    const profile = buildRetrievalQueryProfile(params.query, {
      sessionKey: params.sessionKey,
      workspaceId: params.workspaceId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
    });
    if (!profile.normalized) return [];
    const maxCandidates = Math.max(1, Math.min(200, Math.floor(params.maxCandidates)));

    const fts = searchActiveUnderstandings(profile.expanded, Math.max(50, maxCandidates));
    const ftsScores = new Map(fts.map((result) => [result.understanding.id, result.score]));
    const recentLimit = Math.max(200, Math.min(500, maxCandidates * 5));
    const statuses = profile.timeHints.includes('historical')
      ? ['active', 'archived', 'stale'] as const : ['active'] as const;
    const recent = listUnderstandings([...statuses]).slice(0, recentLimit);
    const candidates = new Map<string, UserUnderstanding>();
    for (const result of fts) candidates.set(result.understanding.id, result.understanding);
    for (const item of recent) candidates.set(item.id, item);
    const feedback = new Map(
      summarizeUnderstandingFeedback([...candidates.keys()])
        .map((summary) => [summary.understandingId, summary]),
    );

    const now = Date.now();
    const ranked = [...candidates.values()]
      .map((item): UnderstandingRetrievalResult => {
        const lexical = Math.max(
          retrievalLexicalSimilarity(profile.normalized, item.statement),
          retrievalLexicalSimilarity(profile.expanded, item.statement),
        );
        const ftsScore = ftsScores.get(item.id) ?? 0;
        const textScore = Math.max(lexical, ftsScore);
        const kindMatched = profile.intentKinds.includes(item.kind);
        const normalizedStatement = normalizeRetrievalText(item.statement);
        const identifierMatched = profile.identifiers.some((identifier) => normalizedStatement.includes(identifier));
        const feedbackScore = feedbackAdjustment(feedback.get(item.id));
        const kindAdjustment = profile.intentKinds.length > 0 && !kindMatched && profile.timeHints.length === 0
          ? -0.35 : 0;
        const score = Math.min(1, Math.max(0, Math.max(
          baseline(item),
          textScore * 0.7
            + lexical * 0.1
            + item.confidence * 0.1
            + authorityBonus(item)
            + (kindMatched ? 0.08 : 0)
            + kindAdjustment
            + (identifierMatched ? 0.12 : 0)
            + temporalAdjustment(item, profile.timeHints, now)
            + (matchesUserContextScope(item.scope, params) && item.scope.type !== 'global' ? 0.05 : 0),
        ) + feedbackScore));
        const reasons = [
          ftsScore > 0 ? 'fts' : '',
          lexical > 0 ? 'lexical' : '',
          identifierMatched ? 'identifier' : '',
          kindMatched ? 'kind' : '',
          item.explicitness === 'explicit' ? 'explicit' : '',
          feedbackScore !== 0 ? 'feedback' : '',
          temporalAdjustment(item, profile.timeHints, now) !== 0 ? 'temporal' : '',
        ].filter(Boolean);
        return { understanding: item, score, reasons };
      })
      .sort((left, right) =>
        Number(matchesUserContextScope(right.understanding.scope, params))
          - Number(matchesUserContextScope(left.understanding.scope, params))
        || right.score - left.score
        || right.understanding.updatedAt - left.understanding.updatedAt)
    return diversify(ranked, maxCandidates);
  }
}
