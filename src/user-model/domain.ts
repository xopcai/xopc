export const USER_MODEL_PRINCIPAL_ID = 'local-owner';

export type UserModelScopeType = 'global' | 'agent' | 'workspace' | 'project' | 'session';
export type AssertionSubjectType = 'user' | 'person' | 'goal' | 'project' | 'topic';
export type AssertionCardinality = 'single' | 'multiple';
export type AssertionKind =
  | 'identity'
  | 'preference'
  | 'value'
  | 'routine'
  | 'capability'
  | 'relationship'
  | 'current_state'
  | 'derived_insight';
export type AssertionAuthority =
  | 'user_explicit'
  | 'user_observed'
  | 'system_inferred'
  | 'external_untrusted';
export type AssertionStatus =
  | 'candidate'
  | 'active'
  | 'needs_review'
  | 'conflicted'
  | 'stale'
  | 'archived'
  | 'rejected';
export type AssertionConsequence = 'low' | 'medium' | 'high' | 'critical';
export type AssertionVolatility = 'stable' | 'slow' | 'dynamic' | 'event';
export type AssertionCreator = 'user' | 'runtime' | 'connector' | 'maintenance' | 'migration';
export type AssertionSensitivity = 'normal' | 'personal' | 'secret' | 'regulated';
export type AssertionDisclosurePolicy = 'silent' | 'referenceable' | 'ask_before_reference';
export const PERSONAL_DOMAINS = [
  'identity', 'life_history', 'health', 'emotion', 'personality', 'cognition',
  'values', 'motivation', 'goals', 'capabilities', 'behavior', 'preferences',
  'relationships', 'resources_constraints', 'environment', 'digital_life',
] as const;
export type PersonalDomain = typeof PERSONAL_DOMAINS[number];
export type PersonalModelLayer = 'fact' | 'pattern' | 'interpretation';
export type AssertionAllowedUse = 'answer' | 'rank' | 'recommend' | 'remind';
export type AssertionSensitivityCategory =
  | 'health'
  | 'financial'
  | 'political'
  | 'religious'
  | 'sexuality'
  | 'biometric'
  | 'precise_location'
  | 'minor'
  | 'trauma'
  | 'third_party'
  | 'credential';

export interface UserModelScope {
  type: UserModelScopeType;
  id?: string;
}

export interface AssertionSubject {
  type: AssertionSubjectType;
  id: string;
}

export interface AssertionSlot {
  id: string;
  principalId: string;
  subject: AssertionSubject;
  predicate: string;
  cardinality: AssertionCardinality;
  scope: UserModelScope;
  createdAt: number;
}

export interface UserAssertion {
  id: string;
  slotId: string;
  kind: AssertionKind;
  value: unknown;
  normalizedValue: string;
  statement: string;
  authority: AssertionAuthority;
  status: AssertionStatus;
  confidence: number;
  declaredImportance?: number;
  inferredImportance: number;
  consequence: AssertionConsequence;
  actionability: number;
  volatility: AssertionVolatility;
  sensitivity: AssertionSensitivity;
  disclosurePolicy: AssertionDisclosurePolicy;
  domain: PersonalDomain;
  layer: PersonalModelLayer;
  sensitivityCategories: AssertionSensitivityCategory[];
  purposeIds: string[];
  allowedUses: AssertionAllowedUse[];
  allowedAgentIds?: string[];
  consentReceiptId?: string;
  supportCount: number;
  independentSourceCount: number;
  lastSupportedAt?: number;
  deleteAfter?: number;
  applicability: Record<string, unknown>;
  validFrom?: number;
  validTo?: number;
  observedAt: number;
  recordedAt: number;
  reviewAt?: number;
  supersedesAssertionId?: string;
  createdBy: AssertionCreator;
  createdAt: number;
}

