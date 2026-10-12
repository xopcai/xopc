import { useMemo, useSyncExternalStore } from 'react';

import { useChatSessionStore } from './chat-session-store';

/** Coalesce live presentation updates without delaying input or terminal state. */
export function useFrameChatSession(conversationId: string | null) {
  const subscription = useMemo(() => {
    const read = () => conversationId ? useChatSessionStore.getState().sessions[conversationId] : undefined;
    let snapshot = read();
    return {
      getSnapshot: () => snapshot,
      subscribe: (notify: () => void) => {
        let frame: number | null = null;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const cancel = () => {
          if (frame !== null) cancelAnimationFrame(frame);
          if (timeout !== null) clearTimeout(timeout);
          frame = null;
          timeout = null;
        };
        const flush = () => {
          cancel();
          const next = read();
          if (snapshot === next) return;
          snapshot = next;
          notify();
        };
        const update = () => {
          const next = read();
          if (snapshot === next) return;
          if (!snapshot || !next || snapshot.messages !== next.messages
            || snapshot.sending !== next.sending || snapshot.streaming !== next.streaming
            || !snapshot.streamingMsg || !next.streamingMsg) {
            flush();
            return;
          }
          if (frame !== null) return;
          frame = requestAnimationFrame(flush);
          // Background tabs throttle animation frames; live state must still converge.
          timeout = setTimeout(flush, 50);
        };
        const unsubscribe = useChatSessionStore.subscribe(update);
        update();
        return () => { cancel(); unsubscribe(); };
      },
    };
  }, [conversationId]);
  return useSyncExternalStore(subscription.subscribe, subscription.getSnapshot, subscription.getSnapshot);
}
