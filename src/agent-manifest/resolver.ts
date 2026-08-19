import {
  AgentConfigEntrySchema,
  AgentManifestSchema,
  CapabilityPresetSchema,
  DEFAULT_CAPABILITY_PRESET_ID,
  type AgentConfigEntry,
  type CapabilityPreset,
  type CapabilityPresetPatch,
  type EffectiveAgentManifest,
} from './schema.js';
import { linearizePresetIds } from './preset-chain.js';

export interface ResolveManifestResult {
  manifest: EffectiveAgentManifest;
  presetChain: string[];
  sources: Record<string, string>;
  overrides: ManifestOverride[];
  locks: string[];
}

export interface ManifestOverride {
  path: string;
  from: string;
  to: string;
}

export interface ResolveManifestParams {
  agent: AgentConfigEntry;
  presets?: Record<string, CapabilityPreset>;
  defaultPresetId?: string;
}

export interface ResolvePresetLayerResult {
  patch: CapabilityPresetPatch;
  presetChain: string[];
  sources: Record<string, string>;
  locks: string[];
  overrides: ManifestOverride[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function pathJoin(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function collectLeafSources(value: unknown, source: string, path: string, out: Record<string, string>): void {
  if (Array.isArray(value)) {
    out[path] = source;
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectLeafSources(child, source, pathJoin(path, key), out);
    }
    return;
  }
  if (path) {
    out[path] = source;
  }
}

function mergeInto(
  target: JsonObject,
  patch: JsonObject,
  params: {
    source: string;
    sources: Record<string, string>;
    locks: Set<string>;
    overrides: ManifestOverride[];
    basePath?: string;
  },
): void {
  for (const [key, patchValue] of Object.entries(patch)) {
    const path = pathJoin(params.basePath ?? '', key);
    if (params.locks.has(path) || [...params.locks].some((lock) => path.startsWith(`${lock}.`))) {
      continue;
    }
    if (isObject(patchValue) && isObject(target[key])) {
      mergeInto(target[key] as JsonObject, patchValue, { ...params, basePath: path });
      continue;
    }
    for (const [sourcePath, previousSource] of Object.entries(params.sources)) {
      if (sourcePath !== path && !sourcePath.startsWith(`${path}.`)) continue;
      if (previousSource !== params.source) {
        params.overrides.push({ path: sourcePath, from: previousSource, to: params.source });
      }
      delete params.sources[sourcePath];
    }
    target[key] = clone(patchValue);
    collectLeafSources(patchValue, params.source, path, params.sources);
  }
}

function presetPatch(preset: CapabilityPreset): JsonObject {
  const {
    id: _id,
    name: _name,
    description: _description,
    version: _version,
    extends: _extends,
    locks: _locks,
    ...patch
  } = preset;
  return patch as JsonObject;
}

export function resolveEffectiveAgentManifest(params: ResolveManifestParams): ResolveManifestResult {
  const agent = AgentConfigEntrySchema.parse(params.agent);
  const presetLayer = resolveCapabilityPresetLayer({
    presetIds: agent.extends,
    presets: params.presets,
    defaultPresetId: params.defaultPresetId,
  });

  const merged: JsonObject = clone(presetLayer.patch) as JsonObject;
  const sources = { ...presetLayer.sources };
  const locks = new Set(presetLayer.locks);
  const overrides = [...presetLayer.overrides];
  const { extends: _extends, ...agentPatch } = agent;
  mergeInto(merged, agentPatch as JsonObject, {
    source: `agent:${agent.id}`,
    sources,
    locks,
    overrides,
  });

  return {
    manifest: AgentManifestSchema.parse({ ...merged, id: agent.id, enabled: agent.enabled, extends: agent.extends }),
    presetChain: presetLayer.presetChain,
    sources,
    overrides,
    locks: [...locks],
  };
}

export function resolveCapabilityPresetLayer(params: {
  presetIds?: readonly string[];
  presets?: Record<string, CapabilityPreset>;
  defaultPresetId?: string;
}): ResolvePresetLayerResult {
  const presets = Object.fromEntries(
    Object.entries(params.presets ?? {}).map(([id, preset]) => [id, CapabilityPresetSchema.parse(preset)]),
  );
  const defaultPresetId = params.defaultPresetId ?? DEFAULT_CAPABILITY_PRESET_ID;
  const presetIds = [
    ...(presets[defaultPresetId] ? [defaultPresetId] : []),
    ...(params.presetIds ?? []).filter((id) => id !== defaultPresetId),
  ];
  const chain = linearizePresetIds(presetIds, presets).map((presetId) => presets[presetId]!);

  const merged: JsonObject = {};
  const sources: Record<string, string> = {};
  const locks = new Set<string>();
  const overrides: ManifestOverride[] = [];
  for (const preset of chain) {
    mergeInto(merged, presetPatch(preset), {
      source: `preset:${preset.id}@${preset.version}`,
      sources,
      locks,
      overrides,
    });
    for (const lock of preset.locks ?? []) {
      locks.add(lock);
    }
  }

  return {
    patch: merged as CapabilityPresetPatch,
    presetChain: chain.map((preset) => preset.id),
    sources,
    locks: [...locks],
    overrides,
  };
}

export function getManifestSource(result: ResolveManifestResult, path: string): string | undefined {
  return result.sources[path];
}
