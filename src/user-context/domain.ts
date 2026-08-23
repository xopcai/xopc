export const USER_CONTEXT_PRINCIPAL_ID = 'local-owner';

export type UserProfile = {
  callName: string;
  role: string;
  primaryGoal: string;
  pronouns: string;
  timezone: string;
  locale: string;
  accessibility: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type UserContextScope = {
  type: 'global' | 'workspace' | 'project' | 'session';
  id?: string;
};

export const UNDERSTANDING_KINDS = [
  'preference',
  'boundary',
  'relationship',
  'routine',
  'current_state',
  'long_term_goal',
  'project_context',
  'task_lesson',
  'derived_insight',
] as const;

export type UnderstandingKind = typeof UNDERSTANDING_KINDS[number];

export type UnderstandingStatus =
  | 'candidate'
  | 'active'
  | 'needs_review'
  | 'stale'
  | 'archived'
  | 'rejected';

export type UserUnderstanding = {
  id: string;
  kind: UnderstandingKind;
  canonicalKey: string;
  status: UnderstandingStatus;
  scope: UserContextScope;
  explicitness: 'explicit' | 'observed' | 'inferred';
  durability: 'ephemeral' | 'durable' | 'recurring';
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  disclosurePolicy: 'silent' | 'referenceable' | 'ask_before_reference';
  confidence: number;
  statement: string;
  payload: Record<string, unknown>;
  versionId: string;
  validFrom?: number;
  validTo?: number;
  expiresAt?: number;
  reviewAt?: number;
  conflictGroupId?: string;
  supersedesId?: string;
  createdAt: number;
  updatedAt: number;
};

export type CollaborationRule = {
  id: string;
  category: 'communication' | 'execution' | 'boundary' | 'routine' | 'proactive';
  status: 'active' | 'disabled' | 'archived';
  priority: number;
  scope: UserContextScope;
  conditions: Record<string, unknown>;
  statement: string;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
};

export type PersonalizationItem = {
  objectType: 'profile' | 'rule' | 'understanding';
  objectId: string;
  versionId?: string;
  decision: 'selected' | 'irrelevant' | 'expired' | 'scope_mismatch' | 'sensitive'
    | 'needs_consent' | 'budget_exceeded' | 'conflicted' | 'disabled';
  reason: string;
  content: string;
  sourceLabel: string;
  rank?: number;
  score?: number;
  injectedChars: number;
};

export type ContextEvidence = {
  id: string;
  sourceType: 'conversation' | 'connector' | 'user' | 'runtime';
  sourceInstanceId?: string;
  sourceRef: string;
  redactedExcerpt?: string;
  trustLevel: 'owner' | 'trusted' | 'untrusted';
  observedAt: number;
  createdAt: number;
};
