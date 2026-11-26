import { useCallback, useEffect, useRef, useState } from 'react';
import { mutate as globalMutate } from 'swr';

import { invalidateAgentRuntimeModelsCache } from '@/features/chat/api/registry-api';
import {
  cancelExternalRuntimeAuthFlow,
  fetchExternalRuntimeAuthFlow,
  logoutExternalAgentRuntime,
  respondExternalRuntimeAuthFlow,
  startExternalRuntimeAuth,
} from '@/features/settings/agents-admin-api';
import {
  closeOAuthAuthorizationWindow,
  openOAuthAuthorizationUrl,
  reserveOAuthAuthorizationWindow,
} from '@/features/settings/oauth-authorization-window';
import type {
  ExternalAgentExecution,
  ExternalRuntimeAuthFlowSnapshot,
  ExternalRuntimeAuthMode,
  ExternalRuntimeProbeResult,
} from '@/features/settings/types/agent-gateway';

const AUTH_POLL_INTERVAL_MS = 1_200;

export type UseExternalRuntimeAuthOptions = {
  execution: ExternalAgentExecution;
  disabled?: boolean;
  zh: boolean;
  onProbeUpdated?: (probe: ExternalRuntimeProbeResult) => void;
  onSignedIn?: (probe?: ExternalRuntimeProbeResult) => void;
};

/**
 * Reusable state machine for in-UI external runtime sign-in (Codex, Antigravity, Claude Code).
 * Shared between Settings (`ExternalRuntimeConfigForm`) and Onboarding (`ExternalRuntimesOnboardingSection`).
 */
