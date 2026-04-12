/**
 * Synchronous checks that mirror CredentialResolver.resolveApiKey sources
 * used by isProviderConfiguredSync (fallback candidate filtering).
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  resolveAgentAuthProfilesPath,
  resolveAuthProfilesPath,
  resolveOAuthPath,
} from '../config/paths.js';
import { loadConfig } from '../config/loader.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';

import type { AuthProfilesFile, ApiKeyProfile, OAuthToken } from './credentials.js';

function findProfileForProvider(
  file: AuthProfilesFile,
  provider: string,
): ApiKeyProfile | null {
  const normalizedProvider = provider.toLowerCase();
  for (const [, profile] of Object.entries(file.profiles)) {
    if (profile.provider === normalizedProvider) {
      return profile;
    }
  }
  return null;
}

function profileHasUsableKey(profile: ApiKeyProfile): boolean {
  if (profile.envVar) {
    const fromEnv = process.env[profile.envVar];
    return !!(fromEnv?.trim() || profile.key?.trim());
  }
  return !!profile.key?.trim();
}

function readAuthProfiles(path: string): AuthProfilesFile | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as {
      version?: number;
      profiles?: Record<string, ApiKeyProfile>;
    };
    return {
      version: data.version ?? 1,
      profiles: data.profiles ?? {},
    };
  } catch {
    return null;
  }
}

function hasApiKeyInProfilesFile(path: string, provider: string): boolean {
  const file = readAuthProfiles(path);
  if (!file) return false;
  const profile = findProfileForProvider(file, provider);
  return profile ? profileHasUsableKey(profile) : false;
}

function hasOAuthTokenSync(provider: string): boolean {
  const oauthPath = resolveOAuthPath(provider.toLowerCase());
  if (!existsSync(oauthPath)) return false;
  try {
    const token = JSON.parse(readFileSync(oauthPath, 'utf-8')) as OAuthToken;
    if (!token.access?.trim()) return false;
    if (token.expiresAt && token.expiresAt < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

/** Same resolution order as {@link CredentialResolver.loadFromAgentCredentials} / global profile (envVar then key). */
function resolveProfileSecret(profile: ApiKeyProfile): string | undefined {
  if (profile.envVar) {
    const fromEnv = process.env[profile.envVar]?.trim();
    if (fromEnv) return fromEnv;
  }
  if (profile.key?.trim()) return profile.key.trim();
  return undefined;
}

function readApiKeyFromProfilesFile(path: string, provider: string): string | undefined {
  const file = readAuthProfiles(path);
  if (!file) return undefined;
  const profile = findProfileForProvider(file, provider);
  if (!profile) return undefined;
  return resolveProfileSecret(profile);
}

function readOAuthAccessTokenSync(provider: string): string | undefined {
  const oauthPath = resolveOAuthPath(provider.toLowerCase());
  if (!existsSync(oauthPath)) return undefined;
  try {
    const token = JSON.parse(readFileSync(oauthPath, 'utf-8')) as OAuthToken;
    if (!token.access?.trim()) return undefined;
    if (token.expiresAt && token.expiresAt < Date.now()) return undefined;
    return token.access.trim();
  } catch {
    return undefined;
  }
}

/**
 * Synchronous API key / OAuth access for {@link Agent} `getApiKey` (pi-agent requires sync).
 * Order: default agent auth-profiles → global auth-profiles → OAuth token file.
 * Does not read standard env vars or models.json registry — callers chain `getApiKeySync` after this.
 */
export function resolveProviderApiKeySync(provider: string): string | undefined {
  const normalized = provider.toLowerCase();
  const cfg = loadConfig();
  const agentPath = resolveAgentAuthProfilesPath(cfg, getDefaultAgentId(cfg));
  const fromAgent = readApiKeyFromProfilesFile(agentPath, normalized);
  if (fromAgent) return fromAgent;
  const fromGlobal = readApiKeyFromProfilesFile(resolveAuthProfilesPath(), normalized);
  if (fromGlobal) return fromGlobal;
  return readOAuthAccessTokenSync(normalized);
}

/**
 * True if credentials exist in auth profiles (global or agent) or OAuth store,
 * matching async CredentialResolver resolution (excluding env — callers check env separately).
 */
export function hasProviderAuthOnDiskSync(provider: string): boolean {
  const cfg = loadConfig();
  const agentPath = resolveAgentAuthProfilesPath(cfg, getDefaultAgentId(cfg));
  if (hasApiKeyInProfilesFile(agentPath, provider)) {
    return true;
  }
  if (hasApiKeyInProfilesFile(resolveAuthProfilesPath(), provider)) {
    return true;
  }
  if (hasOAuthTokenSync(provider)) {
    return true;
  }
  return false;
}
