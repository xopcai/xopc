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
  memory?: Record<string, unknown>;
  workflows?: Record<string, unknown>;
  boundaries?: {
    requiresConfirmation: string[];
    forbidden: string[];
    escalation: string[];
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
};

export type CapabilityPresetsPayload = {
  defaultPresetId: string;
  presets: CapabilityPresetRow[];
  agents: Array<{ id: string; name?: string; extends: string[] }>;
  builtinToolIds: string[];
};

export async function fetchCapabilityPresets(): Promise<CapabilityPresetsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: CapabilityPresetsPayload }>(
    apiUrl('/api/capability-presets'),
  );
  if (
    !Array.isArray(res.payload?.presets) ||
    typeof res.payload.defaultPresetId !== 'string' ||
    !Array.isArray(res.payload.agents) ||
    !Array.isArray(res.payload.builtinToolIds)
  ) {
    throw new Error('Invalid /api/capability-presets response');
  }
  return res.payload;
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
    !Array.isArray(presets.builtinToolIds)
  ) {
    throw new Error('Invalid create capability preset response');
  }
  return { presetId, presets };
}

export async function updateCapabilityPreset(
  id: string,
  body: {
    name?: string;
    description?: string | null;
    version?: number;
  } & { [K in keyof CapabilityPresetPolicyFields]?: CapabilityPresetPolicyFields[K] | null },
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
    !Array.isArray(res.payload.builtinToolIds)
  ) {
    throw new Error('Invalid update capability preset response');
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
    !Array.isArray(res.payload.builtinToolIds)
  ) {
    throw new Error('Invalid delete capability preset response');
  }
  return res.payload;
}
