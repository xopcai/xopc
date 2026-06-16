import { readFile, mkdir, rm } from 'fs/promises';
import { writeTextAtomic } from '../infra/write-file-atomic.js';
import { join, dirname } from 'path';
import { createLogger } from '../utils/logger.js';
import { getApiKeyFromEnv } from '../providers/env-keys.js';
import {
  resolveCredentialsDir,
  resolveAuthProfilesPath,
  resolveAgentAuthProfilesPath,
  resolveOAuthPath,
} from '../config/paths.js';
import type { Config } from '../config/schema.js';

const log = createLogger('Credentials');

// ============================================
// Types
// ============================================

export type CredentialType = 'api_key' | 'oauth';

export interface ApiKeyProfile {
  type: 'api_key';
  provider: string;
  profileName?: string;
  envVar?: string | null;
  key: string | null;
}

export interface OAuthToken {
  type: 'oauth';
  provider: string;
  access: string;
  refresh?: string;
  expiresAt?: number;
  scope?: string[];
  createdAt: string;
  updatedAt: string;
}

export type CredentialProfile = ApiKeyProfile;

export interface AuthProfilesFile {
  version: number;
  profiles: Record<string, ApiKeyProfile>;
}

// ============================================
// Credential Resolver
// ============================================

export interface CredentialResolverOptions {
  stateDir?: string;
  /** When set, per-agent auth profiles are read from `resolveAgentAuthProfilesPath(appConfig, agentId)`. */
  agentId?: string;
  /** Required when `agentId` is set. */
  appConfig?: Config;
}

export class CredentialResolver {
  private readonly credentialsDir: string;
  private readonly agentId?: string;
  private readonly appConfig?: Config;

  constructor(options: CredentialResolverOptions = {}) {
    this.credentialsDir = options.stateDir
      ? join(options.stateDir, 'credentials')
      : resolveCredentialsDir();
    this.agentId = options.agentId;
    this.appConfig = options.appConfig;
    if (this.agentId && !this.appConfig) {
      throw new Error('CredentialResolver: appConfig is required when agentId is set');
    }
  }

  /**
   * Resolve API key for a provider
   * Priority: Agent private > Global > OAuth > Environment
   */
  async resolveApiKey(provider: string): Promise<string | null> {
    const normalizedProvider = provider.toLowerCase();

    // 1. Try agent private credentials
    if (this.agentId) {
      const agentKey = await this.loadFromAgentCredentials(normalizedProvider);
      if (agentKey) {
        log.debug({ provider, source: 'agent' }, 'Resolved API key from agent credentials');
        return agentKey;
      }
    }

    // 2. Try global credentials
    const globalKey = await this.loadFromGlobalCredentials(normalizedProvider);
    if (globalKey) {
      log.debug({ provider, source: 'global' }, 'Resolved API key from global credentials');
      return globalKey;
    }

    // 3. Try OAuth token (convert to Bearer)
    const oauthToken = await this.loadOAuthToken(normalizedProvider);
    if (oauthToken) {
      log.debug({ provider, source: 'oauth' }, 'Resolved API key from OAuth token');
      return oauthToken.access;
    }

    // 4. Environment variables (see `src/providers/env-keys.ts`)
    const envKey = getApiKeyFromEnv(normalizedProvider);
    if (envKey) {
      log.debug({ provider, source: 'env' }, 'Resolved API key from environment');
      return envKey;
    }

    return null;
  }

  /**
   * Check if a provider has credentials configured
   */
  async hasCredentials(provider: string): Promise<boolean> {
    const key = await this.resolveApiKey(provider);
    return key !== null;
  }

  /**
   * Which step in {@link resolveApiKey} would supply the key (no secret material).
   */
  async resolveApiKeySource(
    provider: string,
  ): Promise<'agent' | 'global' | 'oauth' | 'env' | null> {
    const normalizedProvider = provider.toLowerCase();

    if (this.agentId) {
      const agentKey = await this.loadFromAgentCredentials(normalizedProvider);
      if (agentKey) return 'agent';
    }

    const globalKey = await this.loadFromGlobalCredentials(normalizedProvider);
    if (globalKey) return 'global';

    const oauthToken = await this.loadOAuthToken(normalizedProvider);
    if (oauthToken) return 'oauth';

    if (getApiKeyFromEnv(normalizedProvider)) return 'env';

    return null;
  }

