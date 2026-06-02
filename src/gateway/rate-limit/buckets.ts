/**
 * Named rate-limit buckets used across the gateway. Each is a thin wrapper
 * over a primitive limiter ({@link RateLimiter} or {@link FailureLimiter})
 * that hard-codes its config and exposes a small surface.
 *
 * All buckets are owned by a process-level singleton {@link BucketRegistry}
 * so that:
 *   - lifecycle (cleanup timers) is centralized — `destroyAll()` on shutdown,
 *   - tests get one obvious reset entry point (`resetAllForTests`),
 *   - new buckets are added in exactly one place.
 *
 * Tuning policy:
 *   - `auth_failure` is read from runtime config because users tune it per
 *     deployment. Other buckets keep static defaults until a real need
 *     emerges to expose them. (YAGNI > premature configurability.)
 */

import { FailureLimiter, RateLimiter } from '../../infra/rate-limit/index.js';

import type { GatewayAuthRateLimitConfig } from '../../config/schema.js';
import type { AuthRateLimitPolicyConfig } from './auth-policy.js';

/**
 * Auth-failure config validated/normalized into the shape both the limiter
 * primitive and the policy layer need.
 */
export type ResolvedAuthRateLimitConfig = {
  enabled: boolean;
  maxFailures: number;
  windowMs: number;
  blockDurationMs: number;
  burstCoalesceMs: number;
  exemptLoopback: boolean;
};

const DEFAULT_AUTH_RATE_LIMIT: ResolvedAuthRateLimitConfig = {
  enabled: true,
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  blockDurationMs: 5 * 60 * 1000,
  burstCoalesceMs: 1000,
  exemptLoopback: true,
};

export function resolveAuthRateLimit(
  input: GatewayAuthRateLimitConfig | undefined,
): ResolvedAuthRateLimitConfig {
  if (!input) return { ...DEFAULT_AUTH_RATE_LIMIT };
  const blockDurationMs =
    input.blockDurationMs ?? input.lockoutMs ?? DEFAULT_AUTH_RATE_LIMIT.blockDurationMs;
  return {
    enabled: input.enabled ?? DEFAULT_AUTH_RATE_LIMIT.enabled,
    maxFailures: Math.max(1, Math.floor(input.maxAttempts ?? DEFAULT_AUTH_RATE_LIMIT.maxFailures)),
    windowMs: Math.max(1000, Math.floor(input.windowMs ?? DEFAULT_AUTH_RATE_LIMIT.windowMs)),
    blockDurationMs: Math.max(1000, Math.floor(blockDurationMs)),
    burstCoalesceMs: Math.max(
      0,
      Math.floor(input.burstCoalesceMs ?? DEFAULT_AUTH_RATE_LIMIT.burstCoalesceMs),
    ),
    exemptLoopback: input.exemptLoopback ?? DEFAULT_AUTH_RATE_LIMIT.exemptLoopback,
  };
}

export function authPolicyConfig(
  cfg: ResolvedAuthRateLimitConfig,
): AuthRateLimitPolicyConfig {
  return { enabled: cfg.enabled, exemptLoopback: cfg.exemptLoopback };
}

class BucketRegistry {
  private authFailureLimiter?: FailureLimiter;
  private authFailureSignature?: string;

  private strictApiLimiter?: RateLimiter;
  private tunnelMutateLimiter?: RateLimiter;
  private pairingExchangeLimiter?: FailureLimiter;
  private sharePublicShortLimiter?: RateLimiter;
  private sharePublicLongLimiter?: RateLimiter;

  /**
   * Reconfigured on the fly when `gateway.auth.rateLimit` is reloaded —
   * compares a stable signature to avoid swapping out a hot bucket on every
   * config read.
   */
  authFailure(cfg: ResolvedAuthRateLimitConfig): FailureLimiter {
    const sig = `${cfg.maxFailures}|${cfg.windowMs}|${cfg.blockDurationMs}|${cfg.burstCoalesceMs}`;
    if (!this.authFailureLimiter || this.authFailureSignature !== sig) {
      this.authFailureLimiter?.destroy();
      this.authFailureLimiter = new FailureLimiter({
        maxFailures: cfg.maxFailures,
        windowMs: cfg.windowMs,
        blockDurationMs: cfg.blockDurationMs,
        burstCoalesceMs: cfg.burstCoalesceMs,
      });
      this.authFailureSignature = sig;
    }
    return this.authFailureLimiter;
  }

  /** Sensitive admin / mutation endpoints — 15 req / 60 s per client IP. */
  strictApi(): RateLimiter {
    if (!this.strictApiLimiter) {
      this.strictApiLimiter = new RateLimiter({ maxRequests: 15, windowMs: 60_000 });
    }
    return this.strictApiLimiter;
  }

  /** Tunnel mutation calls — 12 req / 5 min per gateway-token fingerprint. */
  tunnelMutate(): RateLimiter {
    if (!this.tunnelMutateLimiter) {
      this.tunnelMutateLimiter = new RateLimiter({
        maxRequests: 12,
        windowMs: 5 * 60_000,
      });
    }
    return this.tunnelMutateLimiter;
  }

  /** Failed pairing-exchange attempts — 30 failures / 5 min per client IP. */
  pairingExchange(): FailureLimiter {
    if (!this.pairingExchangeLimiter) {
      this.pairingExchangeLimiter = new FailureLimiter({
        maxFailures: 30,
        windowMs: 5 * 60_000,
        blockDurationMs: 5 * 60_000,
      });
    }
    return this.pairingExchangeLimiter;
  }

  /** Public share download short window — 60 req / min per client IP. */
  sharePublicShort(): RateLimiter {
    if (!this.sharePublicShortLimiter) {
      this.sharePublicShortLimiter = new RateLimiter({
        maxRequests: 60,
        windowMs: 60_000,
      });
    }
    return this.sharePublicShortLimiter;
  }

  /** Public share download long window — 300 req / 15 min per client IP. */
  sharePublicLong(): RateLimiter {
    if (!this.sharePublicLongLimiter) {
      this.sharePublicLongLimiter = new RateLimiter({
        maxRequests: 300,
        windowMs: 15 * 60_000,
      });
    }
    return this.sharePublicLongLimiter;
  }

  destroyAll(): void {
    this.authFailureLimiter?.destroy();
    this.strictApiLimiter?.destroy();
    this.tunnelMutateLimiter?.destroy();
    this.pairingExchangeLimiter?.destroy();
    this.sharePublicShortLimiter?.destroy();
    this.sharePublicLongLimiter?.destroy();
    this.authFailureLimiter = undefined;
    this.strictApiLimiter = undefined;
    this.tunnelMutateLimiter = undefined;
    this.pairingExchangeLimiter = undefined;
    this.sharePublicShortLimiter = undefined;
    this.sharePublicLongLimiter = undefined;
    this.authFailureSignature = undefined;
  }

  /** @internal */
  resetAllForTests(): void {
    this.authFailureLimiter?.resetForTests();
    this.strictApiLimiter?.resetForTests();
    this.tunnelMutateLimiter?.resetForTests();
    this.pairingExchangeLimiter?.resetForTests();
    this.sharePublicShortLimiter?.resetForTests();
    this.sharePublicLongLimiter?.resetForTests();
  }
}

export const buckets = new BucketRegistry();
