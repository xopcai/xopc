/**
 * Auth runtime layer for capability providers (image / audio / video).
 *
 * Sibling of `src/auth/credentials.ts` (LLM-side, async). The hot path
 * (`resolveApiKeyForProvider` / `isProviderApiKeyConfigured`) stays
 * synchronous so capability providers don't need to `await` for every
 * `isConfigured()` check; OAuth refresh happens through the async members
 * of {@link AuthProfileStore} only when a vendor explicitly opts in.
 */

export { resolveApiKeyForProvider } from './resolve-api-key.js';
export { isProviderApiKeyConfigured } from './is-configured.js';
export {
  NoopAuthProfileStore,
  DiskAuthProfileStore,
  getDefaultAuthProfileStore,
  setDefaultAuthProfileStore,
  ensureDiskAuthProfileStore,
  listProfilesForProvider,
} from './auth-profile-store.js';
export {
  refreshOAuthProfile,
  isOAuthAccessTokenExpired,
  type OAuthRefreshOptions,
} from './oauth.js';
export type {
  AuthProfile,
  AuthProfileStore,
  ProviderAuthMode,
  ResolveApiKeyOptions,
  IsProviderApiKeyConfiguredOptions,
} from './types.js';
export { resolveAuthProfileForProvider, type ProviderAuthResolution } from './resolve-auth.js';
