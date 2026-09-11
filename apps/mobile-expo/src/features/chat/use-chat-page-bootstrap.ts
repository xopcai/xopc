/** Resumes the most recent session on cold start, or creates one when none exists. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import type { ResolvedNewSessionSpec, SessionInitialAgentConfig } from '@xopcai/gateway-contract';

import { openChat } from '../../lib/navigation';

import { canStartChatBootstrap } from './chat-bootstrap-gate';
import { takeNewChatSessionKey } from './session-prefetch';
import type { useMessages } from '../../i18n/messages';

export type ChatBootstrapDeps = {
  scopeKey?: string;
  urlSessionKey: string;
  resumeSessionKey?: string;
  resumeLookupComplete?: boolean;
  /** True only after an active gateway has been restored or selected. */
  gatewayReady: boolean;
  gatewayOnline: boolean;
  newSessionSpec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>;
  initialAgentConfig?: SessionInitialAgentConfig;
  messages: ReturnType<typeof useMessages>;
  /** Shared mutable ref — bootstrap writes the new session key here so callers stay in sync. */
  activeSessionKeyRef: React.MutableRefObject<string>;
  shouldNavigateToRoute?: boolean;
  /** When false, the caller owns session creation. */
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
    gatewayReady,
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
    setCreatingInitialSession(false);
    setBootstrapError(null);
  }, [activeSessionKeyRef, scopeKey]);

  useEffect(() => {
    if (urlSessionKey) setPendingBootstrapKey('');
  }, [urlSessionKey]);

  const startAutoSession = useCallback(() => {
    if (!canStartChatBootstrap({
      gatewayReady,
      gatewayOnline,
      urlSessionKey,
      resumeLookupComplete,
      alreadyAttempted: autoSessionAttemptedRef.current,
    })) return;

    autoSessionAttemptedRef.current = true;
    if (resumeSessionKey) {
      activeSessionKeyRef.current = resumeSessionKey;
      setPendingBootstrapKey(resumeSessionKey);
      setBootstrapError(null);
      if (shouldNavigateToRoute) openChat(router, resumeSessionKey, { replace: true });
      return;
    }
    setCreatingInitialSession(true);
    setBootstrapError(null);
    const attemptScopeKey = scopeKey;

    void takeNewChatSessionKey(newSessionSpec, initialAgentConfig)
      .then((key) => {
        if (previousScopeRef.current !== attemptScopeKey) return;
        activeSessionKeyRef.current = key;
        setPendingBootstrapKey(key);
        if (shouldNavigateToRoute) {
          openChat(router, key, { replace: true });
        }
      })
      .catch((err) => {
        if (previousScopeRef.current !== attemptScopeKey) return;
        autoSessionAttemptedRef.current = false;
        setBootstrapError(err instanceof Error ? err.message : messages.sessions.bootstrapFailed);
      })
      .finally(() => {
        if (previousScopeRef.current !== attemptScopeKey) return;
        setCreatingInitialSession(false);
      });
  }, [urlSessionKey, gatewayReady, gatewayOnline, resumeLookupComplete, resumeSessionKey, newSessionSpec, initialAgentConfig, messages.sessions.bootstrapFailed, router, activeSessionKeyRef, shouldNavigateToRoute, scopeKey]);

  // Auto-start on first mount when gateway is online
  useEffect(() => {
    if (!shouldAutoBootstrap) return;
    startAutoSession();
  }, [shouldAutoBootstrap, startAutoSession]);

  const retryBootstrapSession = useCallback(() => {
    if (!gatewayReady || urlSessionKey || !gatewayOnline) return;
    autoSessionAttemptedRef.current = false;
    startAutoSession();
  }, [gatewayReady, urlSessionKey, gatewayOnline, startAutoSession]);

  return {
    pendingBootstrapKey,
    setPendingBootstrapKey,
    creatingInitialSession,
    bootstrapError,
    retryBootstrapSession,
  };
}
