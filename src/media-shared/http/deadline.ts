/**
 * Deadline / timeout aggregation for provider HTTP calls.
 *
 * A "deadline" combines:
 *   - per-call timeout (caller-supplied, ms)
 *   - provider-default timeout (cfg.providers.<id>.request.timeoutMs, ms)
 *   - upstream AbortSignal (e.g. agent cancellation)
 *
 * The effective timeout is the **smaller** of the per-call value and the
 * provider default; abort is propagated from upstream.
 */

export interface DeadlineInput {
  /** Per-call timeout (ms). Wins when smaller than {@link providerDefaultMs}. */
  timeoutMs?: number;
  /** Provider-default timeout (ms), e.g. from config. */
  providerDefaultMs?: number;
  /** Upstream cancellation. */
  signal?: AbortSignal;
}

export interface ResolvedDeadline {
  /** Final timeout in ms, or undefined when neither side specified one. */
  timeoutMs: number | undefined;
  /** Combined AbortSignal that fires on timeout OR upstream abort. */
  signal: AbortSignal;
  /** Manual cleanup (clear timer, detach listener). Always safe to call. */
  cleanup: () => void;
}

/**
 * Pick the smallest *positive* timeout among the inputs.
 *
 * - Negative / zero / non-finite values are ignored.
 * - Returns undefined when no valid timeout is supplied.
 */
/**
 * Effective positive timeout for outbound provider calls, or `fallbackMs` when
 * neither per-call nor provider-default timeouts are set.
 */
export function pickTimeoutMsOrFallback(
  timeoutMs: number | undefined,
  providerDefaultMs: number | undefined,
  fallbackMs: number,
): number {
  return pickEffectiveTimeoutMs({ timeoutMs, providerDefaultMs }) ?? fallbackMs;
}

export function pickEffectiveTimeoutMs(input: DeadlineInput): number | undefined {
  const candidates: number[] = [];
  if (typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0) {
    candidates.push(input.timeoutMs);
  }
  if (
    typeof input.providerDefaultMs === 'number' &&
    Number.isFinite(input.providerDefaultMs) &&
    input.providerDefaultMs > 0
  ) {
    candidates.push(input.providerDefaultMs);
  }
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

/**
 * Build a combined deadline.
 *
 * Always returns a fresh {@link AbortController} so that callers can pass
 * `signal` directly to `fetch()` without leaking listeners on long-lived
 * upstream signals.
 */
export function resolveDeadline(input: DeadlineInput): ResolvedDeadline {
  const controller = new AbortController();
  const timeoutMs = pickEffectiveTimeoutMs(input);
  const cleanups: Array<() => void> = [];

  if (timeoutMs !== undefined) {
    const timer = setTimeout(() => {
      controller.abort(new TimeoutAbortError(timeoutMs));
    }, timeoutMs);
    // Allow the Node process to exit even if a deadline is pending.
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    cleanups.push(() => clearTimeout(timer));
  }

  const upstream = input.signal;
  if (upstream) {
    if (upstream.aborted) {
      controller.abort(upstream.reason);
    } else {
      const onAbort = () => controller.abort(upstream.reason);
      upstream.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => upstream.removeEventListener('abort', onAbort));
    }
  }

  return {
    timeoutMs,
    signal: controller.signal,
    cleanup: () => {
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Concrete error class so callers can distinguish deadline-aborts from upstream-aborts. */
export class TimeoutAbortError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Provider HTTP call timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutAbortError';
    this.timeoutMs = timeoutMs;
  }
}

export function isTimeoutAbortError(e: unknown): e is TimeoutAbortError {
  return e instanceof TimeoutAbortError;
}
