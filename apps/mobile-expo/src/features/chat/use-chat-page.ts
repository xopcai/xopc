/**
 * Orchestrating hook for the main chat page.
 *
 * Combines: bootstrap, session history, chat streaming, message parsing,
 * agent/model queries, and all user-interaction handlers.
 *
 * The page component (`app/chat/[k].tsx`) remains a thin render shell.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultNewSessionPreferences,
  modelPreferenceForAgent,
  resolveNewSessionSpec,
} from '@xopcai/gateway-contract';

import { dismissOrRoot, openChat, useDismissOnHardwareBack } from '../../lib/navigation';

import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { agentDisplayName } from '../ai/agent-presentation';
import { useGatewayHealth } from '../gateway/use-gateway-health';
import { useGatewayConnectLanding } from '../gateway/gateway-connect-context';
import { useKeyboardVisible } from '../../hooks/use-keyboard-visible';
import { useMessages } from '../../i18n/messages';
import { fetchChatAgents, readPlaceholderAgents, resolveEffectiveDefaultAgentId } from '../../query/agents';
import { chatModelDisplayName, fetchChatModels, resolveEffectiveModelId, sessionModelMutationOptions, fetchSessionAgentConfig } from '../../query/models';
import { queryKeys } from '../../query/keys';
import { fetchTask, handoffTaskConversation } from '../../query/tasks';
import { fetchProject, fetchProjectOperatingView } from '../../query/projects';
import { getColors } from '../../theme';

import { consumeContentChatIntake } from '../content-intake/content-chat-handoff';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { captureWorkspaceText } from '../../sync/workspace-sync';
import {
  buildUserResendPayload,
  findPrecedingUserMessage,
  mergeOptimisticUserMessages,
} from './composer-send-helpers';
import type { ComposerContextRef, WireAttachment } from './composer.types';
import { coerceReasoningLevel, type Message } from './messages.types';
import {
  parseSessionMessages,
  dedupeWireMessages,
  mergeStreamingAssistantIntoMessages,
} from './session-message-parser';
import { reconcileMessageRows } from './reconcile-message-rows';
import { sessionContainsFinalAssistant } from './session-refresh-confirmation';
import { takeNewChatConversationId } from './session-prefetch';
import { buildMobileWelcomeModel } from './mobile-welcome-starters';
import { useChatPageBootstrap } from './use-chat-page-bootstrap';
import { useChatSession } from './use-chat-session';
import { useSessionHistory } from './use-session-history';

export type UseChatPageOptions = {
  root?: boolean;
};

export function useChatPage(options: UseChatPageOptions = {}) {
  const { root = false } = options;
  const { k: rawKey, taskId: rawTaskId } = useLocalSearchParams<{
    k?: string;
    taskId?: string;
  }>();
  const savingAssistantNoteRef = useRef(false);
  const urlConversationId = typeof rawKey === 'string' ? rawKey : Array.isArray(rawKey) ? rawKey[0] : '';
  const routeTaskId = typeof rawTaskId === 'string' ? rawTaskId.trim() : '';
  const router = useRouter();
  useDismissOnHardwareBack(router, { enabled: !root });
  const queryClient = useQueryClient();
  const { gatewayOnline } = useGatewayHealth();
  const activeGatewayId = useGatewayStore((s) => s.activeGatewayId);
  const isDark = usePreferencesStore((s) => s.resolvedTheme === 'dark');
  const keyboardVisible = useKeyboardVisible();
  const m = useMessages();
  const language = usePreferencesStore((s) => s.language);

  // ── Agent / model info ───────────────────────────────────
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: true,
    placeholderData: () => readPlaceholderAgents() ?? undefined,
  });

  const localDefaultAgentId = usePreferencesStore((s) => s.defaultAgentId) ?? '';
  const preferencesByGateway = usePreferencesStore((s) => s.newSessionPreferencesByGateway);
  const rememberSelectedAgent = usePreferencesStore((s) => s.rememberSelectedAgent);
  const rememberAgentModel = usePreferencesStore((s) => s.rememberAgentModel);
  const rememberLastChatScope = usePreferencesStore((s) => s.rememberLastChatScope);
  const newSessionPreferences = useMemo(
    () => preferencesByGateway[activeGatewayId ?? '']
      ?? createDefaultNewSessionPreferences(),
    [activeGatewayId, preferencesByGateway],
  );
  const defaultAgentId = resolveEffectiveDefaultAgentId(agentsQuery.data, localDefaultAgentId);
  const bootstrapSpec = useMemo(
    () => resolveNewSessionSpec(
      { origin: 'mobile-bootstrap', project: { kind: 'remember-last' } },
      {
        defaultAgentId,
        selectedAgentId: newSessionPreferences.selectedAgentId,
        lastChatScope: newSessionPreferences.lastChatScope,
      },
    ),
    [defaultAgentId, newSessionPreferences],
  );
  const bootstrapInitialAgentConfig = useMemo(
    () => {
      const preference = modelPreferenceForAgent(newSessionPreferences, bootstrapSpec.agentId);
      return preference
        ? {
            model: preference.modelRef,
            ...(preference.thinkingLevel
              ? { thinkingLevel: preference.thinkingLevel }
              : {}),
          }
        : undefined;
    },
    [bootstrapSpec.agentId, newSessionPreferences],
  );

  // ── Bootstrap ────────────────────────────────────────────
  // Shared ref for session key — bootstrap writes here, chatSession reads it.
  const activeConversationIdRef = useRef('');
  const bootstrap = useChatPageBootstrap({
    scopeKey: activeGatewayId ?? '',
    urlConversationId,
    gatewayReady: Boolean(activeGatewayId),
    gatewayOnline,
    newSessionSpec: bootstrapSpec,
    initialAgentConfig: bootstrapInitialAgentConfig,
    messages: m,
    activeConversationIdRef,
    shouldNavigateToRoute: !root,
    shouldAutoBootstrap: true,
  });

  const conversationId = urlConversationId || bootstrap.pendingBootstrapKey;

  // ── Session history ──────────────────────────────────────
  const { sessionHistoryQuery } = useSessionHistory(conversationId);

  const currentSessionAgentId = useMemo(
    () => sessionHistoryQuery.data?.pages[0]?.session.routing?.agentId?.trim().toLowerCase() ?? '',
    [sessionHistoryQuery.data?.pages],
  );
  const sessionContext = useMemo(() => {
    const session = sessionHistoryQuery.data?.pages[0]?.session;
    const projectId = session?.projectId?.trim() || undefined;
    const metadataTaskId = session?.customData?.taskId;
    const taskId = routeTaskId || (
      typeof metadataTaskId === 'string' && metadataTaskId.trim() ? metadataTaskId.trim() : undefined
    );
    return { projectId, taskId };
  }, [routeTaskId, sessionHistoryQuery.data?.pages]);
  const welcomeTaskQuery = useQuery({
    queryKey: queryKeys.task(sessionContext.taskId ?? ''),
    queryFn: () => fetchTask(sessionContext.taskId!),
    enabled: Boolean(sessionContext.taskId),
  });
  const welcomeProjectQuery = useQuery({
    queryKey: queryKeys.project(sessionContext.projectId ?? ''),
    queryFn: () => fetchProject(sessionContext.projectId!),
    enabled: Boolean(sessionContext.projectId),
  });
  const welcomeProjectOperatingQuery = useQuery({
    queryKey: queryKeys.projectOperatingView(sessionContext.projectId ?? ''),
    queryFn: () => fetchProjectOperatingView(sessionContext.projectId!),
    enabled: Boolean(sessionContext.projectId),
  });

  const modelsQuery = useQuery({
    queryKey: queryKeys.models(currentSessionAgentId),
    queryFn: () => fetchChatModels(currentSessionAgentId || undefined),
    enabled: true,
  });

  const chatSession = useChatSession({ conversationId, taskId: routeTaskId || undefined });
  const sessionAgentConfigQuery = useQuery({
    queryKey: queryKeys.sessionAgentConfig(conversationId),
    queryFn: () => fetchSessionAgentConfig(conversationId),
    enabled: Boolean(conversationId),
  });
  const modelMutation = useMutation(
    sessionModelMutationOptions(queryClient, conversationId, sessionContext.taskId),
  );

  const preferredModel = modelPreferenceForAgent(
    newSessionPreferences,
    currentSessionAgentId || defaultAgentId,
  );
  const effectiveModelId = resolveEffectiveModelId(
    modelsQuery.data,
    sessionAgentConfigQuery.data?.model || preferredModel?.modelRef || null,
  );

  // Opening an existing chat updates future new-chat context, not its model preference.
  useEffect(() => {
    if (!activeGatewayId || !currentSessionAgentId || !sessionHistoryQuery.data) return;
    rememberSelectedAgent(activeGatewayId, currentSessionAgentId);
    rememberLastChatScope(activeGatewayId, sessionContext.projectId ?? null);
  }, [
    activeGatewayId,
    currentSessionAgentId,
    rememberLastChatScope,
    rememberSelectedAgent,
    sessionContext.projectId,
    sessionHistoryQuery.data,
  ]);

  // Keep the shared ref in sync with chatSession's internal ref
  useEffect(() => {
    activeConversationIdRef.current = chatSession.activeConversationIdRef.current;
  }, [chatSession.activeConversationIdRef]);

  const agentName = useMemo(() => {
    const agents = agentsQuery.data?.items ?? [];
    const defaultId = resolveEffectiveDefaultAgentId(agentsQuery.data, localDefaultAgentId);
    const sessionAgentId = currentSessionAgentId || defaultId;
    const agent = agents.find((a) => a.id === sessionAgentId);
    return agent ? agentDisplayName(agent, m.agentsPage) : sessionAgentId;
  }, [agentsQuery.data, currentSessionAgentId, localDefaultAgentId, m.agentsPage]);
  const welcomeAgentId = useMemo(
    () => currentSessionAgentId || resolveEffectiveDefaultAgentId(agentsQuery.data, localDefaultAgentId),
    [agentsQuery.data, currentSessionAgentId, localDefaultAgentId],
  );
  const welcomeAgent = useMemo(
    () => (agentsQuery.data?.items ?? []).find((agent) => agent.id === welcomeAgentId),
    [agentsQuery.data?.items, welcomeAgentId],
  );

  const modelName = useMemo(() => {
    const models = modelsQuery.data?.items ?? [];
    if (!models.length) return m.chat.modelPickerSelect;
    const model = models.find((item) => item.id === effectiveModelId);
    return model
      ? chatModelDisplayName(model, language)
      : effectiveModelId
        ? chatModelDisplayName({ id: effectiveModelId })
        : m.chat.modelPickerSelect;
  }, [effectiveModelId, language, m.chat.modelPickerSelect, modelsQuery.data?.items]);

  // ── Parsed messages ──────────────────────────────────────
  const sessionMessages = useMemo<Message[]>(() => {
    const pages = sessionHistoryQuery.data?.pages ?? [];
    const raw = [...pages].reverse().flatMap((page) => page?.session.messages ?? []);
    if (!raw.length) return [];
    return parseSessionMessages(dedupeWireMessages(raw as Array<Record<string, unknown>>));
  }, [sessionHistoryQuery.data?.pages]);

  const sessionRefreshComplete =
    !chatSession.streaming &&
    sessionHistoryQuery.dataUpdatedAt > chatSession.sessionDataUpdatedAtRef.current &&
    (chatSession.streamingMsg
      ? sessionContainsFinalAssistant(sessionMessages, chatSession.streamingMsg)
      : chatSession.awaitingSessionRefresh);

  const committedRowsRef = useRef({ scope: '', messages: [] as Message[] });
  const rowScope = JSON.stringify([activeGatewayId, conversationId]);
  const displayMessages = useMemo<Message[]>(() => {
    const base = mergeOptimisticUserMessages(sessionMessages, chatSession.optimisticMessages);
    const next = chatSession.streamingMsg
      ? mergeStreamingAssistantIntoMessages(base, chatSession.streamingMsg)
      : base;
    return reconcileMessageRows(
      committedRowsRef.current.scope === rowScope ? committedRowsRef.current.messages : [],
      next,
    );
  }, [rowScope, sessionMessages, chatSession.optimisticMessages, chatSession.streamingMsg]);

  useLayoutEffect(() => {
    committedRowsRef.current = { scope: rowScope, messages: displayMessages };
  }, [rowScope, displayMessages]);

  useEffect(() => {
    chatSession.displayMessagesRef.current = displayMessages;
  }, [displayMessages, chatSession.displayMessagesRef]);

  useEffect(() => {
    if (!sessionRefreshComplete) return;
    chatSession.clearAllState();
  }, [sessionRefreshComplete, chatSession]);

  // ── Theme colors ─────────────────────────────────────────
  const colors = getColors(isDark);

  // ── Derived UI state ─────────────────────────────────────
  const [composerSuggestion, setComposerSuggestion] = useState<string | undefined>(undefined);

  const welcomeModel = useMemo(
    () => buildMobileWelcomeModel({
      messages: m,
      agent: welcomeAgent,
      agentId: welcomeAgentId,
      effectiveWorkspacePath: sessionAgentConfigQuery.data?.effectiveWorkspacePath,
      project: welcomeProjectQuery.data,
      projectOperating: welcomeProjectOperatingQuery.data,
      task: welcomeTaskQuery.data,
    }),
    [
      m,
      sessionAgentConfigQuery.data?.effectiveWorkspacePath,
      welcomeAgent,
      welcomeAgentId,
      welcomeProjectOperatingQuery.data,
      welcomeProjectQuery.data,
      welcomeTaskQuery.data,
    ],
  );

  const isEmptyChat = displayMessages.length === 0 && !chatSession.streaming && !sessionHistoryQuery.isLoading;

  const composerDisabled =
    modelMutation.isPending ||
    chatSession.sending ||
    !conversationId || bootstrap.creatingInitialSession;

  useEffect(() => {
    if (!conversationId) return;
    const intake = consumeContentChatIntake(conversationId);
    if (!intake) return;
    if (modelMutation.isPending || chatSession.runningRef.current || chatSession.clarifyPrompt) {
      setComposerSuggestion(intake.prompt);
      return;
    }
    void chatSession.send(intake.prompt).then(consumed => {
      if (!consumed) setComposerSuggestion(intake.prompt);
    });
  }, [chatSession, modelMutation.isPending, conversationId]);

  const handleComposerSend = useCallback(
    async (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[], delivery: 'next' | 'steer' = 'next') => {
      if (modelMutation.isPending) return false;
      if (bootstrap.bootstrapError && !conversationId) return false;
      const trimmed = text.trim();
      const hasContent = Boolean(trimmed) || Boolean(attachments?.length) || Boolean(contextRefs?.length);
      if (!hasContent) return false;

      if (!conversationId || bootstrap.creatingInitialSession) return false;
      return chatSession.send(text, attachments, contextRefs, delivery);
    },
    [bootstrap.bootstrapError, bootstrap.creatingInitialSession, chatSession, conversationId, modelMutation.isPending],
  );

  // ── Handlers ─────────────────────────────────────────────
  const handleBack = useCallback(() => {
    dismissOrRoot(router);
  }, [router]);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      const agentId = currentSessionAgentId || defaultAgentId;
      void (async () => {
        if (conversationId) await modelMutation.mutateAsync(modelId);
        const config = queryClient.getQueryData<Awaited<ReturnType<typeof fetchSessionAgentConfig>>>(
          queryKeys.sessionAgentConfig(conversationId),
        );
        if (activeGatewayId && agentId) {
          rememberAgentModel(activeGatewayId, agentId, {
            modelRef: modelId,
            thinkingLevel: config?.thinkingLevel || undefined,
          });
        }
      })().catch((err) => {
        chatSession.setSnackMsg(err instanceof Error ? err.message : String(err));
      });
    },
    [
      activeGatewayId,
      currentSessionAgentId,
      defaultAgentId,
      rememberAgentModel,
      chatSession,
      modelMutation,
      queryClient,
      conversationId,
    ],
  );

  const handleAgentSelect = useCallback(
    (agentId: string) => {
      const completeSelection = bootstrap.beginSessionSelection();
      void (async () => {
        const key = routeTaskId
          ? (await handoffTaskConversation(
              routeTaskId,
              agentId,
              (await queryClient.fetchQuery({
                queryKey: queryKeys.task(routeTaskId),
                queryFn: () => fetchTask(routeTaskId),
              })).task.version,
            )).activeConversationId
          : await takeNewChatConversationId(
              { agentId, projectId: sessionContext.projectId ?? null },
              (() => {
                const preference = modelPreferenceForAgent(newSessionPreferences, agentId);
                return preference
                  ? {
                      model: preference.modelRef,
                      ...(preference.thinkingLevel
                        ? { thinkingLevel: preference.thinkingLevel }
                        : {}),
                    }
                  : undefined;
              })(),
            );
        if (!completeSelection(key)) return;
        if (activeGatewayId) rememberSelectedAgent(activeGatewayId, agentId);
        chatSession.activeConversationIdRef.current = key;
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll });
        if (routeTaskId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.task(routeTaskId) });
        }
        if (!root) {
          openChat(router, key, { replace: true, ...(routeTaskId ? { taskId: routeTaskId } : {}) });
        }
      })().catch((err) => {
        chatSession.setSnackMsg(err instanceof Error ? err.message : String(err));
      });
    },
    [activeGatewayId, root, queryClient, routeTaskId, router, chatSession, bootstrap, newSessionPreferences, rememberSelectedAgent, sessionContext.projectId],
  );

  const handleNewChat = useCallback(() => {
    const completeSelection = bootstrap.beginSessionSelection('home');

    const agentId = currentSessionAgentId || defaultAgentId;
    void (async () => {
      const preference = modelPreferenceForAgent(newSessionPreferences, agentId);
      const key = await takeNewChatConversationId(
        { agentId, projectId: sessionContext.projectId ?? null },
        preference
          ? {
              model: preference.modelRef,
              ...(preference.thinkingLevel ? { thinkingLevel: preference.thinkingLevel } : {}),
            }
          : undefined,
      );
      if (!completeSelection(key)) return;
      chatSession.activeConversationIdRef.current = key;
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    })().catch((err) => {
      chatSession.setSnackMsg(err instanceof Error ? err.message : String(err));
    });
  }, [currentSessionAgentId, defaultAgentId, chatSession, bootstrap, newSessionPreferences, queryClient, sessionContext.projectId]);

  const handleContextChange = useCallback((projectId: string | null, executionMode?: 'local_checkout' | 'managed_worktree') => {
    const completeSelection = bootstrap.beginSessionSelection();
    if (!root) {
      chatSession.activeConversationIdRef.current = '';
      chatSession.cancelRecovery();
      chatSession.clearAllState();
    }

    const agentId = currentSessionAgentId || defaultAgentId;
    void (async () => {
      const preference = modelPreferenceForAgent(newSessionPreferences, agentId);
      const key = await takeNewChatConversationId(
        { agentId, projectId, executionMode },
        preference
          ? {
              model: preference.modelRef,
              ...(preference.thinkingLevel ? { thinkingLevel: preference.thinkingLevel } : {}),
            }
          : undefined,
      );
      if (!completeSelection(key)) return;
      chatSession.activeConversationIdRef.current = key;
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll });
      if (activeGatewayId) rememberLastChatScope(activeGatewayId, projectId);
      if (!root) openChat(router, key, { replace: true });
    })().catch((err) => {
      chatSession.setSnackMsg(err instanceof Error ? err.message : String(err));
    });
  }, [activeGatewayId, bootstrap, chatSession, currentSessionAgentId, defaultAgentId, root, newSessionPreferences, queryClient, rememberLastChatScope, router]);

  const handleSessionSelect = useCallback((key: string) => {
    if (!key || key === conversationId) return;
    if (root) { openChat(router, key); return; }
    chatSession.cancelRecovery();
    chatSession.clearAllState();
    chatSession.activeConversationIdRef.current = key;
    bootstrap.setPendingBootstrapKey(key);
    if (!root) openChat(router, key, { replace: true });
  }, [bootstrap, chatSession, root, router, conversationId]);

  const handleStarterSend = useCallback((text: string) => {
    if (!conversationId || chatSession.runningRef.current) {
      setComposerSuggestion(text);
      return;
    }
    void handleComposerSend(text);
  }, [chatSession.runningRef, handleComposerSend, conversationId]);
  const handleStarterPrefill = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed) setComposerSuggestion(trimmed);
  }, []);

  const handleUserMessageCopy = useCallback(
    (text: string) => {
      void setAppClipboardStringAsync(text)
        .then(() => chatSession.setSnackMsg(m.chat.messageCopied))
        .catch(() => chatSession.setSnackMsg(m.chat.messageCopyFailed));
    },
    [m.chat.messageCopied, m.chat.messageCopyFailed, chatSession.setSnackMsg],
  );

  const handleUserMessageEdit = useCallback(
    (text: string) => {
      setComposerSuggestion(text);
      chatSession.setSnackMsg(m.chat.messageReadyToEdit);
    },
    [m.chat.messageReadyToEdit, chatSession.setSnackMsg],
  );

  const handleUserMessageRetry = useCallback((message: Message) => {
    void chatSession.retryMessage(message);
  }, [chatSession.retryMessage]);

  const handleAssistantCopy = useCallback(
    (text: string) => {
      void setAppClipboardStringAsync(text)
        .then(() => chatSession.setSnackMsg(m.chat.messageCopied))
        .catch(() => chatSession.setSnackMsg(m.chat.messageCopyFailed));
    },
    [m.chat.messageCopied, m.chat.messageCopyFailed, chatSession.setSnackMsg],
  );

  const handleAssistantSaveToNote = useCallback(
    (text: string) => {
      if (savingAssistantNoteRef.current || !text.trim()) return;
      savingAssistantNoteRef.current = true;
      void captureWorkspaceText({ text, channel: 'app' })
        .then((result) => chatSession.setSnackMsg(
          result.synced ? m.chat.messageSavedToNote : m.notesPage.savedOffline,
        ))
        .catch((error) => chatSession.setSnackMsg(
          error instanceof Error ? error.message : m.notesPage.actionFailed,
        ))
        .finally(() => {
          savingAssistantNoteRef.current = false;
        });
    },
    [chatSession.setSnackMsg, m.chat.messageSavedToNote, m.notesPage.actionFailed, m.notesPage.savedOffline],
  );

  const handleAssistantRegenerate = useCallback(
    (assistantIndex: number) => {
      if (!conversationId || chatSession.streaming || chatSession.awaitingSessionRefresh || Boolean(chatSession.clarifyPrompt)) return;
      const userMessage = findPrecedingUserMessage(displayMessages, assistantIndex);
      if (!userMessage) return;
      const payload = buildUserResendPayload(userMessage);
      if (!payload) return;
      void chatSession.send(payload.text, payload.attachments, payload.contextRefs);
    },
    [chatSession, displayMessages, conversationId],
  );

  // ── Picker sheets state ──────────────────────────────────
  const [agentSheetVisible, setAgentSheetVisible] = useState(false);
  const openAgentsPicker = useCallback(() => setAgentSheetVisible(true), []);

  const { openGatewayConnectLanding } = useGatewayConnectLanding();
  const openReconnectLanding = useCallback(() => {
    openGatewayConnectLanding?.();
  }, [openGatewayConnectLanding]);

  const handleGatewayManageSettings = useCallback(() => {
    router.push('/settings/gateway');
  }, [router]);

  return {
    // Identity
    conversationId,
    urlConversationId,
    isDark,
    colors,
    keyboardVisible,
    m,

    // Queries
    agentsQuery,
    modelsQuery,
    sessionHistoryQuery,
    currentSessionAgentId,
    sessionContext,
    effectiveModelId,

    // Derived
    agentName,
    modelName,
    displayMessages,
    reasoningLevel: coerceReasoningLevel(sessionAgentConfigQuery.data?.reasoningLevel),
    sessionPresentationReady:
      !bootstrap.waitingForResume && (!conversationId || !sessionAgentConfigQuery.isLoading),
    welcomeModel,
    isEmptyChat,
    composerDisabled,
    composerSuggestion,
    setComposerSuggestion,

    // Bootstrap
    bootstrap,

    // Chat session
    chat: chatSession,

    // Gateway
    activeGatewayId,
    gatewayOnline,

    // Picker sheets
    agentSheetVisible,
    setAgentSheetVisible,

    // Handlers
    handleBack,
    openAgentsPicker,
    openReconnectLanding,
    handleModelSelect,
    handleAgentSelect,
    handleNewChat,
    handleSessionSelect,
    handleContextChange,
    handleStarterSend,
    handleStarterPrefill,
    handleComposerSend,
    handleUserMessageCopy,
    handleUserMessageEdit,
    handleUserMessageRetry,
    handleAssistantCopy,
    handleAssistantSaveToNote,
    handleAssistantRegenerate,
    handleGatewayManageSettings,
  };
}
