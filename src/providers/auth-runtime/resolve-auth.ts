/**
 * Higher-level auth resolution that returns the *full* profile context, not
 * just the API key. Vendors that support multiple auth modes (e.g. OpenAI
 * api-key + Codex OAuth + Azure api-key) call this to pick the right
 * branch.
 *
 * Resolution order matches `resolveApiKeyForProvider`:
 *   1. AuthProfileStore (per-agent profile — may be OAuth)
 *   2. cfg.providers.<id>.apiKey
 *   3. PROVIDER_ENV_MAP[providerId] env vars
 *
 * Returns:
 *   - `mode: 'oauth' | 'azure-key' | 'api-key'`
 *   - `apiKey` (or OAuth access token) if found
 *   - `profileId` when the credential came from the store
 */

import { getApiKeyFromEnv } from '../env-keys.js';
import { getDefaultAuthProfileStore } from './auth-profile-store.js';
import type { AuthProfile, ProviderAuthMode, ResolveApiKeyOptions } from './types.js';

export interface ProviderAuthResolution {
  apiKey?: string;
  mode: ProviderAuthMode;
  profileId?: string;
  /** Source bucket: 'store' | 'config' | 'env' | 'none'. */
  source: 'store' | 'config' | 'env' | 'none';
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

  // 2. cfg.providers.<id>.apiKey
  const cfgKey = readCfgApiKey(options.cfg, providerId);
  if (cfgKey) {
    const azure = readCfgAzureMeta(options.cfg, providerId);
    return {
      apiKey: cfgKey,
      mode: azure ? 'azure-key' : 'api-key',
      source: 'config',
      meta: azure,
    };
  }

  // 3. env
  const envKey = options.envReader
    ? readFromCustomEnv(options.envReader, providerId)
    : getApiKeyFromEnv(providerId);
  if (envKey) {
    return { apiKey: envKey, mode: 'api-key', source: 'env' };
  }

  return { apiKey: undefined, mode: 'api-key', source: 'none' };
}

function pickProfile(
  store: { get?(p: string, id?: string): AuthProfile | undefined; getApiKeySync(p: string, id?: string): string | undefined },
  providerId: string,
  profileName?: string,
): AuthProfile | undefined {
  if (typeof store.get === 'function') {
    try {
      return store.get(providerId, profileName);
    } catch {
      // fall through to legacy lookup
    }
  }
  // Legacy-only stores that just have getApiKeySync — synthesize a minimal
  // profile so callers can still branch on `mode === 'api-key'`.
  let key: string | undefined;
  try {
    key = store.getApiKeySync(providerId, profileName);
  } catch {
    return undefined;
  }
  if (!key) return undefined;
  return {
    provider: providerId,
    profileId: profileName ?? 'default',
    mode: 'api-key',
    apiKey: key,
  };
}

function readCfgApiKey(cfg: ResolveApiKeyOptions['cfg'], providerId: string): string | undefined {
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>)[providerId];
  if (!entry || typeof entry !== 'object') return undefined;
  const apiKey = (entry as Record<string, unknown>).apiKey;
  return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined;
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
