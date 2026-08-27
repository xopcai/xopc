import {
  listUnderstandings,
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
  if (item.kind === 'preference' && item.explicitness === 'explicit') return 0.35;
  return 0;
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

    const fts = searchActiveUnderstandings(profile.normalized, Math.max(50, maxCandidates));
    const ftsScores = new Map(fts.map((result) => [result.understanding.id, result.score]));
    const recentLimit = Math.max(200, Math.min(500, maxCandidates * 5));
    const recent = listUnderstandings(['active']).slice(0, recentLimit);
    const candidates = new Map<string, UserUnderstanding>();
    for (const result of fts) candidates.set(result.understanding.id, result.understanding);
    for (const item of recent) candidates.set(item.id, item);
    const feedback = new Map(
      summarizeUnderstandingFeedback([...candidates.keys()])
        .map((summary) => [summary.understandingId, summary]),
    );

    return [...candidates.values()]
      .map((item): UnderstandingRetrievalResult => {
        const lexical = retrievalLexicalSimilarity(profile.normalized, item.statement);
        const ftsScore = ftsScores.get(item.id) ?? 0;
        const textScore = Math.max(lexical, ftsScore);
        const kindMatched = profile.intentKinds.includes(item.kind);
        const normalizedStatement = normalizeRetrievalText(item.statement);
        const identifierMatched = profile.identifiers.some((identifier) => normalizedStatement.includes(identifier));
        const feedbackScore = feedbackAdjustment(feedback.get(item.id));
        const score = Math.min(1, Math.max(0, Math.max(
          baseline(item),
          textScore * 0.7
            + lexical * 0.1
            + item.confidence * 0.1
            + authorityBonus(item)
            + (kindMatched ? 0.08 : 0)
            + (identifierMatched ? 0.12 : 0)
            + (matchesUserContextScope(item.scope, params) && item.scope.type !== 'global' ? 0.05 : 0),
        ) + feedbackScore));
        const reasons = [
          ftsScore > 0 ? 'fts' : '',
          lexical > 0 ? 'lexical' : '',
          identifierMatched ? 'identifier' : '',
          kindMatched ? 'kind' : '',
          item.explicitness === 'explicit' ? 'explicit' : '',
          feedbackScore !== 0 ? 'feedback' : '',
        ].filter(Boolean);
        return { understanding: item, score, reasons };
      })
      .sort((left, right) =>
        Number(matchesUserContextScope(right.understanding.scope, params))
          - Number(matchesUserContextScope(left.understanding.scope, params))
        || right.score - left.score
        || right.understanding.updatedAt - left.understanding.updatedAt)
      .slice(0, maxCandidates);
  }
}
