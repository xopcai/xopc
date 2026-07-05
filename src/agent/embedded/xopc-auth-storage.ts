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
 * Gateway / webchat turns inject xopc credentials through {@link applyXopcProviderApiKey}.
 */
export function createEmbeddedAuthStorage(): AuthStorage {
  return AuthStorage.create();
}

/**
 * Inject the resolved key as a runtime override (highest-priority, in-memory only) before
 * the session starts so request-time auth resolution finds it.
 */
export function applyXopcProviderApiKey(auth: AuthStorage, providerId: string): void {
  const key = resolveXopcProviderApiKey(providerId);
  if (key && key !== 'extension-managed') {
    auth.setRuntimeApiKey(providerId, key);
  }
}
