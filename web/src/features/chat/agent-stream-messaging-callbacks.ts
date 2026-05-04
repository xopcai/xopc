import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { MessagingCallbacks } from '@/features/chat/message-sender';
import type { Message, ProgressState } from '@/features/chat/messages.types';
import type { SessionManager } from '@/features/chat/session-manager';
import {
  appendThinkingDelta,
  appendTextDelta,
  appendToolStart,
  cloneMessageForRender,
  completeTool,
  ensureAssistantMessage,
  finalizeStreamingThinking,
  startThinkingSegment,
} from '@/features/chat/streaming';

export type AgentStreamFqCallbacks = {
  dismissClarify: () => void;
  makeOnClarifyRequest: (chatId: string) => MessagingCallbacks['onClarifyRequest'];
  onClarifyToolEnd: () => void;
};

/**
 * Shared SSE handlers for {@link MessageSender.send} and {@link MessageSender.resume}.
 * Resume passes `beforeAssistantDelta` (hydrate tail) and resume-specific ref clears.
 */
export function createAgentStreamMessagingCallbacks(opts: {
  chatId: string;
  shouldApplyStreamUpdate: (streamSessionKey: string) => boolean;
  /** No-op for fresh sends; resume hydrates the last assistant row into the streaming bubble first. */
  beforeAssistantDelta: () => void;
  /** Fresh send turns streaming on at first SSE; resume already set UI streaming before `resume()`. */
  setStreamingOnStreamStart: boolean;
  /** When the route no longer matches, resume clears stored run id; plain send does not. */
  clearResumeRunIdOnBackgroundTerminal: boolean;
  clearResumeRunIdOnVisibleError: boolean;

  setStreaming: (v: boolean) => void;
  setStreamingMsg: Dispatch<SetStateAction<Message | null>>;
  setProgress: (v: ProgressState | null) => void;
  setSending: (v: boolean) => void;
  setError: (msg: string) => void;

  userAbortedRef: MutableRefObject<boolean>;
  activeStreamSessionKeyRef: MutableRefObject<string | null>;
  activeResumeRunIdRef: MutableRefObject<string | null>;
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;

  sessionMgrRef: MutableRefObject<SessionManager>;
  applyLoadedSessionSnapshot: (
    chatId: string,
    data: { messages: Message[]; hasMore: boolean; name?: string },
  ) => void;
  finalizeMessage: (opts?: { skipSteeringQueueFlush?: boolean }) => void;
  fq: AgentStreamFqCallbacks;
}): MessagingCallbacks {
  const {
    chatId,
    shouldApplyStreamUpdate,
    beforeAssistantDelta,
    setStreamingOnStreamStart,
    clearResumeRunIdOnBackgroundTerminal,
    clearResumeRunIdOnVisibleError,
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
  } = opts;

  const reloadSessionSnapshot = () => {
    void sessionMgrRef.current
      .loadSession(chatId, 0)
      .then((data) => applyLoadedSessionSnapshot(chatId, data))
      .catch(() => {});
  };

  const onBackgroundTerminal = () => {
    activeStreamSessionKeyRef.current = null;
    if (clearResumeRunIdOnBackgroundTerminal) {
      activeResumeRunIdRef.current = null;
    }
    sendingRef.current = false;
    streamingRef.current = false;
    setStreaming(false);
    setSending(false);
    setProgress(null);
    fq.dismissClarify();
    reloadSessionSnapshot();
  };

  return {
    onStreamStart: () => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      beforeAssistantDelta();
      if (setStreamingOnStreamStart) {
        setStreaming(true);
      }
      setStreamingMsg((prev) => cloneMessageForRender(ensureAssistantMessage(prev, Date.now())));
    },
    onToken: (delta) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      beforeAssistantDelta();
      setStreamingMsg((prev) => {
        const msg = ensureAssistantMessage(prev, Date.now());
        appendTextDelta(msg.content, delta);
        return cloneMessageForRender(msg);
      });
      setStreaming(true);
    },
    onThinking: (c, isDelta) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      beforeAssistantDelta();
      setStreamingMsg((prev) => {
        const msg = ensureAssistantMessage(prev, Date.now());
        if (!isDelta && c === '') startThinkingSegment(msg.content);
        else appendThinkingDelta(msg.content, c, isDelta);
        return cloneMessageForRender(msg);
      });
    },
    onThinkingEnd: () => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      beforeAssistantDelta();
      setStreamingMsg((prev) => {
        if (!prev) return prev;
        const msg = ensureAssistantMessage(prev, Date.now());
        finalizeStreamingThinking(msg.content);
        return cloneMessageForRender(msg);
      });
    },
    onToolStart: (toolName, args) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      beforeAssistantDelta();
      setStreamingMsg((prev) => {
        const msg = ensureAssistantMessage(prev, Date.now());
        appendToolStart(msg.content, toolName, args);
        return cloneMessageForRender(msg);
      });
      setStreaming(true);
    },
    onToolEnd: (toolName, isErr, result) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      if (toolName === 'clarify') {
        fq.onClarifyToolEnd();
      }
      beforeAssistantDelta();
      setStreamingMsg((prev) => {
        const msg = ensureAssistantMessage(prev, Date.now());
        completeTool(msg.content, toolName, isErr, result);
        return cloneMessageForRender(msg);
      });
    },
    onProgress: (p) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      setProgress(p);
    },
    onTtsAudio: (p) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      setStreamingMsg((prev) => {
        const msg = ensureAssistantMessage(prev, Date.now());
        const rel = p.workspaceRelativePath?.replace(/\\/g, '/').trim();
        const existing = msg.attachments ?? [];
        if (rel && existing.some((a) => a.workspaceRelativePath?.replace(/\\/g, '/').trim() === rel)) {
          return cloneMessageForRender(msg);
        }
        const nextAtt = {
          name: p.name,
          mimeType: p.mimeType,
          type: 'voice' as const,
          workspaceRelativePath: p.workspaceRelativePath,
          size: 0,
        };
        msg.attachments = [...existing, nextAtt];
        return cloneMessageForRender(msg);
      });
    },
    onClarifyRequest: fq.makeOnClarifyRequest(chatId),
    onResult: () => {
      if (!shouldApplyStreamUpdate(chatId)) {
        onBackgroundTerminal();
        return;
      }
      if (userAbortedRef.current) {
        userAbortedRef.current = false;
        return;
      }
      finalizeMessage();
    },
    onError: (msg) => {
      if (!shouldApplyStreamUpdate(chatId)) {
        onBackgroundTerminal();
        return;
      }
      if (clearResumeRunIdOnVisibleError) {
        activeResumeRunIdRef.current = null;
      }
      sendingRef.current = false;
      streamingRef.current = false;
      setError(msg);
      setStreamingMsg(null);
      setStreaming(false);
      setSending(false);
      setProgress(null);
      fq.dismissClarify();
    },
  };
}
