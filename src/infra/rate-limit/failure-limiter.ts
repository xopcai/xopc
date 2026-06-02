/**
 * Per-key brute-force protection limiter.
 *
 * Semantics:
 *   - `fail(key)` records a failed attempt; reaching `maxFailures` within
 *     `windowMs` triggers a `blockDurationMs` lockout.
 *   - `succeed(key)` clears all state for the key (a successful auth wipes the
 *     bucket so legitimate users aren't punished for prior typos).
 *   - `check(key)` is read-only — returns the current block status.
 *   - Failures from the same key within `burstCoalesceMs` collapse to a single
 *     attempt. This absorbs SPA fan-out / SDK auto-retry storms without
 *     weakening protection: a deliberate attacker is rate-limited to ~1
 *     attempt/s per key, still astronomically slow against any token of
 *     meaningful entropy.
 *
 * Pure counter — no policy knowledge (loopback exemption, key formatting,
 * etc. all live in the policy layer that calls into this limiter).
 */

import { KeyedStore, type Clock } from './keyed-store.js';

export type FailureLimiterConfig = {
  maxFailures: number;
  windowMs: number;
  blockDurationMs: number;
  /** @default 1000 */
  burstCoalesceMs?: number;
  /** Retain idle keys for this long. @default `windowMs + blockDurationMs` */
  staleAfterMs?: number;
  clock?: Clock;
};

export type FailureCheck =
  | { blocked: false }
  | { blocked: true; retryAfterSec: number };

type State = {
  windowStart: number;
  count: number;
  blockedUntil?: number;
  lastFailureAtMs?: number;
  lastTouchedMs: number;
};

const DEFAULT_BURST_COALESCE_MS = 1000;

export class FailureLimiter {
  private readonly store: KeyedStore<State>;
  private readonly clock: Clock;
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;
  private readonly burstCoalesceMs: number;

  constructor(cfg: FailureLimiterConfig) {
    this.maxFailures = Math.max(1, Math.floor(cfg.maxFailures));
    this.windowMs = Math.max(1000, Math.floor(cfg.windowMs));
    this.blockDurationMs = Math.max(1000, Math.floor(cfg.blockDurationMs));
    this.burstCoalesceMs = Math.max(0, Math.floor(cfg.burstCoalesceMs ?? DEFAULT_BURST_COALESCE_MS));
    this.clock = cfg.clock ?? Date.now;
    this.store = new KeyedStore<State>({
      staleAfterMs: cfg.staleAfterMs ?? this.windowMs + this.blockDurationMs,
      clock: this.clock,
    });
  }

  check(key: string): FailureCheck {
    const now = this.clock();
    const state = this.store.get(key);
    if (!state?.blockedUntil) return { blocked: false };
    if (now >= state.blockedUntil) {
      state.blockedUntil = undefined;
      state.count = 0;
      state.windowStart = now;
      state.lastTouchedMs = now;
      return { blocked: false };
    }
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
    };
  }

  fail(key: string): void {
    const now = this.clock();
    let state = this.store.get(key);
    if (!state) {
      state = { windowStart: now, count: 0, lastTouchedMs: now };
      this.store.set(key, state);
    }

    state.lastTouchedMs = now;

    if (state.blockedUntil && now < state.blockedUntil) return;
    if (state.blockedUntil && now >= state.blockedUntil) {
      state.blockedUntil = undefined;
      state.count = 0;
      state.windowStart = now;
    }

    if (now - state.windowStart > this.windowMs) {
      state.count = 0;
      state.windowStart = now;
    }

    if (
      state.lastFailureAtMs !== undefined &&
      now - state.lastFailureAtMs < this.burstCoalesceMs
    ) {
      state.lastFailureAtMs = now;
      return;
    }

    state.lastFailureAtMs = now;
    state.count += 1;
    if (state.count >= this.maxFailures) {
      state.blockedUntil = now + this.blockDurationMs;
    }
  }

  succeed(key: string): void {
    this.store.delete(key);
  }

  /** @internal Test hook. */
  resetForTests(): void {
    this.store.clear();
  }

  destroy(): void {
    this.store.destroy();
  }
}
