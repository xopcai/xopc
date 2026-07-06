import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { readPendingAgentRunId } from '../gateway/pending-agent-run';

import {
  isTransientNetworkError,
  STREAM_RECOVERY_MAX_ATTEMPTS,
  STREAM_RECOVERY_WAIT_FOR_RUN_MS,
  streamRetryDelayMs,
} from './network-errors';
import type { TryAgentStreamResume } from './use-agent-stream-resume';

type UseAgentStreamRecoveryOpts = {
  sessionKey: string;
  activeSessionKeyRef: RefObject<string>;
  tryResume: TryAgentStreamResume;
  autoResumeFailedRef: RefObject<boolean>;
  onReconnectingChange: (reconnecting: boolean) => void;
  onRecoveryExhausted: () => void;
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Silently resume agent SSE after transient network loss (exponential backoff).
 * Surfaces UI only after automatic recovery is exhausted.
 */
export function useAgentStreamRecovery(opts: UseAgentStreamRecoveryOpts) {
  const {
    sessionKey,
    activeSessionKeyRef,
    tryResume,
    autoResumeFailedRef,
    onReconnectingChange,
    onRecoveryExhausted,
  } = opts;

  const tryResumeRef = useRef(tryResume);
  tryResumeRef.current = tryResume;

  const recoveryAbortRef = useRef<AbortController | null>(null);
  const recoveryInFlightRef = useRef(false);
  const retryCountRef = useRef(0);
  const waitStartedAtRef = useRef(0);

  const cancelRecovery = useCallback(() => {
    recoveryAbortRef.current?.abort();
    recoveryAbortRef.current = null;
    recoveryInFlightRef.current = false;
    retryCountRef.current = 0;
    waitStartedAtRef.current = 0;
    onReconnectingChange(false);
  }, [onReconnectingChange]);

  const runRecoveryLoop = useCallback(async () => {
    if (!sessionKey || recoveryInFlightRef.current) return;
    recoveryInFlightRef.current = true;
    recoveryAbortRef.current?.abort();
    const abortController = new AbortController();
    recoveryAbortRef.current = abortController;
    waitStartedAtRef.current = Date.now();
    onReconnectingChange(true);
    autoResumeFailedRef.current = false;

    try {
      while (retryCountRef.current < STREAM_RECOVERY_MAX_ATTEMPTS) {
        if (abortController.signal.aborted) return;
        if (activeSessionKeyRef.current !== sessionKey) return;

        const runId = readPendingAgentRunId(sessionKey);
        if (!runId) {
          if (Date.now() - waitStartedAtRef.current > STREAM_RECOVERY_WAIT_FOR_RUN_MS) {
            break;
          }
          await delay(1200, abortController.signal);
          continue;
        }

        retryCountRef.current += 1;
        await delay(streamRetryDelayMs(retryCountRef.current), abortController.signal);

        if (abortController.signal.aborted) return;
        if (activeSessionKeyRef.current !== sessionKey) return;

        try {
          await tryResumeRef.current({ background: true });
          retryCountRef.current = 0;
          waitStartedAtRef.current = 0;
          onReconnectingChange(false);
          return;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!isTransientNetworkError(message)) {
            throw e;
          }
        }
      }

      autoResumeFailedRef.current = true;
      onReconnectingChange(false);
      onRecoveryExhausted();
    } catch {
      if (!abortController.signal.aborted) {
        autoResumeFailedRef.current = true;
        onReconnectingChange(false);
        onRecoveryExhausted();
      }
    } finally {
      if (recoveryAbortRef.current === abortController) {
        recoveryAbortRef.current = null;
      }
      recoveryInFlightRef.current = false;
    }
  }, [
    sessionKey,
    activeSessionKeyRef,
    autoResumeFailedRef,
    onReconnectingChange,
    onRecoveryExhausted,
  ]);

  const handleRecoverableFailure = useCallback(
    (error: unknown): boolean => {
      const message = error instanceof Error ? error.message : String(error);
      if (!isTransientNetworkError(message)) return false;
      void runRecoveryLoop();
      return true;
    },
    [runRecoveryLoop],
  );

  useEffect(() => () => cancelRecovery(), [cancelRecovery, sessionKey]);

  return {
    handleRecoverableFailure,
    cancelRecovery,
    markRecoverySucceeded: cancelRecovery,
  };
}
