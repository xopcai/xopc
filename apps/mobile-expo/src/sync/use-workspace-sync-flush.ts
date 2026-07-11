import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { queryClient } from '../query/query-client';
import { queryKeys } from '../query/keys';
import { invalidateNoteLists } from '../query/workspace-sync';
import {
  flushPendingWorkspaceOperations,
  getPendingWorkspaceOperationCount,
} from './workspace-sync';

const ACTIVE_FLUSH_INTERVAL_MS = 30_000;

export async function flushWorkspaceSyncNow(): Promise<number> {
  const flushed = await flushPendingWorkspaceOperations();
  if (flushed > 0) {
    invalidateNoteLists(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
    void queryClient.invalidateQueries({ queryKey: ['note'] });
  }
  return flushed;
}

export function useWorkspaceSyncFlush(enabled: boolean): void {
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (!enabled || flushingRef.current || getPendingWorkspaceOperationCount() === 0) return;
    flushingRef.current = true;
    try {
      await flushWorkspaceSyncNow();
    } catch {
      // The persisted queue keeps failed operations for a later foreground/configured flush.
    } finally {
      flushingRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    void flush();
  }, [flush]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    return () => sub.remove();
  }, [flush]);

  useEffect(() => {
    if (!enabled) return undefined;
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void flush();
    }, ACTIVE_FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, flush]);
}
