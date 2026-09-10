/** Resumes the most recent session on cold start, or creates one when none exists. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import type { ResolvedNewSessionSpec, SessionInitialAgentConfig } from '@xopcai/gateway-contract';

import { openChat } from '../../lib/navigation';
import {
  isDataSharingConsentRequiredError,
  reviewDataSharingConsent,
  subscribeDataSharingConsentGranted,
} from '../privacy/data-sharing-consent';

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
  /** When false, the caller owns session creation. */
  shouldAutoBootstrap?: boolean;
};

export type ChatBootstrapResult = {
  pendingBootstrapKey: string;
  setPendingBootstrapKey: (key: string) => void;
  creatingInitialSession: boolean;
  bootstrapError: string | null;
  bootstrapConsentRequired: boolean;
  reviewingConsent: boolean;
  reviewConsent: () => void;
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
  const [bootstrapConsentRequired, setBootstrapConsentRequired] = useState(false);
  const [reviewingConsent, setReviewingConsent] = useState(false);
  const bootstrapConsentRequiredRef = useRef(false);
  const autoSessionAttemptedRef = useRef(false);
  const previousScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (previousScopeRef.current === scopeKey) return;
    previousScopeRef.current = scopeKey;
    autoSessionAttemptedRef.current = false;
    activeSessionKeyRef.current = '';
    setPendingBootstrapKey('');
    setBootstrapError(null);
    bootstrapConsentRequiredRef.current = false;
    setBootstrapConsentRequired(false);
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
    bootstrapConsentRequiredRef.current = false;
    setBootstrapConsentRequired(false);

    void takeNewChatSessionKey(newSessionSpec, initialAgentConfig)
      .then((key) => {
        bootstrapConsentRequiredRef.current = false;
        setBootstrapConsentRequired(false);
        activeSessionKeyRef.current = key;
        setPendingBootstrapKey(key);
        if (shouldNavigateToRoute) {
          openChat(router, key, { replace: true });
        }
      })
      .catch((err) => {
        autoSessionAttemptedRef.current = false;
        const consentRequired = isDataSharingConsentRequiredError(err);
        bootstrapConsentRequiredRef.current = consentRequired;
        setBootstrapConsentRequired(consentRequired);
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

  const resumeAfterConsent = useCallback((gatewayId?: string) => {
    if ((gatewayId && gatewayId !== scopeKey) || !bootstrapConsentRequiredRef.current) return;
    bootstrapConsentRequiredRef.current = false;
    setBootstrapConsentRequired(false);
    setBootstrapError(null);
    autoSessionAttemptedRef.current = false;
    startAutoSession();
  }, [scopeKey, startAutoSession]);

  useEffect(() => subscribeDataSharingConsentGranted(resumeAfterConsent), [resumeAfterConsent]);

  const reviewConsent = useCallback(() => {
    if (!bootstrapConsentRequiredRef.current || reviewingConsent) return;
    setReviewingConsent(true);
    void reviewDataSharingConsent()
      .then(() => resumeAfterConsent())
      .catch((error) => {
        const consentRequired = isDataSharingConsentRequiredError(error);
        bootstrapConsentRequiredRef.current = consentRequired;
        setBootstrapConsentRequired(consentRequired);
        setBootstrapError(error instanceof Error ? error.message : messages.privacy.consentRequired);
      })
      .finally(() => setReviewingConsent(false));
  }, [messages.privacy.consentRequired, resumeAfterConsent, reviewingConsent]);

  return {
    pendingBootstrapKey,
    setPendingBootstrapKey,
    creatingInitialSession,
    bootstrapError,
    bootstrapConsentRequired,
    reviewingConsent,
    reviewConsent,
    retryBootstrapSession,
  };
}
