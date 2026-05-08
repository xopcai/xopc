/**
 * Synchronous API-key resolution for capability providers
 * (image / audio / video).
 *
 * Resolution order:
 *   1. AuthProfileStore (per-agent / per-profile; noop in Step 1)
 *   2. cfg.providers.<id>.apiKey
 *   3. PROVIDER_ENV_MAP[providerId] env vars (or `<PROVIDER>_API_KEY` fallback)
 *
 * Distinct from `src/providers/index.ts#getApiKeySync` which is keyed to the
 * LLM model registry. Capability providers care only about per-vendor API
 * keys, not pi-ai's `Model` shape.
 */

import { resolveAuthProfileForProvider } from './resolve-auth.js';
import type { ResolveApiKeyOptions } from './types.js';

/**
 * Synchronous lookup that returns just the resolved API key (or OAuth access
 * token) for a provider. Internally delegates to
 * {@link resolveAuthProfileForProvider} which knows about the full mode set
 * (`api-key` / `oauth` / `azure-key`) and is the entry point vendors use
 * when they need to branch on auth mode.
 *
 * Resolution order (matches spec §8.4):
 *   1. AuthProfileStore (per-agent profile — may be OAuth)
 *   2. cfg.providers.<id>.apiKey
 *   3. PROVIDER_ENV_MAP[providerId] env vars
 */
export function resolveApiKeyForProvider(options: ResolveApiKeyOptions): string | undefined {
  return resolveAuthProfileForProvider(options).apiKey;
}
