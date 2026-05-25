import { useEffect, useRef, useState } from 'react';

import { pendingAgentRunStorageKey } from '@/features/chat/messages/message-sender';
import { PENDING_AGENT_RUN_CHANGED_EVENT } from '@/features/chat/follow-up/pending-agent-run-events';
import { useChatAgentRunIndicatorStore } from '@/stores/chat-agent-run-indicator-store';

function readPendingFromStorage(chatId: string): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem(pendingAgentRunStorageKey(chatId));
    if (!raw) return false;
    const j = JSON.parse(raw) as { runId?: unknown };
    return typeof j.runId === 'string' && j.runId.trim().length > 0;
  } catch {
    return false;
  }
}

/** True when this session has an in-flight web agent run (current page UI or persisted pending run id). */
export function useSidebarSessionAgentRun(sessionKey: string): boolean {
  const focusActive = useChatAgentRunIndicatorStore(
    (s) => s.focusedSessionKey === sessionKey && s.focusedAgentRunActive,
  );
  const [storageActive, setStorageActive] = useState(() => readPendingFromStorage(sessionKey));
  const trackedKeyRef = useRef(sessionKey);
  if (trackedKeyRef.current !== sessionKey) {
    trackedKeyRef.current = sessionKey;
    setStorageActive(readPendingFromStorage(sessionKey));
  }

  useEffect(() => {
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (id !== sessionKey) return;
      setStorageActive(readPendingFromStorage(sessionKey));
    };
    window.addEventListener(PENDING_AGENT_RUN_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PENDING_AGENT_RUN_CHANGED_EVENT, onChanged);
  }, [sessionKey]);

  return focusActive || storageActive;
}