  /**
   * List all available credential profiles
   */
  async listProfiles(): Promise<Array<ApiKeyProfile & { id: string; source: 'agent' | 'global' }>> {
    const profiles: Array<ApiKeyProfile & { id: string; source: 'agent' | 'global' }> = [];

    // Global profiles
    const globalProfiles = await this.loadAuthProfilesFile();
    for (const [id, profile] of Object.entries(globalProfiles.profiles)) {
      profiles.push({ ...profile, id, source: 'global' });
    }

    // Agent private profiles
    if (this.agentId) {
      const agentProfiles = await this.loadAgentAuthProfilesFile();
      for (const [id, profile] of Object.entries(agentProfiles.profiles)) {
        profiles.push({ ...profile, id, source: 'agent' });
      }
    }

    return profiles;
  }

  /**
   * Plaintext API key from global auth profiles only (no env/oauth fallback).
   * Used by the gateway console reveal endpoint.
   */
  async revealGatewayStoredApiKey(provider: string): Promise<string | null> {
    const normalizedProvider = provider.toLowerCase();
    const profiles = await this.loadAuthProfilesFile();
    const profile = this.findProfileForProvider(profiles, normalizedProvider);
    const key = profile?.key?.trim();
    return key || null;
  }

  /**
   * Save an API key profile
   */
  async saveApiKey(
    provider: string,
    key: string,
    options: {
      profileName?: string;
      envVar?: string | null;
      agentPrivate?: boolean;
    } = {}
  ): Promise<void> {
    const normalizedProvider = provider.toLowerCase();
    const profileId = options.profileName
      ? `${normalizedProvider}:${options.profileName}`
      : `${normalizedProvider}:default`;

    const profile: ApiKeyProfile = {
      type: 'api_key',
      provider: normalizedProvider,
      profileName: options.profileName,
      envVar: options.envVar ?? null,
      key,
    };

    if (options.agentPrivate && this.agentId) {
      await this.saveAgentAuthProfile(profileId, profile);
    } else {
      await this.saveGlobalAuthProfile(profileId, profile);
    }

    log.info({ provider, profileId, agentPrivate: options.agentPrivate }, 'Saved API key');
  }

  /**
   * Delete a credential profile
   */
  async deleteProfile(profileId: string, options: { agentPrivate?: boolean } = {}): Promise<void> {
    if (options.agentPrivate && this.agentId) {
      await this.deleteAgentAuthProfile(profileId);
    } else {
      await this.deleteGlobalAuthProfile(profileId);
    }

    log.info({ profileId, agentPrivate: options.agentPrivate }, 'Deleted credential profile');
  }

  /**
   * Load OAuth token for a provider.
   */
  async loadOAuthToken(provider: string): Promise<OAuthToken | null> {
    const token = await this.loadOAuthTokenRecord(provider);
    if (!token) return null;

    if (token.expiresAt && token.expiresAt < Date.now()) {
      log.warn({ provider, expiresAt: token.expiresAt }, 'OAuth token is expired');
      return null;
    }

    return token;
  }

  /**
   * Load the raw OAuth token record, including expired tokens for status UIs.
   */
  async loadOAuthTokenRecord(provider: string): Promise<OAuthToken | null> {
    const normalizedProvider = provider.toLowerCase();
    const oauthPath = resolveOAuthPath(normalizedProvider);

    try {
      const content = await readFile(oauthPath, 'utf-8');
      const token = JSON.parse(content) as OAuthToken;
      return token.provider === normalizedProvider ? token : null;
    } catch {
      return null;
    }
  }

  /**
   * Save OAuth token for a provider.
   */
  async saveOAuthToken(provider: string, token: Omit<OAuthToken, 'type' | 'provider' | 'updatedAt'>): Promise<void> {
    const normalizedProvider = provider.toLowerCase();
    const oauthPath = resolveOAuthPath(normalizedProvider);

    await mkdir(dirname(oauthPath), { recursive: true });

    const fullToken: OAuthToken = {
      ...token,
      type: 'oauth',
      provider: normalizedProvider,
      updatedAt: new Date().toISOString(),
    };

    await writeTextAtomic(oauthPath, JSON.stringify(fullToken, null, 2));
    log.info({ provider: normalizedProvider }, 'Saved OAuth token');
  }

  /**
   * Delete the OAuth token persisted for a provider.
   */
  async deleteOAuthToken(provider: string): Promise<void> {
    const normalizedProvider = provider.toLowerCase();
    const oauthPath = resolveOAuthPath(normalizedProvider);
    await rm(oauthPath, { force: true });
    log.info({ provider: normalizedProvider }, 'Deleted OAuth token');
  }

  /**
   * Disconnect the default credential for a provider from local storage.
   */
  async deleteProviderCredential(provider: string): Promise<void> {
    const normalizedProvider = provider.toLowerCase();
    await this.deleteProfile(`${normalizedProvider}:default`);
    await this.deleteOAuthToken(normalizedProvider);
  }

