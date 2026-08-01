import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { resolveModelsJsonPath } from '../../config/paths.js';
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
export function createEmbeddedCredentialStore(): InMemoryCredentialStore {
  return new InMemoryCredentialStore();
}

/** Create the pi model runtime used by embedded gateway / channel turns. */
export function createEmbeddedModelRuntime(): Promise<ModelRuntime> {
  return ModelRuntime.create({
    credentials: createEmbeddedCredentialStore(),
    modelsPath: resolveModelsJsonPath(),
  });
}

/**
 * Inject the resolved key as a runtime override (highest-priority, in-memory only) before
 * the session starts so request-time auth resolution finds it.
 */
export async function applyXopcProviderApiKey(
  modelRuntime: Pick<ModelRuntime, 'setRuntimeApiKey'>,
  providerId: string,
): Promise<void> {
  const key = resolveXopcProviderApiKey(providerId);
  if (key && key !== 'extension-managed') {
    await modelRuntime.setRuntimeApiKey(providerId, key, { allowNetwork: false });
  }
}
