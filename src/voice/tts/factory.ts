/**
 * TTS factory — registry-driven provider chain construction.
 *
 * Looks up SpeechProviderPlugin instances from the central registry
 * (src/voice/tts/speech-registry.ts), builds per-provider config via
 * plugin.resolveConfig, and filters out providers that report
 * isConfigured() === false.
 *
 * Side-effect import of `./providers/index.js` ensures all built-in providers
 * self-register before the first lookup.
 */

import { createLogger } from '../../utils/logger.js';
import { getModelCatalogStore } from '../../providers/model-catalog-store.js';
import { compareCatalogModels } from '../../providers/model-catalog-ranking.js';

import './providers/index.js'; // side-effect: register built-in providers
import { buildTtsResolveRawConfig } from './config-slice.js';
import { getSpeechProvider, listSpeechProviders } from './speech-registry.js';
import type { SpeechProviderConfig, SpeechProviderPlugin } from './speech-provider-types.js';
import type { TTSConfig, TTSProvider } from './types.js';

const log = createLogger('TTS:Factory');

/** A configured plugin ready to synthesize, with its resolved config snapshot. */
export interface ResolvedSpeechProvider {
  plugin: SpeechProviderPlugin;
  /** Provider id from the chain config (may differ from plugin.id when alias). */
  providerId: TTSProvider;
  /** Per-provider normalized config (output of plugin.resolveConfig). */
  providerConfig: SpeechProviderConfig;
  /** Plugin-shared timeout/maxLength carried from TTSConfig. */
  timeoutMs: number;
}

/** Resolve a single provider id → plugin + per-call config, or null if unavailable. */
export function resolveSpeechProvider(
  providerId: TTSProvider,
  config: TTSConfig,
  providerOverride?: Record<string, unknown>,
): ResolvedSpeechProvider | null {
  const plugin = getSpeechProvider(providerId);
  if (!plugin) {
    log.warn({ providerId }, `Unknown TTS provider "${providerId}" (not registered)`);
    return null;
  }
  const rawConfig = buildTtsResolveRawConfig(providerId, config);
  if (providerOverride) {
    rawConfig[providerId] = {
      ...((rawConfig[providerId] as Record<string, unknown> | undefined) ?? {}),
      ...providerOverride,
    };
  }
  const timeoutMs = config.timeoutMs ?? 30_000;
  // SpeechProviderResolveConfigContext requires `cfg: Config` but this entry
  // point only holds a TTSConfig slice. Cast through unknown — built-in
  // providers' resolveConfig implementations only read `rawConfig`.
  const providerConfig = plugin.resolveConfig({
    cfg: undefined as unknown as Parameters<typeof plugin.resolveConfig>[0]['cfg'],
    rawConfig,
    timeoutMs,
  });
  if (!plugin.isConfigured({ providerConfig, timeoutMs })) {
    log.debug({ providerId }, `Provider "${providerId}" reports not configured; skipping`);
    return null;
  }
  return {
    plugin,
    providerId,
    providerConfig,
    timeoutMs,
  };
}

/** Order providers: explicit fallback when enabled, otherwise auto-select by registry order. */
export function resolveProviderOrder(
  primary: TTSProvider,
  fallback: TTSConfig['fallback'] | undefined,
  config: TTSConfig,
): TTSProvider[] {
  if (fallback?.enabled && fallback.order.length > 0) {
    const order: TTSProvider[] = [primary];
    for (const provider of fallback.order) {
      if (provider !== primary && !order.includes(provider)) {
        order.push(provider);
      }
    }
    return order;
  }

  if (!config.managedAuto) return [primary];

  const configured = listSpeechProviders()
    .map((plugin) => {
      const resolved = resolveSpeechProvider(plugin.id, config);
      return resolved ? plugin : null;
    })
    .filter((plugin): plugin is SpeechProviderPlugin => plugin !== null)
    .sort((left, right) => {
      const leftOrder = left.autoSelectOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.autoSelectOrder ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.id.localeCompare(right.id);
    })
    .map((plugin) => plugin.id);

  const order: TTSProvider[] = [primary];
  for (const providerId of configured) {
    if (providerId !== primary && !order.includes(providerId)) {
      order.push(providerId);
    }
  }
  return order;
}

/** Resolve the full provider chain in priority order; only configured plugins included. */
export function resolveSpeechProviderChain(config: TTSConfig): ResolvedSpeechProvider[] {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }
  const order = resolveProviderOrder(config.provider, config.fallback, config);
  const chain: ResolvedSpeechProvider[] = [];
  for (const providerId of order) {
    if (providerId === 'xopc-cloud') {
      const configuredModel = typeof config.providers?.['xopc-cloud']?.model === 'string'
        ? config.providers['xopc-cloud'].model
        : undefined;
      const source = getModelCatalogStore().getSource('xopc-cloud');
      const models = source?.models
        .filter((model) => model.availability === 'available'
          && model.kind === 'tts'
          && model.operations.includes('audio.speech')
          && Boolean(model.tts?.defaultVoice))
        .sort((left, right) => {
          if (left.id === configuredModel) return -1;
          if (right.id === configuredModel) return 1;
          return compareCatalogModels(left, right, source.recommended?.tts);
        }) ?? [];
      for (const model of models) {
        const resolved = resolveSpeechProvider(providerId, config, { model: model.id });
        if (resolved) chain.push(resolved);
      }
      continue;
    }
    const resolved = resolveSpeechProvider(providerId, config);
    if (resolved) {
      chain.push(resolved);
    }
  }
  if (chain.length === 0) {
    throw new Error('No TTS providers are available');
  }
  log.debug(
    { primary: config.provider, chain: chain.map((c) => c.providerId) },
    'TTS provider chain resolved',
  );
  return chain;
}

// ---- Public API ---------------------------------------------------------

export function isTTSAvailable(config?: TTSConfig): boolean {
  if (!config?.enabled) {
    return false;
  }
  try {
    return resolveSpeechProviderChain(config).length > 0;
  } catch {
    return false;
  }
}

export function isProviderConfigured(provider: TTSProvider, config: TTSConfig): boolean {
  return resolveSpeechProvider(provider, config) !== null;
}

export function getAvailableProviders(config: TTSConfig): TTSProvider[] {
  return listSpeechProviders()
    .map((plugin) => plugin.id)
    .filter((provider) => isProviderConfigured(provider, config));
}

/** List all registered SpeechProviderPlugin ids — primarily for the gateway console. */
export function listRegisteredSpeechProviderIds(): string[] {
  return listSpeechProviders().map((plugin) => plugin.id);
}
