import type { UserFocus, UserUnderstanding } from './user-context-api';

const REVIEW_STATUSES = new Set<UserUnderstanding['status']>(['candidate', 'needs_review', 'stale']);
const HISTORY_STATUSES = new Set<UserUnderstanding['status']>(['archived', 'rejected']);
const GLOBAL_CONTEXT_KINDS = new Set<UserUnderstanding['kind']>([
  'preference', 'boundary', 'relationship', 'routine', 'current_state', 'long_term_goal',
]);
const ENGLISH_STOP_WORDS = new Set([
  'and', 'are', 'for', 'from', 'into', 'that', 'the', 'this', 'with', 'you', 'your',
]);

export type SharedUnderstandingReviewItem =
  | { type: 'focus'; id: string; updatedAt: number; focus: UserFocus; reviewReason: 'candidate' | 'due' | 'expired' }
  | { type: 'understanding'; id: string; updatedAt: number; understanding: UserUnderstanding };

export type SharedUnderstandingHistoryItem =
  | { type: 'focus'; id: string; updatedAt: number; focus: UserFocus }
  | { type: 'understanding'; id: string; updatedAt: number; understanding: UserUnderstanding };

export type SharedUnderstandingTimelineItem =
  | { type: 'focus'; id: string; updatedAt: number; focus: UserFocus }
  | { type: 'understanding'; id: string; updatedAt: number; understanding: UserUnderstanding };

export type UnderstandingRelationReason = 'project_scope' | 'topic_overlap' | 'global_context';

export type UnderstandingRelation = {
  understanding: UserUnderstanding;
  score: number;
  reasons: UnderstandingRelationReason[];
};

export type SharedUnderstandingModel = {
  currentFocuses: UserFocus[];
  activeUnderstandings: UserUnderstanding[];
  reviewQueue: SharedUnderstandingReviewItem[];
  history: SharedUnderstandingHistoryItem[];
  timeline: SharedUnderstandingTimelineItem[];
};

function newestFirst<T extends { updatedAt: number }>(left: T, right: T): number {
  return right.updatedAt - left.updatedAt;
}

export function buildSharedUnderstandingModel(
  focuses: UserFocus[],
  understandings: UserUnderstanding[],
  now = Date.now(),
): SharedUnderstandingModel {
  const currentFocuses = focuses
    .filter((focus) => focus.status === 'active' && !focusNeedsReview(focus, now))
    .sort(newestFirst);
  const activeUnderstandings = understandings
    .filter((understanding) => understanding.status === 'active')
    .sort(newestFirst);
  const reviewQueue: SharedUnderstandingReviewItem[] = [
    ...focuses
      .filter((focus) => focus.status === 'candidate' || focusNeedsReview(focus, now))
      .map((focus) => ({
        type: 'focus' as const,
        id: focus.id,
        updatedAt: focus.updatedAt,
        focus,
        reviewReason: focus.status === 'candidate'
          ? 'candidate' as const
          : focus.validTo !== undefined && focus.validTo <= now
            ? 'expired' as const
            : 'due' as const,
      })),
    ...understandings
      .filter((understanding) => REVIEW_STATUSES.has(understanding.status))
      .map((understanding) => ({
        type: 'understanding' as const,
        id: understanding.id,
        updatedAt: understanding.updatedAt,
        understanding,
      })),
  ].sort(newestFirst);
  const history: SharedUnderstandingHistoryItem[] = [
    ...focuses
      .filter((focus) => focus.status === 'paused' || focus.status === 'completed' || focus.status === 'rejected')
      .map((focus) => ({ type: 'focus' as const, id: focus.id, updatedAt: focus.updatedAt, focus })),
    ...understandings
      .filter((understanding) => HISTORY_STATUSES.has(understanding.status))
      .map((understanding) => ({
        type: 'understanding' as const,
        id: understanding.id,
        updatedAt: understanding.updatedAt,
        understanding,
      })),
  ].sort(newestFirst);
  const timeline: SharedUnderstandingTimelineItem[] = [
    ...focuses
      .filter((focus) => focus.status !== 'candidate'
        && !(focus.status === 'rejected' && focus.explicitness === 'inferred'))
      .map((focus) => ({ type: 'focus' as const, id: focus.id, updatedAt: focus.updatedAt, focus })),
    ...understandings
      .filter((understanding) => !REVIEW_STATUSES.has(understanding.status)
        && !(understanding.status === 'rejected' && understanding.explicitness === 'inferred'))
      .map((understanding) => ({
      type: 'understanding' as const,
      id: understanding.id,
      updatedAt: understanding.updatedAt,
      understanding,
      })),
  ].sort(newestFirst);
  return { currentFocuses, activeUnderstandings, reviewQueue, history, timeline };
}

export function focusNeedsReview(focus: UserFocus, now = Date.now()): boolean {
  if (focus.status !== 'active') return false;
  return (focus.validTo !== undefined && focus.validTo <= now)
    || (focus.reviewAt !== undefined && focus.reviewAt <= now);
}

function tokens(value: string): Set<string> {
  const result = new Set<string>();
  const segments = value.toLocaleLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? [];
  for (const segment of segments) {
    if (/^\p{Script=Han}+$/u.test(segment)) {
      if (segment.length === 1) result.add(segment);
      for (let index = 0; index < segment.length - 1; index += 1) result.add(segment.slice(index, index + 2));
      continue;
    }
    if (segment.length >= 3 && !ENGLISH_STOP_WORDS.has(segment)) result.add(segment);
  }
  return result;
}

function topicOverlap(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

export function rankUnderstandingRelations(
  focus: UserFocus,
  understandings: UserUnderstanding[],
  limit = 6,
): UnderstandingRelation[] {
  const focusText = `${focus.title} ${focus.summary}`;
  return understandings
    .filter((understanding) => ['active', 'candidate', 'needs_review', 'stale'].includes(understanding.status))
    .map((understanding): UnderstandingRelation | null => {
      const reasons: UnderstandingRelationReason[] = [];
      let score = 0;
      if (focus.scope.type === 'project' && understanding.scope.type === 'project'
        && understanding.scope.id === focus.scope.id) {
        reasons.push('project_scope');
        score += 0.75;
      }
      const overlap = topicOverlap(focusText, understanding.statement);
      if (overlap >= 0.12) {
        reasons.push('topic_overlap');
        score += Math.min(0.65, 0.18 + overlap * 0.55);
      }
      if (understanding.status === 'active'
        && understanding.scope.type === 'global'
        && GLOBAL_CONTEXT_KINDS.has(understanding.kind)) {
        reasons.push('global_context');
        score += 0.16;
      }
      if (!reasons.length) return null;
      return { understanding, reasons, score: Math.min(1, score) };
    })
    .filter((relation): relation is UnderstandingRelation => relation !== null)
    .sort((left, right) => right.score - left.score
      || right.understanding.updatedAt - left.understanding.updatedAt)
    .slice(0, Math.max(0, limit));
}
