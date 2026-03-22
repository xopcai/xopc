/**
 * Exponential backoff for channel account restarts (OpenClaw-style).
 */

export interface RestartPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}

export const CHANNEL_RESTART_POLICY: RestartPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  jitter: 0.1,
};

export function computeBackoff(policy: RestartPolicy, attempt: number): number {
  const exponentialDelay = Math.min(
    policy.baseDelayMs * Math.pow(2, attempt - 1),
    policy.maxDelayMs,
  );
  const jitterRange = exponentialDelay * policy.jitter;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, exponentialDelay + jitter);
}
