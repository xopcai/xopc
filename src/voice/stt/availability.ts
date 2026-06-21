import type { STTConfig } from './types.js';

function providerHasConfig(config: STTConfig, providerId: string): boolean {
  const provider = config.providers?.[providerId];
  if (provider && Object.keys(provider).length > 0) return true;
  return [...(config.models ?? []), ...(config.sharedModels ?? [])].some(
    (entry) => entry.provider === providerId && entry.capabilities?.includes('audio'),
  );
}

/**
 * Lightweight availability check for channel routing. Do not import the STT
 * factory/provider registry here; channel plugins call this at startup and the
 * provider registry pulls optional SDKs (e.g. openai) into Electron's dynamic
 * extension runtime path.
 */
export function isSTTAvailable(config?: STTConfig): boolean {
  if (!config?.enabled) return false;
  if (providerHasConfig(config, config.provider)) return true;
  if (config.fallback?.enabled) {
    return config.fallback.order.some((providerId) => providerHasConfig(config, providerId));
  }
  return false;
}
