import type { AgentStreamRunStatus } from '@xopcai/gateway-contract';

import type { CompactionState, MessagingCallbacks } from '@/features/chat/messages/message-sender';
import type { Message } from '@/features/chat/messages/messages.types';
import { claimLatestUnassignedUserTurn } from '@/features/chat/messages/user-message-from-stream';
import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import {
  getChatSessionSnapshot,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';
import type { SessionManager } from '@/features/chat/session/session-manager';
import {
  clearChatRunPresence,
  markChatRunCompleted,
  markChatRunFailed,
  markChatRunRunning,
  markChatRunWaiting,
} from '@/features/chat/session/chat-run-presence-store';
import {
  appendThinkingDelta,
  appendReview,
  appendReviewDelta,
  appendTextDelta,
  appendToolStart,
  completeTool,
  finishTextSegment,
  finalizeStreamingThinking,
  startThinkingSegment,
  startReview,
  finishReview,
  updateToolDetails,
} from '@/features/chat/messages/streaming';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export type AgentStreamFqCallbacks = {
  dismissClarifyForSession: (chatId: string) => void;
  makeOnClarifyRequest: (chatId: string) => MessagingCallbacks['onClarifyRequest'];
};

export function shouldDismissClarificationForTerminal(status: AgentStreamRunStatus): boolean {
  return status !== 'suspended';
}

/**
 * Shared run-event handlers for {@link MessageSender.send} and {@link MessageSender.resume}.
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
  finalizeMessage: (sessionKey?: string, terminalStatus?: AgentStreamRunStatus) => void;
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

  const reloadSessionSnapshot = () => sessionMgrRef.current
      .loadSession(chatId, 0)
      .then((data) => applyLoadedSessionSnapshot(chatId, data))
      .catch(() => {});

  // Reviewer tokens can arrive much faster than a user can read them. Batch
  // them so the review card reads like a normal response instead of repainting
  // the whole streaming bubble for every token.
  const pendingReviewDeltas = new Map<string, string>();
  let reviewDeltaTimer: number | undefined;
  const flushReviewDeltas = () => {
    if (reviewDeltaTimer !== undefined) {
      window.clearTimeout(reviewDeltaTimer);
      reviewDeltaTimer = undefined;
    }
    if (pendingReviewDeltas.size === 0) return;
    const deltas = Array.from(pendingReviewDeltas.entries());
    pendingReviewDeltas.clear();
    beforeAssistantDelta();
    store().mutateSessionStreaming(chatId, (msg) => {
      for (const [reviewId, delta] of deltas) {
        appendReviewDelta(msg.content, reviewId, delta);
      }
    });
  };
  const enqueueReviewDelta = (reviewId: string, delta: string) => {
    pendingReviewDeltas.set(reviewId, `${pendingReviewDeltas.get(reviewId) ?? ''}${delta}`);
    if (reviewDeltaTimer === undefined) {
      reviewDeltaTimer = window.setTimeout(flushReviewDeltas, 120);
    }
  };

  const onBackgroundTerminal = (status: AgentStreamRunStatus) => {
    store().clearStreamingState(chatId);
    if (clearResumeRunIdOnBackgroundTerminal) {
      chatRunManager.setResumeRunId(chatId, null);
    }
    store().setSessionFlags(chatId, { sending: false, streaming: false });
    store().setSessionProgress(chatId, null);
    if (shouldDismissClarificationForTerminal(status)) fq.dismissClarifyForSession(chatId);
    reloadSessionSnapshot();
  };

  return {
    onReplayGap: reloadSessionSnapshot,
    onUserMessage: (message) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      store().appendUserMessageIfMissing(chatId, message);
    },
    onWorkflowRunStarted: () => {
      window.dispatchEvent(new CustomEvent('workflow-run-started-from-chat', { detail: { sessionKey: chatId } }));
    },
    onStreamStart: (turnId) => {
      markChatRunRunning(chatId);
      beforeAssistantDelta();
      store().updateSessionMessages(
        chatId,
        (messages) => claimLatestUnassignedUserTurn(messages, turnId),
      );
      store().mutateSessionStreaming(chatId, (message) => {
        message.turnId = turnId;
      });
      store().setSessionFlags(chatId, { streaming: true });
    },
    onToken: (delta, messageId) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        appendTextDelta(msg.content, delta, messageId);
      });
      if (shouldApplyStreamUpdate(chatId)) {
        store().setSessionFlags(chatId, { streaming: true });
      }
    },
    onAssistantMessageEnd: (messageId, presentation, usage) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        finishTextSegment(msg.content, messageId, presentation);
        if (usage) msg.usage = usage;
      });
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
    onToolStart: (toolName, args, toolCallId, startedAt, activity) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        appendToolStart(msg.content, toolName, args, toolCallId, startedAt, activity);
      });
      store().setSessionFlags(chatId, { streaming: true });
    },
    onToolEnd: (toolName, isErr, result, toolCallId, completedAt, activity) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        completeTool(msg.content, toolName, isErr, result, toolCallId, completedAt, activity);
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
    onTaskPlanUpdated: (taskPlan) => {
      store().setSessionTaskPlan(chatId, taskPlan);
    },
    onTurnOutcome: (outcome) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (message) => {
        message.outcome = outcome;
      });
    },
    onReview: ({ review }) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        appendReview(msg.content, review);
      });
      if (shouldApplyStreamUpdate(chatId)) {
        store().setSessionFlags(chatId, { streaming: true });
      }
    },
    onReviewStart: (review) => {
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        startReview(msg.content, review);
      });
      if (shouldApplyStreamUpdate(chatId)) {
        store().setSessionFlags(chatId, { streaming: true });
      }
    },
    onReviewDelta: ({ reviewId, delta }) => {
      enqueueReviewDelta(reviewId, delta);
    },
    onReviewEnd: ({ reviewId, status, message }) => {
      flushReviewDeltas();
      beforeAssistantDelta();
      store().mutateSessionStreaming(chatId, (msg) => {
        finishReview(msg.content, reviewId, status, message);
      });
    },
    onProgress: (p) => {
      store().setSessionProgress(chatId, p);
    },
    onTtsAudio: (p) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      store().appendAttachmentToCurrentAssistant(chatId, {
        name: p.name,
        mimeType: p.mimeType,
        type: 'voice' as const,
        uri: p.uri,
        size: 0,
      }, {
        attachTo: p.attachTo,
        messageId: p.messageId,
      });
    },
    onCompaction: (state: CompactionState) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      const m = messages(useLocaleStore.getState().language).chat;
      if (state.status === 'started') {
        store().setSessionProgress(chatId, {
          stage: 'compaction',
          message: m.compactingContext,
          timestamp: Date.now(),
        });
      } else if (state.status === 'completed') {
        const saved =
          state.tokensBefore && state.tokensAfter
            ? ` (${m.contextTokensFreed.replace(
                '{{count}}',
                String(Math.round((state.tokensBefore - state.tokensAfter) / 1000)),
              )})`
            : '';
        store().setSessionProgress(chatId, {
          stage: 'compaction',
          message: `${m.contextCompacted}${saved}`,
          timestamp: Date.now(),
        });
      } else {
        store().setSessionProgress(chatId, null);
      }
    },
    onClarifyRequest: fq.makeOnClarifyRequest(chatId),
    onResult: ({ status }) => {
      flushReviewDeltas();
      const visible = shouldApplyStreamUpdate(chatId);
      if (chatRunManager.takeUserAborted(chatId) || status === 'cancelled') {
        clearChatRunPresence(chatId);
        if (visible) finalizeMessage(chatId, status);
        else onBackgroundTerminal(status);
        return;
      }
      if (status === 'error') {
        markChatRunFailed(chatId, !visible);
        if (!visible) {
          onBackgroundTerminal(status);
          return;
        }
        finalizeMessage(chatId, status);
        reloadSessionSnapshot();
        return;
      }
      if (status === 'suspended') markChatRunWaiting(chatId);
      else markChatRunCompleted(chatId, !visible);
      if (!visible) {
        onBackgroundTerminal(status);
        return;
      }
      finalizeMessage(chatId, status);
    },
    onError: (msg) => {
      flushReviewDeltas();
      const visible = shouldApplyStreamUpdate(chatId);
      markChatRunFailed(chatId, !visible);
      if (!visible) {
        onBackgroundTerminal('error');
        return;
      }
      store().clearStreamingState(chatId);
      if (clearResumeRunIdOnVisibleError) {
        chatRunManager.setResumeRunId(chatId, null);
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
