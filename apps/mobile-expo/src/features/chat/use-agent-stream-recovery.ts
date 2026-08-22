import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { AppState } from 'react-native';

import {
  isTransientNetworkError,
  STREAM_RECOVERY_FAST_ATTEMPTS,
  STREAM_RECOVERY_PARKED_RETRY_MS,
  STREAM_RECOVERY_WAIT_FOR_RUN_MS,
  streamRetryDelayMs,
} from './network-errors';
import { resolveResumeRunId } from './resolve-resume-run-id';

type TryAgentStreamResume = (runId: string) => void | Promise<void>;

type UseAgentStreamRecoveryOptions = {
  sessionKey: string;
  activeSessionKeyRef: RefObject<string>;
  tryResume: TryAgentStreamResume;
  tryPendingInput: () => Promise<boolean>;
  onParked: () => void;
  onReconcile: () => void | Promise<void>;
  onSubmissionFailed: (error: unknown) => void;
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
    sessionKey,
    activeSessionKeyRef,
    tryResume,
    tryPendingInput,
    onParked,
    onReconcile,
    onSubmissionFailed,
  } = options;
  const tryResumeRef = useRef(tryResume);
  const tryPendingInputRef = useRef(tryPendingInput);
  const onParkedRef = useRef(onParked);
  const onReconcileRef = useRef(onReconcile);
  const onSubmissionFailedRef = useRef(onSubmissionFailed);
  tryResumeRef.current = tryResume;
  tryPendingInputRef.current = tryPendingInput;
  onParkedRef.current = onParked;
  onReconcileRef.current = onReconcile;
  onSubmissionFailedRef.current = onSubmissionFailed;

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
    if (!sessionKey || activeGenerationRef.current !== 0) return;
    clearParkedTimer();
    const generation = ++generationRef.current;
    activeGenerationRef.current = generation;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const startedAt = Date.now();
    let pendingInputBlocked = false;

    try {
      for (let attempt = 1; attempt <= STREAM_RECOVERY_FAST_ATTEMPTS; attempt++) {
        if (
          controller.signal.aborted ||
          generation !== generationRef.current ||
          activeSessionKeyRef.current !== sessionKey
        ) return;
        try {
          if (await tryPendingInputRef.current()) return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!isTransientNetworkError(message)) {
            onSubmissionFailedRef.current(error);
            return;
          }
          pendingInputBlocked = true;
        }
        if (controller.signal.aborted || generation !== generationRef.current) return;

        const runId = await resolveResumeRunId(sessionKey);
        if (controller.signal.aborted || generation !== generationRef.current) return;
        if (!runId) {
          if (Date.now() - startedAt >= STREAM_RECOVERY_WAIT_FOR_RUN_MS || attempt === STREAM_RECOVERY_FAST_ATTEMPTS) {
            if (pendingInputBlocked) park();
            else await onReconcileRef.current();
            return;
          }
          await delay(1_200, controller.signal);
          continue;
        }

        const retryDelayMs = attempt === 1 ? 0 : streamRetryDelayMs(attempt - 1);
        await delay(retryDelayMs, controller.signal);
        if (
          controller.signal.aborted ||
          generation !== generationRef.current ||
          activeSessionKeyRef.current !== sessionKey
        ) return;
        try {
          await tryResumeRef.current(runId);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!isTransientNetworkError(message)) {
            await onReconcileRef.current();
            return;
          }
        }
      }
      park();
    } catch {
      if (!controller.signal.aborted) park();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (activeGenerationRef.current === generation) activeGenerationRef.current = 0;
    }
  }, [activeSessionKeyRef, clearParkedTimer, park, sessionKey]);
  runRecoveryRef.current = () => { void runRecovery(); };

  const recover = useCallback((error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    if (!isTransientNetworkError(message)) return false;
    void runRecovery();
    return true;
  }, [runRecovery]);

  const wake = useCallback(() => {
    if (!sessionKey) return;
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    activeGenerationRef.current = 0;
    clearParkedTimer();
    void runRecovery();
  }, [clearParkedTimer, runRecovery, sessionKey]);

  useEffect(() => () => cancelRecovery(), [cancelRecovery, sessionKey]);

  return { recover, wake, markRecoverySucceeded: cancelRecovery, cancelRecovery };
}
