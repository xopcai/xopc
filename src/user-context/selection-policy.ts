import type { UserContextRejectionReason } from '../agent/memory/context/types.js';
import { buildRetrievalQueryProfile } from '../retrieval/queryProfile.js';
import { retrievalLexicalSimilarity } from '../retrieval/textFeatures.js';
import type { UserUnderstanding } from './domain.js';
import type { UserFocus } from './sources/types.js';
import { matchesUserContextScope } from './scope.js';

/** Automatic remote context never uses sensitive, consent-gated or weakly inferred facts. */
export function allowsAutomaticDisclosure(item: Pick<UserUnderstanding, 'sensitivity' | 'disclosurePolicy' | 'explicitness' | 'confidence'>): boolean {
  return item.sensitivity === 'normal' && item.disclosurePolicy !== 'ask_before_reference'
    && (item.explicitness !== 'inferred' || item.confidence >= 0.8);
}

export function rejectionReason(
  item: UserUnderstanding,
  input: { sessionKey: string; workspaceId: string; projectId?: string },
  now: number,
  timeHints: string[],
): UserContextRejectionReason | undefined {
  const historical = timeHints.includes('historical') && item.validTo !== undefined;
  if (item.status === 'needs_review' || item.status === 'candidate' || (item.status === 'stale' && !historical)) return 'needs_review';
  if (item.status === 'rejected' || (item.status === 'archived' && !historical)) return 'disabled';
  if (!matchesUserContextScope(item.scope, input)) return 'scope_mismatch';
  if (item.validFrom && item.validFrom > now && !timeHints.includes('future')) return 'not_yet_valid';
  if (((item.validTo && item.validTo < now) || (item.expiresAt && item.expiresAt < now)) && !historical) return 'expired';
  if (item.sensitivity === 'secret' || item.sensitivity === 'regulated') return 'sensitive';
  if (item.conflictGroupId) return 'conflict';
  return undefined;
}

export function focusRejectionReason(
  focus: UserFocus,
  input: { sessionKey: string; workspaceId: string; projectId?: string },
  now: number,
): UserContextRejectionReason | undefined {
  if (focus.status !== 'active') return 'disabled';
  if (!matchesUserContextScope(focus.scope, input)) return 'scope_mismatch';
  if (focus.validFrom && focus.validFrom > now) return 'not_yet_valid';
  if (focus.validTo && focus.validTo < now) return 'expired';
  if (focus.sensitivity === 'secret' || focus.sensitivity === 'regulated') return 'sensitive';
  if (focus.disclosurePolicy === 'ask_before_reference') return 'requires_consent';
  return undefined;
}

export function focusScore(focus: UserFocus, query: string, scopeInput: {
  sessionKey: string;
  workspaceId: string;
  projectId?: string;
}): number {
  const profile = buildRetrievalQueryProfile(query, scopeInput);
  const lexical = retrievalLexicalSimilarity(profile.normalized, `${focus.title} ${focus.summary}`);
  const scoped = focus.scope.type !== 'global' && matchesUserContextScope(focus.scope, scopeInput);
  return Math.min(1, lexical * 0.75 + focus.confidence * 0.15 + (scoped ? 0.25 : 0));
}
