import { useLayoutEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import {
  parseRoutedSessionKey,
  resolveViewSessionKey,
} from '@/features/chat/session/chat-session-view';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

/** Latest routed session key (safe to read during render; updated synchronously from URL). */
const routedFocusedSessionKeyRef = { current: null as string | null };

/** URL → focused session key; keeps {@link useChatSessionStore} `focusedSessionKey` in sync. */
export function useChatSessionRoute() {
  const location = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();

  const isNewRoute = location.pathname.endsWith('/new');
  const decodedKey = sessionKeyParam ? decodeURIComponent(sessionKeyParam) : undefined;
  const routedSessionKey = parseRoutedSessionKey(isNewRoute, decodedKey);
  const viewSessionKey = resolveViewSessionKey(routedSessionKey);
  const routedFocusedSessionKey = isNewRoute ? null : (decodedKey ?? null);

  const routeSessionKeyRef = useRef(routedSessionKey);
  routeSessionKeyRef.current = routedSessionKey;
  routedFocusedSessionKeyRef.current = routedFocusedSessionKey;

  useLayoutEffect(() => {
    const current = useChatSessionStore.getState().focusedSessionKey;
    if (current !== routedFocusedSessionKey) {
      useChatSessionStore.getState().setFocusedSessionKey(routedFocusedSessionKey);
    }
  }, [routedFocusedSessionKey]);

  return {
    isNewRoute,
    decodedKey,
    routedSessionKey,
    viewSessionKey,
    routedFocusedSessionKey,
    routeSessionKeyRef,
    locationSearch: location.search,
    locationState: location.state,
  };
}

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