  // ============================================
  // Private Methods
  // ============================================

  private async loadFromAgentCredentials(provider: string): Promise<string | null> {
    if (!this.agentId) return null;

    const profiles = await this.loadAgentAuthProfilesFile();
    const profile = this.findProfileForProvider(profiles, provider);

    if (!profile) return null;
    if (profile.envVar) return this.loadFromEnv(profile.envVar) ?? profile.key;
    return profile.key;
  }

  private async loadFromGlobalCredentials(provider: string): Promise<string | null> {
    const profiles = await this.loadAuthProfilesFile();
    const profile = this.findProfileForProvider(profiles, provider);

    if (!profile) return null;
    if (profile.envVar) return this.loadFromEnv(profile.envVar) ?? profile.key;
    return profile.key;
  }

  private loadFromEnv(envVarName: string): string | null {
    return process.env[envVarName] || null;
  }

  private findProfileForProvider(
    file: AuthProfilesFile,
    provider: string
  ): ApiKeyProfile | null {
    const normalizedProvider = provider.toLowerCase();

    // Look for exact match first
    for (const [, profile] of Object.entries(file.profiles)) {
      if (profile.provider === normalizedProvider) {
        return profile;
      }
    }

    return null;
  }

  private async loadAuthProfilesFile(): Promise<AuthProfilesFile> {
    const path = resolveAuthProfilesPath();

    try {
      const content = await readFile(path, 'utf-8');
      const data = JSON.parse(content);
      return {
        version: data.version || 1,
        profiles: data.profiles || {},
      };
    } catch {
      return { version: 2, profiles: {} };
    }
  }

  private async loadAgentAuthProfilesFile(): Promise<AuthProfilesFile> {
    if (!this.agentId || !this.appConfig) return { version: 2, profiles: {} };

    const path = resolveAgentAuthProfilesPath(this.appConfig, this.agentId);

    try {
      const content = await readFile(path, 'utf-8');
      const data = JSON.parse(content);
      return {
        version: data.version || 1,
        profiles: data.profiles || {},
      };
    } catch {
      return { version: 2, profiles: {} };
    }
  }

  private async saveGlobalAuthProfile(profileId: string, profile: ApiKeyProfile): Promise<void> {
    const path = resolveAuthProfilesPath();
    await mkdir(dirname(path), { recursive: true });

    const file = await this.loadAuthProfilesFile();
    file.profiles[profileId] = profile;

    await writeTextAtomic(path, JSON.stringify(file, null, 2));
  }

  private async saveAgentAuthProfile(profileId: string, profile: ApiKeyProfile): Promise<void> {
    if (!this.agentId || !this.appConfig) throw new Error('Agent ID and appConfig required for agent-private profiles');

    const path = resolveAgentAuthProfilesPath(this.appConfig, this.agentId);
    await mkdir(dirname(path), { recursive: true });

    const file = await this.loadAgentAuthProfilesFile();
    file.profiles[profileId] = profile;

    await writeTextAtomic(path, JSON.stringify(file, null, 2));
  }

  private async deleteGlobalAuthProfile(profileId: string): Promise<void> {
    const path = resolveAuthProfilesPath();
    const file = await this.loadAuthProfilesFile();

    delete file.profiles[profileId];

    await writeTextAtomic(path, JSON.stringify(file, null, 2));
  }

  private async deleteAgentAuthProfile(profileId: string): Promise<void> {
    if (!this.agentId || !this.appConfig) throw new Error('Agent ID and appConfig required for agent-private profiles');

    const path = resolveAgentAuthProfilesPath(this.appConfig, this.agentId);
    const file = await this.loadAgentAuthProfilesFile();

    delete file.profiles[profileId];

    await writeTextAtomic(path, JSON.stringify(file, null, 2));
  }
}

// ============================================
// Convenience Functions
// ============================================

let defaultResolver: CredentialResolver | null = null;

export function getCredentialResolver(options?: CredentialResolverOptions): CredentialResolver {
  if (!defaultResolver || options) {
    return new CredentialResolver(options);
  }
  return defaultResolver;
}

export async function resolveApiKey(provider: string, options?: CredentialResolverOptions): Promise<string | null> {
  const resolver = getCredentialResolver(options);
  return resolver.resolveApiKey(provider);
}

export async function hasCredentials(provider: string, options?: CredentialResolverOptions): Promise<boolean> {
  const resolver = getCredentialResolver(options);
  return resolver.hasCredentials(provider);
}
