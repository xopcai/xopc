import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { AgentMessageSender } from '../../api/agent-client';
import { subscribeGatewayEvent } from '../gateway/gateway-event-bus';
import { hasPendingAgentRunForSession, setPendingAgentRun } from '../gateway/pending-agent-run';

/**
 * Listen for session run lifecycle events (Task continuations, scheduled webchat runs)
 * and trigger resume when the active chat is idle.
 */
export function useAgentStreamResume(opts: {
  sessionKey: string;
  senderRef: RefObject<AgentMessageSender>;
  activeSessionKeyRef: RefObject<string>;
  wakeRecovery: () => void;
  streaming: boolean;
}): void {
  const { sessionKey, senderRef, activeSessionKeyRef, wakeRecovery, streaming } = opts;
  const wakeRecoveryRef = useRef(wakeRecovery);
  const streamingRef = useRef(streaming);
  wakeRecoveryRef.current = wakeRecovery;
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
        wakeRecoveryRef.current();
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
      wakeRecoveryRef.current();
    });
  }, [streaming, sessionKey, activeSessionKeyRef, senderRef]);
}
