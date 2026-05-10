import { AbortController } from 'abort-controller';

/** grammY `Api` expects `abort-controller` signals, not Node/DOM `AbortSignal.timeout()`. */
export function createTimeoutAbortSignal(ms: number): {
  signal: InstanceType<typeof AbortController>['signal'];
  dispose: () => void;
} {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return {
    signal: ac.signal,
    dispose: () => clearTimeout(t),
  };
}
