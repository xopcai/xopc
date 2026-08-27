import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export const AGENT_STREAM_EVENT = 'agent-stream-event';

export type AgentActivityDetailLevel = 'off' | 'on' | 'stream';

export type AgentStreamWindowDetail = {
  sessionKey: string;
  event: unknown;
  activityDetailLevel: AgentActivityDetailLevel;
};

type RunStartedDetail = {
  sessionKey: string;
  runId: string;
};

type BridgeDependencies = {
  subscribe: typeof subscribeRealtimeTopic;
  loadActivityDetailLevel: (
    sessionKey: string,
  ) => Promise<AgentActivityDetailLevel>;
  dispatch: (detail: AgentStreamWindowDetail) => void;
};

function isActivityDetailLevel(value: unknown): value is AgentActivityDetailLevel {
  return value === 'off' || value === 'on' || value === 'stream';
}

function parseRunStartedDetail(value: unknown): RunStartedDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey.trim() : '';
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  return sessionKey && runId ? { sessionKey, runId } : null;
}

function normalizeRunEvent(
  eventName: string,
  data: unknown,
  sequence: number,
): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), seq: sequence }
    : { type: eventName, seq: sequence, payload: data };
}

export async function loadAgentActivityDetailLevel(
  sessionKey: string,
): Promise<AgentActivityDetailLevel> {
  try {
    const response = await apiFetch(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`),
    );
    if (!response.ok) return 'on';
    const body = await response.json() as {
      payload?: {
        reasoningLevel?: unknown;
        activityDetail?: { effective?: unknown; default?: unknown };
      };
    };
    const effective = body.payload?.activityDetail?.effective;
    if (isActivityDetailLevel(effective)) return effective;
    const fallback = body.payload?.activityDetail?.default ?? body.payload?.reasoningLevel;
    return isActivityDetailLevel(fallback) ? fallback : 'on';
  } catch {
    return 'on';
  }
}

export function dispatchAgentStreamWindowEvent(detail: AgentStreamWindowDetail): void {
  window.dispatchEvent(new CustomEvent(AGENT_STREAM_EVENT, { detail }));
}

/**
 * Restores the app-wide agent stream used by ambient surfaces and extensions.
 * Durable webchat runs announce themselves on `sessions`; their full streams
 * remain isolated on replayable `run:<runId>` topics.
 */
export function startAgentRunStreamEventBridge(
  dependencies: Partial<BridgeDependencies> = {},
): () => void {
  const subscribe = dependencies.subscribe ?? subscribeRealtimeTopic;
  const loadActivityDetailLevel =
    dependencies.loadActivityDetailLevel ?? loadAgentActivityDetailLevel;
  const dispatch = dependencies.dispatch ?? dispatchAgentStreamWindowEvent;
  const subscriptions = new Map<string, () => void>();
  let disposed = false;

  const onRunStarted = (raw: Event) => {
    const started = parseRunStartedDetail((raw as CustomEvent<unknown>).detail);
    if (!started || subscriptions.has(started.runId)) return;

    let activityDetailLevel: AgentActivityDetailLevel = 'on';
    let levelResolved = false;
    let pendingThinkingEvent: Record<string, unknown> | undefined;
    let stopped = false;
    let terminalQueued = false;
    let unsubscribe = () => {};
    const stop = () => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      if (subscriptions.get(started.runId) === stop) {
        subscriptions.delete(started.runId);
      }
    };
    const deliver = (event: Record<string, unknown>) => {
      if (disposed || stopped) return;
      dispatch({
        sessionKey: started.sessionKey,
        event,
        activityDetailLevel,
      });
    };
    void loadActivityDetailLevel(started.sessionKey).then((resolved) => {
      activityDetailLevel = resolved;
      levelResolved = true;
      if (resolved === 'stream' && pendingThinkingEvent && !terminalQueued) {
        deliver(pendingThinkingEvent);
      }
      pendingThinkingEvent = undefined;
    });

    unsubscribe = subscribe(`run:${started.runId}`, {
      onEvent: (message) => {
        if (stopped || terminalQueued) return;
        const event = normalizeRunEvent(message.event, message.data, message.seq);
        if (message.event === 'thinking_delta' && !levelResolved) {
          pendingThinkingEvent = event;
        } else {
          deliver(event);
        }
        if (message.event === 'run_end') {
          terminalQueued = true;
          pendingThinkingEvent = undefined;
          queueMicrotask(stop);
        }
      },
      onGap: (gap) => {
        if (!gap.recoverable) stop();
      },
    }, 0);
    subscriptions.set(started.runId, stop);
  };

  window.addEventListener('run-started', onRunStarted);
  return () => {
    disposed = true;
    window.removeEventListener('run-started', onRunStarted);
    for (const stop of [...subscriptions.values()]) stop();
  };
}
