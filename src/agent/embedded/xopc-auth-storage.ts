import { AuthStorage } from '@earendil-works/pi-coding-agent';

import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { getApiKeySync } from '../../providers/index.js';

/**
 * Resolve API keys the same way as {@link AgentManager} / gateway settings:
 * auth-profiles (agent + global), OAuth files, models.json, then env.
 */
export function resolveXopcProviderApiKey(providerId: string): string | undefined {
  return resolveProviderApiKeySync(providerId) ?? getApiKeySync(providerId);
}

/**
 * pi-coding-agent {@link createAgentSession} defaults to `~/.pi/agent/auth.json` and env.
 * Gateway / webchat turns use xopc credentials under `XOPC_STATE_DIR` — wire them via fallback.
 */
export function createEmbeddedAuthStorage(): AuthStorage {
  const auth = AuthStorage.create();
  auth.setFallbackResolver(resolveXopcProviderApiKey);
  return auth;
}

/**
 * pi-coding-agent's {@link ModelRegistry.getApiKeyAndHeaders} reads the auth storage with
 * `includeFallback: false`, so {@link createEmbeddedAuthStorage}'s fallback resolver alone
 * never fires for xopc-managed providers (e.g. `local-qwen` in xopc's `models.json`).
 *
 * Inject the resolved key as a runtime override (highest-priority, in-memory only) before
 * the session starts so request-time auth resolution finds it.
 */
export function applyXopcProviderApiKey(auth: AuthStorage, providerId: string): void {
  const key = resolveXopcProviderApiKey(providerId);
  if (key && key !== 'extension-managed') {
    auth.setRuntimeApiKey(providerId, key);
  }
}
