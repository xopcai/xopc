/**
 * STT factory — registry-driven provider chain construction.
 *
 * Resolves STTConfig slices into `AudioProviderResolvedConfig` arrays that are
 * consumed by `runAudioTranscription`. Side-effect import of `./providers/index.js`
 * ensures all built-in STT providers self-register with the media-understanding
 * registry before the first lookup.
 */

import { createLogger } from '../../utils/logger.js';

import './providers/index.js'; // side-effect: register built-in STT providers
import { resolveModelEntries } from '../../media-understanding/resolve-entries.js';
import {
  getMediaUnderstandingProvider,
  listMediaUnderstandingProviders,
} from '../../media-understanding/registry.js';
import type { AudioProviderResolvedConfig } from '../../media-understanding/audio-transcription-runner.js';
import {
  STT_LEGACY_ENV_KEYS,
  readSttProviderFields,
  resolveSttProviderConfigSlice,
} from './config-slice.js';
import type { MediaUnderstandingModelEntry, STTConfig } from './types.js';

const log = createLogger('STT:Factory');

function resolveApiKey(
  providerId: string,
  fields: ReturnType<typeof readSttProviderFields>,
  envKey?: string,
): string | undefined {
  return (
    fields.apiKey ??
    (envKey ? process.env[envKey] : undefined) ??
    process.env[STT_LEGACY_ENV_KEYS[providerId] ?? '']
  );
}

/** Resolve a single STT provider config slice → runner-shaped resolved config, or null when unavailable. */
export function resolveSTTProviderConfig(
  providerId: string,
  config: STTConfig,
  entry?: MediaUnderstandingModelEntry,
): AudioProviderResolvedConfig | null {
  const plugin = getMediaUnderstandingProvider(providerId);
  if (!plugin || typeof plugin.transcribeAudio !== 'function') {
    log.warn(
      { providerId },
      `STT provider "${providerId}" is not registered or does not implement transcribeAudio`,
    );
    return null;
  }

  const slice = resolveSttProviderConfigSlice(providerId, config);
  const fields = readSttProviderFields(slice, entry);
  const apiKey = resolveApiKey(providerId, fields, plugin.envKey);
  const requiresApiKey = plugin.requiresApiKey !== false;
  if (requiresApiKey && !apiKey) {
    log.debug({ providerId }, `STT provider "${providerId}" missing API key; skipping`);
    return null;
  }

  return {
    id: providerId,
    ...(apiKey ? { apiKey } : {}),
    ...(fields.baseUrl ? { baseUrl: fields.baseUrl } : {}),
    ...(fields.headers ? { headers: fields.headers } : {}),
    ...(fields.model ?? entry?.model ?? plugin.defaultModels?.audio
      ? { model: fields.model ?? entry?.model ?? plugin.defaultModels?.audio }
      : {}),
    ...(fields.language ? { language: fields.language } : {}),
    ...(fields.prompt ? { prompt: fields.prompt } : {}),
  };
}

function sortAudioProvidersByAutoPriority(
  plugins: ReturnType<typeof listMediaUnderstandingProviders>,
): string[] {
  return [...plugins]
    .filter(
      (plugin) =>
        plugin.capabilities?.includes('audio') && typeof plugin.transcribeAudio === 'function',
    )
    .sort((left, right) => {
      const leftOrder = left.autoPriority?.audio ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.autoPriority?.audio ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.id.localeCompare(right.id);
    })
    .map((plugin) => plugin.id);
}

/** Resolve provider order: explicit fallback when enabled, otherwise auto-select by registry order. */
export function resolveSTTProviderOrder(
  primary: string,
  fallback: STTConfig['fallback'] | undefined,
  config: STTConfig,
): string[] {
  if (fallback?.enabled && fallback.order.length > 0) {
    const order: string[] = [primary];
    for (const providerId of fallback.order) {
      if (providerId !== primary && !order.includes(providerId)) {
        order.push(providerId);
      }
    }
    return order;
  }

  const configured = sortAudioProvidersByAutoPriority(listMediaUnderstandingProviders()).filter(
    (providerId) => resolveSTTProviderConfig(providerId, config) !== null,
  );

  const order: string[] = [primary];
  for (const providerId of configured) {
    if (providerId !== primary && !order.includes(providerId)) {
      order.push(providerId);
    }
  }
  return order;
}

function resolveModelEntryChain(config: STTConfig): AudioProviderResolvedConfig[] {
  const entries = resolveModelEntries({
    capability: 'audio',
    capabilityModels: config.models,
    sharedModels: config.sharedModels,
  });
  const chain: AudioProviderResolvedConfig[] = [];
  for (const entry of entries) {
    const providerId = entry.provider?.trim();
    if (!providerId) {
      continue;
    }
    const resolved = resolveSTTProviderConfig(providerId, config, entry);
    if (resolved) {
      chain.push(resolved);
    }
  }
  return chain;
}

/** Build the full chain of resolved provider configs in priority order. */
export function resolveSTTProviderChain(config: STTConfig): AudioProviderResolvedConfig[] {
  if (!config.enabled) {
    return [];
  }

  const modelChain = resolveModelEntryChain(config);
  if (modelChain.length > 0) {
    return modelChain;
  }

  const order = resolveSTTProviderOrder(config.provider, config.fallback, config);
  const chain: AudioProviderResolvedConfig[] = [];
  for (const providerId of order) {
    const resolved = resolveSTTProviderConfig(providerId, config);
    if (resolved) {
      chain.push(resolved);
    }
  }
  return chain;
}
