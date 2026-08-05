import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type UserContextFacet = 'basics' | 'collaboration' | 'boundaries' | 'priorities' | 'people' | 'current';
export type UserContextOrigin = 'told_by_you' | 'observed' | 'inferred' | 'connected_source';
export type UserTrustLevel = 'observe' | 'suggest' | 'confirm' | 'auto';

export type UserProfileFields = {
  callName: string;
  pronouns: string;
  timezone: string;
  notes: string;
};

export type UserProfileSetup = {
  missing: Array<keyof UserProfileFields>;
  shouldPrompt: boolean;
  state: 'complete' | 'active' | 'snoozed';
  callNameSuggestion?: {
    id: string;
    value: string;
    source: 'gateway_os';
    confidence: 'medium';
  };
  snoozedUntil?: string;
};

export type UserUnderstanding = {
  id: string;
  statement: string;
  facet: UserContextFacet;
  kind: string;
  status: 'active' | 'candidate' | 'needs_review' | 'stale';
  origin: UserContextOrigin;
  sourceName: string;
  updatedAt: string;
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  explicitness: 'explicit' | 'observed' | 'inferred';
  durability: 'ephemeral' | 'durable' | 'recurring';
  disclosurePolicy: 'silent' | 'referenceable' | 'ask_before_reference';
  stability: 'strong' | 'working' | 'fragile';
  stabilityScore: number;
  confidence?: number;
  reviewAt: string;
  reviewDue: boolean;
  evidenceCount: number;
  evidenceBasis?: { eventCount: number; activeDays: number; windowDays: number };
  sourcePath?: string;
  latestEvidenceAt?: string;
  validFrom?: string;
  validTo?: string;
  expiresAt?: string;
};

export type PersonalContextSource = {
  id: string;
  accountLabel?: string;
  accountOrdinal?: number;
  accountCount?: number;
  displayName: string;
  description: string;
  branding?: {
    logoUrl?: string;
    backgroundColor?: string;
  };
  category: string;
  capabilities: string[];
  access: {
    context: boolean;
    memory: boolean;
    read: boolean;
    write: boolean;
  };
  permissionDetails: string[];
  installed: boolean;
  enabled: boolean;
  status: string;
  instanceId?: string;
  lastConnectedAt?: string;
  lastHealthCheckAt?: string;
  lastHealthStatus?: string;
  lastActivityAt?: string;
  derivedUnderstandingCount: number;
  knowledgeItemCount: number;
  learningFunnel: {
    indexedItems: number;
    attributedItems: number;
    resolvedEntities: number;
    provisionalClaims: number;
    activeClaims: number;
    evidenceCount: number;
    lastEvidenceAt?: string;
  };
  lastSyncAt?: string;
  lastSyncStatus?: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  lastSyncError?: string;
  learning?: {
    status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
    phase: 'queued' | 'fetching' | 'indexing' | 'deriving' | 'completed';
    itemsDiscovered: number;
    itemsIndexed: number;
    candidatesCreated: number;
    mode: 'bootstrap' | 'incremental';
    attemptCount: number;
    nextRunAt?: string;
    error?: string;
    updatedAt: string;
  };
};

export type ConnectedClaim = {
  id: string;
  class: 'relationship' | 'project' | 'routine';
  value: Record<string, unknown>;
  state: 'provisional' | 'active' | 'rejected' | 'stale';
  userState: 'auto' | 'confirmed' | 'rejected';
  confidence: number;
  independentEvidenceCount: number;
  activeDayCount: number;
  firstObservedAt: string;
  lastReinforcedAt: string;
  evidence: Array<{
    logicalEventKey: string;
    sourceItemId: string;
    sourceInstanceId: string;
    relation: string;
    observedAt: string;
  }>;
};

export type InsightSuggestion = {
  id: string;
  insight: string;
  kind: string;
  action: 'make_repeatable' | 'start_progress' | 'add_playbook';
  evidenceCount: number;
  confidence?: number;
  sourceName: string;
};

export type PersonalPlaybook = {
  id: 'communication' | 'execution' | 'routines';
  enabled: boolean;
  rules: Array<{
    id: string;
    statement: string;
    origin: 'explicit' | 'observed' | 'inferred';
    enabled: boolean;
    order: number;
    context: {
      channel?: string;
      supportNeed?: 'listen' | 'clarify' | 'advise' | 'act' | 'unknown';
    };
    versions: Array<{ id: string; statement: string; updatedAt: string; current: boolean }>;
  }>;
  updatedAt?: string;
};

