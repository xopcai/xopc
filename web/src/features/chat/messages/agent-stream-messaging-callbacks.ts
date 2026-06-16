import type { CompactionState, MessagingCallbacks } from '@/features/chat/messages/message-sender';
import type { Message } from '@/features/chat/messages/messages.types';
import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import {
  getChatSessionSnapshot,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';
import type { SessionManager } from '@/features/chat/session/session-manager';
import {
  appendThinkingDelta,
  appendTextDelta,
  appendToolStart,
  completeTool,
  finalizeStreamingThinking,
  startThinkingSegment,
  updateToolDetails,
} from '@/features/chat/messages/streaming';

export type AgentStreamFqCallbacks = {
  dismissClarifyForSession: (chatId: string) => void;
  clearVisibleClarify: () => void;
  makeOnClarifyRequest: (chatId: string) => MessagingCallbacks['onClarifyRequest'];
  onClarifyToolEnd: (chatId: string) => void;
};

/**
 * Shared SSE handlers for {@link MessageSender.send} and {@link MessageSender.resume}.
 * Stream UI updates go to {@link useChatSessionStore} only; focused view subscribes via Zustand.
 */
export function createAgentStreamMessagingCallbacks(opts: {
  chatId: string;
  shouldApplyStreamUpdate: (streamSessionKey: string) => boolean;
  beforeAssistantDelta: () => void;
  setStreamingOnStreamStart: boolean;
  clearResumeRunIdOnBackgroundTerminal: boolean;
  clearResumeRunIdOnVisibleError: boolean;

  setError: (msg: string) => void;

  sessionMgrRef: { current: SessionManager };
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
    setStreamingOnStreamStart: _setStreamingOnStreamStart,
    clearResumeRunIdOnBackgroundTerminal,
    clearResumeRunIdOnVisibleError,
    setError,
    sessionMgrRef,
    applyLoadedSessionSnapshot,
    finalizeMessage,
    fq,
  } = opts;

  const store = () => useChatSessionStore.getState();

  const reloadSessionSnapshot = () => {
    void sessionMgrRef.current
      .loadSession(chatId, 0)
      .then((data) => applyLoadedSessionSnapshot(chatId, data))
      .catch(() => {});
  };

  const onBackgroundTerminal = () => {
    store().clearStreamingState(chatId);
    chatRunManager.clearActiveStreamSessionKey(chatId);
    if (clearResumeRunIdOnBackgroundTerminal) {
      chatRunManager.activeResumeRunId = null;
    }
    store().setSessionFlags(chatId, { sending: false, streaming: false });
    store().setSessionProgress(chatId, null);
    fq.dismissClarifyForSession(chatId);
    reloadSessionSnapshot();
  };

  return {
    onUserMessage: (message) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      store().appendUserMessageIfMissing(chatId, message);
    },
    onStreamStart: () => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, () => {});
      store().setSessionFlags(chatId, { streaming: true });
    },
    onToken: (delta) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        appendTextDelta(msg.content, delta);
      });
      if (shouldApplyStreamUpdate(chatId)) {
        store().setSessionFlags(chatId, { streaming: true });
      }
    },
    onThinking: (c, isDelta) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        if (!isDelta && c === '') startThinkingSegment(msg.content);
        else appendThinkingDelta(msg.content, c, isDelta);
      });
    },
    onThinkingEnd: () => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        finalizeStreamingThinking(msg.content);
      });
    },
    onToolStart: (toolName, args, toolCallId) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        appendToolStart(msg.content, toolName, args, toolCallId);
      });
      store().setSessionFlags(chatId, { streaming: true });
    },
    onToolEnd: (toolName, isErr, result) => {
      if (toolName === 'clarify') {
        fq.onClarifyToolEnd(chatId);
      }
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        completeTool(msg.content, toolName, isErr, result);
      });
    },
    onToolUpdate: (toolName, toolCallId, details) => {
      // Mid-run structured update — currently only the `workflow` tool emits
      // these; the WorkflowCard reads `block.details` first and falls back to
      // `block.result` once `tool_end` arrives.
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        updateToolDetails(msg.content, toolName, toolCallId, details);
      });
    },
    onProgress: (p) => {
      store().setSessionProgress(chatId, p);
    },
    onTtsAudio: (p) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        const uri = p.uri?.trim();
        const existing = msg.attachments ?? [];
        if (uri && existing.some((a) => a.uri?.trim() === uri)) {
          return;
        }
        const nextAtt = {
          name: p.name,
          mimeType: p.mimeType,
          type: 'voice' as const,
          uri: p.uri,
          size: 0,
        };
        msg.attachments = [...existing, nextAtt];
      });
    },
    onCompaction: (state: CompactionState) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      if (state.status === 'started') {
        store().setSessionProgress(chatId, {
          stage: 'compaction',
          message: 'Compacting context…',
          timestamp: Date.now(),
        });
      } else if (state.status === 'completed') {
        const saved =
          state.tokensBefore && state.tokensAfter
            ? ` (${Math.round((state.tokensBefore - state.tokensAfter) / 1000)}k tokens freed)`
            : '';
        store().setSessionProgress(chatId, {
          stage: 'compaction',
          message: `Context compacted${saved}`,
          timestamp: Date.now(),
        });
      } else {
        store().setSessionProgress(chatId, null);
      }
    },
    onClarifyRequest: fq.makeOnClarifyRequest(chatId),
    onResult: () => {
      if (!shouldApplyStreamUpdate(chatId)) {
        onBackgroundTerminal();
        return;
      }
      if (chatRunManager.userAborted) {
        chatRunManager.userAborted = false;
        return;
      }
      finalizeMessage();
    },
    onError: (msg) => {
      if (!shouldApplyStreamUpdate(chatId)) {
        onBackgroundTerminal();
        return;
      }
      store().clearStreamingState(chatId);
      if (clearResumeRunIdOnVisibleError) {
        chatRunManager.activeResumeRunId = null;
      }
      store().setSessionFlags(chatId, { sending: false, streaming: false });
      store().setSessionProgress(chatId, null);
      setError(msg);
      fq.dismissClarifyForSession(chatId);
    },
  };
}

/** Read streaming bubble from store (for finalize / tests). */
export function readStreamingBubbleFromStore(chatId: string): Message | null {
  return getChatSessionSnapshot(chatId)?.streamingMsg ?? null;
}
