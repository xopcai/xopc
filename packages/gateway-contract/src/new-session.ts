export const NEW_SESSION_PREFERENCES_VERSION = 1 as const;

export type ChatProjectScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'none' };

export type NewSessionProjectIntent =
  | ChatProjectScope
  | { kind: 'inherit-current' }
  | { kind: 'remember-last' };

export type AgentModelPreference = {
  modelRef: string;
  thinkingLevel?: string;
};

export type NewSessionPreferences = {
  version: typeof NEW_SESSION_PREFERENCES_VERSION;
  selectedAgentId?: string;
  modelByAgent: Record<string, AgentModelPreference>;
  lastChatScope: ChatProjectScope;
};

export type NewSessionContext = {
  currentSession?: {
    agentId?: string | null;
    projectId?: string | null;
  } | null;
  projectDefaultAgentId?: string | null;
  selectedAgentId?: string | null;
  defaultAgentId: string;
  lastChatScope?: ChatProjectScope | null;
};

export type NewSessionIntent = {
  origin: string;
  project: NewSessionProjectIntent;
  agentId?: string | null;
  forceNew?: boolean;
  temporary?: boolean;
};

export type ResolvedNewSessionSpec = {
  origin: string;
  agentId: string;
  projectId: string | null;
  forceNew: boolean;
  temporary: boolean;
};

function normalized(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function normalizedAgentId(value: string | null | undefined): string | undefined {
  return normalized(value)?.toLowerCase();
}

export function noProjectScope(): ChatProjectScope {
  return { kind: 'none' };
}

export function projectScope(projectId: string): ChatProjectScope {
  const normalizedProjectId = normalized(projectId);
  return normalizedProjectId
    ? { kind: 'project', projectId: normalizedProjectId }
    : noProjectScope();
}

export function createDefaultNewSessionPreferences(): NewSessionPreferences {
  return {
    version: NEW_SESSION_PREFERENCES_VERSION,
    modelByAgent: {},
    lastChatScope: noProjectScope(),
  };
}

function parseProjectScope(value: unknown): ChatProjectScope | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'none') return noProjectScope();
  if (record.kind !== 'project' || typeof record.projectId !== 'string') return null;
  const projectId = normalized(record.projectId);
  return projectId ? { kind: 'project', projectId } : null;
}

function parseModelPreferences(value: unknown): Record<string, AgentModelPreference> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, AgentModelPreference> = {};
  for (const [rawAgentId, rawPreference] of Object.entries(value)) {
    const agentId = normalizedAgentId(rawAgentId);
    if (!agentId || !rawPreference || typeof rawPreference !== 'object') continue;
    const record = rawPreference as Record<string, unknown>;
    const modelRef = typeof record.modelRef === 'string' ? normalized(record.modelRef) : undefined;
    if (!modelRef) continue;
    const thinkingLevel = typeof record.thinkingLevel === 'string'
      ? normalized(record.thinkingLevel)
      : undefined;
    result[agentId] = {
      modelRef,
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
  }
  return result;
}

export function parseNewSessionPreferences(value: unknown): NewSessionPreferences {
  const fallback = createDefaultNewSessionPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  if (record.version !== NEW_SESSION_PREFERENCES_VERSION) return fallback;
  const selectedAgentId = typeof record.selectedAgentId === 'string'
    ? normalizedAgentId(record.selectedAgentId)
    : undefined;
  return {
    version: NEW_SESSION_PREFERENCES_VERSION,
    ...(selectedAgentId ? { selectedAgentId } : {}),
    modelByAgent: parseModelPreferences(record.modelByAgent),
    lastChatScope: parseProjectScope(record.lastChatScope) ?? noProjectScope(),
  };
}

export function withSelectedAgent(
  preferences: NewSessionPreferences,
  agentId: string | null | undefined,
): NewSessionPreferences {
  const selectedAgentId = normalizedAgentId(agentId);
  const { selectedAgentId: _current, ...rest } = preferences;
  return selectedAgentId ? { ...rest, selectedAgentId } : rest;
}

export function withAgentModelPreference(
  preferences: NewSessionPreferences,
  agentId: string,
  preference: AgentModelPreference | null,
): NewSessionPreferences {
  const normalizedId = normalizedAgentId(agentId);
  if (!normalizedId) return preferences;
  const modelByAgent = { ...preferences.modelByAgent };
  const modelRef = preference ? normalized(preference.modelRef) : undefined;
  if (!preference || !modelRef) {
    delete modelByAgent[normalizedId];
  } else {
    const thinkingLevel = normalized(preference.thinkingLevel);
    modelByAgent[normalizedId] = {
      modelRef,
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
  }
  return { ...preferences, modelByAgent };
}

export function withLastChatScope(
  preferences: NewSessionPreferences,
  projectId: string | null | undefined,
): NewSessionPreferences {
  const normalizedProjectId = normalized(projectId);
  return {
    ...preferences,
    lastChatScope: normalizedProjectId
      ? { kind: 'project', projectId: normalizedProjectId }
      : noProjectScope(),
  };
}

export function modelPreferenceForAgent(
  preferences: NewSessionPreferences,
  agentId: string,
): AgentModelPreference | undefined {
  const normalizedId = normalizedAgentId(agentId);
  return normalizedId ? preferences.modelByAgent[normalizedId] : undefined;
}

export function resolveProjectScope(
  intent: NewSessionProjectIntent,
  context: Pick<NewSessionContext, 'currentSession' | 'lastChatScope'>,
): ChatProjectScope {
  if (intent.kind === 'project') return projectScope(intent.projectId);
  if (intent.kind === 'none') return noProjectScope();
  if (intent.kind === 'inherit-current') {
    return projectScope(context.currentSession?.projectId ?? '');
  }
  return context.lastChatScope?.kind === 'project'
    ? projectScope(context.lastChatScope.projectId)
    : noProjectScope();
}

export function resolveNewSessionSpec(
  intent: NewSessionIntent,
  context: NewSessionContext,
): ResolvedNewSessionSpec {
  const scope = resolveProjectScope(intent.project, context);
  const agentId = normalizedAgentId(intent.agentId)
    ?? (intent.project.kind === 'inherit-current'
      ? normalizedAgentId(context.currentSession?.agentId)
      : undefined)
    ?? normalizedAgentId(context.projectDefaultAgentId)
    ?? normalizedAgentId(context.selectedAgentId)
    ?? normalizedAgentId(context.defaultAgentId)
    ?? 'main';
  return {
    origin: intent.origin,
    agentId,
    projectId: scope.kind === 'project' ? scope.projectId : null,
    forceNew: intent.forceNew === true,
    temporary: intent.temporary === true,
  };
}

export function newSessionCacheKey(
  gatewayId: string,
  spec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>,
): string {
  return [
    normalized(gatewayId) ?? 'default',
    normalizedAgentId(spec.agentId) ?? 'main',
    normalized(spec.projectId) ?? 'none',
  ].join(':');
}