export type UserContextResponse = {
  scope: {
    profile: 'global';
    memory: 'global';
    trust: 'global';
  };
  profileContent: string;
  profile: UserProfileFields;
  profileSetup: UserProfileSetup;
  understanding: UserUnderstanding[];
  connectedClaims: ConnectedClaim[];
  consentRequests: ReferenceConsent[];
  referenceGrants: ReferenceConsent[];
  conflictGroups: Array<{
    id: string;
    unresolved: boolean;
    records: Array<UserUnderstanding & { storedStatus: string }>;
  }>;
  insights: InsightSuggestion[];
  playbooks: PersonalPlaybook[];
  sources: PersonalContextSource[];
  sourceRecommendations: Array<{
    sourceId: string;
    sourceName: string;
    goalId: string;
    goalTitle: string;
  }>;
  controls: {
    mode: 'off' | 'readOnly' | 'confirmWrite' | 'auto';
    sensitiveWritePolicy: 'deny' | 'confirm' | 'allow';
  };
  relationship: {
    supportMode: 'efficient' | 'coach' | 'companion' | 'auto';
    proactiveEnabled: boolean;
    quietStart?: string;
    quietEnd?: string;
    allowedTopics: string[];
    blockedTopics: string[];
    updatedAt: number;
  };
  trust: {
    defaultActionLevel: UserTrustLevel;
    levels: UserTrustLevel[];
    autoRequiresExplicitOptIn: boolean;
  };
};

export type RelationshipSettingsPatch = Partial<Omit<
  UserContextResponse['relationship'],
  'updatedAt' | 'quietStart' | 'quietEnd'
>> & {
  quietStart?: string | null;
  quietEnd?: string | null;
};

