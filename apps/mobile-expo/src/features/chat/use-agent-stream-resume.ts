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
 * Listen for session run lifecycle events (Task continuations, scheduled webchat runs)
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
    return subscribeGatewayEvent('run-started', (detail) => {
      const event = detail as { sessionKey?: string; runId?: string };
      if (!event.sessionKey || !event.runId?.trim()) return;

      setPendingAgentRun(event.sessionKey, event.runId);

      if (activeSessionKeyRef.current !== event.sessionKey) return;
      const sender = senderRef.current;
      if (sender.isStreamingFor(event.sessionKey)) return;

      queueMicrotask(() => {
        if (activeSessionKeyRef.current !== event.sessionKey) return;
        if (senderRef.current.isStreamingFor(event.sessionKey)) return;
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
