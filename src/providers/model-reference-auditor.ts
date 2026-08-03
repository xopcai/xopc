import type { Config } from '../config/schema.js';
import type { SessionAgentConfig } from '../session/config-types.js';
import { getModelCatalogStore, type ModelCatalogSnapshot } from './model-catalog-store.js';
import { getModelRegistry, type ModelRegistry } from './model-registry.js';

export interface ModelReferenceHealth {
  ref: string;
  availability: 'available' | 'unavailable';
  locations: string[];
  suggestedRef?: string;
}

interface CollectedReference {
  ref: string;
  location: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function addRef(out: CollectedReference[], value: unknown, location: string): void {
  if (typeof value === 'string' && value.trim()) out.push({ ref: value.trim(), location });
}

function collectToolModel(out: CollectedReference[], value: unknown, location: string): void {
  const model = asRecord(value);
  if (!model) return;
  addRef(out, model.primary, `${location}.primary`);
  if (Array.isArray(model.fallbacks)) {
    model.fallbacks.forEach((ref, index) => addRef(out, ref, `${location}.fallbacks[${index}]`));
  }
}

function collectModelPolicy(out: CollectedReference[], value: unknown, location: string): void {
  const policy = asRecord(value);
  if (!policy) return;
  const roles = asRecord(policy.roles);
  for (const [roleId, roleValue] of Object.entries(roles ?? {})) {
    const role = asRecord(roleValue);
    if (!role) continue;
    addRef(out, role.model, `${location}.roles.${roleId}.model`);
    if (Array.isArray(role.fallbacks)) {
      role.fallbacks.forEach((ref, index) => addRef(
        out,
        ref,
        `${location}.roles.${roleId}.fallbacks[${index}]`,
      ));
    }
  }
  collectToolModel(out, policy.imageModel, `${location}.imageModel`);
  collectToolModel(out, policy.imageGenerationModel, `${location}.imageGenerationModel`);
}

function collectReferences(
  config: Config,
  sessionConfigs: ReadonlyMap<string, SessionAgentConfig>,
): CollectedReference[] {
  const out: CollectedReference[] = [];
  for (const [presetId, preset] of Object.entries(config.agents.capabilityPresets)) {
    collectModelPolicy(out, preset.models, `agents.capabilityPresets.${presetId}.models`);
  }
  for (const agent of config.agents.list) {
    collectModelPolicy(out, agent.models, `agents.list.${agent.id}.models`);
  }
  for (const [sessionKey, sessionConfig] of sessionConfigs) {
    addRef(out, sessionConfig.modelOverride, `sessions.${sessionKey}.modelOverride`);
  }
  return out;
}

function suggestedRef(ref: string, catalog: ModelCatalogSnapshot): string | undefined {
  const providerId = ref.split('/')[0];
  const source = Object.values(catalog.sources).find((entry) => entry.providerId === providerId);
  if (!source) return undefined;
  const available = new Set(source.models
    .filter((model) => model.availability === 'available')
    .map((model) => model.id));
  if (source.recommendedModel && available.has(source.recommendedModel)) {
    return `${providerId}/${source.recommendedModel}`;
  }
  const first = source.models.find((model) => model.availability === 'available');
  return first ? `${providerId}/${first.id}` : undefined;
}

export function auditModelReferences(
  config: Config,
  sessionConfigs: ReadonlyMap<string, SessionAgentConfig> = new Map(),
  deps: {
    registry?: ModelRegistry;
    catalog?: ModelCatalogSnapshot;
  } = {},
): ModelReferenceHealth[] {
  const registry = deps.registry ?? getModelRegistry();
  const catalog = deps.catalog ?? getModelCatalogStore().load();
  const grouped = new Map<string, string[]>();
  for (const reference of collectReferences(config, sessionConfigs)) {
    const locations = grouped.get(reference.ref) ?? [];
    locations.push(reference.location);
    grouped.set(reference.ref, locations);
  }

  return [...grouped.entries()]
    .map(([ref, locations]): ModelReferenceHealth => {
      const availability = registry.resolve(ref) ? 'available' : 'unavailable';
      const suggestion = availability === 'unavailable' ? suggestedRef(ref, catalog) : undefined;
      return {
        ref,
        availability,
        locations,
        ...(suggestion ? { suggestedRef: suggestion } : {}),
      };
    })
    .sort((a, b) => a.ref.localeCompare(b.ref));
}
