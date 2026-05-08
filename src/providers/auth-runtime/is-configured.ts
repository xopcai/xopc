/**
 * Synchronous "do we have any usable credential" check for capability providers.
 *
 * Used by:
 *   - Provider.isConfigured?({ cfg })
 *   - Tool default-model resolution (skip providers without credentials)
 *   - Web UI status badge
 *
 * Must NOT touch keychain or trigger OS prompts.
 */

import { resolveApiKeyForProvider } from './resolve-api-key.js';
import type { IsProviderApiKeyConfiguredOptions } from './types.js';

export function isProviderApiKeyConfigured(options: IsProviderApiKeyConfiguredOptions): boolean {
  return Boolean(resolveApiKeyForProvider(options));
}
