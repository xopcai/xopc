/**
 * Synchronous checks that mirror CredentialResolver.resolveApiKey sources
 * used by isProviderConfiguredSync (fallback candidate filtering).
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  resolveAgentAuthProfilesPath,
  resolveAgentId,
  resolveAuthProfilesPath,
  resolveOAuthPath,
} from '../config/paths.js';

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

/**
 * True if credentials exist in auth profiles (global or agent) or OAuth store,
 * matching async CredentialResolver resolution (excluding env — callers check env separately).
 */
export function hasProviderAuthOnDiskSync(provider: string): boolean {
  const agentPath = resolveAgentAuthProfilesPath(resolveAgentId());
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
