import type { Config } from '../config/schema.js';
import type { SessionAgentConfig } from '../session/config-types.js';
import { getImageGenerationProvider } from '../agent/image/generation/provider-registry.js';
import { parseImageGenerationModelRef } from '../agent/image/generation/model-ref.js';
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
  kind: 'text' | 'image-generation';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function addRef(
  out: CollectedReference[],
  value: unknown,
  location: string,
  kind: CollectedReference['kind'] = 'text',
): void {
  if (typeof value === 'string' && value.trim()) out.push({ ref: value.trim(), location, kind });
}

function collectToolModel(
  out: CollectedReference[],
  value: unknown,
  location: string,
  kind: CollectedReference['kind'] = 'text',
): void {
  const model = asRecord(value);
  if (!model) return;
  addRef(out, model.primary, `${location}.primary`, kind);
  if (Array.isArray(model.fallbacks)) {
    model.fallbacks.forEach((ref, index) => addRef(
      out,
      ref,
      `${location}.fallbacks[${index}]`,
      kind,
    ));
  }
}

function collectModelPolicy(out: CollectedReference[], value: unknown, location: string): void {
  const policy = asRecord(value);
  if (!policy) return;
  const chat = asRecord(policy.chat);
  if (chat) {
    addRef(out, chat.primary, `${location}.chat.primary`);
    if (Array.isArray(chat.fallbacks)) chat.fallbacks.forEach((ref, index) => addRef(
      out, ref, `${location}.chat.fallbacks[${index}]`,
    ));
  }
  const intents = asRecord(policy.intents);
  for (const [intent, routeValue] of Object.entries(intents ?? {})) {
    const route = asRecord(routeValue);
    if (!route) continue;
    addRef(out, route.primary, `${location}.intents.${intent}.primary`);
    if (Array.isArray(route.fallbacks)) {
      route.fallbacks.forEach((ref, index) => addRef(
        out,
        ref,
        `${location}.intents.${intent}.fallbacks[${index}]`,
      ));
    }
  }
  collectToolModel(out, policy.imageUnderstanding, `${location}.imageUnderstanding`);
  collectToolModel(
    out,
    policy.imageGeneration,
    `${location}.imageGeneration`,
    'image-generation',
  );
}

function collectReferences(
  config: Config,
  sessionConfigs: ReadonlyMap<string, SessionAgentConfig>,
): CollectedReference[] {
  const out: CollectedReference[] = [];
  collectModelPolicy(out, config.agents.defaults.models, 'agents.defaults.models');
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

function hasImageGenerationModel(ref: string): boolean {
  const parsed = parseImageGenerationModelRef(ref);
  if (!parsed) return false;
  return getImageGenerationProvider(parsed.provider)?.models.includes(parsed.model) ?? false;
}

export function auditModelReferences(
  config: Config,
  sessionConfigs: ReadonlyMap<string, SessionAgentConfig> = new Map(),
  deps: {
    registry?: ModelRegistry;
    catalog?: ModelCatalogSnapshot;
    resolveImageGenerationModel?: (ref: string) => boolean;
  } = {},
): ModelReferenceHealth[] {
  const registry = deps.registry ?? getModelRegistry();
  const catalog = deps.catalog ?? getModelCatalogStore().load();
  const resolveImageGenerationModel = deps.resolveImageGenerationModel ?? hasImageGenerationModel;
  const grouped = new Map<string, CollectedReference[]>();
  for (const reference of collectReferences(config, sessionConfigs)) {
    const references = grouped.get(reference.ref) ?? [];
    references.push(reference);
    grouped.set(reference.ref, references);
  }

  return [...grouped.entries()]
    .map(([ref, references]): ModelReferenceHealth => {
      const available = references.every((reference) => reference.kind === 'image-generation'
        ? resolveImageGenerationModel(ref)
        : Boolean(registry.resolve(ref)));
      const availability = available ? 'available' : 'unavailable';
      const textOnly = references.every((reference) => reference.kind === 'text');
      const suggestion = availability === 'unavailable' && textOnly
        ? suggestedRef(ref, catalog)
        : undefined;
      return {
        ref,
        availability,
        locations: references.map((reference) => reference.location),
        ...(suggestion ? { suggestedRef: suggestion } : {}),
      };
    })
    .sort((a, b) => a.ref.localeCompare(b.ref));
}
