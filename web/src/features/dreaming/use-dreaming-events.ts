/**
 * Hook that listens for dreaming SSE events dispatched on `window`.
 *
 * SSE event names use dots (e.g. `dreaming.phase.start`), but `dispatchGatewaySseEvent`
 * converts them to hyphens before dispatching on `window` — so we listen for
 * `dreaming-phase-start` / `dreaming-phase-end`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type DreamingPhaseId = 'light' | 'deep' | 'rem';

export type DreamingAgentMeta = {
  agentId?: string;
  agentName?: string;
  avatar?: string;
};

export type DreamingSleepingAgent = DreamingAgentMeta & {
  key: string;
  phase: DreamingPhaseId;
  status: 'sleeping' | 'waking';
  startedAt: number;
};

export type DreamingAnimationState =
  | { status: 'idle' }
  | {
      status: 'running' | 'fading-out';
      phase: DreamingPhaseId;
      agents: DreamingSleepingAgent[];
    };

const VALID_PHASES = new Set<string>(['light', 'deep', 'rem']);
const MIN_AGENT_DISPLAY_MS = 3000;
const WAKE_EXIT_MS = 1200;
const OVERLAY_FADE_MS = 800;
const DISMISS_FADE_MS = 800;

function agentKey(phase: DreamingPhaseId, agent?: DreamingAgentMeta): string {
  return `${agent?.agentId?.trim() || 'unknown'}:${phase}`;
}

function firstPhase(agents: DreamingSleepingAgent[]): DreamingPhaseId {
  return agents[0]?.phase ?? 'deep';
}

function parseAgent(detail: unknown): DreamingAgentMeta {
  if (typeof detail !== 'object' || detail === null) return {};
  const record = detail as Record<string, unknown>;
  return {
    ...(typeof record.agentId === 'string' && record.agentId.trim() ? { agentId: record.agentId.trim() } : {}),
    ...(typeof record.agentName === 'string' && record.agentName.trim() ? { agentName: record.agentName.trim() } : {}),
    ...(typeof record.avatar === 'string' && record.avatar.trim() ? { avatar: record.avatar.trim() } : {}),
  };
}

function toState(
  agents: Map<string, DreamingSleepingAgent>,
  overlayStatus: 'running' | 'fading-out' = 'running',
): DreamingAnimationState {
  const list = [...agents.values()];
  if (list.length === 0) return { status: 'idle' };
  return { status: overlayStatus, phase: firstPhase(list), agents: list };
}

export function useDreamingEvents(): {
  state: DreamingAnimationState;
  triggerPhase: (phase: DreamingPhaseId, agent?: DreamingAgentMeta) => void;
  dismiss: () => void;
} {
  const [state, setState] = useState<DreamingAnimationState>({ status: 'idle' });
  const agentsRef = useRef(new Map<string, DreamingSleepingAgent>());
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const setTrackedTimeout = useCallback((fn: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      fn();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
  }, []);

  const triggerPhase = useCallback(
    (phase: DreamingPhaseId, agent?: DreamingAgentMeta) => {
      const key = agentKey(phase, agent);
      const existing = agentsRef.current.get(key);
      agentsRef.current.set(key, {
        key,
        phase,
        status: 'sleeping',
        startedAt: existing?.startedAt ?? Date.now(),
        ...existing,
        ...(agent ?? {}),
      });
      setState(toState(agentsRef.current));
    },
    [],
  );

  const fadeOutIfEmpty = useCallback(() => {
    if (agentsRef.current.size > 0) {
      setState(toState(agentsRef.current));
      return;
    }
    setState((prev) => {
      if (prev.status === 'idle') return prev;
      return { ...prev, status: 'fading-out' };
    });
    setTrackedTimeout(() => setState({ status: 'idle' }), OVERLAY_FADE_MS);
  }, [setTrackedTimeout]);

  const markAgentEnded = useCallback(
    (phase: DreamingPhaseId, agent?: DreamingAgentMeta) => {
      const key = agentKey(phase, agent);
      const existing = agentsRef.current.get(key);
      if (!existing) return;

      const next = { ...existing, ...(agent ?? {}), status: 'waking' as const };
      const elapsed = Date.now() - next.startedAt;
      const waitMs = Math.max(0, MIN_AGENT_DISPLAY_MS - elapsed);

      setTrackedTimeout(() => {
        agentsRef.current.set(key, next);
        setState(toState(agentsRef.current));
        setTrackedTimeout(() => {
          agentsRef.current.delete(key);
          fadeOutIfEmpty();
        }, WAKE_EXIT_MS);
      }, waitMs);
    },
    [fadeOutIfEmpty, setTrackedTimeout],
  );

  const dismiss = useCallback(() => {
    clearTimers();
    agentsRef.current.clear();
    setState((prev) => {
      if (prev.status === 'idle') return prev;
      return { ...prev, status: 'fading-out' };
    });
    setTrackedTimeout(() => setState({ status: 'idle' }), DISMISS_FADE_MS);
  }, [clearTimers, setTrackedTimeout]);

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
        triggerPhase(phase as DreamingPhaseId, parseAgent(detail));
      }
    };

    const handleEnd = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const phase =
        typeof detail === 'object' && detail !== null && typeof detail.phase === 'string'
          ? detail.phase
          : null;
      if (!phase || !VALID_PHASES.has(phase)) return;
      markAgentEnded(phase as DreamingPhaseId, parseAgent(detail));
    };

    window.addEventListener('dreaming-phase-start', handleStart);
    window.addEventListener('dreaming-phase-end', handleEnd);

    return () => {
      window.removeEventListener('dreaming-phase-start', handleStart);
      window.removeEventListener('dreaming-phase-end', handleEnd);
      clearTimers();
    };
  }, [triggerPhase, markAgentEnded, clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  return { state, triggerPhase, dismiss };
}
