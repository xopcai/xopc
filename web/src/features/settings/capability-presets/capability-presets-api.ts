import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type CapabilityPresetModelRole = {
  model: string;
  fallbacks?: string[];
  description?: string;
};

export type CapabilityPresetRow = {
  id: string;
  name: string;
  description?: string;
  version: number;
  extends?: string[];
  models?: {
    defaultRole?: string;
    roles?: Record<string, CapabilityPresetModelRole>;
  };
  tools?: {
    builtin?: Record<string, { mode: 'allow' | 'confirm' | 'deny'; scope?: string }>;
  };
  skills?: {
    mode: 'all' | 'allowlist' | 'denylist' | 'off';
    allow?: string[];
    deny?: string[];
  };
  locks?: string[];
  usage: Array<{ agentId: string; agentName?: string }>;
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
}): Promise<{ presetId: string; presets: CapabilityPresetsPayload }> {
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
    models?: CapabilityPresetRow['models'] | null;
    tools?: CapabilityPresetRow['tools'] | null;
    skills?: CapabilityPresetRow['skills'] | null;
  },
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
