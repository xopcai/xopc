import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  AgentProfileFileEntry,
  GatewayAgentEffectiveManifestPayload,
  GatewayAgentRow,
  GatewayAgentsPayload,
  GatewayConfigBinding,
  SkillCatalogRow,
} from './types/agent-gateway';

export type {
  AgentProfileFileEntry,
  GatewayAgentEffectiveManifestPayload,
  GatewayAgentRow,
  GatewayAgentsPayload,
  GatewayAgentSkillsInfo,
  GatewayAgentToolsInfo,
  GatewayConfigBinding,
  SkillCatalogRow,
} from './types/agent-gateway';

type ToolPolicyPatch = {
  mode: 'allow' | 'confirm' | 'deny';
  scope?: 'readonly' | 'workspace' | 'unrestricted';
  limits?: {
    maxCallsPerTurn?: number;
    timeoutMs?: number;
  };
};

type ToolPolicySetPatch = {
  builtin?: Record<string, ToolPolicyPatch>;
  mcp?: {
    servers?: Record<string, ToolPolicyPatch>;
    tools?: Record<string, ToolPolicyPatch>;
  };
};

function normalizeAgentRow(raw: GatewayAgentRow): GatewayAgentRow {
  const profileDir = typeof raw.profileDir === 'string' ? raw.profileDir.trim() : '';
  const typedPreset = raw.typedModels?.preset ?? [];
  const typedEntry = raw.typedModels?.entry;
  const typedEffective = raw.typedModels?.effective ?? typedPreset;
  return {
    ...raw,
    profileDir,
    ...(typeof raw.avatar === 'string' && raw.avatar.trim() ? { avatar: raw.avatar.trim() } : {}),
    skills: raw.skills ? { ...raw.skills, preset: raw.skills.preset ?? [] } : { preset: [] },
    tools: raw.tools
      ? { ...raw.tools, presetDenied: raw.tools.presetDenied ?? [] }
      : { presetDenied: [], entryDisable: [], effectiveDisable: [] },
    typedModels: {
      defaultRole: raw.typedModels.defaultRole,
      preset: typedPreset,
      ...(typedEntry !== undefined ? { entry: typedEntry } : {}),
      effective: typedEffective,
    },
    extends: Array.isArray(raw.extends) ? raw.extends : [],
  };
}

export async function fetchGatewayAgents(): Promise<GatewayAgentsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: GatewayAgentsPayload }>(
    apiUrl('/api/agents'),
  );
  const p = res.payload;
  if (!p?.defaultId || !Array.isArray(p.agents)) {
    throw new Error('Invalid /api/agents response');
  }
  const builtinToolIds = Array.isArray(p.builtinToolIds) ? p.builtinToolIds : [];
  return {
    defaultId: p.defaultId,
    agents: p.agents.map(normalizeAgentRow),
    builtinToolIds,
  };
}

