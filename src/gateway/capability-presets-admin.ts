import {
  CapabilityPresetSchema,
  DEFAULT_CAPABILITY_PRESET_ID,
  type CapabilityPreset,
} from '../agent-manifest/schema.js';
import { linearizePresetIds } from '../agent-manifest/preset-chain.js';
import { resolveEffectiveAgentManifest } from '../agent-manifest/resolver.js';
import type { Config } from '../config/schema.js';
import { GATEWAY_BUILTIN_TOOL_IDS } from './agent-builtin-tools.js';

export type CapabilityPresetAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: 400 | 404 | 409 | 500 };

export type CapabilityPresetAgentUsage = {
  agentId: string;
  agentName?: string;
  direct: boolean;
};

export type CapabilityPresetRow = CapabilityPreset & {
  usage: CapabilityPresetAgentUsage[];
};

export type CapabilityPresetsListResponse = {
  defaultPresetId: string;
  presets: CapabilityPresetRow[];
  agents: Array<{ id: string; name?: string; extends: string[] }>;
  builtinToolIds: string[];
};

export type CapabilityPresetPreviewDiff = {
  path: string;
  before?: unknown;
  after?: unknown;
};

export type CapabilityPresetPreviewAgent = {
  agentId: string;
  agentName?: string;
  diffs: CapabilityPresetPreviewDiff[];
};

export type CreateCapabilityPresetBody = {
  id?: string;
  name?: string;
  description?: string;
  version?: number;
  extends?: CapabilityPreset['extends'];
  models?: CapabilityPreset['models'];
  tools?: CapabilityPreset['tools'];
  skills?: CapabilityPreset['skills'];
  workflows?: CapabilityPreset['workflows'];
  boundaries?: CapabilityPreset['boundaries'];
  runtime?: CapabilityPreset['runtime'];
  locks?: CapabilityPreset['locks'];
};

export type UpdateCapabilityPresetBody = {
  name?: string;
  description?: string | null;
  version?: number;
  extends?: string[] | null;
  models?: CapabilityPreset['models'] | null;
  tools?: CapabilityPreset['tools'] | null;
  skills?: CapabilityPreset['skills'] | null;
  workflows?: CapabilityPreset['workflows'] | null;
  boundaries?: CapabilityPreset['boundaries'] | null;
  runtime?: CapabilityPreset['runtime'] | null;
  locks?: string[] | null;
};

function presetMap(cfg: Config): Record<string, CapabilityPreset> {
  return cfg.agents.capabilityPresets ?? {};
}

function normalizePresetId(id: string): string {
  return id.trim().toLowerCase();
}

function flattenPolicy(value: unknown, path = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (Array.isArray(value) || value === null || typeof value !== 'object') {
    if (path) out.set(path, value);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenPolicy(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

function manifestDiff(before: unknown, after: unknown): CapabilityPresetPreviewDiff[] {
  const beforeFlat = flattenPolicy(before);
  const afterFlat = flattenPolicy(after);
  const paths = new Set([...beforeFlat.keys(), ...afterFlat.keys()]);
  return [...paths]
    .filter((path) => JSON.stringify(beforeFlat.get(path)) !== JSON.stringify(afterFlat.get(path)))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      ...(beforeFlat.has(path) ? { before: beforeFlat.get(path) } : {}),
      ...(afterFlat.has(path) ? { after: afterFlat.get(path) } : {}),
    }));
}

