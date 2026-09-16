import { useLayoutEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import {
  decodeConcreteConversationId,
  parseRoutedConversationId,
  resolveViewConversationId,
} from '@/features/chat/session/chat-session-view';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

/** Latest routed session key (safe to read during render; updated synchronously from URL). */
const routedFocusedConversationIdRef = { current: null as string | null };

/** Last `/chat/:key` before navigating to `/chat/new` (for empty-shell reuse). */
const lastNonNewConversationIdCell = { current: null as string | null };

export function isForcedNewChatNavigation(state: unknown): boolean {
  return Boolean(
    state &&
      typeof state === 'object' &&
      (state as { forceNewChat?: unknown }).forceNewChat === true,
  );
}

/** URL → focused session key; keeps {@link useChatSessionStore} `focusedConversationId` in sync. */
export function useChatSessionRoute(fixedConversationId?: string) {
  const location = useLocation();
  const { conversationId: conversationIdParam } = useParams();

  const isNewRoute = fixedConversationId ? false : location.pathname.endsWith('/new');
  const forceNewChat = isNewRoute && isForcedNewChatNavigation(location.state);
  const decodedKey = fixedConversationId ?? decodeConcreteConversationId(isNewRoute, conversationIdParam);
  const routedConversationId = parseRoutedConversationId(isNewRoute, decodedKey);
  const viewConversationId = resolveViewConversationId(routedConversationId);
  const routedFocusedConversationId = isNewRoute ? null : (decodedKey ?? null);

  const routeConversationIdRef = useRef(routedConversationId);
  routeConversationIdRef.current = routedConversationId;
  routedFocusedConversationIdRef.current = routedFocusedConversationId;
  if (!isNewRoute && decodedKey) {
    lastNonNewConversationIdCell.current = decodedKey;
  }

  useLayoutEffect(() => {
    const current = useChatSessionStore.getState().focusedConversationId;
    if (current !== routedFocusedConversationId) {
      useChatSessionStore.getState().setFocusedConversationId(routedFocusedConversationId);
    }
  }, [routedFocusedConversationId]);

  return {
    isNewRoute,
    forceNewChat,
    decodedKey,
    routedConversationId,
    viewConversationId,
    routedFocusedConversationId,
    routeConversationIdRef,
    locationKey: location.key,
    locationSearch: location.search,
    locationState: location.state,
  };
}

/** Ref-shaped accessor for the last concrete chat session key (not `/chat/new`). */
export const lastNonNewConversationIdRef = {
  get current(): string | null {
    return lastNonNewConversationIdCell.current;
  },
};

/** Ref-shaped accessor for hooks that expect `RefObject<string | null>`. */
export const focusedConversationIdRef = {
  get current(): string | null {
    return routedFocusedConversationIdRef.current;
  },
  set current(value: string | null) {
    routedFocusedConversationIdRef.current = value;
    useChatSessionStore.getState().setFocusedConversationId(value);
  },
};
