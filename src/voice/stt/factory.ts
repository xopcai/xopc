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
import { getMediaUnderstandingProvider } from '../../media-understanding/registry.js';
import type { AudioProviderResolvedConfig } from '../../media-understanding/audio-transcription-runner.js';
import type { STTConfig } from './types.js';

const log = createLogger('STT:Factory');

/** Resolve a single STT provider config slice → runner-shaped resolved config, or null when unavailable. */
export function resolveSTTProviderConfig(
  providerId: STTConfig['provider'],
  config: STTConfig,
): AudioProviderResolvedConfig | null {
  const plugin = getMediaUnderstandingProvider(providerId);
  if (!plugin || typeof plugin.transcribeAudio !== 'function') {
    log.warn(
      { providerId },
      `STT provider "${providerId}" is not registered or does not implement transcribeAudio`,
    );
    return null;
  }
  const slice = providerId === 'openai' ? config.openai : config.alibaba;
  const apiKey =
    slice?.apiKey ??
    (providerId === 'openai' ? process.env.OPENAI_API_KEY : process.env.DASHSCOPE_API_KEY);
  if (!apiKey) {
    log.debug({ providerId }, `STT provider "${providerId}" missing API key; skipping`);
    return null;
  }
  return {
    id: providerId,
    apiKey,
    ...(slice?.model ? { model: slice.model } : {}),
  };
}

/** Resolve provider order (primary first, then fallback chain — deduped). */
export function resolveSTTProviderOrder(
  primary: STTConfig['provider'],
  fallback?: STTConfig['fallback'],
): STTConfig['provider'][] {
  if (!fallback?.enabled) {
    return [primary];
  }
  const order: STTConfig['provider'][] = [primary];
  for (const p of fallback.order) {
    if (p !== primary && !order.includes(p)) {
      order.push(p);
    }
  }
  return order;
}

/** Build the full chain of resolved provider configs in priority order. */
export function resolveSTTProviderChain(config: STTConfig): AudioProviderResolvedConfig[] {
  if (!config.enabled) {
    return [];
  }
  const order = resolveSTTProviderOrder(config.provider, config.fallback);
  const chain: AudioProviderResolvedConfig[] = [];
  for (const providerId of order) {
    const resolved = resolveSTTProviderConfig(providerId, config);
    if (resolved) {
      chain.push(resolved);
    }
  }
  return chain;
}
