/**
 * Tiny pub/sub for SSE transport state. Lets the connection state machine
 * factor in "real-time channel up?" (not just /health) when deciding what
 * pill/banner to show, and lets the composer hint the user when their next
 * send will be queued instead of streamed live.
 */
export type SseStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

let current: SseStatus = 'idle';
const listeners = new Set<(status: SseStatus) => void>();

export function getSseStatus(): SseStatus {
  return current;
}

export function setSseStatus(next: SseStatus): void {
  if (current === next) return;
  current = next;
  for (const cb of listeners) cb(current);
}

export function subscribeSseStatus(cb: (status: SseStatus) => void): () => void {
  listeners.add(cb);
  cb(current);
  return () => {
    listeners.delete(cb);
  };
}

/** @internal test helper */
export function __resetSseStatusForTests(): void {
  current = 'idle';
  listeners.clear();
}
