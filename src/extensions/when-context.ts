import type { Config as SurfaceConfig } from '../config/config-surface.js';
import { getAllProviders, isProviderConfiguredSync } from '../providers/index.js';
import type { ExtensionLoader } from './loader.js';

/**
 * Flat payload for `GET /api/context` and client-side `when` evaluation.
 */
export function buildWhenContextSnapshot(
  config: SurfaceConfig,
  loader: ExtensionLoader | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    platform: process.platform,
    isElectron: Boolean(process.versions.electron),
    gatewayAuthenticated: true,
    sessionActive: false,
    agentRunning: false,
  };
  for (const p of getAllProviders()) {
    out[`hasProvider.${p}`] = isProviderConfiguredSync(p);
  }
  const channels = config.channels;
  if (channels && typeof channels === 'object') {
    for (const [id, raw] of Object.entries(channels)) {
      if (raw && typeof raw === 'object' && raw !== null && 'enabled' in raw) {
        out[`hasChannel.${id}`] = (raw as { enabled?: boolean }).enabled === true;
      } else {
        out[`hasChannel.${id}`] = Boolean(raw);
      }
    }
  }
  if (loader) {
    try {
      loader.setConfig(config);
      for (const ext of loader.discoverExtensions()) {
        out[`extensionEnabled.${ext.id}`] = true;
      }
    } catch {
      /* non-fatal for context snapshot */
    }
  }
  return out;
}
