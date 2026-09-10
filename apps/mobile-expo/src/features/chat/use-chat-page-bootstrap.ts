/** Resumes the most recent session on cold start, or creates one when none exists. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import type { ResolvedNewSessionSpec, SessionInitialAgentConfig } from '@xopcai/gateway-contract';

import { openChat } from '../../lib/navigation';

import { takeNewChatSessionKey } from './session-prefetch';
import type { useMessages } from '../../i18n/messages';

export type ChatBootstrapDeps = {
  scopeKey?: string;
  urlSessionKey: string;
  resumeSessionKey?: string;
  resumeLookupComplete?: boolean;
  gatewayOnline: boolean;
  newSessionSpec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>;
  initialAgentConfig?: SessionInitialAgentConfig;
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
};

export function useChatPageBootstrap(deps: ChatBootstrapDeps): ChatBootstrapResult {
  const {
    scopeKey = '',
    urlSessionKey,
    resumeSessionKey = '',
    resumeLookupComplete = true,
    gatewayOnline,
    newSessionSpec,
    initialAgentConfig,
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
  const previousScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (previousScopeRef.current === scopeKey) return;
    previousScopeRef.current = scopeKey;
    autoSessionAttemptedRef.current = false;
    activeSessionKeyRef.current = '';
    setPendingBootstrapKey('');
    setBootstrapError(null);
  }, [activeSessionKeyRef, scopeKey]);

  useEffect(() => {
    if (urlSessionKey) setPendingBootstrapKey('');
  }, [urlSessionKey]);

  const startAutoSession = useCallback(() => {
    if (urlSessionKey || !gatewayOnline) return;
    if (!resumeLookupComplete || autoSessionAttemptedRef.current) return;

    autoSessionAttemptedRef.current = true;
    if (resumeSessionKey) {
      activeSessionKeyRef.current = resumeSessionKey;
      setPendingBootstrapKey(resumeSessionKey);
      if (shouldNavigateToRoute) openChat(router, resumeSessionKey, { replace: true });
      return;
    }
    setCreatingInitialSession(true);
    setBootstrapError(null);

    void takeNewChatSessionKey(newSessionSpec, initialAgentConfig)
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
  }, [urlSessionKey, gatewayOnline, resumeLookupComplete, resumeSessionKey, newSessionSpec, initialAgentConfig, messages.sessions.bootstrapFailed, router, activeSessionKeyRef, shouldNavigateToRoute]);

  // Auto-start on first mount when gateway is online
  useEffect(() => {
    if (!shouldAutoBootstrap || urlSessionKey || !gatewayOnline || !resumeLookupComplete) return;
    if (autoSessionAttemptedRef.current) return;
    startAutoSession();
  }, [shouldAutoBootstrap, urlSessionKey, gatewayOnline, resumeLookupComplete, startAutoSession]);

  const retryBootstrapSession = useCallback(() => {
    if (urlSessionKey || !gatewayOnline) return;
    autoSessionAttemptedRef.current = false;
    startAutoSession();
  }, [urlSessionKey, gatewayOnline, startAutoSession]);

  return {
    pendingBootstrapKey,
    setPendingBootstrapKey,
    creatingInitialSession,
    bootstrapError,
    retryBootstrapSession,
  };
}
