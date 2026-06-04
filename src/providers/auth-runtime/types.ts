/**
 * Auth runtime types — capability-provider auth abstraction
 * (image / audio / video). Decoupled from the LLM-side
 * `src/auth/credentials.ts` so capability providers do not need to
 * `await` for every isConfigured() call.
 */

import type { Config } from '../../config/schema.js';

export interface ResolveApiKeyOptions {
  /** Provider id, e.g. "openai", "dashscope", "minimax". */
  providerId: string;
  /** Active xopc config. */
  cfg?: Config;
  /** Per-agent profile id; used to resolve `<stateDir>/agents/<agentId>/auth-profiles.json`. */
  agentId?: string;
  /** Profile name within the agent (e.g. "primary", "default"). */
  profileName?: string;
  /** Override env reader (test only). */
  envReader?: (name: string) => string | undefined;
  /** Override store (test / explicit dependency injection). */
  store?: AuthProfileStore;
}

export interface IsProviderApiKeyConfiguredOptions extends ResolveApiKeyOptions {}

export type ProviderAuthMode = 'api-key' | 'oauth' | 'azure-key';

/**
 * Persisted credential record for a single (provider, profileId) pair.
 * Stored on disk under `<stateDir>/agents/<agentId>/auth-profiles.json`.
 */
export interface AuthProfile {
  provider: string;
  /** Profile id within the agent (e.g. "default", "personal", "work"). */
  profileId: string;
  mode: ProviderAuthMode;
  /** Static API key (api-key / azure-key modes). */
  apiKey?: string;
  /** OAuth access token (current short-lived token). */
  oauthAccessToken?: string;
  /** OAuth refresh token (long-lived; used to mint fresh access tokens). */
  oauthRefreshToken?: string;
  /** Epoch ms when {@link oauthAccessToken} expires (0 = unknown). */
  expiresAt?: number;
  /** OAuth token endpoint (used by `refresh()`). */
  oauthTokenEndpoint?: string;
  /** OAuth client id, when the token endpoint requires it. */
  oauthClientId?: string;
  /** Free-form vendor metadata (e.g. azure resource / deployment). */
  meta?: Record<string, unknown>;
  /** Marks this profile as the default candidate when none is requested. */
  default?: boolean;
}

/**
 * Pluggable per-agent / per-profile credential store.
 *
 * Sync members ({@link getApiKeySync}, {@link hasCredentialSync}) keep
 * `resolveApiKeyForProvider` synchronous so capability providers and tool
 * default-model resolution stay non-blocking. {@link get} / {@link list} are
 * required so OAuth-aware callers can branch on `mode` without falling back
 * to the sync getters.
 */
export interface AuthProfileStore {
  /** Synchronous lookup; returns undefined when no profile is loaded. */
  getApiKeySync(providerId: string, profile?: string): string | undefined;
  /** Synchronous "do we have any usable credential" check. */
  hasCredentialSync(providerId: string, profile?: string): boolean;
  /** All profiles for a provider. */
  list(providerId: string): AuthProfile[];
  /** Single profile; defaults to `default: true` then "default" id. */
  get(providerId: string, profileId?: string): AuthProfile | undefined;
  /** Persist a profile; replaces any existing record with the same id. */
  save?(profile: AuthProfile): Promise<void>;
  /** Refresh OAuth access token; idempotent if still fresh. */
  refresh?(profile: AuthProfile): Promise<AuthProfile>;
}
