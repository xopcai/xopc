import { useCallback, type RefObject } from 'react';

import { buildSendFailedErrorPayload } from '@/features/chat/messages/agent-run-error-parser';
import { createAgentStreamMessagingCallbacks, readStreamingBubbleFromStore } from '@/features/chat/messages/agent-stream-messaging-callbacks';
import type { WireAttachment } from '@/features/chat/composer/composer.types';
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

export function useChatSessionStreaming(deps: {
  sessionKey: string | null;
  taskId?: string;
  thinkingLevel: string;
  modelSupportsThinking: boolean;

  sessionKeyRef: RefObject<string | null>;
  sendingRef: RefObject<boolean>;
  streamingRef: RefObject<boolean>;
  sessionMgrRef: RefObject<SessionManager>;

  sendMessageRef: RefObject<
    (
      content: string,
      attachments?: PendingFollowUp['attachments'],
      levelOverride?: string,
      replaceTurnId?: string,
    ) => Promise<void>
  >;

  shouldApplyStreamUpdate: (streamSessionKey: string) => boolean;
  fq: ChatFollowUpClarifyApi;

  applyLoadedSessionSnapshot: (
    chatId: string,
    data: { messages: Message[]; hasMore: boolean; name?: string },
  ) => void;
  loadSessionById: (key: string, offset?: number) => Promise<Message[] | undefined>;
  createNewSession: (opts?: { forceNew?: boolean; projectId?: string | null }) => Promise<void>;
  pollSessionNameAfterTurn: () => void;
}) {
  const {
    sessionKey,
    taskId,
    thinkingLevel,
    modelSupportsThinking,
    sessionKeyRef,
    sendingRef,
    streamingRef,
    sessionMgrRef,
    sendMessageRef,
    shouldApplyStreamUpdate,
    fq,
    applyLoadedSessionSnapshot,
    loadSessionById,
    createNewSession,
    pollSessionNameAfterTurn,
  } = deps;

  const store = () => useChatSessionStore.getState();
  const setShellError = (msg: string) => store().setShellError(msg);
  const clearShellError = () => store().setShellError(null);

  const finalizeMessage = useCallback(
    () => {
      const cacheKey = chatRunManager.activeStreamSessionKey ?? sessionKeyRef.current;
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
        finalMsg = cloneMessageForRender(msg);
      }
      if (finalMsg && hasRenderableAssistantContent(finalMsg) && cacheKey) {
        store().finalizeStreamingTurn(cacheKey, finalMsg);
      } else if (cacheKey) {
        store().clearStreamingState(cacheKey);
      }
      sendingRef.current = false;
      streamingRef.current = false;
      chatRunManager.resetRunTracking();
      fq.dismissClarify();
      void pollSessionNameAfterTurn();
      const syncKey = sessionKeyRef.current;
      if (syncKey) {
        window.setTimeout(() => {
          if (sessionKeyRef.current !== syncKey) return;
          if (sendingRef.current || streamingRef.current) return;
          void loadSessionById(syncKey, 0);
        }, 400);
      }
    },
    [
      sendingRef,
      streamingRef,
      sessionKeyRef,
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
      if (chatRunManager.isStreamingFor(chatId)) return;
      if (chatRunManager.isSending) return;

      const runId = await resolveResumeRunId(chatId);
      if (!runId) return;
      if (chatRunManager.activeResumeRunId === runId) return;

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

      chatRunManager.userAborted = false;
      chatRunManager.activeResumeRunId = runId;
      chatRunManager.activeStreamSessionKey = chatId;
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
        if (prev.length === 0) return;
        const last = prev[prev.length - 1];
        if (last?.role !== 'assistant') return;
        const extractedTail = cloneMessageForRender(last);
        const committedWithoutTail = prev.slice(0, -1);
        store().applyHydratedTail(chatId, committedWithoutTail, extractedTail);
      };

      const clearFailedResumeState = () => {
        store().clearStreamingState(chatId);
        if (chatRunManager.activeResumeRunId === runId) {
          chatRunManager.activeResumeRunId = null;
        }
        if (!shouldApplyStreamUpdate(chatId)) {
          chatRunManager.clearActiveStreamSessionKey(chatId);
          return;
        }
        sendingRef.current = false;
        streamingRef.current = false;
        chatRunManager.clearActiveStreamSessionKey(chatId);
      };

      try {
        const resumeStreamCallbacks = createAgentStreamMessagingCallbacks({
          chatId,
          shouldApplyStreamUpdate,
          beforeAssistantDelta: hydrateResumeTailAssistant,
          setStreamingOnStreamStart: false,
          clearResumeRunIdOnBackgroundTerminal: true,
          clearResumeRunIdOnVisibleError: true,
          setError: setShellError,
          sessionMgrRef,
          applyLoadedSessionSnapshot,
          finalizeMessage,
          fq,
        });

        const resumed = await chatRunManager.sender.resume(runId, chatId, resumeStreamCallbacks);
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
    async (content: string, attachments?: WireAttachment[], levelOverride?: string) => {
      if (!content.trim() && !attachments?.length) return;
      if (!sendingRef.current && !streamingRef.current && !chatRunManager.isSending) {
        return;
      }
      const trimmed = content.trim();
      if (trimmed === '/new' && !attachments?.length) {
        if (taskId) {
          setShellError('A task has one continuous conversation.');
          return;
        }
        await createNewSession({ forceNew: true });
        return;
      }
      const key = sessionKeyRef.current;
      if (!key) return;
      fq.dismissClarifyAndClearPending();
      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      chatRunManager.userAborted = true;
      chatRunManager.resetRunTracking();
      chatRunManager.abort();
      sendingRef.current = false;
      streamingRef.current = false;
      finalizeMessage();
      queueMicrotask(() => {
        void sendMessageRef.current(content, attachments, effectiveThinking);
      });
    },
    [
      sendingRef,
      streamingRef,
      sessionKeyRef,
      fq.dismissClarifyAndClearPending,
      modelSupportsThinking,
      thinkingLevel,
      finalizeMessage,
      sendMessageRef,
      createNewSession,
    ],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: WireAttachment[],
      levelOverride?: string,
      replaceTurnId?: string,
    ) => {
      if (!sessionKey) return;
      if (!shouldApplyStreamUpdate(sessionKey)) return;
      if (
        (!content.trim() && !attachments?.length) ||
        (chatRunManager.activeStreamSessionKey === sessionKey &&
          (sendingRef.current || streamingRef.current))
      ) {
        return;
      }

      const trimmed = content.trim();
      if (trimmed === '/new' && !attachments?.length) {
        if (taskId) {
          setShellError('A task has one continuous conversation.');
          return;
        }
        await createNewSession({ forceNew: true });
        return;
      }

      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      const chatId = sessionKey;
      const currentMessages = getSessionMessages(chatId);
      const replaceIndex = replaceTurnId
        ? currentMessages.findIndex(
            (message) => message.role === 'user' && message.turnId === replaceTurnId,
          )
        : -1;
      if (replaceTurnId && replaceIndex < 0) return;
      chatRunManager.userAborted = false;
      chatRunManager.activeStreamSessionKey = chatId;
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
          attachments,
          timestamp: Date.now(),
        },
      ] as Message[];

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

      try {
        await sessionMgrRef.current.ensureSessionExists(chatId);

        const sendStreamCallbacks = createAgentStreamMessagingCallbacks({
          chatId,
          shouldApplyStreamUpdate,
          beforeAssistantDelta: () => {},
          setStreamingOnStreamStart: true,
          clearResumeRunIdOnBackgroundTerminal: false,
          clearResumeRunIdOnVisibleError: false,
          setError: setShellError,
          sessionMgrRef,
          applyLoadedSessionSnapshot,
          finalizeMessage,
          fq,
        });

        await chatRunManager.sender.send(
          content,
          chatId,
          attachments,
          effectiveThinking,
          sendStreamCallbacks,
          taskId,
          replaceTurnId,
        );
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          store().clearStreamingState(chatId);
          clearChatRunPresence(chatId);
          setShellError(JSON.stringify(buildSendFailedErrorPayload()));
          if (replaceTurnId) void loadSessionById(chatId, 0);
        } else {
          clearChatRunPresence(chatId);
        }
      } finally {
        sendingRef.current = false;
        streamingRef.current = false;
        store().setSessionFlags(chatId, { sending: false });
        chatRunManager.clearActiveStreamSessionKey(chatId);
      }
    },
    [
      sessionKey,
      thinkingLevel,
      modelSupportsThinking,
      sendingRef,
      streamingRef,
      shouldApplyStreamUpdate,
      sessionMgrRef,
      applyLoadedSessionSnapshot,
      finalizeMessage,
      fq.dismissClarify,
      createNewSession,
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
    ) => sendMessage(content, attachments, levelOverride, turnId),
    [sendMessage],
  );

  const abort = useCallback(() => {
    chatRunManager.userAborted = true;
    chatRunManager.resetRunTracking();
    fq.dismissClarifyAndClearPending();
    chatRunManager.abort();
    const key = sessionKeyRef.current;
    if (key) clearChatRunPresence(key);
    sendingRef.current = false;
    streamingRef.current = false;
    finalizeMessage();
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
    sessionKeyRef,
    loadSessionById,
  ]);

  const deleteMessageRound = useCallback(
    (messageIndex: number) => {
      const key = sessionKeyRef.current;
      if (!key) return;
      if (sendingRef.current || streamingRef.current) return;

      const messages = getSessionMessages(key);
      const msg = messages[messageIndex];
      if (!msg || !isUiUserMessage(msg.role)) return;

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
    [sessionKeyRef, sendingRef, streamingRef, sessionMgrRef, loadSessionById],
  );

  const retryUserMessageRound = useCallback(
    (messageIndex: number) => {
      const key = sessionKeyRef.current;
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
      if (!text.trim() && !wireAtt?.length) return;

      if (!msg.turnId) return;
      void sendMessageRef.current(text, wireAtt, undefined, msg.turnId).catch(() => {
        void loadSessionById(key, 0);
      });
    },
    [sessionKeyRef, sendingRef, streamingRef, loadSessionById, sendMessageRef],
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
