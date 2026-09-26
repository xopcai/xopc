type SyncState = {
  promise: Promise<void>;
  rerun: boolean;
  sync: () => Promise<void>;
};

const activeSyncs = new Map<string, SyncState>();

/**
 * Coalesces all head refresh triggers for a session. A trigger received while
 * the request is active schedules exactly one trailing refresh, so events are
 * not lost and slow responses cannot race a newer request.
 */
export function requestSessionSync(key: string, sync: () => Promise<void>): Promise<void> {
  const active = activeSyncs.get(key);
  if (active) {
    active.rerun = true;
    active.sync = sync;
    return active.promise;
  }

  const state: SyncState = { promise: Promise.resolve(), rerun: false, sync };
  state.promise = (async () => {
    try {
      do {
        state.rerun = false;
        await state.sync();
      } while (state.rerun);
    } finally {
      if (activeSyncs.get(key) === state) activeSyncs.delete(key);
    }
  })();
  activeSyncs.set(key, state);
  return state.promise;
}

/** Forget an owner that unmounted; the underlying fetch may still settle safely. */
export function releaseSessionSync(key: string): void {
  activeSyncs.delete(key);
}

export function resetSessionSyncCoordinatorForTests(): void {
  activeSyncs.clear();
}
