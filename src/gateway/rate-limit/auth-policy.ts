/**
 * Auth-failure rate-limit policy: how to derive a tracking key from a request,
 * and whether a given client should be exempted before counting.
 *
 * The {@link FailureLimiter} primitive is intentionally policy-free — this
 * module is the only place that knows about IPs, browser origins, and the
 * loopback exemption. Adding a new exemption rule (e.g. private CIDRs) means
 * editing this file alone; the limiter primitive does not change.
 */

import {
  isLoopbackClientIp,
  isLoopbackEmbeddedBrowserClient,
} from '../security/loopback.js';

export type AuthRateLimitPolicyConfig = {
  enabled: boolean;
  exemptLoopback: boolean;
};

/**
 * `key` is `''` when `exempt` is true. We use a flat shape rather than a
 * tagged union because the project's tsconfig has `strict: false`, which
 * disables boolean-discriminator narrowing.
 */
export type AuthRateLimitTracking = {
  exempt: boolean;
  key: string;
};

/**
 * Decide whether to track this client and, if so, what key identifies them.
 * Browser clients are tracked separately (origin + IP) so a rogue `<iframe>`
 * cannot piggyback on a CLI client's bucket and DoS it.
 */
export function resolveAuthTracking(params: {
  clientIp: string;
  origin?: string | null;
  cfg: AuthRateLimitPolicyConfig;
}): AuthRateLimitTracking {
  if (!params.cfg.enabled) return { exempt: true, key: '' };

  const origin = params.origin?.trim();
  if (origin) {
    const isLocal = isLoopbackEmbeddedBrowserClient(origin, params.clientIp);
    if (isLocal && params.cfg.exemptLoopback) return { exempt: true, key: '' };
    return {
      exempt: false,
      key: buildBrowserOriginKey(origin, params.clientIp),
    };
  }

  if (params.cfg.exemptLoopback && isLoopbackClientIp(params.clientIp)) {
    return { exempt: true, key: '' };
  }
  return { exempt: false, key: params.clientIp };
}

/** Browser-tracking key format. Stable across reloads — survives state replay. */
export function buildBrowserOriginKey(origin: string, clientIp: string): string {
  return `browser-origin:${origin.trim().toLowerCase()}|${clientIp.trim()}`;
}
