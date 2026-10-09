/** Bound startup waits, including APIs that cannot be aborted (getUserMedia / IPC). */
export function awaitVoiceStartupStep<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  onLateResult?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new DOMException('Voice startup timed out', 'TimeoutError')), timeoutMs);
    pending.then((value) => {
      if (settled) onLateResult?.(value);
      else finish(undefined, value);
    }, (error) => finish(error));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
