/**
 * Orchestrating hook for the main chat page.
 *
 * Combines: bootstrap, session history, chat streaming, message parsing,
 * agent/model queries, and all user-interaction handlers.
 *
 * The page component (`app/chat/[k].tsx`) remains a thin render shell.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { dismissOrHome, openChat, useDismissOnHardwareBack } from '../../lib/navigation';

import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useGatewayHealth } from '../gateway/use-gateway-health';
import { useGatewayConnectLanding } from '../gateway/gateway-connect-context';
import { syncAfterGatewaySettingsSave } from '../gateway/gateway-connection-sync';
import { useRouteOverrideToast } from '../gateway/use-route-override-toast';
import { useKeyboardVisible } from '../../hooks/use-keyboard-visible';
import { useMessages, t } from '../../i18n/messages';
import { fetchChatAgents, readPlaceholderAgents, resolveEffectiveDefaultAgentId } from '../../query/agents';
import { fetchChatModels, resolveEffectiveModelId, setSessionModelRef, fetchSessionAgentConfig } from '../../query/models';
import { queryKeys } from '../../query/keys';
import { fetchTask, handoffTaskConversation } from '../../query/tasks';
import { fetchProject, fetchProjectOperatingView } from '../../query/projects';
import { getColors } from '../../theme';

import { consumeContentChatIntake } from '../content-intake/content-chat-handoff';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { captureWorkspaceText } from '../../sync/workspace-sync';
import { buildUserResendPayload, findPrecedingUserMessage } from './composer-send-helpers';
import type { ComposerAttachment, WireAttachment } from './composer.types';
import { coerceReasoningLevel, type Message } from './messages.types';
import { MAX_PENDING_FOLLOW_UPS } from './pending-follow-up.types';
import { sendOrQueueMessage } from './send-or-queue';
import {
  parseSessionMessages,
  dedupeWireMessages,
  mergeStreamingAssistantIntoMessages,
} from './session-message-parser';
import { takeNewChatSessionKey } from './session-prefetch';
import { consumeNoteChatPrefill } from './note-chat-prefill-storage';
import { MAX_CHAT_ATTACHMENTS } from './chat-limits';
import { buildMobileWelcomeModel } from './mobile-welcome-starters';
import { useChatPageBootstrap } from './use-chat-page-bootstrap';
import { useChatSession } from './use-chat-session';
import { useSessionHistory } from './use-session-history';
import { useWorkspaceNavigation } from '../workspace/workspace-navigation-context';
import { useOptionalWorkspaceTransition } from '../workspace/workspace-transition-context';

export type UseChatPageOptions = {
  embedded?: boolean;
  onBack?: () => void;
};

export function useChatPage(options: UseChatPageOptions = {}) {
  const { embedded = false, onBack } = options;
  const { k: rawKey, msg: rawMsg, taskId: rawTaskId } = useLocalSearchParams<{
    k?: string;
    msg?: string;
    taskId?: string;
  }>();
  const savingAssistantNoteRef = useRef(false);
  const urlSessionKey = typeof rawKey === 'string' ? rawKey : Array.isArray(rawKey) ? rawKey[0] : '';
  const urlPrefillMessage = typeof rawMsg === 'string' ? rawMsg : Array.isArray(rawMsg) ? rawMsg[0] : '';
  const routeTaskId = typeof rawTaskId === 'string' ? rawTaskId.trim() : '';
  const router = useRouter();
  useDismissOnHardwareBack(router, { enabled: !embedded });
  const queryClient = useQueryClient();
  const { gatewayOnline } = useGatewayHealth();
  const routeOverrideToast = useRouteOverrideToast();
  const gatewayProfiles = useGatewayStore((s) => s.profiles);
  const activeGatewayId = useGatewayStore((s) => s.activeGatewayId);
  const switchGateway = useGatewayStore((s) => s.switchGateway);
  const isDark = usePreferencesStore((s) => s.resolvedTheme === 'dark');
  const keyboardVisible = useKeyboardVisible();
  const m = useMessages();

  // ── Agent / model info ───────────────────────────────────
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: true,
    placeholderData: () => readPlaceholderAgents() ?? undefined,
  });

  const localDefaultAgentId = usePreferencesStore((s) => s.defaultAgentId) ?? '';
  const localSelectedModelRef = usePreferencesStore((s) => s.selectedModelRef);
  const setSelectedModelRef = usePreferencesStore((s) => s.setSelectedModelRef);

  // ── Bootstrap ────────────────────────────────────────────
  // Shared ref for session key — bootstrap writes here, chatSession reads it.
  const activeSessionKeyRef = useRef('');
  const transition = useOptionalWorkspaceTransition();
  const overlaySessionKey = embedded ? transition?.overlaySessionKey ?? '' : '';

  const bootstrap = useChatPageBootstrap({
    urlSessionKey,
    gatewayOnline,
    agentsData: agentsQuery.data,
    localDefaultAgentId,
    messages: m,
    activeSessionKeyRef,
    shouldNavigateToRoute: !embedded,
    shouldAutoBootstrap: !embedded,
  });

  const sessionKey = urlSessionKey || overlaySessionKey || bootstrap.pendingBootstrapKey;

  // ── Session history ──────────────────────────────────────
  const { sessionHistoryQuery } = useSessionHistory(sessionKey);

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

  const effectiveModelId = resolveEffectiveModelId(modelsQuery.data, localSelectedModelRef);
  const chatSession = useChatSession({ sessionKey, taskId: routeTaskId || undefined });
  const sessionAgentConfigQuery = useQuery({
    queryKey: queryKeys.sessionAgentConfig(sessionKey),
    queryFn: () => fetchSessionAgentConfig(sessionKey),
    enabled: Boolean(sessionKey),
  });

  // Overlay: reset UI when a new Ask AI session key arrives from the transition.
  const prevOverlayKeyRef = useRef('');
  useEffect(() => {
    if (!embedded || !overlaySessionKey || overlaySessionKey === prevOverlayKeyRef.current) return;
    prevOverlayKeyRef.current = overlaySessionKey;
    activeSessionKeyRef.current = overlaySessionKey;
    chatSession.cancelRecovery();
    chatSession.clearAllState();
  }, [embedded, overlaySessionKey, chatSession]);

  // Sync session model override from agent-config when session changes.
  useEffect(() => {
    const cfg = sessionAgentConfigQuery.data;
    if (!cfg?.model) return;
    setSelectedModelRef(cfg.model);
  }, [sessionAgentConfigQuery.data, setSelectedModelRef]);

  // Keep the shared ref in sync with chatSession's internal ref
  useEffect(() => {
    activeSessionKeyRef.current = chatSession.activeSessionKeyRef.current;
  }, [chatSession.activeSessionKeyRef]);

  const agentName = useMemo(() => {
    const agents = agentsQuery.data?.items ?? [];
    const defaultId = resolveEffectiveDefaultAgentId(agentsQuery.data, localDefaultAgentId);
    const sessionAgentId = currentSessionAgentId || defaultId;
    const agent = agents.find((a) => a.id === sessionAgentId);
    return agent?.name ?? agent?.id ?? sessionAgentId;
  }, [agentsQuery.data, currentSessionAgentId, localDefaultAgentId]);
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
    return model?.name ?? model?.id ?? (effectiveModelId || m.chat.modelPickerSelect);
  }, [effectiveModelId, m.chat.modelPickerSelect, modelsQuery.data?.items]);

  // ── Parsed messages ──────────────────────────────────────
  const sessionMessages = useMemo<Message[]>(() => {
    const pages = sessionHistoryQuery.data?.pages ?? [];
    const raw = [...pages].reverse().flatMap((page) => page?.session.messages ?? []);
    if (!raw.length) return [];
    return parseSessionMessages(dedupeWireMessages(raw as Array<Record<string, unknown>>));
  }, [sessionHistoryQuery.data?.pages]);

  const sessionRefreshComplete =
    chatSession.awaitingSessionRefresh &&
    sessionHistoryQuery.dataUpdatedAt > chatSession.sessionDataUpdatedAtRef.current;

  const displayMessages = useMemo<Message[]>(() => {
    if (sessionRefreshComplete) return sessionMessages;
    const base =
      chatSession.optimisticMessages.length > 0
        ? [...sessionMessages, ...chatSession.optimisticMessages]
        : sessionMessages;
    if (!chatSession.streamingMsg) return base;
    return mergeStreamingAssistantIntoMessages(base, chatSession.streamingMsg);
  }, [sessionRefreshComplete, sessionMessages, chatSession.optimisticMessages, chatSession.streamingMsg]);

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
  const [composerPrefillAttachments, setComposerPrefillAttachments] = useState<ComposerAttachment[] | undefined>();

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
    Boolean(chatSession.clarifyPrompt) ||
    chatSession.inputQueued ||
    (!sessionKey && Boolean(bootstrap.bootstrapError));

  const pendingSendRef = useRef<{ text: string; attachments?: WireAttachment[] } | null>(null);

  const flushPendingSend = useCallback(() => {
    const pending = pendingSendRef.current;
    if (!pending || !sessionKey || chatSession.streaming || chatSession.clarifyPrompt) return;
    pendingSendRef.current = null;
    void chatSession.send(pending.text, pending.attachments);
  }, [sessionKey, chatSession]);

  useEffect(() => {
    flushPendingSend();
  }, [flushPendingSend]);

  useEffect(() => {
    if (!sessionKey || chatSession.streaming || chatSession.clarifyPrompt) return;
    const intake = consumeContentChatIntake(sessionKey);
    if (!intake) return;
    pendingSendRef.current = { text: intake.prompt };
    flushPendingSend();
  }, [chatSession.clarifyPrompt, chatSession.streaming, flushPendingSend, sessionKey]);

  const handleComposerSend = useCallback(
    async (text: string, attachments?: WireAttachment[]) => {
      if (bootstrap.bootstrapError && !sessionKey) return false;
      const trimmed = text.trim();
      const hasContent = Boolean(trimmed) || Boolean(attachments?.length);
      if (!hasContent) return false;

      if (!sessionKey || bootstrap.creatingInitialSession) {
        pendingSendRef.current = { text: trimmed, attachments };
        return true;
      }
      return chatSession.send(text, attachments);
    },
    [bootstrap.bootstrapError, bootstrap.creatingInitialSession, chatSession, sessionKey],
  );

  // ── Handlers ─────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    dismissOrHome(router);
  }, [onBack, router]);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setSelectedModelRef(modelId);
      if (sessionKey) void setSessionModelRef(sessionKey, modelId, routeTaskId || undefined).catch(() => {});
    },
    [routeTaskId, sessionKey, setSelectedModelRef],
  );

  const handleAgentSelect = useCallback(
    (agentId: string) => {
      void (async () => {
        const key = routeTaskId
          ? (await handoffTaskConversation(
              routeTaskId,
              agentId,
              (await queryClient.fetchQuery({
                queryKey: queryKeys.task(routeTaskId),
                queryFn: () => fetchTask(routeTaskId),
              })).task.version,
            )).activeSessionKey
          : await takeNewChatSessionKey(agentId);
        chatSession.activeSessionKeyRef.current = key;
        bootstrap.setPendingBootstrapKey(key);
        if (routeTaskId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.task(routeTaskId) });
        }
        if (!embedded) {
          openChat(router, key, { replace: true, ...(routeTaskId ? { taskId: routeTaskId } : {}) });
        }
      })().catch((err) => {
        chatSession.setSnackMsg(err instanceof Error ? err.message : String(err));
      });
    },
    [embedded, queryClient, routeTaskId, router, chatSession, bootstrap],
  );

  const handleNewChat = useCallback(() => {
    chatSession.activeSessionKeyRef.current = '';
    chatSession.cancelRecovery();
    chatSession.clearAllState();

    const agentId = resolveEffectiveDefaultAgentId(agentsQuery.data, localDefaultAgentId);
    void (async () => {
      const key = await takeNewChatSessionKey(agentId);
      chatSession.activeSessionKeyRef.current = key;
      bootstrap.setPendingBootstrapKey(key);
      if (!embedded) {
        openChat(router, key, { replace: true });
      }
    })().catch((err) => {
      chatSession.setSnackMsg(err instanceof Error ? err.message : String(err));
    });
  }, [agentsQuery.data, embedded, localDefaultAgentId, router, chatSession, bootstrap]);

  const queueFollowUpOrSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (!sessionKey || bootstrap.creatingInitialSession) {
        pendingSendRef.current = { text: trimmed };
        return;
      }

      sendOrQueueMessage({
        text: trimmed,
        runBusy: chatSession.runningRef.current,
        pendingCount: chatSession.followUp.pendingFollowUps.length,
        send: chatSession.send,
        addPendingFollowUp: (msg) => chatSession.followUp.addPendingFollowUp(msg),
        onQueueFull: () => {
          chatSession.setSnackMsg(t(m.chat.followUpQueueMaxReached, { max: MAX_PENDING_FOLLOW_UPS }));
        },
      });
    },
    [bootstrap.creatingInitialSession, chatSession, m.chat.followUpQueueMaxReached, sessionKey],
  );

  const handleStarterSend = useCallback((text: string) => queueFollowUpOrSend(text), [queueFollowUpOrSend]);
  const handleStarterPrefill = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed) setComposerSuggestion(trimmed);
  }, []);

  // Consume prefill message from URL params (e.g. from Notes → Chat)
  useEffect(() => {
    if (urlPrefillMessage) {
      setComposerSuggestion(urlPrefillMessage);
    }
  }, [urlPrefillMessage]);

  useEffect(() => {
    if (!sessionKey) return;
    const snap = consumeNoteChatPrefill(sessionKey);
    if (!snap) return;
    if (snap.attachments.length) {
      setComposerPrefillAttachments(snap.attachments);
    }
    if (snap.droppedCount) {
      chatSession.setSnackMsg(
        t(m.chat.maxAttachmentsTruncated, { dropped: snap.droppedCount, max: MAX_CHAT_ATTACHMENTS }),
      );
    }
  }, [sessionKey, chatSession, m.chat.maxAttachmentsTruncated]);

  const { registerFinalizeHandler } = useWorkspaceNavigation();

  const prepareAskAiFromHome = useCallback(() => {
    pendingSendRef.current = null;
    chatSession.cancelRecovery();
    chatSession.clearAllState();
  }, [chatSession]);

  useEffect(() => {
    if (!embedded) return;
    registerFinalizeHandler(prepareAskAiFromHome);
    return () => registerFinalizeHandler(null);
  }, [embedded, prepareAskAiFromHome, registerFinalizeHandler]);

  const handleUserMessageCopy = useCallback(
    (text: string) => {
      void setAppClipboardStringAsync(text)
        .then(() => chatSession.setSnackMsg(m.chat.messageCopied))
        .catch(() => chatSession.setSnackMsg(m.chat.messageCopyFailed));
    },
    [m.chat.messageCopied, m.chat.messageCopyFailed, chatSession],
  );

  const handleUserMessageEdit = useCallback(
    (text: string) => {
      setComposerSuggestion(text);
      chatSession.setSnackMsg(m.chat.messageReadyToEdit);
    },
    [m.chat.messageReadyToEdit, chatSession],
  );

  const handleUserMessageRetry = useCallback((message: Message) => {
    const payload = buildUserResendPayload(message);
    if (!payload) return;
    void chatSession.send(payload.text, payload.attachments);
  }, [chatSession]);

  const handleAssistantCopy = useCallback(
    (text: string) => {
      void setAppClipboardStringAsync(text)
        .then(() => chatSession.setSnackMsg(m.chat.messageCopied))
        .catch(() => chatSession.setSnackMsg(m.chat.messageCopyFailed));
    },
    [m.chat.messageCopied, m.chat.messageCopyFailed, chatSession],
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
    [chatSession, m.chat.messageSavedToNote, m.notesPage.actionFailed, m.notesPage.savedOffline],
  );

  const handleAssistantRegenerate = useCallback(
    (assistantIndex: number) => {
      if (!sessionKey || chatSession.streaming || chatSession.awaitingSessionRefresh || Boolean(chatSession.clarifyPrompt)) return;
      const userMessage = findPrecedingUserMessage(displayMessages, assistantIndex);
      if (!userMessage) return;
      const payload = buildUserResendPayload(userMessage);
      if (!payload) return;
      void chatSession.send(payload.text, payload.attachments);
    },
    [chatSession, displayMessages, sessionKey],
  );

  // ── Picker sheets state ──────────────────────────────────
  const [agentSheetVisible, setAgentSheetVisible] = useState(false);
  const [gatewaySheetVisible, setGatewaySheetVisible] = useState(false);
  const [switchingGatewayId, setSwitchingGatewayId] = useState<string | null>(null);

  const openAgentsPicker = useCallback(() => setAgentSheetVisible(true), []);

  const handleGatewaySelect = useCallback(
    async (profileId: string) => {
      if (profileId === activeGatewayId) {
        setGatewaySheetVisible(false);
        return;
      }
      setSwitchingGatewayId(profileId);
      try {
        switchGateway(profileId);
        await syncAfterGatewaySettingsSave();
        const agentId = resolveEffectiveDefaultAgentId(agentsQuery.data, localDefaultAgentId);
        const key = await takeNewChatSessionKey(agentId);
        chatSession.activeSessionKeyRef.current = key;
        bootstrap.setPendingBootstrapKey(key);
        setGatewaySheetVisible(false);
        if (!embedded) {
          openChat(router, key, { replace: true });
        }
      } catch (e) {
        chatSession.setSnackMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setSwitchingGatewayId(null);
      }
    },
    [activeGatewayId, agentsQuery.data, embedded, localDefaultAgentId, queryClient, router, switchGateway, chatSession, bootstrap],
  );

  const { openGatewayConnectLanding } = useGatewayConnectLanding();
  const openReconnectLanding = useCallback(() => {
    openGatewayConnectLanding?.();
  }, [openGatewayConnectLanding]);

  const handleGatewayManageSettings = useCallback(() => {
    setGatewaySheetVisible(false);
    router.push('/settings/gateway');
  }, [router]);

  const handleGatewayAdd = useCallback(() => {
    setGatewaySheetVisible(false);
    router.push('/settings/gateway/new');
  }, [router]);

  return {
    // Identity
    sessionKey,
    urlSessionKey,
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
    sessionPresentationReady: !sessionKey || !sessionAgentConfigQuery.isLoading,
    welcomeModel,
    isEmptyChat,
    composerDisabled,
    composerSuggestion,
    setComposerSuggestion,
    composerPrefillAttachments,
    setComposerPrefillAttachments,

    // Bootstrap
    bootstrap,

    // Chat session
    chat: chatSession,

    // Gateway
    gatewayProfiles,
    activeGatewayId,
    gatewayOnline,
    routeOverrideToast,

    // Picker sheets
    agentSheetVisible,
    setAgentSheetVisible,
    gatewaySheetVisible,
    setGatewaySheetVisible,
    switchingGatewayId,

    // Handlers
    handleBack,
    openAgentsPicker,
    openReconnectLanding,
    handleModelSelect,
    handleAgentSelect,
    handleNewChat,
    handleStarterSend,
    handleStarterPrefill,
    handleComposerSend,
    handleUserMessageCopy,
    handleUserMessageEdit,
    handleUserMessageRetry,
    handleAssistantCopy,
    handleAssistantSaveToNote,
    handleAssistantRegenerate,
    handleGatewaySelect,
    handleGatewayManageSettings,
    handleGatewayAdd,
  };
}
