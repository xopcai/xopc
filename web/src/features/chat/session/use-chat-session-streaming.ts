import { useCallback, type RefObject } from 'react';
import type { AgentStreamRunStatus, AppContextEnvelope } from '@xopcai/gateway-contract';

import { trackInputAcceptance } from '../messages/input-acceptance';
import { buildSendFailedErrorPayload } from '@/features/chat/messages/agent-run-error-parser';
import { setOptimisticUserMessageDelivery } from '@/features/chat/messages/optimistic-user-message';
import {
  createAgentStreamMessagingCallbacks,
  readStreamingBubbleFromStore,
  shouldDismissClarificationForTerminal,
} from '@/features/chat/messages/agent-stream-messaging-callbacks';
import type { ComposerContextRef, WireAttachment } from '@/features/chat/composer/composer.types';
import type { Message } from '@/features/chat/messages/messages.types';
import { extractUserMessagePlainText, messageAttachmentsToWire } from '@/features/chat/messages/user-message-plain-text';
import {
  isUiUserMessage,
  uiDeleteCountForUserRound,
  userRoundIndexFromUiMessageIndex,
} from '@/features/chat/messages/user-round-index';
import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import {
  getChatSessionSnapshot,
  getSessionMessages,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';
import {
  clearChatRunPresence,
  markChatRunRunning,
} from '@/features/chat/session/chat-run-presence-store';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import {
  dispatchSessionTitleUpdated,
  provisionalTitleFromUserText,
} from '@/lib/provisional-session-title';
import { resolveResumeRunId } from '@/features/chat/session/resolve-resume-run-id';
import { extractResumeTailForRun } from '@/features/chat/session/chat-session-view';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
import type { SessionManager } from '@/features/chat/session/session-manager';
import {
  cloneMessageForRender,
  ensureAssistantMessage,
  finalizeRunningReviews,
  finalizeRunningTools,
  finalizeStreamingThinking,
  hasRenderableAssistantContent,
} from '@/features/chat/messages/streaming';
import type { ChatFollowUpClarifyApi } from '@/features/chat/session/use-chat-follow-up-clarify';
import {
  isBareResetCommand,
  isTaskDestructiveCommand,
} from '@/features/chat/session/slash-command-semantics';

export function useChatSessionStreaming(deps: {
  conversationId: string | null;
  taskId?: string;
  thinkingLevel: string;
  modelSupportsThinking: boolean;

  conversationIdRef: RefObject<string | null>;
  sendingRef: RefObject<boolean>;
  streamingRef: RefObject<boolean>;
  sessionMgrRef: RefObject<SessionManager>;

  sendMessageRef: RefObject<
    (
      content: string,
      attachments?: PendingFollowUp['attachments'],
      levelOverride?: string,
      contextRefs?: ComposerContextRef[],
      replaceTurnId?: string,
      appContext?: AppContextEnvelope,
      onDispatched?: (clientSubmissionId: string, messageRenderKey?: string) => void,
      replaceClientSubmissionId?: string,
    ) => Promise<void | boolean>
  >;

  shouldApplyStreamUpdate: (streamConversationId: string) => boolean;
  fq: ChatFollowUpClarifyApi;

  applyLoadedSessionSnapshot: (
    chatId: string,
    data: { messages: Message[]; hasMore: boolean; name?: string },
  ) => void;
  loadSessionById: (key: string, offset?: number) => Promise<Message[] | undefined>;
  resetCurrentSession: () => Promise<void>;
  pollSessionNameAfterTurn: () => void;
}) {
  const {
    conversationId,
    taskId,
    thinkingLevel,
    modelSupportsThinking,
    conversationIdRef,
    sendingRef,
    streamingRef,
    sessionMgrRef,
    sendMessageRef,
    shouldApplyStreamUpdate,
    fq,
    applyLoadedSessionSnapshot,
    loadSessionById,
    resetCurrentSession,
    pollSessionNameAfterTurn,
  } = deps;

  const store = () => useChatSessionStore.getState();
  const setShellError = (msg: string) => store().setShellError(msg);
  const clearShellError = () => store().setShellError(null);

  const finalizeMessage = useCallback(
    (targetConversationId?: string, terminalStatus?: AgentStreamRunStatus) => {
      const cacheKey = targetConversationId ?? conversationIdRef.current;
      if (cacheKey && !shouldApplyStreamUpdate(cacheKey)) {
        return;
      }
      const cachedBubble = cacheKey ? readStreamingBubbleFromStore(cacheKey) : null;
      let finalMsg: Message | null = null;
      if (cachedBubble) {
        const msg = ensureAssistantMessage(cachedBubble, Date.now());
        finalizeStreamingThinking(msg.content);
        finalizeRunningTools(msg.content);
        finalizeRunningReviews(msg.content);
        msg.completedAt = Date.now();
        finalMsg = cloneMessageForRender(msg);
      }
      if (finalMsg && hasRenderableAssistantContent(finalMsg) && cacheKey) {
        store().finalizeStreamingTurn(cacheKey, finalMsg);
      } else if (cacheKey) {
        store().clearStreamingState(cacheKey);
      }
      sendingRef.current = false;
      streamingRef.current = false;
      if (cacheKey) chatRunManager.resetRunTracking(cacheKey);
      if (!terminalStatus || shouldDismissClarificationForTerminal(terminalStatus)) fq.dismissClarify();
      void pollSessionNameAfterTurn();
      const syncKey = conversationIdRef.current;
      if (syncKey) {
        window.setTimeout(() => {
          if (conversationIdRef.current !== syncKey) return;
          if (sendingRef.current || streamingRef.current) return;
          void loadSessionById(syncKey, 0);
        }, 400);
      }
    },
    [
      sendingRef,
      streamingRef,
      conversationIdRef,
      fq.dismissClarify,
      fq.pendingFollowUpsRef,
      pollSessionNameAfterTurn,
      loadSessionById,
      shouldApplyStreamUpdate,
    ],
  );

  const tryResumeAgentRun = useCallback(
    async (chatId: string, loadedMessages?: Message[]) => {
      if (!shouldApplyStreamUpdate(chatId)) return;

      const runId = await resolveResumeRunId(chatId);
      if (!runId) {
        const staleRunId = chatRunManager.getResumeRunId(chatId);
        if (staleRunId) chatRunManager.reconcileInactive(chatId, staleRunId);
        store().clearStreamingState(chatId);
        clearChatRunPresence(chatId);
        return;
      }
      if (chatRunManager.isTrackingRun(chatId, runId)) return;

      let seedMessages = loadedMessages ?? getSessionMessages(chatId);
      let seedHasMore = getChatSessionSnapshot(chatId)?.hasMore ?? false;
      try {
        const fresh = await sessionMgrRef.current.loadSession(chatId, 0, undefined, taskId);
        store().mergeCommittedFromServer(chatId, fresh.messages, fresh.hasMore);
        seedMessages = fresh.messages;
        seedHasMore = fresh.hasMore;
      } catch {
        /* use cached seed */
      }

      chatRunManager.setUserAborted(chatId, false);
      chatRunManager.setResumeRunId(chatId, runId);
      sendingRef.current = true;
      streamingRef.current = true;
      store().seedSessionIfEmpty(chatId, seedMessages, true, true, seedHasMore);
      store().setSessionFlags(chatId, { sending: true, streaming: true });
      store().setSessionProgress(chatId, null);
      markChatRunRunning(chatId);

      let hydratedResumeTail = false;
      const hydrateResumeTailAssistant = () => {
        if (hydratedResumeTail) return;
        if (!shouldApplyStreamUpdate(chatId)) return;
        hydratedResumeTail = true;
        const prev = getSessionMessages(chatId);
        const extracted = extractResumeTailForRun(prev, runId);
        if (!extracted) return;
        store().applyHydratedTail(
          chatId,
          extracted.messagesWithoutTail,
          cloneMessageForRender(extracted.tail),
        );
      };

      const clearFailedResumeState = () => {
        store().clearStreamingState(chatId);
        if (chatRunManager.getResumeRunId(chatId) === runId) {
          chatRunManager.setResumeRunId(chatId, null);
        }
        if (!shouldApplyStreamUpdate(chatId)) {
          return;
        }
        sendingRef.current = false;
        streamingRef.current = false;
      };

      try {
        const resumeStreamCallbacks = createAgentStreamMessagingCallbacks({
          chatId,
          shouldApplyStreamUpdate,
          beforeAssistantDelta: hydrateResumeTailAssistant,
          reconcileHydratedAssistantText: true,
          setStreamingOnStreamStart: false,
          clearResumeRunIdOnBackgroundTerminal: true,
          clearResumeRunIdOnVisibleError: true,
          setError: setShellError,
          sessionMgrRef,
          applyLoadedSessionSnapshot,
          finalizeMessage,
          fq,
        });

        const resumed = await chatRunManager.senderFor(chatId).resume(runId, chatId, resumeStreamCallbacks);
        if (!resumed) {
          clearChatRunPresence(chatId);
          clearFailedResumeState();
          await loadSessionById(chatId, 0).catch(() => undefined);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[chat] resume failed:', err);
        }
        clearChatRunPresence(chatId);
        clearFailedResumeState();
      } finally {
        chatRunManager.releaseIdleSender(chatId);
      }
    },
    [
      sendingRef,
      streamingRef,
      shouldApplyStreamUpdate,
      sessionMgrRef,
      applyLoadedSessionSnapshot,
      finalizeMessage,
      loadSessionById,
      taskId,
    ],
  );

  const interruptAndSend = useCallback(
    async (content: string, attachments?: WireAttachment[], levelOverride?: string, contextRefs?: ComposerContextRef[]) => {
      if (!content.trim() && !attachments?.length) return;
      const key = conversationIdRef.current;
      if (!key) return;
      if (!sendingRef.current && !streamingRef.current && !chatRunManager.isStreamingFor(key)) return;
      const trimmed = content.trim();
      if (taskId && isTaskDestructiveCommand(trimmed)) {
        setShellError('A task has one continuous conversation.');
        return;
      }
      if (isBareResetCommand(trimmed) && !attachments?.length) {
        await resetCurrentSession();
        return;
      }
      fq.dismissClarifyAndClearPending();
      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      chatRunManager.setUserAborted(key, true);
      chatRunManager.abort(key);
      sendingRef.current = false;
      streamingRef.current = false;
      finalizeMessage(key);
      queueMicrotask(() => {
        void sendMessageRef.current(content, attachments, effectiveThinking, contextRefs);
      });
    },
    [
      sendingRef,
      streamingRef,
      conversationIdRef,
      fq.dismissClarifyAndClearPending,
      modelSupportsThinking,
      thinkingLevel,
      finalizeMessage,
      sendMessageRef,
      resetCurrentSession,
      taskId,
    ],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: WireAttachment[],
      levelOverride?: string,
      contextRefs?: ComposerContextRef[],
      replaceTurnId?: string,
      appContext?: AppContextEnvelope,
      onDispatched?: (clientSubmissionId: string, messageRenderKey?: string) => void,
      replaceClientSubmissionId?: string,
    ) => {
      if (!conversationId) return false;
      if (!shouldApplyStreamUpdate(conversationId)) return false;
      if (
        (!content.trim() && !attachments?.length) ||
        (sendingRef.current || streamingRef.current || chatRunManager.isStreamingFor(conversationId))
      ) {
        return false;
      }

      const trimmed = content.trim();
      if (taskId && isTaskDestructiveCommand(trimmed)) {
        setShellError('A task has one continuous conversation.');
        return false;
      }
      if (isBareResetCommand(trimmed) && !attachments?.length) {
        await resetCurrentSession();
        return;
      }

      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      const chatId = conversationId;
      const clientSubmissionId = crypto.randomUUID();
      const storedMessages = getSessionMessages(chatId);
      const currentMessages = replaceClientSubmissionId
        ? storedMessages.filter((message) => message.clientSubmissionId !== replaceClientSubmissionId)
        : storedMessages;
      const replaceIndex = replaceTurnId
        ? currentMessages.findIndex(
            (message) => message.role === 'user' && message.turnId === replaceTurnId,
          )
        : -1;
      if (replaceTurnId && replaceIndex < 0) return false;
      chatRunManager.setUserAborted(chatId, false);
      sendingRef.current = true;
      streamingRef.current = false;
      clearShellError();
      fq.dismissClarify();

      const baseMessages = replaceIndex >= 0
        ? currentMessages.slice(0, replaceIndex)
        : currentMessages;
      const nextMessages = [
        ...baseMessages,
        {
          role: 'user',
          content: content ? [{ type: 'text', text: content }] : [],
          deliveryStatus: 'sending',
          clientSubmissionId,
          pendingAppContext: appContext === undefined ? undefined : structuredClone(appContext),
          attachments,
          contextRefs: contextRefs?.map((ref) => ({
            kind: ref.kind,
            sourceId: ref.sourceId,
            version: ref.expectedVersion,
            title: ref.title,
            fileKind: ref.fileKind,
          })),
          timestamp: Date.now(),
        },
      ] as Message[];

      onDispatched?.(clientSubmissionId);
      const existing = getChatSessionSnapshot(chatId);
      store().initSessionSnapshot(chatId, {
        ...(existing ?? {
          ...defaultSessionMeta(),
          historyStatus: 'ready',
          hasMore: false,
          streamingMsg: null,
          progress: null,
          taskPlan: null,
          sending: false,
          streaming: false,
        }),
        messages: nextMessages,
        hasMore: existing?.hasMore ?? false,
        streamingMsg: null,
        progress: null,
        sending: true,
        streaming: false,
      });
      markChatRunRunning(chatId);

      if (!existing?.name?.trim() && trimmed) {
        const provisional = provisionalTitleFromUserText(trimmed);
        if (provisional) {
          store().patchSessionMeta(chatId, { name: provisional });
          dispatchSessionTitleUpdated(chatId, provisional);
        }
      }

      const updateDeliveryStatus = (status: 'accepted' | 'failed') => {
        store().updateSessionMessages(
          chatId,
          (messages) => setOptimisticUserMessageDelivery(messages, clientSubmissionId, status),
        );
      };

      return trackInputAcceptance(async (onInputAccepted) => {
        let inputAccepted = false;
        try {
          await sessionMgrRef.current.ensureSessionExists(chatId);

          const sendStreamCallbacks = createAgentStreamMessagingCallbacks({
            chatId,
            shouldApplyStreamUpdate,
            beforeAssistantDelta: () => {},
            reconcileHydratedAssistantText: false,
            setStreamingOnStreamStart: true,
            clearResumeRunIdOnBackgroundTerminal: false,
            clearResumeRunIdOnVisibleError: false,
            setError: setShellError,
            sessionMgrRef,
            applyLoadedSessionSnapshot,
            finalizeMessage,
            fq,
          });
          sendStreamCallbacks.onInputAccepted = () => {
            inputAccepted = true;
            updateDeliveryStatus('accepted');
            onInputAccepted();
          };

          await chatRunManager.senderFor(chatId).send(
            content,
            chatId,
            attachments,
            effectiveThinking,
            sendStreamCallbacks,
            taskId,
            replaceTurnId,
            contextRefs,
            appContext,
          );
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            store().clearStreamingState(chatId);
            clearChatRunPresence(chatId);
            if (shouldApplyStreamUpdate(chatId)) {
              setShellError(appContext && err instanceof Error ? err.message : JSON.stringify(buildSendFailedErrorPayload()));
            }
            if (replaceTurnId) void loadSessionById(chatId, 0);
          } else {
            clearChatRunPresence(chatId);
          }
        } finally {
          if (!inputAccepted) updateDeliveryStatus('failed');
          if (shouldApplyStreamUpdate(chatId)) {
            sendingRef.current = false;
            streamingRef.current = false;
          }
          store().setSessionFlags(chatId, { sending: false });
          chatRunManager.releaseIdleSender(chatId);
        }
      });
    },
    [
      conversationId,
      thinkingLevel,
      modelSupportsThinking,
      sendingRef,
      streamingRef,
      shouldApplyStreamUpdate,
      sessionMgrRef,
      applyLoadedSessionSnapshot,
      finalizeMessage,
      fq.dismissClarify,
      resetCurrentSession,
      taskId,
      loadSessionById,
    ],
  );

  const replaceLatestUserTurn = useCallback(
    (
      turnId: string,
      content: string,
      attachments?: WireAttachment[],
      levelOverride?: string,
      contextRefs?: ComposerContextRef[],
    ) => sendMessage(content, attachments, levelOverride, contextRefs, turnId),
    [sendMessage],
  );

  const abort = useCallback(() => {
    const key = conversationIdRef.current;
    if (!key) return;
    chatRunManager.setUserAborted(key, true);
    fq.dismissClarifyAndClearPending();
    chatRunManager.abort(key);
    if (key) clearChatRunPresence(key);
    sendingRef.current = false;
    streamingRef.current = false;
    finalizeMessage(key);
    if (key) {
      window.setTimeout(() => {
        void loadSessionById(key, 0);
      }, 300);
    }
  }, [
    fq.dismissClarifyAndClearPending,
    sendingRef,
    streamingRef,
    finalizeMessage,
    conversationIdRef,
    loadSessionById,
  ]);

  const deleteMessageRound = useCallback(
    (messageIndex: number) => {
      const key = conversationIdRef.current;
      if (!key) return;
      if (sendingRef.current || streamingRef.current) return;

      const messages = getSessionMessages(key);
      const msg = messages[messageIndex];
      if (!msg || !isUiUserMessage(msg.role)) return;

      if (msg.deliveryStatus === 'failed') {
        const updated = [...messages];
        updated.splice(messageIndex, 1);
        store().updateSessionMessages(key, () => updated);
        return;
      }

      const userRoundIndex = userRoundIndexFromUiMessageIndex(messages, messageIndex);
      if (userRoundIndex === null) return;

      const deleteCount = uiDeleteCountForUserRound(messages, messageIndex);
      const updated = [...messages];
      updated.splice(messageIndex, deleteCount);

      store().updateSessionMessages(key, () => updated);

      void sessionMgrRef.current.deleteMessages(key, { userRoundIndex }).catch(() => {
        void loadSessionById(key, 0);
      });
    },
    [conversationIdRef, sendingRef, streamingRef, sessionMgrRef, loadSessionById],
  );

  const retryUserMessageRound = useCallback(
    (messageIndex: number) => {
      const key = conversationIdRef.current;
      if (!key) return;
      if (sendingRef.current || streamingRef.current) return;

      const messages = getSessionMessages(key);
      const msg = messages[messageIndex];
      if (!msg || !isUiUserMessage(msg.role)) return;
      for (let j = messageIndex + 1; j < messages.length; j++) {
        const nextMsg = messages[j];
        if (nextMsg && isUiUserMessage(nextMsg.role)) return;
      }

      const text = extractUserMessagePlainText(msg.content);
      const wireAtt = messageAttachmentsToWire(msg.attachments);
      if (!text.trim() && !wireAtt?.length && !msg.contextRefs?.length) return;

      const contextRefs = msg.contextRefs?.map((ref) => ({
        kind: ref.kind,
        sourceId: ref.sourceId,
        expectedVersion: ref.version,
        title: ref.title,
        fileKind: ref.fileKind,
      }));
      const failedSubmissionId = msg.deliveryStatus === 'failed' ? msg.clientSubmissionId : undefined;
      if (!failedSubmissionId && !msg.turnId) {
        return;
      }
      void sendMessageRef.current(
        text,
        wireAtt,
        undefined,
        contextRefs,
        msg.turnId,
        msg.pendingAppContext,
        undefined,
        failedSubmissionId,
      ).catch(() => {
        void loadSessionById(key, 0);
      });
    },
    [conversationIdRef, sendingRef, streamingRef, loadSessionById, sendMessageRef],
  );

  return {
    finalizeMessage,
    tryResumeAgentRun,
    sendMessage,
    replaceLatestUserTurn,
    interruptAndSend,
    abort,
    deleteMessageRound,
    retryUserMessageRound,
  };
}