export type ReferenceConsent = {
  id: string;
  recordId: string;
  sessionKey: string;
  purpose: string;
  statement: string;
  sourceName: string;
  status: 'pending' | 'granted' | 'denied' | 'consumed';
  grantScope?: 'once' | 'session' | 'always';
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export function fetchUserContext(): Promise<UserContextResponse> {
  return fetchJson<UserContextResponse>(apiUrl('/api/you'));
}

export function updateRelationshipSettings(
  patch: RelationshipSettingsPatch,
) {
  return fetchJson<{ ok: true; relationship: UserContextResponse['relationship'] }>(
    apiUrl('/api/you/relationship'),
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function updateConnectedClaim(id: string, action: 'confirm' | 'reject'): Promise<ConnectedClaim> {
  const response = await fetchJson<{ ok: true; claim: ConnectedClaim }>(apiUrl(`/api/you/claims/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
  return response.claim;
}

export function setPersonalPlaybookEnabled(id: PersonalPlaybook['id'], enabled: boolean) {
  return fetchJson<{ ok: true; playbook: PersonalPlaybook }>(apiUrl(`/api/you/playbooks/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function createPersonalPlaybookRule(id: PersonalPlaybook['id'], statement: string, order?: number) {
  return fetchJson(apiUrl(`/api/you/playbooks/${id}/rules`), {
    method: 'POST',
    body: JSON.stringify({ statement, order }),
  });
}

export function updatePersonalPlaybookRule(
  id: PersonalPlaybook['id'],
  ruleId: string,
  patch: {
    statement?: string;
    enabled?: boolean;
    order?: number;
    context?: { channel?: string | null; supportNeed?: string | null };
  },
) {
  return fetchJson(apiUrl(`/api/you/playbooks/${id}/rules/${encodeURIComponent(ruleId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deletePersonalPlaybookRule(id: PersonalPlaybook['id'], ruleId: string) {
  return fetchJson(apiUrl(`/api/you/playbooks/${id}/rules/${encodeURIComponent(ruleId)}`), { method: 'DELETE' });
}

export function rollbackPersonalPlaybookRule(id: PersonalPlaybook['id'], ruleId: string, versionId: string) {
  return fetchJson(apiUrl(`/api/you/playbooks/${id}/rules/${encodeURIComponent(ruleId)}/rollback`), {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
}

export function updateInsightSuggestion(
  id: string,
  input: { action: 'apply' | 'complete' | 'dismiss'; uiLocale?: 'en' | 'zh' },
): Promise<{ ok: true; status: 'queued' | 'saved' | 'dismissed' | 'drafting'; href?: string }> {
  return fetchJson(apiUrl(`/api/you/insights/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function updateUnderstanding(
  id: string,
  input: { action: 'confirm' | 'reject' | 'update'; content?: string },
): Promise<UserUnderstanding> {
  const response = await fetchJson<{ understanding: UserUnderstanding }>(
    apiUrl(`/api/you/understanding/${encodeURIComponent(id)}`),
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.understanding;
}

export function forgetUnderstanding(id: string): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(apiUrl(`/api/you/understanding/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
}

export function createUnderstanding(input: {
  content: string;
  kind: string;
  sensitivity?: UserUnderstanding['sensitivity'];
  durability?: UserUnderstanding['durability'];
  disclosurePolicy?: UserUnderstanding['disclosurePolicy'];
}): Promise<UserUnderstanding> {
  return fetchJson<{ understanding: UserUnderstanding }>(apiUrl('/api/you/understanding'), {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => response.understanding);
}

export function batchUpdateUnderstanding(ids: string[], action: 'confirm' | 'reject' | 'forget') {
  return fetchJson<{ ok: true; updatedCount: number }>(apiUrl('/api/you/understanding/batch'), {
    method: 'POST',
    body: JSON.stringify({ ids, action }),
  });
}

export function fetchUnderstandingHistory(id: string) {
  return fetchJson<{ history: Array<UserUnderstanding & { storedStatus: string }> }>(
    apiUrl(`/api/you/understanding/${encodeURIComponent(id)}/history`),
  );
}

export function resolveUnderstandingConflict(groupId: string, winnerId: string) {
  return fetchJson<{ ok: true; understanding: UserUnderstanding }>(
    apiUrl(`/api/you/conflicts/${encodeURIComponent(groupId)}/resolve`),
    { method: 'POST', body: JSON.stringify({ winnerId }) },
  );
}

export function decideReferenceConsent(
  id: string,
  decision: 'once' | 'session' | 'always' | 'deny',
): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/you/consents/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify({ decision }),
  });
}

export function revokeReferenceConsent(id: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/you/consents/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export function disconnectPersonalContextSource(
  instanceId: string,
  deleteDerivedUnderstanding: boolean,
): Promise<{ ok: true; deletedUnderstandingCount: number }> {
  return fetchJson(apiUrl(`/api/you/sources/${encodeURIComponent(instanceId)}`), {
    method: 'DELETE',
    body: JSON.stringify({ deleteDerivedUnderstanding }),
  });
}

export function updateUserContextControls(
  controls: UserContextResponse['controls'],
): Promise<UserContextResponse['controls']> {
  return fetchJson<{ controls: UserContextResponse['controls'] }>(apiUrl('/api/you/controls'), {
    method: 'PATCH',
    body: JSON.stringify(controls),
  }).then((response) => response.controls);
}

export function updateUserTrust(defaultActionLevel: UserTrustLevel): Promise<UserContextResponse['trust']> {
  return fetchJson<{ trust: UserContextResponse['trust'] }>(apiUrl('/api/you/trust'), {
    method: 'PATCH',
    body: JSON.stringify({ defaultActionLevel }),
  }).then((response) => response.trust);
}

export function updateUserProfile(
  patch: Partial<UserProfileFields>,
): Promise<Pick<UserContextResponse, 'profile' | 'profileContent' | 'profileSetup'>> {
  return fetchJson(apiUrl('/api/you/profile'), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function fetchUserProfile(): Promise<Pick<UserContextResponse, 'profile' | 'profileContent' | 'profileSetup'>> {
  return fetchJson(apiUrl('/api/you/profile'));
}

export function updateUserProfilePrompt(action: 'snooze' | 'reset'): Promise<{ profileSetup: UserProfileSetup }> {
  return fetchJson(apiUrl('/api/you/profile-prompt'), {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

export type UserContextExport = {
  version: 2;
  exportedAt: string;
  profile: UserProfileFields;
  understanding: Array<{
    statement: string;
    kind: string;
    status: string;
    sensitivity: UserUnderstanding['sensitivity'];
    durability: UserUnderstanding['durability'];
    disclosurePolicy: UserUnderstanding['disclosurePolicy'];
    sourceName: string;
    updatedAt: string;
  }>;
};

export function exportUserContext(): Promise<UserContextExport> {
  return fetchJson(apiUrl('/api/you/export'));
}

export function importUserContext(payload: unknown): Promise<{ ok: true; importedCount: number; skippedCount: number }> {
  return fetchJson(apiUrl('/api/you/import'), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
