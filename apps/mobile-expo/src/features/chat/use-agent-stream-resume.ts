import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { AgentMessageSender } from '../../api/agent-client';
import { subscribeGatewayEvent } from '../gateway/gateway-event-bus';
import { hasPendingAgentRunForSession, setPendingAgentRun } from '../gateway/pending-agent-run';

export type AgentStreamResumeOptions = {
  background?: boolean;
};

export type TryAgentStreamResume = (opts?: AgentStreamResumeOptions) => void | Promise<void>;

/**
 * Listen for gateway `agent.stream` run_start events (goal continuations, scheduled webchat runs)
 * and trigger resume when the active chat is idle.
 */
export function useAgentStreamResume(opts: {
  sessionKey: string;
  senderRef: RefObject<AgentMessageSender>;
  activeSessionKeyRef: RefObject<string>;
  tryResume: TryAgentStreamResume;
  streaming: boolean;
}): void {
  const { sessionKey, senderRef, activeSessionKeyRef, tryResume, streaming } = opts;
  const tryResumeRef = useRef(tryResume);
  const streamingRef = useRef(streaming);
  tryResumeRef.current = tryResume;
  streamingRef.current = streaming;

  useEffect(() => {
    return subscribeGatewayEvent('agent-stream', (detail) => {
      const d = detail as { sessionKey?: string; event?: { type?: string; runId?: string } };
      if (!d?.sessionKey) return;
      const inner = d.event;
      if (!inner || inner.type !== 'run_start' || typeof inner.runId !== 'string' || !inner.runId.trim()) {
        return;
      }

      setPendingAgentRun(d.sessionKey, inner.runId);

      if (activeSessionKeyRef.current !== d.sessionKey) return;
      const sender = senderRef.current;
      if (sender.isStreamingFor(d.sessionKey)) return;

      queueMicrotask(() => {
        if (activeSessionKeyRef.current !== d.sessionKey) return;
        if (senderRef.current.isStreamingFor(d.sessionKey)) return;
        void tryResumeRef.current({ background: true });
      });
    });
  }, [activeSessionKeyRef, senderRef]);

  const streamBusyRef = useRef(false);
  useEffect(() => {
    const busy = streaming || senderRef.current.isSending;
    const wasBusy = streamBusyRef.current;
    streamBusyRef.current = busy;
    if (!wasBusy || busy || !sessionKey) return;

    queueMicrotask(() => {
      if (activeSessionKeyRef.current !== sessionKey) return;
      if (senderRef.current.isStreamingFor(sessionKey)) return;
      if (!hasPendingAgentRunForSession(sessionKey)) return;
      void tryResumeRef.current({ background: true });
    });
  }, [streaming, sessionKey, activeSessionKeyRef, senderRef]);
}