export function useExternalRuntimeAuth({
  execution,
  disabled = false,
  zh,
  onProbeUpdated,
  onSignedIn,
}: UseExternalRuntimeAuthOptions) {
  const [authFlow, setAuthFlow] = useState<ExternalRuntimeAuthFlowSnapshot | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccessNotice, setAuthSuccessNotice] = useState<string | null>(null);
  const [responseInput, setResponseInput] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const latestExecutionRef = useRef(execution);
  latestExecutionRef.current = execution;
  const onProbeUpdatedRef = useRef(onProbeUpdated);
  onProbeUpdatedRef.current = onProbeUpdated;
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const popupRef = useRef<Window | null>(null);
  const openedUrlRef = useRef<string | null>(null);

  const syncGlobalRuntimeCache = useCallback(() => {
    void globalMutate('settings-external-agent-runtimes');
    void invalidateAgentRuntimeModelsCache();
  }, []);

  const resetForKind = useCallback(() => {
    setAuthFlow(null);
    setAuthError(null);
    setAuthSuccessNotice(null);
    setResponseInput('');
    setShowApiKeyInput(false);
    setApiKeyInput('');
    openedUrlRef.current = null;
    closeOAuthAuthorizationWindow(popupRef.current);
    popupRef.current = null;
  }, []);

  useEffect(() => {
    resetForKind();
  }, [execution.kind, resetForKind]);

  useEffect(() => () => {
    closeOAuthAuthorizationWindow(popupRef.current);
    popupRef.current = null;
  }, []);

  useEffect(() => {
    const url = authFlow?.authorizationUrl;
    if (!url || openedUrlRef.current === url) return;
    openedUrlRef.current = url;
    void openOAuthAuthorizationUrl(url, popupRef.current);
  }, [authFlow?.authorizationUrl]);

  const activeFlowId =
    authFlow && (authFlow.phase === 'starting' || authFlow.phase === 'waiting' || authFlow.phase === 'verifying')
      ? authFlow.flowId
      : null;

  useEffect(() => {
    if (!activeFlowId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchExternalRuntimeAuthFlow(activeFlowId);
        if (cancelled) return;
        setAuthFlow(next);
        if (next.phase === 'succeeded') {
          closeOAuthAuthorizationWindow(popupRef.current);
          popupRef.current = null;
          if (next.probe) onProbeUpdatedRef.current?.(next.probe);
          setAuthSuccessNotice(next.message ?? (zh ? '登录成功，已同步可用模型。' : 'Signed in and loaded available models.'));
          setAuthFlow(null);
          setResponseInput('');
          syncGlobalRuntimeCache();
          onSignedInRef.current?.(next.probe);
        } else if (next.phase === 'failed' || next.phase === 'cancelled') {
          closeOAuthAuthorizationWindow(popupRef.current);
          popupRef.current = null;
          if (next.probe) onProbeUpdatedRef.current?.(next.probe);
        }
      } catch (cause) {
        if (!cancelled) {
          setAuthError(cause instanceof Error ? cause.message : String(cause));
          setAuthFlow(null);
          closeOAuthAuthorizationWindow(popupRef.current);
          popupRef.current = null;
        }
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, AUTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeFlowId, syncGlobalRuntimeCache, zh]);

  const handleStartAuth = useCallback(async (mode: ExternalRuntimeAuthMode, apiKey?: string) => {
    if (disabled || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    setAuthSuccessNotice(null);
    setResponseInput('');
    openedUrlRef.current = null;

    const current = latestExecutionRef.current;
    const usesBrowserWindow = mode === 'browser' || mode === 'device_code';
    const agyUsesCredentials =
      current.kind === 'agy' && (current.authMethod === 'gemini-api-key' || current.authMethod === 'agent-platform');
    if (usesBrowserWindow && !agyUsesCredentials) {
      closeOAuthAuthorizationWindow(popupRef.current);
      popupRef.current = reserveOAuthAuthorizationWindow();
    }

    try {
      const flow = await startExternalRuntimeAuth({
        execution: current,
        mode,
        ...(apiKey ? { apiKey } : {}),
      });
      if (flow.phase === 'succeeded') {
        closeOAuthAuthorizationWindow(popupRef.current);
        popupRef.current = null;
        if (flow.probe) onProbeUpdatedRef.current?.(flow.probe);
        setAuthSuccessNotice(flow.message ?? (zh ? '登录成功。' : 'Signed in successfully.'));
        setAuthFlow(null);
        setShowApiKeyInput(false);
        setApiKeyInput('');
        syncGlobalRuntimeCache();
        onSignedInRef.current?.(flow.probe);
      } else if (flow.phase === 'failed') {
        closeOAuthAuthorizationWindow(popupRef.current);
        popupRef.current = null;
        if (flow.probe) onProbeUpdatedRef.current?.(flow.probe);
        setAuthFlow(flow);
      } else {
        setAuthFlow(flow);
        if (flow.authorizationUrl) {
          openedUrlRef.current = flow.authorizationUrl;
          void openOAuthAuthorizationUrl(flow.authorizationUrl, popupRef.current);
        }
      }
    } catch (cause) {
      closeOAuthAuthorizationWindow(popupRef.current);
      popupRef.current = null;
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, disabled, syncGlobalRuntimeCache, zh]);

  const handleSubmitAuthResponse = useCallback(async () => {
    if (!authFlow || !responseInput.trim() || submittingResponse) return;
    setSubmittingResponse(true);
    setAuthError(null);
    try {
      const next = await respondExternalRuntimeAuthFlow(authFlow.flowId, responseInput.trim());
      setAuthFlow(next);
      setResponseInput('');
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmittingResponse(false);
    }
  }, [authFlow, responseInput, submittingResponse]);

  const handleCancelAuth = useCallback(async () => {
    const id = authFlow?.flowId;
    setAuthFlow(null);
    setAuthError(null);
    setResponseInput('');
    closeOAuthAuthorizationWindow(popupRef.current);
    popupRef.current = null;
    if (id) {
      await cancelExternalRuntimeAuthFlow(id).catch(() => {});
    }
  }, [authFlow?.flowId]);

  const handleLogout = useCallback(async () => {
    if (disabled || loggingOut) return;
    setLoggingOut(true);
    setAuthError(null);
    setAuthSuccessNotice(null);
    try {
      const nextProbe = await logoutExternalAgentRuntime(latestExecutionRef.current);
      onProbeUpdatedRef.current?.(nextProbe);
      syncGlobalRuntimeCache();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoggingOut(false);
    }
  }, [disabled, loggingOut, syncGlobalRuntimeCache]);

  const isAuthInProgress =
    authFlow !== null
    && (authFlow.phase === 'starting' || authFlow.phase === 'waiting' || authFlow.phase === 'verifying');

  return {
    authFlow,
    authBusy,
    authError,
    authSuccessNotice,
    responseInput,
    setResponseInput,
    submittingResponse,
    showApiKeyInput,
    setShowApiKeyInput,
    apiKeyInput,
    setApiKeyInput,
    loggingOut,
    isAuthInProgress,
    handleStartAuth,
    handleSubmitAuthResponse,
    handleCancelAuth,
    handleLogout,
  };
}
