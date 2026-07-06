/** Transient transport failures where resume/retry is appropriate. */
export function isTransientNetworkError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('network request failed') ||
    normalized.includes('network error') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('network connection was lost') ||
    normalized.includes('internet connection appears to be offline') ||
    normalized.includes('connection lost') ||
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('socket') ||
    normalized.includes('econnreset') ||
    normalized.includes('enotfound')
  );
}

export function streamRetryDelayMs(attempt: number): number {
  const n = Math.max(1, attempt);
  return Math.min(30_000, 1000 * 2 ** Math.min(n - 1, 5));
}

export const STREAM_RECOVERY_MAX_ATTEMPTS = 8;
export const STREAM_RECOVERY_WAIT_FOR_RUN_MS = 45_000;
/** No SSE activity while streaming — treat as a stalled connection. */
export const STREAM_STALL_MS = 25_000;
