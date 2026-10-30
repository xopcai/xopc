async function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** One deadline shared by launch, restore, metadata polling and capture. */
export async function withWindowReadiness<T>(signal: AbortSignal, operation: (signal: AbortSignal,
  poll: <V>(sample: () => Promise<V | undefined>) => Promise<V>) => Promise<T>): Promise<T> {
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new Error('COMPUTER_WINDOW_READY_TIMEOUT')), 5000);
  let rejectCancelled!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const abort = () => rejectCancelled(combined.reason);
  combined.addEventListener('abort', abort, { once: true });
  const poll = async <V>(sample: () => Promise<V | undefined>): Promise<V> => {
    for (let attempt = 0; ; attempt++) {
      combined.throwIfAborted();
      const value = await sample();
      combined.throwIfAborted();
      if (value !== undefined) return value;
      await wait([100, 200, 400][attempt] ?? 500, combined);
    }
  };
  try {
    combined.throwIfAborted();
    return await Promise.race([operation(combined, poll), cancelled]);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timeout.signal.aborted) throw new Error('COMPUTER_WINDOW_READY_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); combined.removeEventListener('abort', abort); }
}
