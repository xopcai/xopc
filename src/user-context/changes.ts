import { createLogger } from '../utils/logger.js';

export interface UserContextChange {
  kind: 'profile' | 'understanding' | 'focus' | 'policy' | 'session' | 'session-reset';
  id?: string;
}
const listeners = new Set<(change: UserContextChange) => void>();
const log = createLogger('UserContextChanges');

export function onUserContextChange(listener: (change: UserContextChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Dispatch after the synchronous write/outer transaction has left the stack. */
export function notifyUserContextChange(change: UserContextChange): void {
  if (!listeners.size) return;
  queueMicrotask(() => {
    for (const listener of listeners) {
      try { listener(change); }
      catch (err) { log.error({ err, kind: change.kind }, 'User context change listener failed'); }
    }
  });
}
