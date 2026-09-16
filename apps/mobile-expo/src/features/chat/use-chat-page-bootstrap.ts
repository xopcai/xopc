/** Keep the main conversation independent from detail routes and recent history. */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import type { ResolvedNewSessionSpec, SessionInitialAgentConfig } from '@xopcai/gateway-contract';

import { openChat } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { fetchSessionResumeStatus } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import type { useMessages } from '../../i18n/messages';
import { canStartChatBootstrap } from './chat-bootstrap-gate';
import { rootChatLookupComplete } from './chat-root-session';
import { EMPTY_CHAT_SELECTION, useChatSelectionStore, type ChatSelection } from './chat-selection-store';
import { takeNewChatConversationId } from './session-prefetch';

export type ChatBootstrapDeps = {
  scopeKey?: string;
  urlConversationId: string;
  gatewayReady: boolean;
  gatewayOnline: boolean;
  newSessionSpec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>;
  initialAgentConfig?: SessionInitialAgentConfig;
  messages: ReturnType<typeof useMessages>;
  activeConversationIdRef: React.MutableRefObject<string>;
  shouldNavigateToRoute?: boolean;
  shouldAutoBootstrap?: boolean;
};

export function useChatPageBootstrap({
  scopeKey = '', urlConversationId, gatewayReady, gatewayOnline, newSessionSpec,
  initialAgentConfig, messages, activeConversationIdRef,
  shouldNavigateToRoute = true, shouldAutoBootstrap = true,
}: ChatBootstrapDeps) {
  const router = useRouter();
  const selectionScope = urlConversationId ? JSON.stringify([scopeKey, urlConversationId]) : scopeKey;
  const selection = useChatSelectionStore(state => state.selections[selectionScope] ?? EMPTY_CHAT_SELECTION);
  const attemptedRef = useRef<{ scope: string; selection: ChatSelection } | null>(null);
  const mountedRef = useRef(false);
  const focusedRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const lastVisibleSelection = useRef({ scope: scopeKey, key: selection.key });
  const [creating, setCreating] = useState<{ scope: string; selection: ChatSelection } | null>(null);
  const [createError, setCreateError] = useState<{ scope: string; message: string } | null>(null);

  useLayoutEffect(() => {
    if (focused) lastVisibleSelection.current = { scope: scopeKey, key: selection.key };
  }, [focused, scopeKey, selection.key]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isCurrent = useCallback((expected: ChatSelection) => mountedRef.current
    && focusedRef.current
    && useGatewayStore.getState().activeGatewayId === scopeKey
    && (useChatSelectionStore.getState().selections[selectionScope] ?? EMPTY_CHAT_SELECTION) === expected,
  [scopeKey, selectionScope]);

  const commitSelection = useCallback((key: string) => {
    activeConversationIdRef.current = key;
    useChatSelectionStore.getState().select(selectionScope, key);
    setCreating(null);
    setCreateError(null);
  }, [activeConversationIdRef, selectionScope]);

  const setPendingBootstrapKey = useCallback((key: string) => {
    if (useGatewayStore.getState().activeGatewayId !== scopeKey) return;
    commitSelection(key);
  }, [commitSelection, scopeKey]);

  // Covered root screens must not overwrite the focused detail/deep-link selection.
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    setFocused(true);
    // A new focus epoch invalidates requests started before leaving this screen/gateway.
    if (gatewayReady) useChatSelectionStore.getState().beginSelection(selectionScope);
    if (gatewayReady && urlConversationId && useChatSelectionStore.getState().selections[selectionScope]?.key !== urlConversationId) {
      setPendingBootstrapKey(urlConversationId);
    }
    return () => {
      focusedRef.current = false;
      setFocused(false);
      attemptedRef.current = null;
    };
  }, [gatewayReady, scopeKey, selectionScope, setPendingBootstrapKey, urlConversationId]));

  const validation = useQuery({
    queryKey: queryKeys.sessionResume(scopeKey, selection.key, selection.revision),
    queryFn: ({ signal }) => fetchSessionResumeStatus(selection.key, signal),
    enabled: focused && shouldAutoBootstrap && gatewayReady && gatewayOnline && !urlConversationId && Boolean(selection.key)
      && !(attemptedRef.current?.scope === scopeKey && attemptedRef.current.selection === selection),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (!focused || urlConversationId || !rootChatLookupComplete(validation) || validation.data !== 'unavailable') return;
    if (!isCurrent(selection)) return;
    useChatSelectionStore.getState().selectIfCurrent(selectionScope, selection, '');
  }, [focused, isCurrent, selectionScope, selection, urlConversationId, validation]);

  const beginSessionSelection = useCallback((destination: 'current' | 'home' = 'current') => {
    const expected = useChatSelectionStore.getState().beginSelection(selectionScope);
    attemptedRef.current = { scope: scopeKey, selection: expected };
    setCreating(null);
    setCreateError(null);
    return (key: string): boolean => {
      if (!isCurrent(expected)) return false;
      if (destination === 'home' && urlConversationId) {
        useChatSelectionStore.getState().select(scopeKey, key);
        setCreating(null);
        setCreateError(null);
        router.dismissTo('/');
        return true;
      }
      commitSelection(key);
      return true;
    };
  }, [commitSelection, isCurrent, router, scopeKey, selectionScope, urlConversationId]);

  const startAutoSession = useCallback(() => {
    if (!focused || selection.key || !isCurrent(selection) || !canStartChatBootstrap({
      gatewayReady, gatewayOnline, urlConversationId,
      alreadyAttempted: attemptedRef.current?.scope === scopeKey && attemptedRef.current.selection === selection,
    })) return;
    attemptedRef.current = { scope: scopeKey, selection };
    setCreating({ scope: scopeKey, selection });
    setCreateError(null);
    void takeNewChatConversationId(newSessionSpec, initialAgentConfig)
      .then(key => {
        if (!isCurrent(selection)) return;
        commitSelection(key);
        if (shouldNavigateToRoute) openChat(router, key, { replace: true });
      })
      .catch(err => {
        if (!isCurrent(selection)) return;
        setCreateError({ scope: scopeKey, message: err instanceof Error ? err.message : messages.sessions.bootstrapFailed });
      })
      .finally(() => {
        if (isCurrent(selection)) setCreating(null);
      });
  }, [commitSelection, focused, gatewayOnline, gatewayReady, initialAgentConfig, isCurrent,
    messages.sessions.bootstrapFailed, newSessionSpec, router, scopeKey, selection, shouldNavigateToRoute, urlConversationId]);

  useEffect(() => {
    if (shouldAutoBootstrap) startAutoSession();
  }, [shouldAutoBootstrap, startAutoSession]);

  const retryBootstrapSession = useCallback(() => {
    if (!gatewayReady || urlConversationId || !gatewayOnline || selection.key) return;
    attemptedRef.current = null;
    setCreateError(null);
    useChatSelectionStore.getState().beginSelection(selectionScope);
  }, [gatewayOnline, gatewayReady, selection.key, selectionScope, urlConversationId]);

  return {
    // A covered root must not start a second chat stream for the foreground detail route.
    pendingBootstrapKey: focused || lastVisibleSelection.current.scope !== scopeKey
      ? selection.key : lastVisibleSelection.current.key,
    setPendingBootstrapKey,
    beginSessionSelection,
    creatingInitialSession: creating?.scope === scopeKey && creating.selection === selection,
    waitingForResume: !urlConversationId && !selection.key && createError?.scope !== scopeKey,
    bootstrapError: createError?.scope === scopeKey ? createError.message : null,
    retryBootstrapSession,
  };
}