export interface AssertionCandidate {
  principalId?: string;
  subject: AssertionSubject;
  predicate: string;
  cardinality: AssertionCardinality;
  scope: UserModelScope;
  kind: AssertionKind;
  value: unknown;
  normalizedValue: string;
  statement: string;
  authority: AssertionAuthority;
  confidence: number;
  declaredImportance?: number;
  inferredImportance: number;
  consequence: AssertionConsequence;
  actionability: number;
  volatility: AssertionVolatility;
  sensitivity: AssertionSensitivity;
  disclosurePolicy: AssertionDisclosurePolicy;
  domain?: PersonalDomain;
  layer?: PersonalModelLayer;
  sensitivityCategories?: AssertionSensitivityCategory[];
  purposeIds?: string[];
  allowedUses?: AssertionAllowedUse[];
  allowedAgentIds?: string[];
  consentReceiptId?: string;
  deleteAfter?: number;
  applicability?: Record<string, unknown>;
  validFrom?: number;
  validTo?: number;
  observedAt: number;
  reviewAt?: number;
  createdBy: AssertionCreator;
  evidenceId?: string;
  evidenceConfidence?: number;
  correctionOfAssertionId?: string;
}

const KIND_DOMAIN: Record<AssertionKind, PersonalDomain> = {
  identity: 'identity',
  preference: 'preferences',
  value: 'values',
  routine: 'behavior',
  capability: 'capabilities',
  relationship: 'relationships',
  current_state: 'environment',
  derived_insight: 'cognition',
};

export function defaultAssertionDomain(kind: AssertionKind): PersonalDomain {
  return KIND_DOMAIN[kind];
}

export function defaultAssertionLayer(candidate: Pick<AssertionCandidate, 'authority' | 'kind'>): PersonalModelLayer {
  if (candidate.authority === 'user_explicit' || candidate.kind === 'current_state') return 'fact';
  return candidate.kind === 'derived_insight' ? 'interpretation' : 'pattern';
}

export type ReconciliationAction = 'created' | 'deduplicated' | 'superseded' | 'conflicted';

export type ReconciliationResult = {
  action: ReconciliationAction;
  assertion: UserAssertion;
  previousAssertion?: UserAssertion;
} | { action: 'suppressed'; assertion?: undefined; previousAssertion?: undefined };

export function validateScope(scope: UserModelScope): void {
  const id = scope.id?.trim();
  if (scope.type === 'global') {
    if (id) throw new Error('Global user-model scope must not have an id.');
    return;
  }
  if (!id) throw new Error(`${scope.type} user-model scope requires an id.`);
}

export function validateCandidate(candidate: AssertionCandidate): void {
  validateScope(candidate.scope);
  if (!candidate.subject.id.trim()) throw new Error('Assertion subject id is required.');
  if (!candidate.predicate.trim()) throw new Error('Assertion predicate is required.');
  if (!candidate.normalizedValue.trim()) throw new Error('Assertion normalized value is required.');
  if (!candidate.statement.trim()) throw new Error('Assertion statement is required.');
  if (!Number.isFinite(candidate.observedAt)) throw new Error('Assertion observedAt must be finite.');
  if (candidate.domain !== undefined && !PERSONAL_DOMAINS.includes(candidate.domain)) {
    throw new Error('Assertion domain is invalid.');
  }
  if (candidate.purposeIds?.some((purpose) => !purpose.trim())) {
    throw new Error('Assertion purpose ids must not be empty.');
  }
  if (candidate.allowedAgentIds?.some((agentId) => !agentId.trim())) {
    throw new Error('Assertion allowed agent ids must not be empty.');
  }
  for (const [field, value] of [
    ['validFrom', candidate.validFrom],
    ['validTo', candidate.validTo],
    ['reviewAt', candidate.reviewAt],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  }
  for (const [field, value] of [
    ['confidence', candidate.confidence],
    ['inferredImportance', candidate.inferredImportance],
    ['actionability', candidate.actionability],
    ['declaredImportance', candidate.declaredImportance],
    ['evidenceConfidence', candidate.evidenceConfidence],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`${field} must be between 0 and 1.`);
    }
  }
  if (candidate.validFrom !== undefined && candidate.validTo !== undefined
    && candidate.validTo < candidate.validFrom) {
    throw new Error('Assertion validTo must be greater than or equal to validFrom.');
  }
}
