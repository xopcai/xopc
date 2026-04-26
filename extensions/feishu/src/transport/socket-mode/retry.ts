export function computeBackoffMs(attempt: number): number {
  const a = Math.max(1, Math.min(attempt, 10));
  const base = 500 * 2 ** (a - 1); // 0.5s, 1s, 2s, ...
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(30_000, base + jitter);
}

