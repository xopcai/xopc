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
