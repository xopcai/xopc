import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type Scope = { type: 'global' | 'agent' | 'workspace' | 'project' | 'session'; id?: string };
export type AssertionStatus = 'candidate' | 'active' | 'needs_review' | 'conflicted' | 'stale' | 'archived' | 'rejected';

export type UserAssertion = {
  id: string;
  predicate: string;
  statement: string;
  kind: 'identity' | 'preference' | 'value' | 'routine' | 'capability' | 'relationship' | 'current_state' | 'derived_insight';
  status: AssertionStatus;
  authority: 'user_explicit' | 'user_observed' | 'system_inferred' | 'external_untrusted';
  confidence: number;
  declaredImportance?: number;
  inferredImportance: number;
  consequence: 'low' | 'medium' | 'high' | 'critical';
  actionability: number;
  volatility: 'stable' | 'slow' | 'dynamic' | 'event';
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  validFrom?: number;
  validTo?: number;
  reviewAt?: number;
  observedAt: number;
  recordedAt: number;
  createdAt: number;
  createdBy: 'user' | 'runtime' | 'connector' | 'maintenance' | 'migration';
  scope: Scope;
};

export type UserGoal = {
  id: string;
  title: string;
  desiredOutcome: string;
  status: 'proposed' | 'active' | 'paused' | 'achieved' | 'abandoned';
  scope: Scope;
  declaredImportance?: number;
  targetAt?: number;
  reviewAt?: number;
};

export type PriorityWindow = {
  id: string;
  targetType: 'goal' | 'project' | 'task' | 'assertion' | 'topic';
  targetId: string;
  rank: 'primary' | 'secondary' | 'background';
  urgency: number;
  status: 'active' | 'paused' | 'completed' | 'expired';
  validFrom: number;
  validTo: number;
};

export type CollaborationRule = {
  id: string;
  statement: string;
  category: string;
  status: 'active' | 'disabled' | 'archived';
  priority: number;
  scope: Scope;
};

export type KnowledgeItem = {
  id: string;
  content: string;
  recordClass: 'memory' | 'source_index';
  kind: 'project_fact' | 'workspace_fact' | 'decision' | 'task_lesson' | 'commitment' | 'open_question' | 'episode' | 'note';
  status: Exclude<AssertionStatus, 'conflicted'>;
  scope: Scope;
  confidence: number;
  importance: number;
  validTo?: number;
  expiresAt?: number;
  reviewAt?: number;
  originClass?: 'owner' | 'agent' | 'system' | 'untrusted';
  sourceAgentId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type UserModelResponse = {
  profile: { callName?: unknown; pronouns?: unknown; timezone?: unknown; locale?: unknown; role?: unknown };
  suggestedCallName?: unknown;
  assertions: UserAssertion[];
  goals: UserGoal[];
  priorities: PriorityWindow[];
  rules: CollaborationRule[];
  knowledge: KnowledgeItem[];
  maintenance: { lastRun: { jobType: string; status: string; startedAt: number; finishedAt?: number } | null };
  counts: {
    activeAssertions: number;
    reviewAssertions: number;
    activeGoals: number;
    activePriorities: number;
    activeKnowledge: number;
  };
};

export type UserProfile = {
  callName: string;
  role: string;
  pronouns: string;
  timezone: string;
  locale: string;
};

export function fetchUserModel(): Promise<UserModelResponse> {
  return fetchJson(apiUrl('/api/user-model'));
}

export async function fetchUserProfile(): Promise<{ profile: UserProfile; suggestedCallName?: string }> {
  const model = await fetchUserModel();
  return {
    profile: {
      callName: typeof model.profile.callName === 'string' ? model.profile.callName : '',
      role: typeof model.profile.role === 'string' ? model.profile.role : '',
      pronouns: typeof model.profile.pronouns === 'string' ? model.profile.pronouns : '',
      timezone: typeof model.profile.timezone === 'string' ? model.profile.timezone : '',
      locale: typeof model.profile.locale === 'string' ? model.profile.locale : '',
    },
    ...(typeof model.suggestedCallName === 'string'
      ? { suggestedCallName: model.suggestedCallName }
      : {}),
  };
}

export async function updateUserProfile(input: Partial<UserProfile>): Promise<UserProfile> {
  const result = await fetchJson<{ profile: Partial<UserProfile> }>(apiUrl('/api/user-model/profile'), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return {
    callName: result.profile.callName ?? '',
    role: result.profile.role ?? '',
    pronouns: result.profile.pronouns ?? '',
    timezone: result.profile.timezone ?? '',
    locale: result.profile.locale ?? '',
  };
}

export type UserModelBootstrapInput = {
  profile: Partial<UserProfile>;
  responsibilities?: string[];
  goals?: string[];
  communicationPreferences?: string[];
  boundaries?: string[];
  relationships?: string[];
};

export function bootstrapUserModel(input: UserModelBootstrapInput): Promise<unknown> {
  return fetchJson(apiUrl('/api/user-model/bootstrap'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function detectBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function setAssertionStatus(id: string, status: AssertionStatus): Promise<unknown> {
  return fetchJson(apiUrl(`/api/user-model/assertions/${encodeURIComponent(id)}/status`), {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
}

export function correctAssertion(id: string, statement: string): Promise<unknown> {
  return fetchJson(apiUrl(`/api/user-model/assertions/${encodeURIComponent(id)}`), {
    method: 'PATCH', body: JSON.stringify({ statement }),
  });
}

export function setGoalStatus(id: string, status: UserGoal['status']): Promise<unknown> {
  return fetchJson(apiUrl(`/api/user-model/goals/${encodeURIComponent(id)}/status`), {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
}

export function setRuleStatus(id: string, status: CollaborationRule['status']): Promise<unknown> {
  return fetchJson(apiUrl(`/api/user-model/rules/${encodeURIComponent(id)}/status`), {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
}

export function setKnowledgeStatus(id: string, status: AssertionStatus): Promise<unknown> {
  return fetchJson(apiUrl(`/api/knowledge-memory/${encodeURIComponent(id)}/status`), {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
}
