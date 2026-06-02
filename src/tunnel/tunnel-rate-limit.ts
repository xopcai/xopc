import { createHash } from 'node:crypto';

import { buckets } from '../gateway/rate-limit/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TunnelRateLimit');

function tokenKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
}

export type TunnelMutationLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

export function consumeTunnelMutationLimit(token: string): TunnelMutationLimitResult {
  const result = buckets.tunnelMutate().consume(tokenKey(token));
  if (!result.allowed) {
    log.warn(
      {
        tokenPrefix: token.slice(0, 8),
        retryAfterSec: Math.ceil(result.retryAfterMs / 1000),
        reason: 'tunnel_mutation_limit',
      },
      'Tunnel mutation rate limit exceeded',
    );
  }
  return { allowed: result.allowed, retryAfterMs: result.retryAfterMs };
}

/** @internal */
export function resetTunnelMutationLimitsForTests(): void {
  buckets.tunnelMutate().resetForTests();
}