function agentUsage(cfg: Config, presetId: string): CapabilityPresetAgentUsage[] {
  const defaultPresetId = cfg.agents.defaultPreset || DEFAULT_CAPABILITY_PRESET_ID;
  return cfg.agents.list
    .filter((agent) => {
      const roots = [
        ...(cfg.agents.capabilityPresets[defaultPresetId] ? [defaultPresetId] : []),
        ...(agent.extends ?? []).filter((id) => id !== defaultPresetId),
      ];
      return linearizePresetIds(roots, cfg.agents.capabilityPresets).includes(presetId);
    })
    .map((agent) => ({
      agentId: agent.id,
      ...(agent.identity.name ? { agentName: agent.identity.name } : {}),
      direct: presetId === defaultPresetId || (agent.extends ?? []).includes(presetId),
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

function validatePresetReferences(
  presets: Record<string, CapabilityPreset>,
): CapabilityPresetAdminResult<void> {
  for (const [id, preset] of Object.entries(presets)) {
    for (const parent of preset.extends ?? []) {
      if (!presets[parent]) {
        return { ok: false, error: `capability preset "${id}" extends missing preset "${parent}"`, status: 400 };
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, stack: string[]): CapabilityPresetAdminResult<void> => {
    if (visiting.has(id)) {
      return { ok: false, error: `capability preset cycle detected: ${[...stack, id].join(' -> ')}`, status: 400 };
    }
    if (visited.has(id)) {
      return { ok: true, data: undefined };
    }
    visiting.add(id);
    for (const parent of presets[id]?.extends ?? []) {
      const res = visit(parent, [...stack, id]);
      if (!res.ok) return res;
    }
    visiting.delete(id);
    visited.add(id);
    return { ok: true, data: undefined };
  };

  for (const id of Object.keys(presets)) {
    const res = visit(id, []);
    if (!res.ok) return res;
  }
  return { ok: true, data: undefined };
}

function validateAgentPresetReferences(cfg: Config): CapabilityPresetAdminResult<void> {
  const presets = presetMap(cfg);
  for (const agent of cfg.agents.list) {
    for (const presetId of agent.extends ?? []) {
      if (!presets[presetId]) {
        return { ok: false, error: `agent "${agent.id}" extends missing preset "${presetId}"`, status: 400 };
      }
    }
  }
  return { ok: true, data: undefined };
}

function nextConfigWithPresets(
  cfg: Config,
  presets: Record<string, CapabilityPreset>,
): CapabilityPresetAdminResult<{ nextConfig: Config }> {
  const refs = validatePresetReferences(presets);
  if (refs.ok === false) return { ok: false, error: refs.error, status: refs.status };
  const nextConfig: Config = {
    ...cfg,
    agents: {
      ...cfg.agents,
      capabilityPresets: presets,
    },
  };
  const agentRefs = validateAgentPresetReferences(nextConfig);
  if (agentRefs.ok === false) return { ok: false, error: agentRefs.error, status: agentRefs.status };
  for (const agent of nextConfig.agents.list) {
    try {
      resolveEffectiveAgentManifest({
        agent,
        presets,
        defaultPresetId: nextConfig.agents.defaultPreset,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `agent "${agent.id}" effective manifest is invalid: ${message}`, status: 400 };
    }
  }
  return { ok: true, data: { nextConfig } };
}

export function listCapabilityPresets(cfg: Config): CapabilityPresetsListResponse {
  const presets = Object.values(presetMap(cfg))
    .map((preset) => ({ ...preset, usage: agentUsage(cfg, preset.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const agents = cfg.agents.list
    .map((agent) => ({
      id: agent.id,
      ...(agent.identity.name ? { name: agent.identity.name } : {}),
      extends: [...(agent.extends ?? [])],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { defaultPresetId: cfg.agents.defaultPreset, presets, agents, builtinToolIds: [...GATEWAY_BUILTIN_TOOL_IDS] };
}

export function prepareCreateCapabilityPreset(
  cfg: Config,
  body: CreateCapabilityPresetBody,
): CapabilityPresetAdminResult<{ nextConfig: Config; presetId: string }> {
  const id = normalizePresetId(body.id ?? '');
  const name = body.name?.trim() || id;
  const description = body.description?.trim();
  const { id: _id, name: _name, description: _description, ...policy } = body;
  const parsed = CapabilityPresetSchema.safeParse({
    ...policy,
    id,
    name,
    version: body.version ?? 1,
    ...(description ? { description } : {}),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'capability preset is invalid', status: 400 };
  }
  const presets = presetMap(cfg);
  if (presets[id]) {
    return { ok: false, error: `capability preset "${id}" already exists`, status: 409 };
  }
  const next = nextConfigWithPresets(cfg, { ...presets, [id]: parsed.data });
  if (next.ok === false) return { ok: false, error: next.error, status: next.status };
  return { ok: true, data: { ...next.data, presetId: id } };
}

export function prepareUpdateCapabilityPreset(
  cfg: Config,
  presetIdRaw: string,
  body: UpdateCapabilityPresetBody,
): CapabilityPresetAdminResult<{ nextConfig: Config }> {
  const presetId = normalizePresetId(presetIdRaw);
  const presets = presetMap(cfg);
  const current = presets[presetId];
  if (!current) {
    return { ok: false, error: `capability preset "${presetId}" not found`, status: 404 };
  }
  const nextPreset: CapabilityPreset = { ...current };

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return { ok: false, error: 'name must be a non-empty string', status: 400 };
    }
    nextPreset.name = name;
  }
  if (body.description !== undefined) {
    if (body.description === null || !body.description.trim()) {
      delete nextPreset.description;
    } else {
      nextPreset.description = body.description.trim();
    }
  }
  nextPreset.version = body.version ?? current.version + 1;
  for (const key of ['extends', 'models', 'tools', 'skills', 'workflows', 'boundaries', 'runtime', 'locks'] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null) {
      delete nextPreset[key];
    } else {
      (nextPreset as Record<string, unknown>)[key] = body[key];
    }
  }

  const parsed = CapabilityPresetSchema.safeParse(nextPreset);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'capability preset is invalid', status: 400 };
  }
  return nextConfigWithPresets(cfg, { ...presets, [presetId]: parsed.data });
}

export function previewCapabilityPresetUpdate(
  cfg: Config,
  presetIdRaw: string,
  body: UpdateCapabilityPresetBody,
): CapabilityPresetAdminResult<{ agents: CapabilityPresetPreviewAgent[] }> {
  const prepared = prepareUpdateCapabilityPreset(cfg, presetIdRaw, body);
  if (prepared.ok === false) return prepared;

  const agents = cfg.agents.list.flatMap((agent) => {
    const before = resolveEffectiveAgentManifest({
      agent,
      presets: cfg.agents.capabilityPresets,
      defaultPresetId: cfg.agents.defaultPreset,
    }).manifest;
    const after = resolveEffectiveAgentManifest({
      agent,
      presets: prepared.data.nextConfig.agents.capabilityPresets,
      defaultPresetId: prepared.data.nextConfig.agents.defaultPreset,
    }).manifest;
    const diffs = manifestDiff(before, after);
    if (diffs.length === 0) return [];
    return [{
      agentId: agent.id,
      ...(agent.identity.name ? { agentName: agent.identity.name } : {}),
      diffs,
    }];
  });

  return { ok: true, data: { agents } };
}

export function prepareDeleteCapabilityPreset(
  cfg: Config,
  presetIdRaw: string,
): CapabilityPresetAdminResult<{ nextConfig: Config }> {
  const presetId = normalizePresetId(presetIdRaw);
  const presets = presetMap(cfg);
  if (!presets[presetId]) {
    return { ok: false, error: `capability preset "${presetId}" not found`, status: 404 };
  }
  if (presetId === cfg.agents.defaultPreset) {
    return { ok: false, error: `capability preset "${presetId}" is the global default and cannot be deleted`, status: 409 };
  }
  const usage = agentUsage(cfg, presetId);
  if (usage.length > 0) {
    return {
      ok: false,
      error: `capability preset "${presetId}" is used by agents: ${usage.map((u) => u.agentId).join(', ')}`,
      status: 409,
    };
  }
  const nextPresets = { ...presets };
  delete nextPresets[presetId];
  return nextConfigWithPresets(cfg, nextPresets);
}
