import { useLayoutEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import {
  decodeConcreteSessionKey,
  parseRoutedSessionKey,
  resolveViewSessionKey,
} from '@/features/chat/session/chat-session-view';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

/** Latest routed session key (safe to read during render; updated synchronously from URL). */
const routedFocusedSessionKeyRef = { current: null as string | null };

/** Last `/chat/:key` before navigating to `/chat/new` (for empty-shell reuse). */
const lastNonNewSessionKeyCell = { current: null as string | null };

export function isForcedNewChatNavigation(state: unknown): boolean {
  return Boolean(
    state &&
      typeof state === 'object' &&
      (state as { forceNewChat?: unknown }).forceNewChat === true,
  );
}

/** URL → focused session key; keeps {@link useChatSessionStore} `focusedSessionKey` in sync. */
export function useChatSessionRoute(fixedSessionKey?: string) {
  const location = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();

  const isNewRoute = fixedSessionKey ? false : location.pathname.endsWith('/new');
  const forceNewChat = isNewRoute && isForcedNewChatNavigation(location.state);
  const decodedKey = fixedSessionKey ?? decodeConcreteSessionKey(isNewRoute, sessionKeyParam);
  const routedSessionKey = parseRoutedSessionKey(isNewRoute, decodedKey);
  const viewSessionKey = resolveViewSessionKey(routedSessionKey);
  const routedFocusedSessionKey = isNewRoute ? null : (decodedKey ?? null);

  const routeSessionKeyRef = useRef(routedSessionKey);
  routeSessionKeyRef.current = routedSessionKey;
  routedFocusedSessionKeyRef.current = routedFocusedSessionKey;
  if (!isNewRoute && decodedKey) {
    lastNonNewSessionKeyCell.current = decodedKey;
  }

  useLayoutEffect(() => {
    const current = useChatSessionStore.getState().focusedSessionKey;
    if (current !== routedFocusedSessionKey) {
      useChatSessionStore.getState().setFocusedSessionKey(routedFocusedSessionKey);
    }
  }, [routedFocusedSessionKey]);

  return {
    isNewRoute,
    forceNewChat,
    decodedKey,
    routedSessionKey,
    viewSessionKey,
    routedFocusedSessionKey,
    routeSessionKeyRef,
    locationKey: location.key,
    locationSearch: location.search,
    locationState: location.state,
  };
}

/** Ref-shaped accessor for the last concrete chat session key (not `/chat/new`). */
export const lastNonNewSessionKeyRef = {
  get current(): string | null {
    return lastNonNewSessionKeyCell.current;
  },
};

/** Ref-shaped accessor for hooks that expect `RefObject<string | null>`. */
export const focusedSessionKeyRef = {
  get current(): string | null {
    return routedFocusedSessionKeyRef.current;
  },
  set current(value: string | null) {
    routedFocusedSessionKeyRef.current = value;
    useChatSessionStore.getState().setFocusedSessionKey(value);
  },
};
