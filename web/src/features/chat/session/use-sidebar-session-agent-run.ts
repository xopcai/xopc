import { useEffect, useRef, useState } from 'react';

import { PENDING_AGENT_RUN_CHANGED_EVENT } from '@/features/chat/follow-up/pending-agent-run-events';
import {
  isSessionAgentRunActive,
  isSessionSliceLive,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';

/** True when this session has an in-flight web agent run (any tab route or persisted pending run id). */
export function useSidebarSessionAgentRun(sessionKey: string): boolean {
  const storeLive = useChatSessionStore((s) => isSessionSliceLive(s.sessions[sessionKey]));
  const [pendingActive, setPendingActive] = useState(() => isSessionAgentRunActive(sessionKey));
  const trackedKeyRef = useRef(sessionKey);

  if (trackedKeyRef.current !== sessionKey) {
    trackedKeyRef.current = sessionKey;
    setPendingActive(isSessionAgentRunActive(sessionKey));
  }

  useEffect(() => {
    setPendingActive(isSessionAgentRunActive(sessionKey));
  }, [sessionKey, storeLive]);

  useEffect(() => {
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (id !== sessionKey) return;
      setPendingActive(isSessionAgentRunActive(sessionKey));
    };
    window.addEventListener(PENDING_AGENT_RUN_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PENDING_AGENT_RUN_CHANGED_EVENT, onChanged);
  }, [sessionKey]);

  return storeLive || pendingActive;
}
