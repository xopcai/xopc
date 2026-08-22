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
  kind: UnderstandingKind;
  status: UnderstandingStatus;
  scope: UserContextScope;
  explicitness: 'explicit' | 'observed' | 'inferred';
  durability: 'ephemeral' | 'durable' | 'recurring';
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  disclosurePolicy: 'silent' | 'referenceable' | 'ask_before_reference';
  confidence: number;
  statement: string;
  versionId: string;
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

export type UserContextResponse = {
  profile: UserProfile;
  understandings: UserUnderstanding[];
  rules: CollaborationRule[];
  consolidation: { lastRun: ContextConsolidationRun | null };
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

export type UserFocus = {
  id: string;
  title: string;
  summary: string;
  horizon: 'current' | 'ongoing' | 'long_term';
  status: 'candidate' | 'active' | 'paused' | 'completed' | 'rejected';
  confidence: number;
  updatedAt: number;
};

export function detectBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function fetchUserContext(): Promise<UserContextResponse> {
  return fetchJson(apiUrl('/api/you'));
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

export function deleteUnderstanding(id: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/you/understandings/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export function createCollaborationRule(input: { statement: string; category: CollaborationRule['category']; priority?: number; scope?: UserContextScope }): Promise<{ rule: CollaborationRule }> {
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

export async function fetchUnderstandingSourceGrants(): Promise<UnderstandingSourceGrant[]> {
  const response = await fetchJson<{ grants: UnderstandingSourceGrant[] }>(apiUrl('/api/understanding/sources/grants'));
  return response.grants;
}

export function revokeUnderstandingSourceGrant(grantId: string): Promise<{ grant: UnderstandingSourceGrant }> {
  return fetchJson(apiUrl(`/api/understanding/sources/grants/${encodeURIComponent(grantId)}?deleteDerived=true`), { method: 'DELETE' });
}

export function refreshUnderstandingSourceGrant(grantId: string): Promise<unknown> {
  return fetchJson(apiUrl(`/api/understanding/sources/grants/${encodeURIComponent(grantId)}/refresh`), { method: 'POST' });
}

export async function fetchUserFocuses(): Promise<UserFocus[]> {
  const response = await fetchJson<{ focuses: UserFocus[] }>(apiUrl('/api/understanding/focuses'));
  return response.focuses;
}

export function updateUserFocusStatus(focusId: string, status: UserFocus['status']): Promise<{ focus: UserFocus }> {
  return fetchJson(apiUrl(`/api/understanding/focuses/${encodeURIComponent(focusId)}`), {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
