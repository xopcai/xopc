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
  conversationId: string;
  senderRef: RefObject<AgentMessageSender>;
  activeConversationIdRef: RefObject<string>;
  wakeRecovery: () => void;
  streaming: boolean;
  sending: boolean;
}): void {
  const { conversationId, senderRef, activeConversationIdRef, wakeRecovery, streaming, sending } = opts;
  const wakeRecoveryRef = useRef(wakeRecovery);
  const sendingRef = useRef(sending);
  wakeRecoveryRef.current = wakeRecovery;
  sendingRef.current = sending;

  useEffect(() => {
    return subscribeGatewayEvent('run-started', (detail) => {
      const event = detail as { conversationId?: string; runId?: string };
      if (!event.conversationId || !event.runId?.trim()) return;

      setPendingAgentRun(event.conversationId, event.runId);

      if (activeConversationIdRef.current !== event.conversationId || sendingRef.current) return;
      const sender = senderRef.current;
      if (sender.isStreamingFor(event.conversationId)) return;

      queueMicrotask(() => {
        if (activeConversationIdRef.current !== event.conversationId || sendingRef.current) return;
        if (senderRef.current.isStreamingFor(event.conversationId)) return;
        wakeRecoveryRef.current();
      });
    });
  }, [activeConversationIdRef, senderRef]);

  const streamBusyRef = useRef(false);
  useEffect(() => {
    const busy = streaming || sending;
    const wasBusy = streamBusyRef.current;
    streamBusyRef.current = busy;
    if (!wasBusy || busy || !conversationId) return;

    queueMicrotask(() => {
      if (activeConversationIdRef.current !== conversationId) return;
      if (senderRef.current.isStreamingFor(conversationId)) return;
      if (!hasPendingAgentRunForSession(conversationId)) return;
      wakeRecoveryRef.current();
    });
  }, [streaming, sending, conversationId, activeConversationIdRef, senderRef]);
}
