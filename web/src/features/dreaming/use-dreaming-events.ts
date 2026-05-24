/**
 * Hook that listens for dreaming SSE events dispatched on `window`.
 *
 * SSE event names use dots (e.g. `dreaming.phase.start`), but `dispatchGatewaySseEvent`
 * converts them to hyphens before dispatching on `window` — so we listen for
 * `dreaming-phase-start` / `dreaming-phase-end`.
 *
 * Phase runs triggered from Settings → Dreams arrive via SSE when the gateway executes the job.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type DreamingPhaseId = 'light' | 'deep' | 'rem';

export type DreamingAnimationState =
  | { status: 'idle' }
  | { status: 'running'; phase: DreamingPhaseId }
  | { status: 'fading-out'; phase: DreamingPhaseId };

const VALID_PHASES = new Set<string>(['light', 'deep', 'rem']);

/** Minimum display time (ms) before auto-fade when phase ends quickly. */
const MIN_DISPLAY_MS = 3000;

export function useDreamingEvents(): {
  state: DreamingAnimationState;
  triggerPhase: (phase: DreamingPhaseId) => void;
  dismiss: () => void;
} {
  const [state, setState] = useState<DreamingAnimationState>({ status: 'idle' });
  const startedAt = useRef(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFadeTimer = useCallback(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);

  const triggerPhase = useCallback(
    (phase: DreamingPhaseId) => {
      clearFadeTimer();
      startedAt.current = Date.now();
      setState({ status: 'running', phase });
    },
    [clearFadeTimer],
  );

  const beginFadeOut = useCallback(
    (phase: DreamingPhaseId) => {
      clearFadeTimer();
      setState({ status: 'fading-out', phase });
      // After fade completes (~1.5s), go idle
      fadeTimerRef.current = setTimeout(() => {
        setState({ status: 'idle' });
      }, 1500);
    },
    [clearFadeTimer],
  );

  const dismiss = useCallback(() => {
    clearFadeTimer();
    setState((prev) => {
      if (prev.status === 'idle') return prev;
      return { status: 'fading-out', phase: prev.phase };
    });
    fadeTimerRef.current = setTimeout(() => {
      setState({ status: 'idle' });
    }, 800);
  }, [clearFadeTimer]);

  useEffect(() => {
    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const phase =
        typeof detail === 'object' && detail !== null && typeof detail.phase === 'string'
          ? detail.phase
          : typeof detail === 'string'
            ? detail
            : null;
      if (phase && VALID_PHASES.has(phase)) {
        triggerPhase(phase as DreamingPhaseId);
      }
    };

    const handleEnd = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const phase =
        typeof detail === 'object' && detail !== null && typeof detail.phase === 'string'
          ? detail.phase
          : null;
      if (!phase || !VALID_PHASES.has(phase)) return;

      // Ensure the animation has been visible for at least MIN_DISPLAY_MS
      const elapsed = Date.now() - startedAt.current;
      const remainingDelay = Math.max(0, MIN_DISPLAY_MS - elapsed);

      clearFadeTimer();
      fadeTimerRef.current = setTimeout(() => {
        beginFadeOut(phase as DreamingPhaseId);
      }, remainingDelay);
    };

    window.addEventListener('dreaming-phase-start', handleStart);
    window.addEventListener('dreaming-phase-end', handleEnd);

    return () => {
      window.removeEventListener('dreaming-phase-start', handleStart);
      window.removeEventListener('dreaming-phase-end', handleEnd);
      clearFadeTimer();
    };
  }, [triggerPhase, beginFadeOut, clearFadeTimer]);

  // Cleanup on unmount
  useEffect(() => clearFadeTimer, [clearFadeTimer]);

  return { state, triggerPhase, dismiss };
}
