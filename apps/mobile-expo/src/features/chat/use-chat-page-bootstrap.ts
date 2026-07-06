/**
 * Encapsulates the "auto-create session on cold start" logic.
 *
 * On first mount, if no session key exists in the URL, create a server-owned
 * webchat session and navigate with the returned canonical key.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import { openChat } from '../../lib/navigation';

import { resolveEffectiveDefaultAgentId } from '../../query/agents';
import { takeNewChatSessionKey } from './session-prefetch';
import type { useMessages } from '../../i18n/messages';

export type ChatBootstrapDeps = {
  urlSessionKey: string;
  gatewayOnline: boolean;
  agentsData: Parameters<typeof resolveEffectiveDefaultAgentId>[0];
  localDefaultAgentId: string;
  messages: ReturnType<typeof useMessages>;
  /** Shared mutable ref — bootstrap writes the new session key here so callers stay in sync. */
  activeSessionKeyRef: React.MutableRefObject<string>;
  shouldNavigateToRoute?: boolean;
  /** When false, skip auto session creation (overlay supplies its own key). */
  shouldAutoBootstrap?: boolean;
};

export type ChatBootstrapResult = {
  pendingBootstrapKey: string;
  setPendingBootstrapKey: (key: string) => void;
  creatingInitialSession: boolean;
  bootstrapError: string | null;
  retryBootstrapSession: () => void;
  /** Force a fresh session when the workspace Ask AI overlay settles open. */
  startFreshSession: () => void;
};

export function useChatPageBootstrap(deps: ChatBootstrapDeps): ChatBootstrapResult {
  const {
    urlSessionKey,
    gatewayOnline,
    agentsData,
    localDefaultAgentId,
    messages,
    activeSessionKeyRef,
    shouldNavigateToRoute = true,
    shouldAutoBootstrap = true,
  } = deps;

  const router = useRouter();

  const [pendingBootstrapKey, setPendingBootstrapKey] = useState('');
  const [creatingInitialSession, setCreatingInitialSession] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const autoSessionAttemptedRef = useRef(false);

  useEffect(() => {
    if (urlSessionKey) setPendingBootstrapKey('');
  }, [urlSessionKey]);

  const startAutoSession = useCallback((options?: { force?: boolean }) => {
    if (urlSessionKey || !gatewayOnline) return;
    if (autoSessionAttemptedRef.current && !options?.force) return;

    if (options?.force) {
      autoSessionAttemptedRef.current = false;
      setPendingBootstrapKey('');
      activeSessionKeyRef.current = '';
    }

    autoSessionAttemptedRef.current = true;
    const agentId = resolveEffectiveDefaultAgentId(agentsData, localDefaultAgentId);
    setCreatingInitialSession(true);
    setBootstrapError(null);

    void takeNewChatSessionKey(agentId)
      .then((key) => {
        activeSessionKeyRef.current = key;
        setPendingBootstrapKey(key);
        if (shouldNavigateToRoute) {
          openChat(router, key, { replace: true });
        }
      })
      .catch((err) => {
        autoSessionAttemptedRef.current = false;
        setBootstrapError(err instanceof Error ? err.message : messages.sessions.bootstrapFailed);
      })
      .finally(() => {
        setCreatingInitialSession(false);
      });
  }, [urlSessionKey, gatewayOnline, agentsData, localDefaultAgentId, messages.sessions.bootstrapFailed, router, activeSessionKeyRef, shouldNavigateToRoute]);

  // Auto-start on first mount when gateway is online
  useEffect(() => {
    if (!shouldAutoBootstrap || urlSessionKey || !gatewayOnline) return;
    if (autoSessionAttemptedRef.current) return;
    startAutoSession();
  }, [shouldAutoBootstrap, urlSessionKey, gatewayOnline, startAutoSession]);

  const retryBootstrapSession = useCallback(() => {
    if (urlSessionKey || !gatewayOnline) return;
    autoSessionAttemptedRef.current = false;
    startAutoSession();
  }, [urlSessionKey, gatewayOnline, startAutoSession]);

  const startFreshSession = useCallback(() => {
    if (urlSessionKey || !gatewayOnline) return;
    startAutoSession({ force: true });
  }, [urlSessionKey, gatewayOnline, startAutoSession]);

  return {
    pendingBootstrapKey,
    setPendingBootstrapKey,
    creatingInitialSession,
    bootstrapError,
    retryBootstrapSession,
    startFreshSession,
  };
}
