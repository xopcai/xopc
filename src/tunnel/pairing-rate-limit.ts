import { buckets } from '../gateway/rate-limit/index.js';

export type PairingFailureLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

/**
 * Records a failed pairing exchange and returns whether subsequent attempts
 * are still permitted. Called from the route handler on every invalid /
 * expired pairing secret — successful exchanges do NOT call this.
 */
export function consumePairingExchangeFailLimit(clientKey: string): PairingFailureLimitResult {
  const fl = buckets.pairingExchange();
  const key = clientKey.trim() || 'unknown';
  fl.fail(key);
  const status = fl.check(key);
  if (status.blocked) {
    return { allowed: false, retryAfterMs: status.retryAfterSec * 1000 };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** @internal */
export function resetPairingExchangeLimitsForTests(): void {
  buckets.pairingExchange().resetForTests();
}
