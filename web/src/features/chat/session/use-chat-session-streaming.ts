import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

import {
  clearLiveSessionCache,
  getLiveSessionCache,
  initLiveSessionCache,
  liveSessionCacheApplyHydratedTail,
  seedLiveSessionCacheIfEmpty,
} from '@/features/chat/session/active-session-live-cache';
import { mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import { createAgentStreamMessagingCallbacks } from '@/features/chat/messages/agent-stream-messaging-callbacks';
import type { WireAttachment } from '@/features/chat/composer/composer.types';
import type { Message, ProgressState } from '@/features/chat/messages/messages.types';
import { extractUserMessagePlainText, messageAttachmentsToWire } from '@/features/chat/messages/user-message-plain-text';
import {
  isUiUserMessage,
  uiDeleteCountForUserRound,
  userRoundIndexFromUiMessageIndex,
} from '@/features/chat/messages/user-round-index';
import { pendingAgentRunStorageKey, MessageSender } from '@/features/chat/messages/message-sender';
import {
  FOLLOW_UP_AUTO_SEND_IDLE_MS,
  type PendingFollowUp,
} from '@/features/chat/follow-up/pending-follow-up.types';
import type { SessionManager } from '@/features/chat/session/session-manager';
import {
  cloneMessageForRender,
  ensureAssistantMessage,
  finalizeRunningTools,
  finalizeStreamingThinking,
  hasRenderableAssistantContent,
} from '@/features/chat/messages/streaming';
import type { ChatFollowUpClarifyApi } from '@/features/chat/session/use-chat-follow-up-clarify';

export function useChatSessionStreaming(deps: {
  sessionKey: string | null;
  thinkingLevel: string;
  modelSupportsThinking: boolean;

  sessionKeyRef: RefObject<string | null>;
  sendingRef: RefObject<boolean>;
  streamingRef: RefObject<boolean>;
  activeStreamSessionKeyRef: RefObject<string | null>;
  activeResumeRunIdRef: RefObject<string | null>;
  userAbortedRef: RefObject<boolean>;
  senderRef: RefObject<MessageSender>;
  sessionMgrRef: RefObject<SessionManager>;

  sendMessageRef: RefObject<
    (content: string, attachments?: PendingFollowUp['attachments'], levelOverride?: string) => Promise<void>
  >;

  setMessages: Dispatch<SetStateAction<Message[]>>;
  setStreamingMsg: Dispatch<SetStateAction<Message | null>>;
  setStreaming: Dispatch<SetStateAction<boolean>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setProgress: Dispatch<SetStateAction<ProgressState | null>>;
  setError: Dispatch<SetStateAction<string | null>>;

  shouldApplyStreamUpdate: (streamSessionKey: string) => boolean;
  fq: ChatFollowUpClarifyApi;

  applyLoadedSessionSnapshot: (
    chatId: string,
    data: { messages: Message[]; hasMore: boolean; name?: string },
  ) => void;
  loadSessionById: (key: string, offset?: number) => Promise<Message[] | undefined>;
  createNewSession: () => Promise<void>;
  pollSessionNameAfterTurn: () => void;
  /** Latest committed messages (synced each render) for resume cache seeding. */
  latestMessagesRef: RefObject<Message[]>;
  /** In-progress assistant bubble (synced each render) for synchronous finalize. */
  streamingMsgRef: RefObject<Message | null>;
}) {
  const {
    sessionKey,
    thinkingLevel,
    modelSupportsThinking,
    sessionKeyRef,
    sendingRef,
    streamingRef,
    activeStreamSessionKeyRef,
    activeResumeRunIdRef,
    userAbortedRef,
    senderRef,
    sessionMgrRef,
    sendMessageRef,
    setMessages,
    setStreamingMsg,
    setStreaming,
    setSending,
    setProgress,
    setError,
    shouldApplyStreamUpdate,
    fq,
    applyLoadedSessionSnapshot,
    loadSessionById,
    createNewSession,
    pollSessionNameAfterTurn,
    latestMessagesRef,
    streamingMsgRef,
  } = deps;

  const flushSteeringQueueRef = useRef(fq.flushSteeringQueue);
  flushSteeringQueueRef.current = fq.flushSteeringQueue;

  const finalizeMessage = useCallback(
    (opts?: { skipSteeringQueueFlush?: boolean }) => {
      const cacheKey = activeStreamSessionKeyRef.current ?? sessionKeyRef.current;
      const cachedBubble = cacheKey ? (getLiveSessionCache(cacheKey)?.streamingMsg ?? null) : null;
      const bubbleSource = cachedBubble ?? streamingMsgRef.current;
      let finalMsg: Message | null = null;
      if (bubbleSource) {
        const msg = ensureAssistantMessage(bubbleSource, Date.now());
        finalizeStreamingThinking(msg.content);
        finalizeRunningTools(msg.content);
        finalMsg = cloneMessageForRender(msg);
      }
      setStreamingMsg(null);
      if (finalMsg && hasRenderableAssistantContent(finalMsg)) {
        const prior = latestMessagesRef.current ?? [];
        setMessages(mergeConsecutiveAssistantMessages([...prior, finalMsg]));
      }
      setStreaming(false);
      setProgress(null);
      setSending(false);
      sendingRef.current = false;
      streamingRef.current = false;
      activeStreamSessionKeyRef.current = null;
      activeResumeRunIdRef.current = null;
      fq.dismissClarify();
      void pollSessionNameAfterTurn();
      if (!opts?.skipSteeringQueueFlush) {
        const flushFor = cacheKey ?? sessionKeyRef.current;
        if (flushFor) {
          window.setTimeout(() => {
            void flushSteeringQueueRef.current(flushFor);
          }, FOLLOW_UP_AUTO_SEND_IDLE_MS);
        }
      }
      /** Persisted transcript includes `thinking` blocks the SSE path may omit (e.g. `reasoningLevel: off` strips thinking events). Re-sync from gateway so history matches server JSON. */
      const syncKey = sessionKeyRef.current;
      if (syncKey) {
        window.setTimeout(() => {
          if (sessionKeyRef.current !== syncKey) return;
          if (sendingRef.current || streamingRef.current) return;
          if (fq.pendingFollowUpsRef.current.length > 0) return;
          void loadSessionById(syncKey, 0);
        }, 400);
      }
      if (cacheKey) clearLiveSessionCache(cacheKey);
    },
    [
      setStreamingMsg,
      setMessages,
      setStreaming,
      setProgress,
      setSending,
      sendingRef,
      streamingRef,
      activeStreamSessionKeyRef,
      activeResumeRunIdRef,
      sessionKeyRef,
      fq.dismissClarify,
      fq.pendingFollowUpsRef,
      pollSessionNameAfterTurn,
      loadSessionById,
      streamingMsgRef,
    ],
  );

  const tryResumeAgentRun = useCallback(
    async (chatId: string, loadedMessages?: Message[]) => {
      const sender = senderRef.current;
      if (sender.isSending) {
        return;
      }
      let stored: { runId: string } | null = null;
      try {
        const raw = sessionStorage.getItem(pendingAgentRunStorageKey(chatId));
        if (raw) stored = JSON.parse(raw) as { runId: string };
      } catch {
        /* ignore */
      }
      if (!stored?.runId) return;
      if (activeResumeRunIdRef.current === stored.runId) return;

      userAbortedRef.current = false;
      activeResumeRunIdRef.current = stored.runId;
      activeStreamSessionKeyRef.current = chatId;
      sendingRef.current = true;
      streamingRef.current = true;
      setSending(true);
      setStreaming(true);
      setProgress(null);
      seedLiveSessionCacheIfEmpty(
        chatId,
        loadedMessages ?? latestMessagesRef.current ?? [],
        true,
        true,
      );
      let hydratedResumeTail = false;
      const hydrateResumeTailAssistant = () => {
        if (hydratedResumeTail) return;
        hydratedResumeTail = true;
        let extractedTail: Message | null = null;
        let committedWithoutTail: Message[] = [];
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last?.role !== 'assistant') return prev;
          extractedTail = cloneMessageForRender(last);
          committedWithoutTail = prev.slice(0, -1);
          return committedWithoutTail;
        });
        if (extractedTail) {
          setStreamingMsg((prev) => prev ?? extractedTail);
          liveSessionCacheApplyHydratedTail(chatId, committedWithoutTail, extractedTail);
        }
      };

      try {
        const resumeStreamCallbacks = createAgentStreamMessagingCallbacks({
          chatId,
          shouldApplyStreamUpdate,
          beforeAssistantDelta: hydrateResumeTailAssistant,
          setStreamingOnStreamStart: false,
          clearResumeRunIdOnBackgroundTerminal: true,
          clearResumeRunIdOnVisibleError: true,
          setStreaming,
          setStreamingMsg,
          setProgress,
          setSending,
          setError,
          userAbortedRef,
          activeStreamSessionKeyRef,
          activeResumeRunIdRef,
          sendingRef,
          streamingRef,
          sessionMgrRef,
          applyLoadedSessionSnapshot,
          finalizeMessage,
          fq,
        });

        await sender.resume(stored.runId, chatId, resumeStreamCallbacks);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[chat] resume failed:', err);
        }
        clearLiveSessionCache(chatId);
        activeResumeRunIdRef.current = null;
        sendingRef.current = false;
        streamingRef.current = false;
        setStreaming(false);
        setSending(false);
        setStreamingMsg(null);
        setProgress(null);
        if (activeStreamSessionKeyRef.current === chatId) {
          activeStreamSessionKeyRef.current = null;
        }
      }
    },
    [
      senderRef,
      activeResumeRunIdRef,
      userAbortedRef,
      activeStreamSessionKeyRef,
      sendingRef,
      streamingRef,
      setSending,
      setStreaming,
      setProgress,
      setMessages,
      setStreamingMsg,
      setError,
      shouldApplyStreamUpdate,
      sessionMgrRef,
      applyLoadedSessionSnapshot,
      finalizeMessage,
      fq.dismissClarify,
      fq.makeOnClarifyRequest,
      fq.onClarifyToolEnd,
      latestMessagesRef,
    ],
  );

  const interruptAndSend = useCallback(
    async (content: string, attachments?: WireAttachment[], levelOverride?: string) => {
      if (!content.trim() && !attachments?.length) return;
      if (!sendingRef.current && !streamingRef.current && !senderRef.current.isSending) {
        return;
      }
      const trimmed = content.trim();
      if (trimmed === '/new' && !attachments?.length) {
        await createNewSession();
        return;
      }
      const key = sessionKeyRef.current;
      if (!key) return;
      fq.dismissClarifyAndClearPending();
      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      userAbortedRef.current = true;
      activeResumeRunIdRef.current = null;
      activeStreamSessionKeyRef.current = null;
      senderRef.current.abort();
      sendingRef.current = false;
      streamingRef.current = false;
      finalizeMessage({ skipSteeringQueueFlush: true });
      setProgress(null);
      queueMicrotask(() => {
        void sendMessageRef.current(content, attachments, effectiveThinking);
      });
    },
    [
      sendingRef,
      streamingRef,
      senderRef,
      sessionKeyRef,
      fq.dismissClarifyAndClearPending,
      modelSupportsThinking,
      thinkingLevel,
      userAbortedRef,
      activeResumeRunIdRef,
      activeStreamSessionKeyRef,
      finalizeMessage,
      setProgress,
      sendMessageRef,
      createNewSession,
    ],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: WireAttachment[],
      levelOverride?: string,
    ) => {
      if (!sessionKey) {
        return;
      }
      if (
        (!content.trim() && !attachments?.length) ||
        (activeStreamSessionKeyRef.current === sessionKey && (sendingRef.current || streamingRef.current))
      ) {
        return;
      }

      const trimmed = content.trim();
      if (trimmed === '/new' && !attachments?.length) {
        await createNewSession();
        return;
      }

      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';

      const sender = senderRef.current;
      const chatId = sessionKey;
      userAbortedRef.current = false;
      activeStreamSessionKeyRef.current = chatId;
      sendingRef.current = true;
      setSending(true);
      setError(null);
      fq.dismissClarify();
      setMessages((m) => {
        const next = [
          ...m,
          {
            role: 'user',
            content: content ? [{ type: 'text', text: content }] : [],
            attachments,
            timestamp: Date.now(),
          },
        ] as Message[];
        initLiveSessionCache(chatId, {
          messages: next,
          streamingMsg: null,
          progress: null,
          sending: true,
          streaming: false,
        });
        return next;
      });

      try {
        const sendStreamCallbacks = createAgentStreamMessagingCallbacks({
          chatId,
          shouldApplyStreamUpdate,
          beforeAssistantDelta: () => {},
          setStreamingOnStreamStart: true,
          clearResumeRunIdOnBackgroundTerminal: false,
          clearResumeRunIdOnVisibleError: false,
          setStreaming,
          setStreamingMsg,
          setProgress,
          setSending,
          setError,
          userAbortedRef,
          activeStreamSessionKeyRef,
          activeResumeRunIdRef,
          sendingRef,
          streamingRef,
          sessionMgrRef,
          applyLoadedSessionSnapshot,
          finalizeMessage,
          fq,
        });

        await sender.send(content, chatId, attachments, effectiveThinking, sendStreamCallbacks);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          clearLiveSessionCache(chatId);
          setError(err instanceof Error ? err.message : 'Send failed');
          setStreamingMsg(null);
          setStreaming(false);
        }
      } finally {
        sendingRef.current = false;
        streamingRef.current = false;
        setSending(false);
        if (activeStreamSessionKeyRef.current === chatId) {
          activeStreamSessionKeyRef.current = null;
        }
      }
    },
    [
      sessionKey,
      thinkingLevel,
      modelSupportsThinking,
      activeStreamSessionKeyRef,
      sendingRef,
      streamingRef,
      userAbortedRef,
      fq.dismissClarify,
      setSending,
      setError,
      setMessages,
      setStreaming,
      setStreamingMsg,
      setProgress,
      shouldApplyStreamUpdate,
      sessionMgrRef,
      applyLoadedSessionSnapshot,
      finalizeMessage,
      fq.dismissClarify,
      fq.makeOnClarifyRequest,
      fq.onClarifyToolEnd,
      createNewSession,
      latestMessagesRef,
    ],
  );

  const abort = useCallback(() => {
    userAbortedRef.current = true;
    activeResumeRunIdRef.current = null;
    activeStreamSessionKeyRef.current = null;
    fq.dismissClarifyAndClearPending();
    senderRef.current.abort();
    sendingRef.current = false;
    streamingRef.current = false;
    finalizeMessage({ skipSteeringQueueFlush: true });
    setProgress(null);
    const key = sessionKeyRef.current;
    if (key) {
      window.setTimeout(() => {
        void loadSessionById(key, 0);
      }, 300);
    }
  }, [
    userAbortedRef,
    activeResumeRunIdRef,
    activeStreamSessionKeyRef,
    fq.dismissClarifyAndClearPending,
    senderRef,
    sendingRef,
    streamingRef,
    finalizeMessage,
    setProgress,
    sessionKeyRef,
    loadSessionById,
  ]);

  const deleteMessageRound = useCallback(
    (messageIndex: number) => {
      const key = sessionKeyRef.current;
      if (!key) return;
      if (sendingRef.current || streamingRef.current) return;

      setMessages((prev) => {
        const msg = prev[messageIndex];
        if (!msg || !isUiUserMessage(msg.role)) return prev;

        const userRoundIndex = userRoundIndexFromUiMessageIndex(prev, messageIndex);
        if (userRoundIndex === null) return prev;

        const deleteCount = uiDeleteCountForUserRound(prev, messageIndex);
        const updated = [...prev];
        updated.splice(messageIndex, deleteCount);

        void sessionMgrRef.current.deleteMessages(key, { userRoundIndex }).catch(() => {
          void loadSessionById(key, 0);
        });

        return updated;
      });
    },
    [sessionKeyRef, sendingRef, streamingRef, setMessages, sessionMgrRef, loadSessionById],
  );

  const retryUserMessageRound = useCallback(
    (messageIndex: number) => {
      const key = sessionKeyRef.current;
      if (!key) return;
      if (sendingRef.current || streamingRef.current) return;

      setMessages((prev) => {
        const msg = prev[messageIndex];
        if (!msg || !isUiUserMessage(msg.role)) return prev;
        for (let j = messageIndex + 1; j < prev.length; j++) {
          const nextMsg = prev[j];
          if (nextMsg && isUiUserMessage(nextMsg.role)) return prev;
        }

        const text = extractUserMessagePlainText(msg.content);
        const wireAtt = messageAttachmentsToWire(msg.attachments);
        if (!text.trim() && !wireAtt?.length) return prev;

        const userRoundIndex = userRoundIndexFromUiMessageIndex(prev, messageIndex);
        if (userRoundIndex === null) return prev;

        const deleteCount = uiDeleteCountForUserRound(prev, messageIndex);
        const updated = [...prev];
        updated.splice(messageIndex, deleteCount);

        void (async () => {
          try {
            await sessionMgrRef.current.deleteMessages(key, { userRoundIndex });
            await sendMessageRef.current(text, wireAtt);
          } catch {
            void loadSessionById(key, 0);
          }
        })();

        return updated;
      });
    },
    [sessionKeyRef, sendingRef, streamingRef, setMessages, sessionMgrRef, loadSessionById, sendMessageRef],
  );

  return {
    finalizeMessage,
    tryResumeAgentRun,
    sendMessage,
    interruptAndSend,
    abort,
    deleteMessageRound,
    retryUserMessageRound,
  };
}
