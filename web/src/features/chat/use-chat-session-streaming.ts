import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';

import { mergeConsecutiveAssistantMessages } from '@/features/chat/agent-messages';
import { createAgentStreamMessagingCallbacks } from '@/features/chat/agent-stream-messaging-callbacks';
import type { WireAttachment } from '@/features/chat/composer.types';
import type { Message, ProgressState } from '@/features/chat/messages.types';
import { pendingAgentRunStorageKey, MessageSender } from '@/features/chat/message-sender';
import type { PendingFollowUp } from '@/features/chat/pending-follow-up.types';
import type { SessionManager } from '@/features/chat/session-manager';
import {
  cloneMessageForRender,
  ensureAssistantMessage,
  finalizeRunningTools,
  finalizeStreamingThinking,
  hasRenderableAssistantContent,
} from '@/features/chat/streaming';
import type { ChatFollowUpClarifyApi } from '@/features/chat/use-chat-follow-up-clarify';

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
  loadSessionById: (key: string, offset?: number) => Promise<void>;
  createNewSession: () => Promise<void>;
  pollSessionNameAfterTurn: () => Promise<void>;
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
  } = deps;

  const finalizeMessage = useCallback(
    (opts?: { skipSteeringQueueFlush?: boolean }) => {
      let finalMsg: Message | null = null;
      flushSync(() => {
        setStreamingMsg((prev) => {
          if (!prev) return null;
          const msg = ensureAssistantMessage(prev, Date.now());
          finalizeStreamingThinking(msg.content);
          finalizeRunningTools(msg.content);
          finalMsg = cloneMessageForRender(msg);
          return null;
        });
      });
      const appended = finalMsg;
      if (appended && hasRenderableAssistantContent(appended)) {
        setMessages((m) => mergeConsecutiveAssistantMessages([...m, appended]));
        fq.refreshFollowUpSuggestions(appended);
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
        queueMicrotask(() => {
          fq.flushSteeringQueue();
        });
      }
      /** Persisted transcript includes `thinking` blocks the SSE path may omit (e.g. `reasoningLevel: off` strips thinking events). Re-sync from gateway so history matches server JSON. */
      const syncKey = sessionKeyRef.current;
      if (syncKey) {
        window.setTimeout(() => {
          if (sessionKeyRef.current !== syncKey) return;
          void loadSessionById(syncKey, 0);
        }, 400);
      }
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
      fq.refreshFollowUpSuggestions,
      fq.flushSteeringQueue,
      pollSessionNameAfterTurn,
      loadSessionById,
    ],
  );

  const tryResumeAgentRun = useCallback(
    async (chatId: string) => {
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
      let hydratedResumeTail = false;
      const hydrateResumeTailAssistant = () => {
        if (hydratedResumeTail) return;
        hydratedResumeTail = true;
        let extractedTail: Message | null = null;
        flushSync(() => {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last?.role !== 'assistant') return prev;
            extractedTail = cloneMessageForRender(last);
            return prev.slice(0, -1);
          });
          if (extractedTail) {
            setStreamingMsg((prev) => prev ?? extractedTail);
          }
        });
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
      fq,
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
      fq.clearFollowUpSuggestions();
      activeStreamSessionKeyRef.current = chatId;
      sendingRef.current = true;
      setSending(true);
      setError(null);
      fq.dismissClarify();
      setMessages((m) => [
        ...m,
        {
          role: 'user',
          content: content ? [{ type: 'text', text: content }] : [],
          attachments,
          timestamp: Date.now(),
        },
      ]);

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
      fq.clearFollowUpSuggestions,
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
      fq,
      createNewSession,
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
        if (!msg) return prev;
        const isUserMsg = msg.role === 'user' || msg.role === 'user-with-attachments';
        if (!isUserMsg) return prev;

        let deleteCount = 1;
        const next = prev[messageIndex + 1];
        if (next && next.role === 'assistant') {
          deleteCount = 2;
        }

        const updated = [...prev];
        updated.splice(messageIndex, deleteCount);

        void sessionMgrRef.current.deleteMessages(key, messageIndex, deleteCount).catch(() => {
          void loadSessionById(key, 0);
        });

        return updated;
      });
    },
    [sessionKeyRef, sendingRef, streamingRef, setMessages, sessionMgrRef, loadSessionById],
  );

  return {
    finalizeMessage,
    tryResumeAgentRun,
    sendMessage,
    interruptAndSend,
    abort,
    deleteMessageRound,
  };
}
