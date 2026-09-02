/**
 * Runtime accessors for `gateway.publicUrl` (the user-deployed reverse-proxy
 * URL). Centralizes the "is it configured?" + "normalized origin" lookup so
 * callers (device access, CORS allowlist, UI status) all agree
 * on the same value.
 */

import type { Config } from '../config/schema.js';
import { normalizePublicUrlOrNull } from '../config/public-url.js';

export function resolveReverseProxyPublicUrl(config: Config | undefined): string | null {
  return normalizePublicUrlOrNull(config?.gateway?.publicUrl);
}
