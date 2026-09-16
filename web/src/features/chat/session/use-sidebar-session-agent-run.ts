import { useEffect, useRef, useState } from 'react';

import { PENDING_AGENT_RUN_CHANGED_EVENT } from '@/features/chat/follow-up/pending-agent-run-events';
import {
  isSessionAgentRunActive,
  isSessionSliceLive,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';

/** True when this session has an in-flight web agent run (any tab route or persisted pending run id). */
export function useSidebarSessionAgentRun(conversationId: string): boolean {
  const storeLive = useChatSessionStore((s) => isSessionSliceLive(s.sessions[conversationId]));
  const [pendingActive, setPendingActive] = useState(() => isSessionAgentRunActive(conversationId));
  const trackedKeyRef = useRef(conversationId);

  if (trackedKeyRef.current !== conversationId) {
    trackedKeyRef.current = conversationId;
    setPendingActive(isSessionAgentRunActive(conversationId));
  }

  useEffect(() => {
    setPendingActive(isSessionAgentRunActive(conversationId));
  }, [conversationId, storeLive]);

  useEffect(() => {
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (id !== conversationId) return;
      setPendingActive(isSessionAgentRunActive(conversationId));
    };
    window.addEventListener(PENDING_AGENT_RUN_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PENDING_AGENT_RUN_CHANGED_EVENT, onChanged);
  }, [conversationId]);

  return storeLive || pendingActive;
}
