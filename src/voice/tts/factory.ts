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

import './providers/index.js'; // side-effect: register built-in providers
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

/**
 * Build the SpeechProviderConfig consumed by plugin.resolveConfig from the
 * TTSConfig shape. The plugin's own `resolveConfig` further normalizes
 * per-provider keys; we just hand it the raw nested object.
 */
function buildRawConfig(providerId: TTSProvider, config: TTSConfig): Record<string, unknown> {
  switch (providerId) {
    case 'openai':
      return { openai: config.openai ?? {} };
    case 'alibaba':
      return { alibaba: config.alibaba ?? {} };
    case 'edge':
      return { edge: config.edge ?? {} };
    case 'minimax':
      return { minimax: config.minimax ?? {} };
    default:
      return {};
  }
}

/** Resolve a single provider id → plugin + per-call config, or null if unavailable. */
export function resolveSpeechProvider(
  providerId: TTSProvider,
  config: TTSConfig,
): ResolvedSpeechProvider | null {
  const plugin = getSpeechProvider(providerId);
  if (!plugin) {
    log.warn({ providerId }, `Unknown TTS provider "${providerId}" (not registered)`);
    return null;
  }
  const rawConfig = buildRawConfig(providerId, config);
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

/** Order = primary first, then fallback chain (deduped, primary excluded from fallback list). */
export function resolveProviderOrder(
  primary: TTSProvider,
  fallback?: { enabled: boolean; order: TTSProvider[] },
): TTSProvider[] {
  if (!fallback?.enabled) {
    return [primary];
  }
  const order: TTSProvider[] = [primary];
  for (const provider of fallback.order) {
    if (provider !== primary && !order.includes(provider)) {
      order.push(provider);
    }
  }
  return order;
}

/** Resolve the full provider chain in priority order; only configured plugins included. */
export function resolveSpeechProviderChain(config: TTSConfig): ResolvedSpeechProvider[] {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }
  const order = resolveProviderOrder(config.provider, config.fallback);
  const chain: ResolvedSpeechProvider[] = [];
  for (const providerId of order) {
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
  const allProviders: TTSProvider[] = ['openai', 'alibaba', 'minimax', 'edge'];
  return allProviders.filter((provider) => isProviderConfigured(provider, config));
}

/** List all registered SpeechProviderPlugin ids — primarily for the gateway console. */
export function listRegisteredSpeechProviderIds(): string[] {
  return listSpeechProviders().map((plugin) => plugin.id);
}
