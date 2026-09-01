export const USER_PERSON_KINDS = ['person', 'bot', 'service', 'group', 'unknown'] as const;

export type UserPersonKind = typeof USER_PERSON_KINDS[number];

export type UserPersonHandle = {
  id: string;
  type: 'email' | 'provider_user' | 'username' | 'display_name';
  value: string;
  sourceInstanceId: string;
  verification: 'observed' | 'inferred' | 'user_confirmed';
  firstObservedAt: number;
  lastObservedAt: number;
};

export type UserPersonSource = {
  sourceInstanceId: string;
  connectorId?: string;
  toolkit?: string;
  interactionCount: number;
  firstObservedAt: number;
  lastObservedAt: number;
};

export type UserPerson = {
  id: string;
  displayName: string;
  kind: UserPersonKind;
  hidden: boolean;
  confidence: number;
  primaryHandle?: string;
  interactionCount: number;
  firstObservedAt: number;
  lastObservedAt: number;
  handles: UserPersonHandle[];
  sources: UserPersonSource[];
  relationshipUnderstanding?: {
    id: string;
    statement: string;
    status: 'candidate' | 'active' | 'needs_review' | 'stale' | 'archived' | 'rejected';
  };
};

export type UserRelationshipSummary = {
  people: number;
  automatedAccounts: number;
  needsReview: number;
  hidden: number;
  sources: number;
  lastUpdatedAt?: number;
};

export type UserPersonIndexEntry = {
  id: string;
  displayName: string;
  inferredKind: UserPersonKind;
  confidence: number;
  firstObservedAt: number;
  lastObservedAt: number;
  handles: UserPersonHandle[];
  sources: UserPersonSource[];
};
