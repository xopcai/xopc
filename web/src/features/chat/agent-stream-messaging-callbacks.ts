import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import {
  clearLiveSessionCache,
  getLiveSessionCache,
  liveSessionCacheMutateStreaming,
  liveSessionCacheSetFlags,
  liveSessionCacheSetProgress,
} from '@/features/chat/active-session-live-cache';
import type { MessagingCallbacks } from '@/features/chat/message-sender';
import type { Message, ProgressState } from '@/features/chat/messages.types';
import type { SessionManager } from '@/features/chat/session-manager';
import {
  appendThinkingDelta,
  appendTextDelta,
  appendToolStart,
  completeTool,
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
    clearLiveSessionCache(chatId);
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

  const applyStreamingToReact = () => {
    const snap = getLiveSessionCache(chatId);
    const bubble = snap?.streamingMsg;
    if (!bubble) return;
    setStreamingMsg(bubble);
  };

  return {
    onStreamStart: () => {
      beforeAssistantDelta();
      liveSessionCacheMutateStreaming(chatId, () => {});
      liveSessionCacheSetFlags(chatId, { streaming: true });
      if (!shouldApplyStreamUpdate(chatId)) return;
      if (setStreamingOnStreamStart) {
        setStreaming(true);
      }
      applyStreamingToReact();
      setStreaming(true);
    },
    onToken: (delta) => {
      beforeAssistantDelta();
      liveSessionCacheMutateStreaming(chatId, (msg) => {
        appendTextDelta(msg.content, delta);
      });
      if (!shouldApplyStreamUpdate(chatId)) return;
      applyStreamingToReact();
      setStreaming(true);
    },
    onThinking: (c, isDelta) => {
      beforeAssistantDelta();
      liveSessionCacheMutateStreaming(chatId, (msg) => {
        if (!isDelta && c === '') startThinkingSegment(msg.content);
        else appendThinkingDelta(msg.content, c, isDelta);
      });
      if (!shouldApplyStreamUpdate(chatId)) return;
      applyStreamingToReact();
    },
    onThinkingEnd: () => {
      beforeAssistantDelta();
      liveSessionCacheMutateStreaming(chatId, (msg) => {
        finalizeStreamingThinking(msg.content);
      });
      if (!shouldApplyStreamUpdate(chatId)) return;
      applyStreamingToReact();
    },
    onToolStart: (toolName, args) => {
      beforeAssistantDelta();
      liveSessionCacheMutateStreaming(chatId, (msg) => {
        appendToolStart(msg.content, toolName, args);
      });
      if (!shouldApplyStreamUpdate(chatId)) return;
      applyStreamingToReact();
      setStreaming(true);
    },
    onToolEnd: (toolName, isErr, result) => {
      if (toolName === 'clarify') {
        fq.onClarifyToolEnd();
      }
      beforeAssistantDelta();
      liveSessionCacheMutateStreaming(chatId, (msg) => {
        completeTool(msg.content, toolName, isErr, result);
      });
      if (!shouldApplyStreamUpdate(chatId)) return;
      applyStreamingToReact();
    },
    onProgress: (p) => {
      liveSessionCacheSetProgress(chatId, p);
      if (!shouldApplyStreamUpdate(chatId)) return;
      setProgress(p);
    },
    onTtsAudio: (p) => {
      beforeAssistantDelta();
      liveSessionCacheMutateStreaming(chatId, (msg) => {
        const rel = p.workspaceRelativePath?.replace(/\\/g, '/').trim();
        const existing = msg.attachments ?? [];
        if (rel && existing.some((a) => a.workspaceRelativePath?.replace(/\\/g, '/').trim() === rel)) {
          return;
        }
        const nextAtt = {
          name: p.name,
          mimeType: p.mimeType,
          type: 'voice' as const,
          workspaceRelativePath: p.workspaceRelativePath,
          size: 0,
        };
        msg.attachments = [...existing, nextAtt];
      });
      if (!shouldApplyStreamUpdate(chatId)) return;
      applyStreamingToReact();
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
      clearLiveSessionCache(chatId);
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
