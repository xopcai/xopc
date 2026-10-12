import { useMemo, useSyncExternalStore } from 'react';

import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

import { createMessageShellSelector, createSessionShellSelector, selectContentPart, selectMessageRow } from './message-render-selectors';

export function useChatSessionShell(conversationId: string | null) {
  const reader = useMemo(() => {
    const select = createSessionShellSelector();
    return () => select(conversationId ? useChatSessionStore.getState().sessions[conversationId] : undefined);
  }, [conversationId]);
  return useSyncExternalStore(useChatSessionStore.subscribe, reader, reader);
}

function useFrameReader<T>(conversationId: string | null | undefined, read: () => T) {
  const subscription = useMemo(() => {
    let snapshot = read();
    return {
      read: () => snapshot,
      subscribe: (notify: () => void) => {
        let frame: number | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const cancel = () => {
          if (frame !== null) cancelAnimationFrame(frame);
          if (timer !== null) clearTimeout(timer);
          frame = null; timer = null;
        };
        const flush = () => {
          cancel();
          const next = read();
          if (snapshot === next) return;
          snapshot = next; notify();
        };
        const unsubscribe = useChatSessionStore.subscribe((state, previous) => {
          if (read() === snapshot) return;
          const currentSlice = conversationId ? state.sessions[conversationId] : undefined;
          const previousSlice = conversationId ? previous.sessions[conversationId] : undefined;
          if (currentSlice?.streaming !== previousSlice?.streaming
            || currentSlice?.messages !== previousSlice?.messages) { flush(); return; }
          if (frame !== null) return;
          frame = requestAnimationFrame(flush);
          timer = setTimeout(flush, 50);
        });
        flush();
        return () => { cancel(); unsubscribe(); };
      },
    };
  }, [conversationId, read]);
  return useSyncExternalStore(subscription.subscribe, subscription.read, subscription.read);
}

export function useChatMessageRow(conversationId: string | null | undefined, rowId: string | undefined) {
  const read = useMemo(() => {
    const select = createMessageShellSelector();
    return () => select(conversationId && rowId
      ? selectMessageRow(useChatSessionStore.getState().sessions[conversationId], rowId) : undefined);
  }, [conversationId, rowId]);
  return useFrameReader(conversationId, read);
}

export function useChatContentPart(conversationId: string | null | undefined, partId: string | undefined) {
  const read = useMemo(() => () => conversationId && partId
    ? selectContentPart(useChatSessionStore.getState().sessions[conversationId], partId) : undefined,
  [conversationId, partId]);
  return useFrameReader(conversationId, read);
}

export function useChatTextRun(conversationId: string | null | undefined, partIds: readonly string[]) {
  const key = partIds.join(',');
  const read = useMemo(() => {
    const ids = key ? key.split(',') : [];
    return () => {
      if (!conversationId || !ids.length) return undefined;
      const slice = useChatSessionStore.getState().sessions[conversationId];
      const parts = ids.map(id => selectContentPart(slice, id));
      if (parts.some(part => part?.type !== 'text')) return undefined;
      return parts.map(part => part?.type === 'text' ? part.text : '').join('');
    };
  }, [conversationId, key]);
  return useFrameReader(conversationId, read);
}
