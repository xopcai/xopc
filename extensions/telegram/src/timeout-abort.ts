import { AbortController } from 'abort-controller';

/** grammY `Api` expects `abort-controller` signals, not Node/DOM `AbortSignal.timeout()`. */
export function createTimeoutAbortSignal(ms: number, parent?: AbortSignal): {
  signal: InstanceType<typeof AbortController>['signal'];
  dispose: () => void;
} {
  const ac = new AbortController();
  const abort = () => ac.abort();
  const t = setTimeout(abort, ms);
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  return {
    signal: ac.signal,
    dispose: () => {
      clearTimeout(t);
      parent?.removeEventListener('abort', abort);
    },
  };
}
