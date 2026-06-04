import type { Config } from '../../../config/schema.js';
import type { ImageProviderUiMetadata } from './image-provider-ui.js';
import type {
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
  ImageGenerationResult,
} from './types.js';

/** Lifecycle context for {@link ImageGenerationProvider#isConfigured}. */
export interface ImageGenerationProviderConfiguredContext {
  cfg?: Config;
  agentDir?: string;
}

export interface ImageGenerationProvider {
  /** Lower-case provider id (registry key). */
  id: string;
  /** Optional aliases — alternate ids that resolve to this provider. */
  aliases?: string[];
  label?: string;
  defaultModel?: string;
  models?: string[];
  /** Provider capability map. */
  capabilities?: ImageGenerationProviderCapabilities;
  /**
   * Synchronous configuration check (Step 2 — was async in Step 1).
   * MUST NOT touch keychain or trigger OS prompts.
   */
  isConfigured?: (ctx: ImageGenerationProviderConfiguredContext) => boolean;
  /** Gateway console presets (regions / base URLs); defined by each bundled extension. */
  ui?: ImageProviderUiMetadata;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

/**
 * Provider ids that must never be registered (defensive — guards against
 * accidentally shadowing well-known internal namespaces / prototype keys).
 */
const UNSAFE_PROVIDER_IDS = new Set<string>(['__proto__', 'constructor', 'prototype']);

const registry = new Map<string, ImageGenerationProvider>();
const aliasIndex = new Map<string, string>();

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function isExtensionDisabled(cfg: Config | undefined, providerId: string): boolean {
  if (!cfg) return false;
  // `cfg.extensions[<id>].enabled === false` ⇒ skip the provider in listings.
  // We keep the lookup in a defensively-typed shape; Step 4 may move this to
  // a typed schema entry.
  const extensions = (cfg as unknown as { extensions?: Record<string, unknown> } | undefined)?.extensions;
  if (!extensions || typeof extensions !== 'object') return false;
  const entry = (extensions as Record<string, unknown>)[providerId];
  if (!entry || typeof entry !== 'object') return false;
  const enabled = (entry as { enabled?: unknown }).enabled;
  return enabled === false;
}

export function registerImageGenerationProvider(provider: ImageGenerationProvider): void {
  if (!provider.id?.trim()) {
    throw new Error('Image generation provider id is required');
  }
  const id = normalizeId(provider.id);
  if (UNSAFE_PROVIDER_IDS.has(id)) {
    throw new Error(`Image generation provider id is reserved: ${provider.id}`);
  }
  // Drop any stale alias entries that pointed at the previous registration.
  for (const [alias, target] of [...aliasIndex.entries()]) {
    if (target === id) aliasIndex.delete(alias);
  }
  registry.set(id, provider);
  for (const aliasRaw of provider.aliases ?? []) {
    if (typeof aliasRaw !== 'string') continue;
    const alias = normalizeId(aliasRaw);
    if (!alias || alias === id) continue;
    if (UNSAFE_PROVIDER_IDS.has(alias)) continue;
    if (registry.has(alias)) continue; // Real ids always win over aliases.
    aliasIndex.set(alias, id);
  }
}

/**
 * Resolve a provider by id or alias.
 *
 * `cfg` is honoured to skip providers disabled via `cfg.extensions[<id>].enabled = false`.
 */
export function getImageGenerationProvider(
  providerId: string,
  cfg?: Config,
): ImageGenerationProvider | undefined {
  if (typeof providerId !== 'string') return undefined;
  const id = normalizeId(providerId);
  if (!id) return undefined;
  const direct = registry.get(id);
  if (direct) {
    return isExtensionDisabled(cfg, direct.id) ? undefined : direct;
  }
  const aliasTarget = aliasIndex.get(id);
  if (!aliasTarget) return undefined;
  const aliased = registry.get(aliasTarget);
  if (!aliased) return undefined;
  return isExtensionDisabled(cfg, aliased.id) ? undefined : aliased;
}

export function listImageGenerationProviders(cfg?: Config): ImageGenerationProvider[] {
  const out: ImageGenerationProvider[] = [];
  for (const provider of registry.values()) {
    if (isExtensionDisabled(cfg, provider.id)) continue;
    out.push(provider);
  }
  return out;
}

export interface ImageGenerationProviderSummary {
  id: string;
  label?: string;
  defaultModel?: string;
  models: string[];
  aliases?: string[];
  capabilities?: ImageGenerationProviderCapabilities;
  ui?: ImageProviderUiMetadata;
}

export function listImageGenerationProvidersSummary(
  cfg?: Config,
): ImageGenerationProviderSummary[] {
  return listImageGenerationProviders(cfg).map((provider) => ({
    id: provider.id,
    ...(provider.label ? { label: provider.label } : {}),
    ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
    models: provider.models ?? (provider.defaultModel ? [provider.defaultModel] : []),
    ...(provider.aliases?.length ? { aliases: [...provider.aliases] } : {}),
    ...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
    ...(provider.ui ? { ui: provider.ui } : {}),
  }));
}

export function clearImageGenerationRegistryForTests(): void {
  registry.clear();
  aliasIndex.clear();
}
