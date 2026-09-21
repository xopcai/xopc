import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { AppState } from 'react-native';

import {
  isTransientNetworkError,
  STREAM_RECOVERY_FAST_ATTEMPTS,
  STREAM_RECOVERY_PARKED_RETRY_MS,
  streamRetryDelayMs,
} from './network-errors';
import { resolveResumeRunId } from './resolve-resume-run-id';

type TryAgentStreamResume = (runId: string, signal: AbortSignal) => void | Promise<void>;

type UseAgentStreamRecoveryOptions = {
  conversationId: string;
  activeConversationIdRef: RefObject<string>;
  tryResume: TryAgentStreamResume;
  onParked: () => void;
  onReconcile: () => void | Promise<void>;
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Owns silent fast recovery and low-frequency parked retries. */
export function useAgentStreamRecovery(options: UseAgentStreamRecoveryOptions) {
  const {
    conversationId,
    activeConversationIdRef,
    tryResume,
    onParked,
    onReconcile,
  } = options;
  const tryResumeRef = useRef(tryResume);
  const onParkedRef = useRef(onParked);
  const onReconcileRef = useRef(onReconcile);
  tryResumeRef.current = tryResume;
  onParkedRef.current = onParked;
  onReconcileRef.current = onReconcile;

  const abortRef = useRef<AbortController | null>(null);
  const parkedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);

  const clearParkedTimer = useCallback(() => {
    if (parkedTimerRef.current) clearTimeout(parkedTimerRef.current);
    parkedTimerRef.current = null;
  }, []);

  const cancelRecovery = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    activeGenerationRef.current = 0;
    clearParkedTimer();
  }, [clearParkedTimer]);

  const runRecoveryRef = useRef<() => void>(() => {});
  const park = useCallback(() => {
    onParkedRef.current();
    clearParkedTimer();
    if (AppState.currentState !== 'active') return;
    parkedTimerRef.current = setTimeout(() => runRecoveryRef.current(), STREAM_RECOVERY_PARKED_RETRY_MS);
  }, [clearParkedTimer]);

  const runRecovery = useCallback(async () => {
    if (!conversationId || activeGenerationRef.current !== 0) return;
    clearParkedTimer();
    if (AppState.currentState !== 'active') {
      onParkedRef.current();
      return;
    }
    const generation = ++generationRef.current;
    activeGenerationRef.current = generation;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted
      && generation === generationRef.current
      && activeConversationIdRef.current === conversationId
      && AppState.currentState === 'active';

    try {
      for (let attempt = 1; attempt <= STREAM_RECOVERY_FAST_ATTEMPTS; attempt++) {
        if (!isCurrent()) return;
        let runId: string | null;
        try {
          runId = await resolveResumeRunId(conversationId, controller.signal);
        } catch (error) {
          if (!isCurrent()) return;
          const message = error instanceof Error ? error.message : String(error);
          if (!isTransientNetworkError(message)) {
            await onReconcileRef.current();
            return;
          }
          if (attempt === STREAM_RECOVERY_FAST_ATTEMPTS) {
            park();
            return;
          }
          await delay(1_200, controller.signal);
          continue;
        }
        if (!isCurrent()) return;
        if (!runId) {
          await onReconcileRef.current();
          return;
        }

        const retryDelayMs = attempt === 1 ? 0 : streamRetryDelayMs(attempt - 1);
        if (retryDelayMs > 0) await delay(retryDelayMs, controller.signal);
        if (!isCurrent()) return;
        try {
          await tryResumeRef.current(runId, controller.signal);
          return;
        } catch (error) {
          if (!isCurrent()) return;
          const message = error instanceof Error ? error.message : String(error);
          if (!isTransientNetworkError(message)) {
            await onReconcileRef.current();
            return;
          }
        }
      }
      if (isCurrent()) park();
    } catch {
      if (isCurrent()) park();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (activeGenerationRef.current === generation) activeGenerationRef.current = 0;
    }
  }, [activeConversationIdRef, clearParkedTimer, park, conversationId]);
  runRecoveryRef.current = () => { void runRecovery(); };

  const recover = useCallback((error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    if (!isTransientNetworkError(message)) return false;
    void runRecovery();
    return true;
  }, [runRecovery]);

  const wake = useCallback(() => {
    if (!conversationId) return;
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    activeGenerationRef.current = 0;
    clearParkedTimer();
    void runRecovery();
  }, [clearParkedTimer, runRecovery, conversationId]);

  useEffect(() => () => cancelRecovery(), [cancelRecovery, conversationId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') cancelRecovery();
    });
    return () => subscription.remove();
  }, [cancelRecovery]);

  return { recover, wake, cancelRecovery };
}