export async function fetchGatewayAgentEffectiveManifest(
  agentId: string,
): Promise<GatewayAgentEffectiveManifestPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: GatewayAgentEffectiveManifestPayload }>(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/effective-manifest`),
  );
  if (!res.payload?.manifest || typeof res.payload.sources !== 'object' || res.payload.sources === null) {
    throw new Error('Invalid /api/agents/:id/effective-manifest response');
  }
  return res.payload;
}

export type CreateGatewayAgentResult = GatewayAgentsPayload & { createdAgentId: string };

export async function applyGatewayAgentsPayloadToCaches(payload: GatewayAgentsPayload): Promise<void> {
  const { mutate } = await import('swr');
  await Promise.all([
    mutate('settings-gateway-agents', payload, { revalidate: false }),
    mutate('setup-checklist-agents', payload, { revalidate: false }),
  ]);
}

export async function createGatewayAgent(body: {
  id?: string;
  workspace: string;
  models?: {
    defaultRole?: string;
    roles?: Record<string, { model: string; description?: string }>;
  };
  skills?: string[];
  tools?: ToolPolicySetPatch;
  profileFiles?: Record<string, string>;
  cloneFrom?: string;
}): Promise<CreateGatewayAgentResult> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { agentId?: string; agents: GatewayAgentsPayload };
  }>(apiUrl('/api/agents'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const createdAgentId = typeof res.payload?.agentId === 'string' ? res.payload.agentId.trim() : '';
  const agents = res.payload?.agents;
  if (!createdAgentId || !agents?.defaultId || !Array.isArray(agents.agents)) {
    throw new Error('Invalid create agent response');
  }
  return {
    createdAgentId,
    defaultId: agents.defaultId,
    agents: agents.agents.map(normalizeAgentRow),
    builtinToolIds: Array.isArray(agents.builtinToolIds) ? agents.builtinToolIds : [],
  };
}

export async function updateGatewayAgent(
  id: string,
  body: {
    workspace?: string;
    extends?: string[];
    models?: {
      defaultRole?: string | null;
      roles?: Record<string, { model: string; description?: string }>;
    } | null;
    setDefault?: boolean;
    skills?: string[] | null;
    tools?: ToolPolicySetPatch | null;
  },
): Promise<GatewayAgentsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: GatewayAgentsPayload }>(
    apiUrl(`/api/agents/${encodeURIComponent(id)}`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const p = res.payload;
  if (!p?.defaultId || !Array.isArray(p.agents)) {
    throw new Error('Invalid update agent response');
  }
  return {
    defaultId: p.defaultId,
    agents: p.agents.map(normalizeAgentRow),
    builtinToolIds: Array.isArray(p.builtinToolIds) ? p.builtinToolIds : [],
  };
}

export async function deleteGatewayAgent(id: string, purge: boolean): Promise<GatewayAgentsPayload> {
  const q = purge ? '?purge=true' : '';
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { agentId?: string; purged?: boolean; agents: GatewayAgentsPayload };
  }>(apiUrl(`/api/agents/${encodeURIComponent(id)}${q}`), { method: 'DELETE' });
  const agents = res.payload?.agents;
  if (!agents?.defaultId || !Array.isArray(agents.agents)) {
    throw new Error('Invalid delete agent response');
  }
  return {
    defaultId: agents.defaultId,
    agents: agents.agents.map(normalizeAgentRow),
    builtinToolIds: Array.isArray(agents.builtinToolIds) ? agents.builtinToolIds : [],
  };
}

export function parseGatewayBindingsFromConfig(config: unknown): GatewayConfigBinding[] {
  if (!config || typeof config !== 'object' || !('bindings' in config)) {
    return [];
  }
  const raw = (config as { bindings?: unknown }).bindings;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as GatewayConfigBinding[];
}

export async function patchGatewayBindings(bindings: GatewayConfigBinding[]): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bindings }),
  });
  void revalidateGatewayConfig();
}

export async function fetchSkillsCatalog(): Promise<SkillCatalogRow[]> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { catalog?: SkillCatalogRow[] };
  }>(apiUrl('/api/skills'));
  const c = res.payload?.catalog;
  return Array.isArray(c) ? c : [];
}

export async function fetchAgentProfileFiles(agentId: string): Promise<{
  agentId: string;
  profileDir: string;
  files: AgentProfileFileEntry[];
}> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { agentId: string; profileDir?: string; files: AgentProfileFileEntry[] };
  }>(apiUrl(`/api/agents/${encodeURIComponent(agentId)}/files`));
  const p = res.payload;
  const profileDir = typeof p?.profileDir === 'string' ? p.profileDir.trim() : '';
  if (!p?.files || !profileDir) {
    throw new Error('Invalid files list response');
  }
  return { agentId: p.agentId, profileDir, files: p.files };
}

export async function fetchAgentProfileFileContent(agentId: string, name: string): Promise<string> {
  const res = await fetchJson<{ ok?: boolean; payload?: { content?: string } }>(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`),
  );
  const c = res.payload?.content;
  if (typeof c !== 'string') {
    throw new Error('Invalid file content response');
  }
  return c;
}

export async function saveAgentProfileFileContent(agentId: string, name: string, content: string): Promise<void> {
  await fetchJson(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
}

export type AgentAvatarMime = 'image/png' | 'image/jpeg' | 'image/webp';

function mimeFromFile(file: File): AgentAvatarMime | null {
  const t = file.type.toLowerCase();
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/jpg' || t === 'image/webp') {
    if (t === 'image/jpg') return 'image/jpeg';
    return t;
  }
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = String(r.result ?? '');
      const i = dataUrl.indexOf(',');
      resolve(i >= 0 ? dataUrl.slice(i + 1) : '');
    };
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export async function uploadAgentAvatarFile(agentId: string, file: File): Promise<void> {
  const mimeType = mimeFromFile(file);
  if (!mimeType) {
    throw new Error('unsupported_image_type');
  }
  if (file.size === 0 || file.size > 512 * 1024) {
    throw new Error('avatar_too_large');
  }
  const base64 = await fileToBase64(file);
  if (!base64) {
    throw new Error('empty_file');
  }
  await fetchJson(apiUrl(`/api/agents/${encodeURIComponent(agentId)}/avatar`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mimeType }),
  });
}

export async function deleteAgentAvatarFile(agentId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/agents/${encodeURIComponent(agentId)}/avatar`), {
    method: 'DELETE',
  });
}
