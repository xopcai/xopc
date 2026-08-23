import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type CapabilityPresetModelRole = {
  model: string;
  fallbacks?: string[];
  description?: string;
};

export type CapabilityPresetToolPolicy = {
  mode: 'allow' | 'confirm' | 'deny';
  scope?: 'readonly' | 'workspace' | 'unrestricted';
  limits?: { maxCallsPerTurn?: number; timeoutMs?: number };
};

export type CapabilityPresetPolicyFields = {
  extends?: string[];
  models?: {
    defaultRole?: string;
    roles?: Record<string, CapabilityPresetModelRole>;
    imageModel?: { primary: string; fallbacks?: string[]; timeoutMs?: number; autoProviderFallback?: boolean };
    imageGenerationModel?: { primary: string; fallbacks?: string[]; timeoutMs?: number; autoProviderFallback?: boolean };
    policy?: { allowFallbacks?: boolean; maxCostTier?: 'low' | 'medium' | 'high' };
  };
  tools?: {
    builtin?: Record<string, CapabilityPresetToolPolicy>;
    mcp?: {
      servers?: Record<string, CapabilityPresetToolPolicy>;
      tools?: Record<string, CapabilityPresetToolPolicy>;
    };
  };
  skills?: {
    mode: 'all' | 'allowlist' | 'denylist' | 'off';
    allow?: string[];
    deny?: string[];
  };
  workflows?: {
    default?: string;
    allowed?: string[];
    suggested?: Array<{ intent: string; workflow: string }>;
  };
  boundaries?: {
    requiresConfirmation?: string[];
    forbidden?: string[];
    escalation?: string[];
  };
  runtime?: { maxTurns?: number; timeoutMs?: number; maxToolFailuresPerTurn?: number };
  locks?: string[];
};

export type CapabilityPresetRow = CapabilityPresetPolicyFields & {
  id: string;
  name: string;
  description?: string;
  version: number;
  usage: Array<{ agentId: string; agentName?: string; direct?: boolean }>;
  inherited: CapabilityPresetPolicyFields;
  inheritedSources: Record<string, string>;
};

export type CapabilityPresetsPayload = {
  defaultPresetId: string;
  presets: CapabilityPresetRow[];
  agents: Array<{ id: string; name?: string; extends: string[] }>;
  builtinToolIds: string[];
  mcpServerIds: string[];
  workflows: Array<{ id: string; title: string; description: string }>;
};

export type CapabilityPresetUpdateBody = {
  name?: string;
  description?: string | null;
  version?: number;
} & { [K in keyof CapabilityPresetPolicyFields]?: CapabilityPresetPolicyFields[K] | null };

export type CapabilityPresetPreview = {
  agents: Array<{
    agentId: string;
    agentName?: string;
    diffs: Array<{ path: string; before?: unknown; after?: unknown }>;
  }>;
};

export async function fetchCapabilityPresets(): Promise<CapabilityPresetsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: CapabilityPresetsPayload }>(
    apiUrl('/api/capability-presets'),
  );
  if (
    !Array.isArray(res.payload?.presets) ||
    typeof res.payload.defaultPresetId !== 'string' ||
    !Array.isArray(res.payload.agents) ||
    !Array.isArray(res.payload.builtinToolIds) ||
    !Array.isArray(res.payload.mcpServerIds) ||
    !Array.isArray(res.payload.workflows)
  ) {
    throw new Error('Invalid /api/capability-presets response');
  }
  return res.payload;
}

export async function fetchCapabilityPresetMcpTools(
  serverIds: string[],
): Promise<Array<{ id: string; serverId: string; name: string; description: string; readOnly: boolean }>> {
  const groups = await Promise.all(serverIds.map(async (serverId) => {
    try {
      const res = await fetchJson<{ ok?: boolean; payload?: { tools?: Array<{ name: string; shortName: string; description: string; readOnly: boolean }> } }>(
        apiUrl(`/api/mcp/servers/${encodeURIComponent(serverId)}/tools`),
      );
      return (res.payload?.tools ?? []).map((tool) => ({
        id: tool.name,
        serverId,
        name: tool.shortName,
        description: tool.description,
        readOnly: tool.readOnly,
      }));
    } catch {
      return [];
    }
  }));
  return groups.flat().sort((left, right) => left.id.localeCompare(right.id));
}

export async function createCapabilityPreset(body: {
  id: string;
  name: string;
  description?: string;
  version?: number;
} & CapabilityPresetPolicyFields): Promise<{ presetId: string; presets: CapabilityPresetsPayload }> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { presetId?: string; presets?: CapabilityPresetsPayload };
  }>(apiUrl('/api/capability-presets'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const presetId = res.payload?.presetId;
  const presets = res.payload?.presets;
  if (
    !presetId ||
    !presets ||
    typeof presets.defaultPresetId !== 'string' ||
    !Array.isArray(presets.presets) ||
    !Array.isArray(presets.agents) ||
    !Array.isArray(presets.builtinToolIds) ||
    !Array.isArray(presets.mcpServerIds) ||
    !Array.isArray(presets.workflows)
  ) {
    throw new Error('Invalid create capability preset response');
  }
  return { presetId, presets };
}

export async function updateCapabilityPreset(
  id: string,
  body: CapabilityPresetUpdateBody,
): Promise<CapabilityPresetsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: CapabilityPresetsPayload }>(
    apiUrl(`/api/capability-presets/${encodeURIComponent(id)}`),
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );
  if (
    !Array.isArray(res.payload?.presets) ||
    typeof res.payload.defaultPresetId !== 'string' ||
    !Array.isArray(res.payload.agents) ||
    !Array.isArray(res.payload.builtinToolIds) ||
    !Array.isArray(res.payload.mcpServerIds) ||
    !Array.isArray(res.payload.workflows)
  ) {
    throw new Error('Invalid update capability preset response');
  }
  return res.payload;
}

export async function previewCapabilityPresetUpdate(
  id: string,
  body: CapabilityPresetUpdateBody,
): Promise<CapabilityPresetPreview> {
  const res = await fetchJson<{ ok?: boolean; payload?: CapabilityPresetPreview }>(
    apiUrl(`/api/capability-presets/${encodeURIComponent(id)}/preview`),
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!Array.isArray(res.payload?.agents)) {
    throw new Error('Invalid capability preset preview response');
  }
  return res.payload;
}

export async function deleteCapabilityPreset(id: string): Promise<CapabilityPresetsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: CapabilityPresetsPayload }>(
    apiUrl(`/api/capability-presets/${encodeURIComponent(id)}`),
    { method: 'DELETE' },
  );
  if (
    !Array.isArray(res.payload?.presets) ||
    typeof res.payload.defaultPresetId !== 'string' ||
    !Array.isArray(res.payload.agents) ||
    !Array.isArray(res.payload.builtinToolIds) ||
    !Array.isArray(res.payload.mcpServerIds) ||
    !Array.isArray(res.payload.workflows)
  ) {
    throw new Error('Invalid delete capability preset response');
  }
  return res.payload;
}
