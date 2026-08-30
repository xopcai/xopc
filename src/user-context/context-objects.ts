import {
  getUserProfile,
  listCollaborationRules,
  listUnderstandingEvidence,
  listUnderstandings,
} from '../storage/sqlite/index.js';
import type { ContextEvidence, UserContextScope, UserUnderstanding } from './domain.js';
import {
  getUnderstandingSourceGrant,
  getUnderstandingSourceRun,
  listUserFocusEvidence,
  listUserFocuses,
} from './sources/repository.js';

export type ContextObjectView = 'current' | 'review' | 'history';
export type ContextObjectOrigin = 'told_by_user' | 'observed' | 'inferred' | 'connected_source';

export type ContextObject = {
  objectType: 'profile' | 'rule' | 'focus' | 'understanding';
  objectId: string;
  status: string;
  content: string;
  scope: UserContextScope;
  origin: ContextObjectOrigin;
  confidence: number;
  evidence: ContextEvidence[] | Array<{ sourceRef: string }>;
  updatedAt: number;
};

function understandingOrigin(item: UserUnderstanding, evidence: ContextEvidence[]): ContextObjectOrigin {
  if (item.explicitness === 'explicit') return 'told_by_user';
  if (evidence.some((entry) => entry.sourceType === 'connector')) return 'connected_source';
  return item.explicitness === 'observed' ? 'observed' : 'inferred';
}

function includesStatus(view: ContextObjectView, objectType: ContextObject['objectType'], status: string): boolean {
  if (view === 'current') return status === 'active';
  if (view === 'review') {
    return objectType === 'understanding'
      ? ['candidate', 'needs_review', 'stale'].includes(status)
      : objectType === 'focus' && status === 'candidate';
  }
  return objectType === 'understanding'
    ? ['archived', 'rejected'].includes(status)
    : objectType === 'focus'
      ? ['paused', 'completed', 'rejected'].includes(status)
      : objectType === 'rule' && ['disabled', 'archived'].includes(status);
}

export function listContextObjects(view: ContextObjectView): ContextObject[] {
  const objects: ContextObject[] = [];
  if (view === 'current') {
    const profile = getUserProfile();
    const fields = [
      ['callName', profile.callName],
      ['role', profile.role],
      ['primaryGoal', profile.primaryGoal],
      ['pronouns', profile.pronouns],
      ['timezone', profile.timezone],
      ['locale', profile.locale],
    ] as const;
    for (const [field, value] of fields) {
      if (!value) continue;
      objects.push({
        objectType: 'profile', objectId: field, status: 'active', content: value,
        scope: { type: 'global' }, origin: 'told_by_user', confidence: 1,
        evidence: [{ sourceRef: `user-profile://${field}` }], updatedAt: profile.updatedAt,
      });
    }
  }

  for (const rule of listCollaborationRules()) {
    if (!includesStatus(view, 'rule', rule.status)) continue;
    objects.push({
      objectType: 'rule', objectId: rule.id, status: rule.status, content: rule.statement,
      scope: rule.scope, origin: 'told_by_user', confidence: 1,
      evidence: [{ sourceRef: `collaboration-rule://${rule.revisionId}` }], updatedAt: rule.updatedAt,
    });
  }
  for (const focus of listUserFocuses()) {
    if (!includesStatus(view, 'focus', focus.status)) continue;
    const sourceRun = focus.sourceRunId ? getUnderstandingSourceRun(focus.sourceRunId) : null;
    const sourceGrant = sourceRun ? getUnderstandingSourceGrant(sourceRun.grantId) : null;
    const linkedEvidence = listUserFocusEvidence(focus.id);
    objects.push({
      objectType: 'focus', objectId: focus.id, status: focus.status,
      content: `${focus.title}: ${focus.summary}`, scope: focus.scope,
      origin: focus.explicitness === 'explicit' ? 'told_by_user'
        : sourceGrant?.adapterId.startsWith('connector:') ? 'connected_source'
          : focus.explicitness === 'observed' ? 'observed' : 'inferred',
      confidence: focus.confidence,
      evidence: linkedEvidence.length
        ? linkedEvidence
        : focus.evidenceRefs.map((sourceRef) => ({ sourceRef })),
      updatedAt: focus.updatedAt,
    });
  }
  for (const understanding of listUnderstandings()) {
    if (!includesStatus(view, 'understanding', understanding.status)) continue;
    const evidence = listUnderstandingEvidence(understanding.id);
    objects.push({
      objectType: 'understanding', objectId: understanding.id, status: understanding.status,
      content: understanding.statement, scope: understanding.scope,
      origin: understandingOrigin(understanding, evidence), confidence: understanding.confidence,
      evidence, updatedAt: understanding.updatedAt,
    });
  }
  return objects.sort((left, right) => right.updatedAt - left.updatedAt);
}
