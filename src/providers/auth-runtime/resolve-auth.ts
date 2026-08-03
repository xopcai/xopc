/**
 * Higher-level auth resolution that returns the *full* profile context, not
 * just the API key. Vendors that support multiple auth modes (e.g. OpenAI
 * api-key + Codex OAuth + Azure api-key) call this to pick the right
 * branch.
 *
 * Resolution order matches `resolveApiKeyForProvider`:
 *   1. AuthProfileStore (per-agent profile — may be OAuth)
 *   2. Environment variables
 *
 * Returns:
 *   - `mode: 'oauth' | 'azure-key' | 'api-key'`
 *   - `apiKey` (or OAuth access token) if found
 *   - `profileId` when the credential came from the store
 */

import { getApiKeyFromEnv } from '../env-keys.js';
import { resolveProviderApiKeyForAgentSync } from '../../auth/sync-provider-auth.js';
import { getDefaultAuthProfileStore } from './auth-profile-store.js';
import type { AuthProfile, AuthProfileStore, ProviderAuthMode, ResolveApiKeyOptions } from './types.js';

export interface ProviderAuthResolution {
  apiKey?: string;
  mode: ProviderAuthMode;
  profileId?: string;
  /** Source bucket. */
  source: 'store' | 'env' | 'none';
  /** Vendor metadata copied from the matched profile (azure resource etc.). */
  meta?: Record<string, unknown>;
}

export function resolveAuthProfileForProvider(
  options: ResolveApiKeyOptions,
): ProviderAuthResolution {
  const { providerId } = options;
  if (!providerId) {
    return { apiKey: undefined, mode: 'api-key', source: 'none' };
  }

  // 1. Profile store
  const store = options.store ?? getDefaultAuthProfileStore();
  const profile = pickProfile(store, providerId, options.profileName);
  if (profile) {
    const key =
      (typeof profile.apiKey === 'string' && profile.apiKey.length > 0 ? profile.apiKey : undefined) ??
      (typeof profile.oauthAccessToken === 'string' && profile.oauthAccessToken.length > 0
        ? profile.oauthAccessToken
        : undefined);
    if (key) {
      return {
        apiKey: key,
        mode: profile.mode,
        profileId: profile.profileId,
        source: 'store',
        meta: profile.meta,
      };
    }
  }

  if (!options.store && !options.envReader) {
    const storedKey = resolveProviderApiKeyForAgentSync(providerId, options.agentId, options.cfg);
    if (storedKey) {
      const azure = readCfgAzureMeta(options.cfg, providerId);
      return {
        apiKey: storedKey,
        mode: azure ? 'azure-key' : 'api-key',
        source: 'store',
        meta: azure,
      };
    }
  }

  // 2. env
  const envKey = options.envReader
    ? readFromCustomEnv(options.envReader, providerId)
    : getApiKeyFromEnv(providerId);
  if (envKey) {
    const azure = readCfgAzureMeta(options.cfg, providerId);
    return { apiKey: envKey, mode: azure ? 'azure-key' : 'api-key', source: 'env', meta: azure };
  }

  return { apiKey: undefined, mode: 'api-key', source: 'none' };
}

function pickProfile(
  store: AuthProfileStore,
  providerId: string,
  profileName?: string,
): AuthProfile | undefined {
  try {
    return store.get(providerId, profileName);
  } catch {
    return undefined;
  }
}

function readCfgAzureMeta(
  cfg: ResolveApiKeyOptions['cfg'],
  providerId: string,
): Record<string, unknown> | undefined {
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>)[providerId];
  if (!entry || typeof entry !== 'object') return undefined;
  const azure = (entry as Record<string, unknown>).azure;
  return azure && typeof azure === 'object' ? (azure as Record<string, unknown>) : undefined;
}

function readFromCustomEnv(
  reader: (name: string) => string | undefined,
  providerId: string,
): string | undefined {
  const fallbackName = providerId.toUpperCase().replace(/-/g, '_') + '_API_KEY';
  const v = reader(fallbackName);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
