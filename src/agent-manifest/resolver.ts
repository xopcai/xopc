import {
  AgentManifestSchema,
  CapabilityPresetSchema,
  type AgentManifest,
  type CapabilityPreset,
  type EffectiveAgentManifest,
} from './schema.js';

export interface ResolveManifestResult {
  manifest: EffectiveAgentManifest;
  sources: Record<string, string>;
}

export interface ResolveManifestParams {
  agent: AgentManifest;
  presets?: Record<string, CapabilityPreset>;
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
    patchLocks?: readonly string[];
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
    target[key] = clone(patchValue);
    collectLeafSources(patchValue, params.source, path, params.sources);
    for (const lock of params.patchLocks ?? []) {
      const lockPath = pathJoin(path, lock);
      params.locks.add(lockPath);
    }
  }
}

function resolvePresetChain(
  presetId: string,
  presets: Record<string, CapabilityPreset>,
  stack: string[],
  out: CapabilityPreset[],
): void {
  if (stack.includes(presetId)) {
    throw new Error(`Capability preset cycle detected: ${[...stack, presetId].join(' -> ')}`);
  }
  const preset = presets[presetId];
  if (!preset) {
    throw new Error(`Capability preset "${presetId}" was not found`);
  }
  for (const parent of preset.extends ?? []) {
    resolvePresetChain(parent, presets, [...stack, presetId], out);
  }
  out.push(preset);
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
  const agent = AgentManifestSchema.parse(params.agent);
  const presets = Object.fromEntries(
    Object.entries(params.presets ?? {}).map(([id, preset]) => [id, CapabilityPresetSchema.parse(preset)]),
  );
  const chain: CapabilityPreset[] = [];
  for (const presetId of agent.extends ?? []) {
    resolvePresetChain(presetId, presets, [], chain);
  }

  const merged: JsonObject = {};
  const sources: Record<string, string> = {};
  const locks = new Set<string>();
  for (const preset of chain) {
    mergeInto(merged, presetPatch(preset), {
      source: `preset:${preset.id}@${preset.version}`,
      sources,
      locks,
      patchLocks: preset.locks,
    });
    for (const lock of preset.locks ?? []) {
      locks.add(lock);
    }
  }

  const { extends: _extends, ...agentPatch } = agent;
  mergeInto(merged, agentPatch as JsonObject, {
    source: `agent:${agent.id}`,
    sources,
    locks,
  });

  return {
    manifest: AgentManifestSchema.parse({ ...merged, id: agent.id, enabled: agent.enabled, extends: agent.extends }),
    sources,
  };
}

export function getManifestSource(result: ResolveManifestResult, path: string): string | undefined {
  return result.sources[path];
}
