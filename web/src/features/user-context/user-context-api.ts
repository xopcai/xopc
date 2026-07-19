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
  status: 'active' | 'candidate' | 'needs_review';
  origin: UserContextOrigin;
  sourceName: string;
  updatedAt: string;
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  explicitness: 'explicit' | 'observed' | 'inferred';
  durability: 'ephemeral' | 'durable' | 'recurring';
  canReference: boolean;
  stability: 'strong' | 'working' | 'fragile';
  stabilityScore: number;
  reviewAt: string;
  reviewDue: boolean;
  evidenceCount: number;
  sourcePath?: string;
};

export type PersonalContextSource = {
  id: string;
  displayName: string;
  description: string;
  category: string;
  capabilities: string[];
  installed: boolean;
  enabled: boolean;
  status: string;
  instanceId?: string;
  lastConnectedAt?: string;
};

export type InsightSuggestion = {
  id: string;
  insight: string;
  kind: string;
  action: 'make_repeatable' | 'start_progress';
  evidenceCount: number;
  confidence?: number;
  sourceName: string;
};

export type PersonalPlaybook = {
  id: 'communication' | 'execution' | 'routines';
  enabled: boolean;
  rules: Array<{ id: string; statement: string; origin: 'explicit' | 'observed' | 'inferred' }>;
  updatedAt?: string;
};

export type UserContextResponse = {
  agentId: string;
  profileContent: string;
  profile: UserProfileFields;
  profileSetup: UserProfileSetup;
  understanding: UserUnderstanding[];
  insights: InsightSuggestion[];
  playbooks: PersonalPlaybook[];
  sources: PersonalContextSource[];
  controls: {
    mode: 'off' | 'readOnly' | 'confirmWrite' | 'auto';
    sensitiveWritePolicy: 'deny' | 'confirm' | 'allow';
    crossAgentSharing: 'deny' | 'readOnly' | 'allow';
  };
  trust: {
    defaultActionLevel: UserTrustLevel;
    levels: UserTrustLevel[];
    autoRequiresExplicitOptIn: boolean;
  };
};

export function fetchUserContext(): Promise<UserContextResponse> {
  return fetchJson<UserContextResponse>(apiUrl('/api/you'));
}

export function setPersonalPlaybookEnabled(id: PersonalPlaybook['id'], enabled: boolean) {
  return fetchJson<{ ok: true; playbook: PersonalPlaybook }>(apiUrl(`/api/you/playbooks/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function updateInsightSuggestion(
  id: string,
  input: { action: 'apply' | 'dismiss'; uiLocale?: 'en' | 'zh' },
): Promise<{ ok: true; status: 'queued' | 'saved' | 'dismissed'; href?: string }> {
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
