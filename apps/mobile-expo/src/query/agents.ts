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

export type AgentTypedModelInfo = {
  defaults: Array<{ id: string; model: string; description?: string }>;
  entry?: Array<{ id: string; model: string; description?: string }>;
  effective: Array<{ id: string; model: string; description?: string }>;
};

export type AgentSkillsInfo = {
  defaults: string[];
  entry?: string[];
  effectiveAllowlist?: string[];
};

export type AgentToolsInfo = {
  defaultsDisable: string[];
  entryDisable: string[];
  effectiveDisable: string[];
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
  typedModels: AgentTypedModelInfo;
  isDefault?: boolean;
  skills: AgentSkillsInfo;
  tools: AgentToolsInfo;
};

export type ChatAgentsPayload = {
  defaultId: string;
  items: ChatAgentOption[];
  builtinToolIds: string[];
};

const emptyTypedModels: AgentTypedModelInfo = { defaults: [], effective: [] };
const emptySkills: AgentSkillsInfo = { defaults: [] };
const emptyTools: AgentToolsInfo = { defaultsDisable: [], entryDisable: [], effectiveDisable: [] };

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

function typedModelRows(value: unknown): AgentTypedModelInfo['defaults'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const raw = row as { id?: unknown; model?: unknown; description?: unknown };
    const id = stringOrUndefined(raw.id);
    const model = stringOrUndefined(raw.model);
    if (!id || !model) return [];
    const description = stringOrUndefined(raw.description);
    return [{ id, model, ...(description ? { description } : {}) }];
  });
}

function typedModelsInfo(value: unknown): AgentTypedModelInfo {
  if (!value || typeof value !== 'object') return emptyTypedModels;
  const raw = value as { defaults?: unknown; entry?: unknown; effective?: unknown };
  const defaults = typedModelRows(raw.defaults);
  const entry = typedModelRows(raw.entry);
  const effective = typedModelRows(raw.effective);
  return {
    defaults,
    ...(entry.length ? { entry } : {}),
    effective: effective.length ? effective : defaults,
  };
}

function skillsInfo(value: unknown): AgentSkillsInfo {
  if (!value || typeof value !== 'object') return emptySkills;
  const raw = value as { defaults?: unknown; entry?: unknown; effectiveAllowlist?: unknown };
  const entry = stringArray(raw.entry);
  const effectiveAllowlist = stringArray(raw.effectiveAllowlist);
  return {
    defaults: stringArray(raw.defaults),
    ...(entry.length ? { entry } : {}),
    ...(effectiveAllowlist.length ? { effectiveAllowlist } : {}),
  };
}

function toolsInfo(value: unknown): AgentToolsInfo {
  if (!value || typeof value !== 'object') return emptyTools;
  const raw = value as { defaultsDisable?: unknown; entryDisable?: unknown; effectiveDisable?: unknown };
  return {
    defaultsDisable: stringArray(raw.defaultsDisable),
    entryDisable: stringArray(raw.entryDisable),
    effectiveDisable: stringArray(raw.effectiveDisable),
  };
}

export function resolveEffectiveDefaultAgentId(
  payload: ChatAgentsPayload | undefined,
  localOverride: string | null,
): string {
  const gatewayDefault = payload?.defaultId?.trim().toLowerCase() || 'main';
  const items = payload?.items ?? [];
  const override = localOverride?.trim().toLowerCase();
  if (override && items.some((a) => a.id === override)) return override;
  return gatewayDefault;
}

export async function setGatewayDefaultAgent(agentId: string): Promise<boolean> {
  const id = agentId.trim().toLowerCase();
  const body = JSON.stringify({ agentId: id });
  const attempts: Array<() => Promise<Response>> = [
    () =>
      apiFetch('/api/agents/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    () =>
      apiFetch(`/api/agents/${encodeURIComponent(id)}/default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    () =>
      apiFetch('/api/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultId: id }),
      }),
  ];

  for (const attempt of attempts) {
    const res = await attempt();
    if (res.ok) return true;
    if (res.status !== 404 && res.status !== 405 && res.status !== 501) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(formatApiHttpError(res.status, res.statusText, errBody.error?.message));
    }
  }
  return false;
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
    return { defaultId: 'main', items: [{ id: 'main', typedModels: emptyTypedModels, skills: emptySkills, tools: emptyTools }], builtinToolIds: [] };
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
        model: modelInfo(raw.model),
        typedModels: typedModelsInfo(raw.typedModels),
        isDefault: typeof raw.isDefault === 'boolean' ? raw.isDefault : undefined,
        skills: skillsInfo(raw.skills),
        tools: toolsInfo(raw.tools),
      };
    });
  const payload: ChatAgentsPayload =
    items.length === 0
      ? { defaultId: defaultId.trim().toLowerCase(), items: [{ id: 'main', typedModels: emptyTypedModels, skills: emptySkills, tools: emptyTools }], builtinToolIds: [] }
      : { defaultId: defaultId.trim().toLowerCase(), items, builtinToolIds: builtinToolIds ?? [] };

  writeCachedAgents(useGatewayStore.getState().activeGatewayId, payload);
  return payload;
}
