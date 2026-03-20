import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { createLogger } from '../utils/logger.js';
import {
  resolveCredentialsDir,
  resolveAuthProfilesPath,
  resolveAgentAuthProfilesPath,
  resolveOAuthPath,
} from '../config/paths.js';

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
// Default Environment Variable Mappings
// ============================================

const DEFAULT_ENV_VARS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  alibaba: 'ALIBABA_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  '01-ai': 'ZERONE_API_KEY',
};

// ============================================
// Credential Resolver
// ============================================

export interface CredentialResolverOptions {
  stateDir?: string;
  agentId?: string;
}

export class CredentialResolver {
  private readonly credentialsDir: string;
  private readonly agentId?: string;

  constructor(options: CredentialResolverOptions = {}) {
    this.credentialsDir = options.stateDir
      ? join(options.stateDir, 'credentials')
      : resolveCredentialsDir();
    this.agentId = options.agentId;
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

    // 4. Fallback to environment variable
    const envKey = this.loadFromEnv(normalizedProvider);
    if (envKey) {
      log.debug({ provider, source: 'env' }, 'Resolved API key from environment');
      return envKey;
    }

    log.debug({ provider }, 'No API key found');
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
   * Load OAuth token for a provider
   */
  async loadOAuthToken(provider: string): Promise<OAuthToken | null> {
    const normalizedProvider = provider.toLowerCase();
    const oauthPath = resolveOAuthPath(normalizedProvider);

    try {
      const content = await readFile(oauthPath, 'utf-8');
      const token = JSON.parse(content) as OAuthToken;

      // Check if token is expired
      if (token.expiresAt && token.expiresAt < Date.now()) {
        log.warn({ provider, expiresAt: token.expiresAt }, 'OAuth token is expired');
        // TODO: Implement token refresh
        return null;
      }

      return token;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save OAuth token for a provider
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

    await writeFile(oauthPath, JSON.stringify(fullToken, null, 2), 'utf-8');
    log.info({ provider }, 'Saved OAuth token');
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

  private loadFromEnv(providerOrEnvVar: string): string | null {
    // Try direct env var
    const directValue = process.env[providerOrEnvVar];
    if (directValue) return directValue;

    // Try default mapping
    const envVar = DEFAULT_ENV_VARS[providerOrEnvVar.toLowerCase()];
    if (envVar) {
      return process.env[envVar] || null;
    }

    return null;
  }

  private findProfileForProvider(
    file: AuthProfilesFile,
    provider: string
  ): ApiKeyProfile | null {
    const normalizedProvider = provider.toLowerCase();

    // Look for exact match first
    for (const [id, profile] of Object.entries(file.profiles)) {
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
    } catch (error) {
      return { version: 2, profiles: {} };
    }
  }

  private async loadAgentAuthProfilesFile(): Promise<AuthProfilesFile> {
    if (!this.agentId) return { version: 2, profiles: {} };

    const path = resolveAgentAuthProfilesPath(this.agentId);

    try {
      const content = await readFile(path, 'utf-8');
      const data = JSON.parse(content);
      return {
        version: data.version || 1,
        profiles: data.profiles || {},
      };
    } catch (error) {
      return { version: 2, profiles: {} };
    }
  }

  private async saveGlobalAuthProfile(profileId: string, profile: ApiKeyProfile): Promise<void> {
    const path = resolveAuthProfilesPath();
    await mkdir(dirname(path), { recursive: true });

    const file = await this.loadAuthProfilesFile();
    file.profiles[profileId] = profile;

    await writeFile(path, JSON.stringify(file, null, 2), 'utf-8');
  }

  private async saveAgentAuthProfile(profileId: string, profile: ApiKeyProfile): Promise<void> {
    if (!this.agentId) throw new Error('Agent ID not set');

    const path = resolveAgentAuthProfilesPath(this.agentId);
    await mkdir(dirname(path), { recursive: true });

    const file = await this.loadAgentAuthProfilesFile();
    file.profiles[profileId] = profile;

    await writeFile(path, JSON.stringify(file, null, 2), 'utf-8');
  }

  private async deleteGlobalAuthProfile(profileId: string): Promise<void> {
    const path = resolveAuthProfilesPath();
    const file = await this.loadAuthProfilesFile();

    delete file.profiles[profileId];

    await writeFile(path, JSON.stringify(file, null, 2), 'utf-8');
  }

  private async deleteAgentAuthProfile(profileId: string): Promise<void> {
    if (!this.agentId) throw new Error('Agent ID not set');

    const path = resolveAgentAuthProfilesPath(this.agentId);
    const file = await this.loadAgentAuthProfilesFile();

    delete file.profiles[profileId];

    await writeFile(path, JSON.stringify(file, null, 2), 'utf-8');
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
