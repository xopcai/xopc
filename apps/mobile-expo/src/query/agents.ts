import { useQuery } from '@tanstack/react-query';

import { agentsResponseSchema } from '../config/schema';
import { apiFetch, formatApiHttpError } from '../api/client';
import {
  readCachedAgents,
  writeCachedAgents,
} from '../features/gateway/agents-cache';
import { useGatewayStore } from '../stores/gateway-store';
import { queryKeys } from './keys';
import { usePreferencesStore } from '../stores/preferences-store';

export type AgentModelInfo = { primary?: string; fallbacks?: string[] };

export type AgentModelIntentsInfo = {
  effective: string[];
  overrides: string[];
};

export type AgentSkillsInfo = {
  mode?: 'all-enabled' | 'selected';
  allowlist?: string[];
  excluded: string[];
  overrides: string[];
};

export type AgentToolsInfo = {
  denied: string[];
  overrides: string[];
};

export type ChatAgentOption = {
  id: string;
  name?: string;
  description?: string;
  language?: string;
  avatar?: string;
  workspace?: string;
  profileDir?: string;
  model?: AgentModelInfo;
  modelIntents: AgentModelIntentsInfo;
  isDefault?: boolean;
  skills: AgentSkillsInfo;
  tools: AgentToolsInfo;
};

export type ChatAgentsPayload = {
  defaultId: string;
  items: ChatAgentOption[];
  builtinToolIds: string[];
};

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const v = stringOrUndefined(item);
    return v ? [v] : [];
  });
}

function modelInfo(value: unknown): AgentModelInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { primary?: unknown; fallbacks?: unknown };
  const primary = stringOrUndefined(raw.primary);
  const fallbacks = stringArray(raw.fallbacks);
  if (!primary && fallbacks.length === 0) return undefined;
  return { ...(primary ? { primary } : {}), ...(fallbacks.length ? { fallbacks } : {}) };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function modelIntentsInfo(value: unknown): AgentModelIntentsInfo {
  const raw = objectRecord(value);
  const effectiveModels = objectRecord(objectRecord(raw.effective).models);
  const overrideModels = objectRecord(objectRecord(raw.override).models);
  const effective = Object.keys(objectRecord(effectiveModels.intents)).sort();
  const overrides = Object.keys(objectRecord(overrideModels.intents)).sort();
  return {
    effective,
    overrides,
  };
}

function skillsInfo(value: unknown): AgentSkillsInfo {
  const raw = objectRecord(value);
  const effective = objectRecord(objectRecord(raw.effective).skills);
  const override = objectRecord(objectRecord(raw.override).skills);
  const mode = effective.mode === 'all-enabled' || effective.mode === 'selected'
    ? effective.mode
    : undefined;
  const allowlist = mode === 'selected' ? stringArray(effective.include) : undefined;
  const excluded = mode === 'all-enabled' ? stringArray(effective.exclude) : [];
  const overrides = override.mode === 'replace'
    ? stringArray(override.include)
    : [...stringArray(override.add), ...stringArray(override.remove)].sort();
  return {
    ...(mode ? { mode } : {}),
    ...(allowlist ? { allowlist } : {}),
    excluded,
    overrides,
  };
}

function toolsInfo(value: unknown): AgentToolsInfo {
  const raw = objectRecord(value);
  const effective = objectRecord(objectRecord(raw.effective).tools);
  const overrides = objectRecord(objectRecord(raw.override).tools);
  return {
    denied: Object.entries(effective)
      .filter(([, policy]) => objectRecord(policy).mode === 'deny')
      .map(([id]) => id)
      .sort(),
    overrides: Object.keys(overrides).sort(),
  };
}

export function resolveEffectiveDefaultAgentId(
  payload: ChatAgentsPayload | undefined,
  localOverride: string | null,
): string {
  const items = payload?.items ?? [];
  const override = localOverride?.trim().toLowerCase();
  if (override && items.some((a) => a.id === override)) return override;
  const gatewayDefault = payload?.defaultId?.trim().toLowerCase();
  if (gatewayDefault && items.some((agent) => agent.id === gatewayDefault)) return gatewayDefault;
  return items[0]?.id ?? '';
}

export async function setGatewayDefaultAgent(agentId: string): Promise<boolean> {
  const id = agentId.trim().toLowerCase();
  if (!id) throw new Error('Agent id is required');
  const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setDefault: true }),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, errBody.error?.message));
  }
  return true;
}

/** Effective default agent id (local override when set, else gateway). */
export function useEffectiveDefaultAgentId(): string {
  const localOverride = usePreferencesStore((s) => s.defaultAgentId);
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    placeholderData: () => readPlaceholderAgents() ?? undefined,
  });
  return resolveEffectiveDefaultAgentId(agentsQuery.data, localOverride);
}

/** Last-known agent list for the active profile; used as `placeholderData`
 * so the chat header agent name renders instantly on cold start. */
export function readPlaceholderAgents(): ChatAgentsPayload | null {
  return readCachedAgents(useGatewayStore.getState().activeGatewayId);
}

export async function fetchChatAgents(): Promise<ChatAgentsPayload> {
  const res = await apiFetch('/api/agents');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = await res.json();
  const parsed = agentsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Gateway returned an invalid agents response');
  }
  const { defaultId, agents, builtinToolIds } = parsed.data.payload;
  const items: ChatAgentOption[] = agents
    .filter((a) => a.id.trim())
    .map((a) => {
      const raw = a as typeof a & Record<string, unknown>;
      return {
        id: a.id.trim().toLowerCase(),
        name: a.name?.trim() || undefined,
        description: a.description?.trim() || undefined,
        language: stringOrUndefined(raw.language),
        avatar: stringOrUndefined(raw.avatar),
        workspace: stringOrUndefined(raw.workspace),
        profileDir: stringOrUndefined(raw.profileDir),
        model: modelInfo(objectRecord(objectRecord(raw.effective).models).chat),
        modelIntents: modelIntentsInfo(raw),
        isDefault: typeof raw.isDefault === 'boolean' ? raw.isDefault : undefined,
        skills: skillsInfo(raw),
        tools: toolsInfo(raw),
      };
    });
  if (items.length === 0) throw new Error('Gateway returned no enabled agents');
  const payload: ChatAgentsPayload = {
    defaultId: defaultId.trim().toLowerCase(),
    items,
    builtinToolIds: builtinToolIds ?? [],
  };

  writeCachedAgents(useGatewayStore.getState().activeGatewayId, payload);
  return payload;
}
