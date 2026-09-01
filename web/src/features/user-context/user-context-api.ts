import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { fetchGatewayConfigSwrResponse, revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';

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

export type UnderstandingKind =
  | 'preference' | 'boundary' | 'relationship' | 'routine' | 'current_state'
  | 'long_term_goal' | 'project_context' | 'task_lesson' | 'derived_insight';

export type UnderstandingStatus = 'candidate' | 'active' | 'needs_review' | 'stale' | 'archived' | 'rejected';

export type UserUnderstanding = {
  id: string;
  canonicalKey?: string;
  kind: UnderstandingKind;
  status: UnderstandingStatus;
  scope: UserContextScope;
  explicitness: 'explicit' | 'observed' | 'inferred';
  durability: 'ephemeral' | 'durable' | 'recurring';
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  disclosurePolicy: 'silent' | 'referenceable' | 'ask_before_reference';
  confidence: number;
  statement: string;
  payload?: Record<string, unknown>;
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

export type ContextEvidence = {
  id: string;
  sourceType: 'conversation' | 'connector' | 'user' | 'runtime';
  sourceInstanceId?: string;
  sourceRef: string;
  sourceRunId?: string;
  sourceItemId?: string;
  sessionId?: string;
  turnId?: string;
  messageId?: string;
  contentHash?: string;
  retentionPolicy?: 'metadata_only' | 'derived_only' | 'bounded_raw';
  processingPolicy?: 'local_only' | 'remote_allowed';
  extractorId?: string;
  extractorVersion?: string;
  redactedExcerpt?: string;
  trustLevel: 'owner' | 'trusted' | 'untrusted';
  observedAt: number;
  ingestedAt: number;
  createdAt: number;
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

export type UserContextResponse = {
  profile: UserProfile;
  understandings: UserUnderstanding[];
  focuses: UserFocus[];
  rules: CollaborationRule[];
  consolidation: { lastRun: ContextConsolidationRun | null };
};

export type UserPersonKind = 'person' | 'bot' | 'service' | 'group' | 'unknown';

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
  handles: Array<{
    id: string;
    type: 'email' | 'provider_user' | 'username' | 'display_name';
    value: string;
    sourceInstanceId: string;
    verification: 'observed' | 'inferred' | 'user_confirmed';
    firstObservedAt: number;
    lastObservedAt: number;
  }>;
  sources: Array<{
    sourceInstanceId: string;
    connectorId?: string;
    toolkit?: string;
    interactionCount: number;
    firstObservedAt: number;
    lastObservedAt: number;
  }>;
  relationshipUnderstanding?: {
    id: string;
    statement: string;
    status: UnderstandingStatus;
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

export type UserRelationshipsResponse = {
  items: UserPerson[];
  summary: UserRelationshipSummary;
  total: number;
  nextCursor?: string;
};

export type ContextConsolidationRun = {
  runId: string;
  triggerKind: 'schedule' | 'manual';
  status: 'running' | 'completed' | 'failed';
  reason?: string;
  metrics: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
};

export type UserContextSettings = {
  dreaming: {
    mode: 'off' | 'review';
    timezone?: string;
    schedule: { time: string };
    minEvidenceSources: number;
    limit: number;
  };
  privacy: { sensitiveWritePolicy: 'deny' | 'confirm' | 'allow' };
};

export type UnderstandingSourceGrant = {
  id: string;
  sourceKey: string;
  adapterId: string;
  category: string;
  platform: 'darwin' | 'win32' | 'linux' | 'all';
  displayName: string;
  status: 'active' | 'revoked';
  accessMode: 'once' | 'continuous';
  retentionPolicy: 'metadata_only' | 'derived_only' | 'bounded_raw';
  processingPolicy: 'local_only' | 'remote_allowed';
  lastCollectedAt?: number;
  updatedAt: number;
};

export type UnderstandingSourceRun = {
  id: string;
  grantId: string;
  kind: 'preview' | 'bootstrap' | 'incremental' | 'fingerprint';
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'canceled';
  itemsSeen: number;
  metadata: Record<string, unknown>;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
};

export type ConnectedContentCandidate = {
  sourceItemId: string;
  sourceInstanceId: string;
  toolkit: 'gmail' | 'googledrive';
  title: string;
  occurredAt?: string;
  mimeType?: string;
};

export type UserFocus = {
  id: string;
  versionId: string;
  principalId: string;
  canonicalKey?: string;
  title: string;
  summary: string;
  horizon: 'current' | 'ongoing' | 'long_term';
  status: 'candidate' | 'active' | 'paused' | 'completed' | 'rejected';
  confidence: number;
  scope: UserContextScope;
  explicitness: UserUnderstanding['explicitness'];
  sensitivity: UserUnderstanding['sensitivity'];
  disclosurePolicy: UserUnderstanding['disclosurePolicy'];
  validFrom?: number;
  validTo?: number;
  reviewAt?: number;
  evidenceRefs: string[];
  sourceRunId?: string;
  createdAt: number;
  updatedAt: number;
};

export function detectBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function fetchUserContext(): Promise<UserContextResponse> {
  return fetchJson(apiUrl('/api/you'));
}

export function fetchUserRelationships(options: {
  query?: string;
  kind?: UserPersonKind;
  sourceInstanceId?: string;
  includeHidden?: boolean;
  hiddenOnly?: boolean;
  cursor?: string;
  limit?: number;
} = {}): Promise<UserRelationshipsResponse> {
  const params = new URLSearchParams();
  if (options.query) params.set('q', options.query);
  if (options.kind) params.set('kind', options.kind);
  if (options.sourceInstanceId) params.set('source', options.sourceInstanceId);
  if (options.includeHidden) params.set('includeHidden', 'true');
  if (options.hiddenOnly) params.set('hidden', 'true');
  if (options.cursor) params.set('cursor', options.cursor);
  params.set('limit', String(options.limit ?? 30));
  return fetchJson(apiUrl(`/api/you/relationships?${params.toString()}`));
}

export async function fetchUserRelationship(personId: string): Promise<UserPerson> {
  const response = await fetchJson<{ person: UserPerson }>(apiUrl(`/api/you/relationships/${encodeURIComponent(personId)}`));
  return response.person;
}

export async function updateUserRelationship(personId: string, patch: {
  displayName?: string | null;
  kind?: UserPersonKind | null;
  hidden?: boolean;
}): Promise<UserPerson> {
  const response = await fetchJson<{ person: UserPerson }>(apiUrl(`/api/you/relationships/${encodeURIComponent(personId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.person;
}

export async function mergeUserRelationships(sourcePersonId: string, targetPersonId: string): Promise<UserPerson> {
  const response = await fetchJson<{ person: UserPerson }>(apiUrl('/api/you/relationships/merge'), {
    method: 'POST',
    body: JSON.stringify({ sourcePersonId, targetPersonId }),
  });
  return response.person;
}

export async function fetchUserContextSettings(): Promise<UserContextSettings> {
  const response = await fetchGatewayConfigSwrResponse();
  const config = response.payload?.config as { userContext?: Partial<UserContextSettings> } | undefined;
  const dreaming = config?.userContext?.dreaming;
  const privacy = config?.userContext?.privacy;
  return {
    dreaming: {
      mode: dreaming?.mode === 'off' ? 'off' : 'review',
      ...(typeof dreaming?.timezone === 'string' ? { timezone: dreaming.timezone } : {}),
      schedule: { time: dreaming?.schedule?.time ?? '03:00' },
      minEvidenceSources: dreaming?.minEvidenceSources ?? 2,
      limit: dreaming?.limit ?? 500,
    },
    privacy: {
      sensitiveWritePolicy: privacy?.sensitiveWritePolicy ?? 'confirm',
    },
  };
}

export async function updateUserContextSettings(patch: Partial<UserContextSettings>): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ userContext: patch }),
  });
  await revalidateGatewayConfig();
}

export async function fetchUserProfile(): Promise<{ profile: UserProfile; suggestedCallName?: string }> {
  return fetchJson(apiUrl('/api/you/profile'));
}

export function updateUserProfile(patch: Partial<Pick<UserProfile, 'callName' | 'role' | 'primaryGoal' | 'pronouns' | 'timezone' | 'locale' | 'accessibility'>>): Promise<{ profile: UserProfile }> {
  return fetchJson(apiUrl('/api/you/profile'), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function createUnderstanding(input: { statement: string; kind: UnderstandingKind; scope?: UserContextScope }): Promise<{ understanding: UserUnderstanding }> {
  return fetchJson(apiUrl('/api/you/understandings'), {
    method: 'POST',
    body: JSON.stringify({ ...input, scope: input.scope ?? { type: 'global' } }),
  });
}

export function updateUnderstanding(id: string, patch: { statement?: string; status?: UnderstandingStatus; reason?: string }): Promise<{ understanding: UserUnderstanding }> {
  return fetchJson(apiUrl(`/api/you/understandings/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function fetchUnderstandingEvidence(id: string): Promise<{ evidence: ContextEvidence[] }> {
  return fetchJson(apiUrl(`/api/you/understandings/${encodeURIComponent(id)}/evidence`));
}

export function deleteUnderstanding(id: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/you/understandings/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export function createCollaborationRule(input: {
  statement: string;
  category: CollaborationRule['category'];
  priority?: number;
  scope?: UserContextScope;
  conditions?: Record<string, unknown>;
}): Promise<{ rule: CollaborationRule }> {
  return fetchJson(apiUrl('/api/you/rules'), {
    method: 'POST',
    body: JSON.stringify({ ...input, scope: input.scope ?? { type: 'global' } }),
  });
}

export function updateCollaborationRule(id: string, patch: { statement?: string; status?: CollaborationRule['status'] }): Promise<{ rule: CollaborationRule }> {
  return fetchJson(apiUrl(`/api/you/rules/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteCollaborationRule(id: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/you/rules/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function fetchUnderstandingSourceOverview(): Promise<{
  grants: UnderstandingSourceGrant[];
  latestRuns: Record<string, UnderstandingSourceRun>;
}> {
  const response = await fetchJson<{
    grants: UnderstandingSourceGrant[];
    latestRuns?: Record<string, UnderstandingSourceRun>;
  }>(apiUrl('/api/understanding/sources/grants'));
  return { grants: response.grants, latestRuns: response.latestRuns ?? {} };
}

export async function fetchConnectedContentCandidates(): Promise<ConnectedContentCandidate[]> {
  const response = await fetchJson<{ candidates: ConnectedContentCandidate[] }>(
    apiUrl('/api/understanding/sources/content-candidates'),
  );
  return response.candidates;
}

export function readConnectedContent(sourceItemIds: string[]): Promise<{
  result: { requested: number; completed: number; failed: Array<{ sourceItemId: string; error: string }> };
}> {
  return fetchJson(apiUrl('/api/understanding/sources/content-reads'), {
    method: 'POST',
    body: JSON.stringify({ sourceItemIds }),
  });
}

export type SourceRevocationImpact = {
  derivedCount: number;
  understandingCount: number;
  focusCount: number;
  memoryRecordCount: number;
  boundedRawCount: number;
};

export function fetchUnderstandingSourceRevocationImpact(grantId: string): Promise<{ impact: SourceRevocationImpact }> {
  return fetchJson(apiUrl(`/api/understanding/sources/grants/${encodeURIComponent(grantId)}/impact`));
}

export function revokeUnderstandingSourceGrant(
  grantId: string,
  options: { derived: 'delete' | 'retain'; raw: 'delete' | 'retain' },
): Promise<{ grant: UnderstandingSourceGrant; impact: SourceRevocationImpact }> {
  const query = new URLSearchParams(options);
  return fetchJson(apiUrl(`/api/understanding/sources/grants/${encodeURIComponent(grantId)}?${query}`), { method: 'DELETE' });
}

export function refreshUnderstandingSourceGrant(grantId: string): Promise<unknown> {
  return fetchJson(apiUrl(`/api/understanding/sources/grants/${encodeURIComponent(grantId)}/refresh`), { method: 'POST' });
}

export function updateUserFocus(
  focusId: string,
  patch: Partial<Pick<UserFocus, 'title' | 'summary' | 'status'>>,
): Promise<{ focus: UserFocus }> {
  return fetchJson(apiUrl(`/api/understanding/focuses/${encodeURIComponent(focusId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export type ContextReviewDecision = {
  objectType: 'focus' | 'understanding';
  objectId: string;
  action: 'accept' | 'reject' | 'pause';
};

export function batchReviewContextObjects(decisions: ContextReviewDecision[]): Promise<{ objects: unknown[] }> {
  return fetchJson(apiUrl('/api/you/context-objects/batch-review'), {
    method: 'POST',
    body: JSON.stringify({ decisions }),
  });
}
