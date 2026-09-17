/**
 * Chat session hook — streaming state machine, message sending, resume, clarify.
 *
 * This is the core chat logic extracted from the chat screen. It manages:
 * - Streaming state (optimistic messages, streaming bubble, flush throttle)
 * - Message sending (text + voice)
 * - Stream resume / recovery
 * - Gateway connectivity effects (stall detection, reconnect resume)
 * - Clarify prompt lifecycle
 *
 * Returns all state and actions needed by the UI layer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';

import {
  AgentMessageSender,
  fetchClarificationSnapshot,
  submitClarificationResponse,
  type MessagingCallbacks,
} from '../../api/agent-client';
import { queryKeys } from '../../query/keys';
import { invalidateSessionLists } from '../../query/workspace-sync';
import { fetchSessionMessagePage, type SessionMessagePage } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { useAgentStreamResume } from './use-agent-stream-resume';
import { useAgentStreamRecovery } from './use-agent-stream-recovery';
import { isTransientNetworkError, STREAM_STALL_MS } from './network-errors';
import { useMessages } from '../../i18n/messages';
import {
  canSendComposerDraft,
  buildOptimisticUserMessage,
} from './composer-send-helpers';
import type { ComposerContextRef, WireAttachment } from './composer.types';
import type { AudioContent, Message, ProgressState } from './messages.types';
import type { ClarifyPromptState } from './ClarifyPrompt';
import {
  appendTextDelta,
  appendThinkingDelta,
  appendCommandOutputDelta,
  appendReview,
  appendToolStart,
  cloneMessageForRender,
  completeCommand,
  completePatchApplied,
  completeTool,
  ensureAssistantMessage,
  finishTextSegment,
  finalizeRunningTools,
  finalizeStreamingThinking,
  startThinkingSegment,
  updateToolDetails,
} from './streaming';
import {
  clearPendingAgentRun,
  readPendingAgentRunId,
  subscribePendingAgentRunChanged,
} from '../gateway/pending-agent-run';
import {
  subscribeGatewayEvent,
} from '../gateway/gateway-event-bus';
import {
  mergeLatestSessionHistoryPage,
} from './session-message-parser';
import { useGatewayHealth } from '../gateway/use-gateway-health';
import { requestMobileRealtimeReconnect } from '../gateway/use-gateway-realtime';
import { readCachedSessionDetail } from '../gateway/session-detail-cache';
import { capAttachments } from './chat-limits';
import {
  acknowledgeLocalSessionInputs,
  failLocalMessageIfSending,
  localMessageScope,
  readLocalMessages,
  setLocalMessageDeliveryState,
  useLocalMessagesStore,
} from './local-messages-store';
import type { MessageSubmission } from './message-submission';
import { resolveResumeRunId } from './resolve-resume-run-id';
import { shouldWakeStreamRecoveryOnForeground } from './stream-recovery-foreground';
import { formatMobileAgentRunError } from './agent-run-error';
import { queueAssistantAudioAutoplay } from './assistant-audio-autoplay';
import { sessionContainsFinalAssistant } from './session-refresh-confirmation';
import { recordConnectionEvent } from '../gateway/connection-log';

// Discrete 10 Hz text commits keep the answer responsive without continuously
// rebuilding Markdown and remeasuring the virtualized row.
const STREAMING_RENDER_THROTTLE_MS = 100;

export interface UseChatSessionOptions {
  conversationId: string;
  taskId?: string;
}

export interface UseChatSessionReturn {
  // Streaming state
  streamingMsg: Message | null;
  streaming: boolean;
  progress: ProgressState | null;
  snackMsg: string;
  setSnackMsg: React.Dispatch<React.SetStateAction<string>>;
  clarifyPrompt: ClarifyPromptState | null;
  clarifySubmitting: boolean;
  clarifySubmitError: string | null;
  optimisticMessages: Message[];
  finalizedMessages: Message[];
  sending: boolean;

  // Actions
  send: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[], delivery?: 'next' | 'steer') => Promise<boolean>;
  retryMessage: (message: Message) => Promise<void>;
  abort: () => void;
  cancelRecovery: () => void;
  submitClarifyAnswer: (answer: string) => Promise<void>;
  letAgentDecideClarification: () => Promise<void>;
  cancelClarification: () => Promise<void>;
  clearAllState: () => void;
  reconcileFinalizedMessages: (messages: Message[]) => void;

  // Refs (needed by parent)
  activeConversationIdRef: React.MutableRefObject<string>;
  displayMessagesRef: React.MutableRefObject<Message[]>;
  messageListAtBottomRef: React.MutableRefObject<boolean>;
  runningRef: React.MutableRefObject<boolean>;
}

export function useChatSession(options: UseChatSessionOptions): UseChatSessionReturn {
  const { conversationId, taskId } = options;

  const queryClient = useQueryClient();
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const { gatewayOnline } = useGatewayHealth();
  const m = useMessages();

  // ── Core refs ───────────────────────────────────────────
  const senderRef = useRef(new AgentMessageSender());
  const activeConversationIdRef = useRef(conversationId);
  const lastStreamActivityAtRef = useRef(0);
  const streamingRef = useRef(false);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const runBusyRef = useRef(false);
  const resumeInFlightRef = useRef(false);
  const streamingMsgRef = useRef<Message | null>(null);
  const finalizedMessagesRef = useRef<Message[]>([]);
  const finalizedAtRef = useRef(new Map<string, number>());
  const streamingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayMessagesRef = useRef<Message[]>([]);
  const messageListAtBottomRef = useRef(true);
  const sessionHeadRefreshGenerationRef = useRef(new Map<string, number>());
  const prevGatewayOnlineForStreamRef = useRef(gatewayOnline);

  const streamRecoveryRef = useRef({
    recover: (_error: unknown): boolean => false,
    wake: () => {},
    markRecoverySucceeded: () => {},
    cancelRecovery: () => {},
  });

  // ── Streaming state ──────────────────────────────────────
  const [streamingMsg, setStreamingMsg] = useState<Message | null>(null);
  const [finalizedMessages, setFinalizedMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [snackMsg, setSnackMsg] = useState('');
  const [clarifyPrompt, setClarifyPrompt] = useState<ClarifyPromptState | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifySubmitError, setClarifySubmitError] = useState<string | null>(null);
  const clarificationAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);

  const refreshClarification = useCallback(async (targetConversationId: string) => {
    const snapshot = await fetchClarificationSnapshot(targetConversationId);
    if (activeConversationIdRef.current !== targetConversationId) return;
    const wait = snapshot.clarification;
    setClarifyPrompt(wait?.status === 'open' ? {
      requestId: wait.id,
      kind: wait.kind,
      question: wait.question,
      choices: wait.choices,
      suggestedAnswer: wait.suggestedAnswer,
      version: wait.version,
      createdAt: wait.createdAt,
      expiresAt: wait.expiresAt,
    } : null);
    clarificationAttemptRef.current = null;
    setClarifySubmitError(null);
  }, []);
  const scope = localMessageScope(activeGatewayId, conversationId);
  const optimisticMessages = useLocalMessagesStore(state => state.sessions[scope] ?? readLocalMessages(scope));
  const setOptimisticMessages = useCallback((update: (messages: Message[]) => Message[]) => {
    useLocalMessagesStore.getState().update(scope, update);
  }, [scope]);
  const setMessageDeliveryState = useCallback((messageId: string, deliveryState: Message['deliveryState']) => {
    setOptimisticMessages(messages => setLocalMessageDeliveryState(messages, messageId, deliveryState));
  }, [setOptimisticMessages]);
  const activeMessageIdRef = useRef<string | null>(null);
  const sending = optimisticMessages.some(message => message.deliveryState === 'sending');
  const [pendingRunTick, setPendingRunTick] = useState(0);

  // ── Streaming helpers ────────────────────────────────────
  const clearStreamingFlushTimer = useCallback(() => {
    if (!streamingFlushTimerRef.current) return;
    clearTimeout(streamingFlushTimerRef.current);
    streamingFlushTimerRef.current = null;
  }, []);

  const flushStreamingMessage = useCallback(() => {
    clearStreamingFlushTimer();
    const message = streamingMsgRef.current;
    setStreamingMsg(message ? cloneMessageForRender(message) : null);
  }, [clearStreamingFlushTimer]);

  const updateStreamingMessage = useCallback((update: (message: Message) => void, flushImmediately = false) => {
    const message = ensureAssistantMessage(streamingMsgRef.current, Date.now());
    update(message);
    streamingMsgRef.current = message;

    if (flushImmediately) {
      flushStreamingMessage();
      return;
    }

    if (streamingFlushTimerRef.current) return;
    streamingFlushTimerRef.current = setTimeout(
      flushStreamingMessage,
      STREAMING_RENDER_THROTTLE_MS,
    );
  }, [flushStreamingMessage]);

  const appendAudioToStreamingAssistant = useCallback((audio: AudioContent) => {
    const message = ensureAssistantMessage(streamingMsgRef.current, Date.now());
    const key = audio.uri?.trim() || audio.workspaceRelativePath?.trim() || audio.name?.trim();
    const exists = key
      ? message.content.some(
        (block) =>
          block.type === 'audio' &&
          (block.uri?.trim() || block.workspaceRelativePath?.trim() || block.name?.trim()) === key,
      )
      : false;
    if (!exists) {
      message.content.push(audio);
    }
    streamingMsgRef.current = message;
    flushStreamingMessage();
  }, [flushStreamingMessage]);

  const clearStreamingMessage = useCallback(() => {
    clearStreamingFlushTimer();
    streamingMsgRef.current = null;
    setStreamingMsg(null);
  }, [clearStreamingFlushTimer]);

  const clearAllState = useCallback(() => {
    clearStreamingMessage();
    setStreaming(false);
    streamingRef.current = false;
    setProgress(null);
    setClarifyPrompt(null);
    setClarifySubmitError(null);
    setClarifySubmitting(false);
    setOptimisticMessages(messages => messages.filter(message =>
      message.deliveryState === 'failed' || message.deliveryState === 'sending'));
    finalizedMessagesRef.current = [];
    finalizedAtRef.current.clear();
    setFinalizedMessages([]);
  }, [clearStreamingMessage, setOptimisticMessages]);

  const reconcileFinalizedMessages = useCallback((messages: Message[]) => {
    const current = finalizedMessagesRef.current;
    const pending = current.filter((message) => {
      if (!sessionContainsFinalAssistant(messages, message)) return true;
      const identity = message.turnId ?? message.id;
      if (!identity) return true;
      const startedAt = finalizedAtRef.current.get(identity);
      finalizedAtRef.current.delete(identity);
      recordConnectionEvent({
        kind: 'chatRun',
        ok: true,
        reason: 'history_confirmed',
        ...(startedAt ? { latencyMs: Date.now() - startedAt } : {}),
      });
      return false;
    });
    if (pending.length === current.length) return;
    finalizedMessagesRef.current = pending;
    setFinalizedMessages(pending);
    setOptimisticMessages((optimistic) => optimistic.filter(
      (message) => message.deliveryState === 'failed' || message.deliveryState === 'sending',
    ));
  }, [setOptimisticMessages]);


  // ── Session invalidation ─────────────────────────────────
  const invalidateSessionByKey = useCallback((targetConversationId: string) => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.sessionHistory(targetConversationId, activeGatewayId),
    });
    invalidateSessionLists(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionContext(targetConversationId) });
  }, [activeGatewayId, queryClient]);

  const refreshSessionHeadByKey = useCallback(async (targetConversationId: string) => {
    const generations = sessionHeadRefreshGenerationRef.current;
    const generation = (generations.get(targetConversationId) ?? 0) + 1;
    generations.set(targetConversationId, generation);
    let latestPage: SessionMessagePage | null;
    try {
      latestPage = await fetchSessionMessagePage(targetConversationId, { limit: 50 });
    } catch (error) {
      if (generations.get(targetConversationId) !== generation) return;
      throw error;
    }
    // Weak networks can complete an older foreground/finalize request after a
    // newer one. Only the newest started refresh may update the transcript.
    if (generations.get(targetConversationId) !== generation) return;
    if (!latestPage) {
      invalidateSessionByKey(targetConversationId);
      return;
    }

    void import('./session-history-cache').then((mod) => {
      mod.writeCachedSessionHistoryHead(activeGatewayId, targetConversationId, latestPage);
    });
    queryClient.setQueryData<InfiniteData<SessionMessagePage | null, string | undefined>>(
      queryKeys.sessionHistory(targetConversationId, activeGatewayId),
      (oldData) => mergeLatestSessionHistoryPage(oldData, latestPage),
    );
    invalidateSessionLists(queryClient);
  }, [activeGatewayId, invalidateSessionByKey, queryClient]);

  const invalidateSession = useCallback(() => {
    invalidateSessionByKey(conversationId);
  }, [invalidateSessionByKey, conversationId]);

  const reconcileSessionHead = useCallback(async (targetConversationId = conversationId) => {
    await refreshSessionHeadByKey(targetConversationId).catch(() => {
      invalidateSessionByKey(targetConversationId);
    });
    if (activeConversationIdRef.current !== targetConversationId) return;
    if (activeMessageIdRef.current) setMessageDeliveryState(activeMessageIdRef.current, 'sent');
    sendingRef.current = false;
    runBusyRef.current = false;
    clearAllState();
  }, [clearAllState, invalidateSessionByKey, refreshSessionHeadByKey, conversationId, setMessageDeliveryState]);

  // ── Session key change ───────────────────────────────────
  useEffect(() => {
    senderRef.current.detachLocalStream();
    activeConversationIdRef.current = conversationId;
    sendingRef.current = false;
    runBusyRef.current = false;
    clearAllState();
    if (conversationId) void refreshClarification(conversationId).catch(() => undefined);
  }, [conversationId, clearAllState, refreshClarification]);

  // ── Run busy tracking ────────────────────────────────────
  useEffect(() => {
    runBusyRef.current = streaming || sendingRef.current;
  }, [streaming, sending]);

  // ── Finalize message ─────────────────────────────────────
  const finalizeMessage = useCallback((targetConversationId = conversationId) => {
    if (activeConversationIdRef.current !== targetConversationId) {
      void refreshSessionHeadByKey(targetConversationId).catch(() => {
        invalidateSessionByKey(targetConversationId);
      });
      return;
    }

    setStreaming(false);
    streamingRef.current = false;
    setProgress(null);
    setClarifyPrompt(null);
    setClarifySubmitError(null);
    setClarifySubmitting(false);
    const finalized = streamingMsgRef.current;
    if (finalized) {
      const snapshot = cloneMessageForRender(finalized);
      const identity = snapshot.turnId ?? snapshot.id ?? randomUUID();
      snapshot.id ??= identity;
      const withoutCurrent = finalizedMessagesRef.current.filter(
        (message) => (message.turnId ?? message.id) !== identity,
      );
      const next = [...withoutCurrent, snapshot];
      finalizedMessagesRef.current = next;
      finalizedAtRef.current.set(identity, Date.now());
      setFinalizedMessages(next);
    }
    clearStreamingMessage();
    void refreshClarification(targetConversationId).catch(() => undefined);
  }, [clearStreamingMessage, refreshClarification, conversationId]);

  useEffect(() => {
    if (!conversationId || finalizedMessages.length === 0) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finishDelay: (() => void) | undefined;
    const delays = [0, 300, 900];
    const sync = async () => {
      for (const delayMs of delays) {
        if (delayMs > 0) {
          await new Promise<void>((resolve) => {
            finishDelay = resolve;
            timer = setTimeout(() => {
              timer = undefined;
              finishDelay = undefined;
              resolve();
            }, delayMs);
          });
        }
        if (cancelled) return;
        try {
          await refreshSessionHeadByKey(conversationId);
        } catch {
          if (cancelled) return;
        }
      }
      if (!cancelled) invalidateSessionByKey(conversationId);
    };
    void sync();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      finishDelay?.();
    };
  }, [conversationId, finalizedMessages.length, invalidateSessionByKey, refreshSessionHeadByKey]);

  // ── Build callbacks ──────────────────────────────────────
  const buildCallbacks = useCallback((callbackConversationId: string): MessagingCallbacks => {
    const isCurrentSession = () => mountedRef.current
      && activeConversationIdRef.current === callbackConversationId
      && useGatewayStore.getState().activeGatewayId === activeGatewayId;
    const touchStreamActivity = () => {
      lastStreamActivityAtRef.current = Date.now();
    };

    return {
      onReplayGap: () => {
        return queryClient.invalidateQueries({
          queryKey: queryKeys.sessionHistory(callbackConversationId, activeGatewayId),
        });
      },
      onStreamStart: () => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        streamRecoveryRef.current.markRecoverySucceeded();
        setStreaming(true);
        streamingRef.current = true;
        updateStreamingMessage(() => {}, true);
      },
      onUserTranscript: ({ text, attachments }) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        if (activeMessageIdRef.current) setMessageDeliveryState(activeMessageIdRef.current, 'sent');
        setProgress(null);
        setOptimisticMessages((prev) => {
          const head = prev.find(message => message.id === activeMessageIdRef.current);
          if (!head || head.role !== 'user-with-attachments') return prev;
          const content = [...head.content];
          const trimmed = text.trim();
          if (trimmed) {
            const textIdx = content.findIndex((b) => b.type === 'text');
            if (textIdx >= 0) {
              content[textIdx] = { type: 'text', text: trimmed };
            } else {
              content.unshift({ type: 'text', text: trimmed });
            }
          }
          if (attachments?.length) {
            let voiceIdx = 0;
            for (let i = 0; i < content.length; i++) {
              const block = content[i];
              if (block.type !== 'audio') continue;
              const att = attachments[voiceIdx] ?? attachments[attachments.length - 1];
              voiceIdx += 1;
              content[i] = {
                ...block,
                workspaceRelativePath: att.workspaceRelativePath ?? block.workspaceRelativePath,
                mimeType: att.mimeType ?? block.mimeType,
                name: att.name ?? block.name,
                durationSeconds: att.durationSeconds ?? block.durationSeconds,
              };
            }
          }
          return prev.map(message => message === head ? { ...head, content } : message);
        });
      },
      onToken: (delta, messageId) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          appendTextDelta(message.content, delta, messageId);
        });
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
        }
      },
      onAssistantMessageEnd: (messageId, presentation, usage) => {
        if (!isCurrentSession() || !streamingMsgRef.current) return;
        finishTextSegment(streamingMsgRef.current.content, messageId, presentation);
        if (usage) streamingMsgRef.current.usage = usage;
        flushStreamingMessage();
      },
      onThinking: (text, isDelta, messageId) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          if (!isDelta && text === '') startThinkingSegment(message.content, messageId);
          else appendThinkingDelta(message.content, text, isDelta, messageId);
        });
      },
      onThinkingEnd: (messageId) => {
        if (!isCurrentSession() || !streamingMsgRef.current) return;
        finalizeStreamingThinking(streamingMsgRef.current.content, messageId);
        flushStreamingMessage();
      },
      onToolStart: (toolName, args, toolCallId) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          appendToolStart(message.content, toolName, args, toolCallId);
        }, true);
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
        }
      },
      onToolUpdate: (toolName, toolCallId, details) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          updateToolDetails(message.content, toolName, toolCallId, details);
        }, true);
      },
      onToolEnd: (toolName, isErr, result, toolCallId) => {
        if (!isCurrentSession()) return;
        updateStreamingMessage((message) => {
          completeTool(message.content, toolName, isErr, result, toolCallId);
        }, true);
      },
      onCommandStarted: (payload) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          appendToolStart(
            message.content,
            'exec_command',
            { cmd: payload.command, ...(payload.cwd ? { cwd: payload.cwd } : {}) },
            payload.toolCallId,
          );
        }, true);
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
        }
      },
      onCommandOutputDelta: (payload) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          appendCommandOutputDelta(message.content, payload.toolCallId, payload.stream, payload.delta);
        }, true);
      },
      onCommandCompleted: (payload) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          completeCommand(message.content, payload);
        }, true);
      },
      onPatchApplied: (payload) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          completePatchApplied(message.content, payload);
        }, true);
      },
      onTurnDiff: (payload) => {
        if (!isCurrentSession()) return;
        if (!payload.diff && payload.files.length === 0) return;
        touchStreamActivity();
      },
      onTurnOutcome: (outcome) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          message.turnId = outcome.turnId;
          message.outcome = outcome;
        }, true);
      },
      onReview: ({ review }) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          appendReview(message.content, review);
        }, true);
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
        }
      },
      onProgress: (p) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        setProgress(p);
      },
      onTtsAudio: (payload) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        const audio: AudioContent = {
          type: 'audio',
          uri: payload.uri,
          mimeType: payload.mimeType,
          name: payload.name,
        };
        queueAssistantAudioAutoplay(audio, callbackConversationId);
        appendAudioToStreamingAssistant(audio);
      },
      onClarifyRequest: (payload) => {
        if (!isCurrentSession()) return;
        flushStreamingMessage();
        setClarifyPrompt(payload);
        clarificationAttemptRef.current = null;
        setClarifySubmitError(null);
        setClarifySubmitting(false);
      },
      onResult: () => {
        if (!isCurrentSession()) {
          invalidateSessionByKey(callbackConversationId);
          return;
        }
        if (activeMessageIdRef.current) setMessageDeliveryState(activeMessageIdRef.current, 'sent');
        sendingRef.current = false;
        runBusyRef.current = true;
        if (streamingMsgRef.current) {
          finalizeStreamingThinking(streamingMsgRef.current.content);
          finalizeRunningTools(streamingMsgRef.current.content);
          flushStreamingMessage();
        }
        recordConnectionEvent({
          kind: 'chatRun',
          ok: true,
          reason: 'terminal_tail',
          latencyMs: Math.max(0, Date.now() - lastStreamActivityAtRef.current),
        });
        finalizeMessage(callbackConversationId);
      },
      onError: (msg) => {
        if (!isCurrentSession()) {
          invalidateSessionByKey(callbackConversationId);
          return;
        }
        if (activeMessageIdRef.current) setMessageDeliveryState(activeMessageIdRef.current, 'sent');
        if (isTransientNetworkError(msg) && streamRecoveryRef.current.recover(msg)) {
          sendingRef.current = false;
          runBusyRef.current = streamingRef.current;
          return;
        }
        sendingRef.current = false;
        setStreaming(false);
        streamingRef.current = false;
        runBusyRef.current = false;
        clearStreamingMessage();
        setProgress(null);
        setClarifyPrompt(null);
        setClarifySubmitError(null);
        setClarifySubmitting(false);
        setSnackMsg(formatMobileAgentRunError(msg, {
          modelQuotaExhausted: m.chat.modelQuotaExhausted,
          platformTokenLimitExceeded: m.chat.platformTokenLimitExceeded,
        }));
        invalidateSession();
      },
    };
  }, [
    activeGatewayId,
    queryClient,
    invalidateSessionByKey,
    invalidateSession,
    updateStreamingMessage,
    appendAudioToStreamingAssistant,
    flushStreamingMessage,
    clearStreamingMessage,
    finalizeMessage,
    setOptimisticMessages,
    setMessageDeliveryState,
    m.chat.modelQuotaExhausted,
    m.chat.platformTokenLimitExceeded,
  ]);

  // ── Submit once; only the message retry action submits again. ──────
  const submitMessage = useCallback(async (input: MessageSubmission): Promise<void> => {
    const targetScope = localMessageScope(input.gatewayId, input.conversationId);
    const updateMessage = (deliveryState: Message['deliveryState']) => {
      useLocalMessagesStore.getState().update(
        targetScope,
        messages => setLocalMessageDeliveryState(messages, input.clientMessageId, deliveryState),
      );
    };
    const isCurrent = () => mountedRef.current && activeConversationIdRef.current === input.conversationId
      && useGatewayStore.getState().activeGatewayId === input.gatewayId;
    const continuingRun = streamingRef.current;
    sendingRef.current = true;
    runBusyRef.current = true;
    updateMessage('sending');
    if (!continuingRun) {
      activeMessageIdRef.current = input.clientMessageId;
      clearStreamingMessage();
      setProgress(null);
      streamRecoveryRef.current.cancelRecovery();
    }
    let runId: string | undefined;
    try {
      ({ runId } = await senderRef.current.sendMessage(input));
      updateMessage('sent');
      void queryClient.invalidateQueries({ queryKey: ['session-inputs', input.gatewayId, input.conversationId] });
    } catch (error) {
      useLocalMessagesStore.getState().update(
        targetScope,
        messages => failLocalMessageIfSending(messages, input.clientMessageId),
      );
      if (isCurrent()) {
        sendingRef.current = false;
        runBusyRef.current = streamingRef.current;
        setSnackMsg(error instanceof Error ? error.message : m.chat.sendFailed);
      }
      return;
    }
    if (!isCurrent()) return;
    sendingRef.current = false;
    if (continuingRun) {
      // The previous run can finish while the queue POST is in flight. Resolve the
      // current server run instead of replaying its now-stale acknowledgement.
      if (!senderRef.current.isStreamingFor(input.conversationId)) streamRecoveryRef.current.wake();
      return;
    }
    if (!runId) {
      runBusyRef.current = false;
      finalizeMessage(input.conversationId);
      return;
    }
    setStreaming(true);
    streamingRef.current = true;
    lastStreamActivityAtRef.current = Date.now();
    // A stream failure cannot change an accepted message back to failed.
    void senderRef.current.resume(runId, input.conversationId, buildCallbacks(input.conversationId), {
      replayFromStart: true,
    }).catch(async error => {
      if (!isCurrent()) return;
      if (streamRecoveryRef.current.recover(error)) return;
      await reconcileSessionHead(input.conversationId);
    });
  }, [buildCallbacks, clearStreamingMessage, finalizeMessage, m.chat.sendFailed, queryClient, reconcileSessionHead]);

  const send = useCallback(async (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[], delivery: 'next' | 'steer' = 'next'): Promise<boolean> => {
    if (!canSendComposerDraft(text, attachments?.length ?? 0, contextRefs?.length ?? 0) || !conversationId || !activeGatewayId
      || sendingRef.current
      || readLocalMessages(scope).some(message => message.deliveryState === 'sending')) return false;
    const input: MessageSubmission = {
      clientMessageId: randomUUID(),
      gatewayId: activeGatewayId,
      conversationId,
      expectedTranscriptId: readCachedSessionDetail(activeGatewayId, conversationId)?.transcriptId,
      taskId,
      content: text.trim(),
      delivery,
      attachments: capAttachments(attachments) ?? [],
      contextRefs: (contextRefs ?? []).map(({ kind, sourceId, expectedVersion }) => ({ kind, sourceId, expectedVersion })),
    };
    const message = {
      ...buildOptimisticUserMessage(input.content, input.attachments, contextRefs),
      id: input.clientMessageId,
      submission: input,
      deliveryState: 'sending' as const,
    };
    setOptimisticMessages(messages => [...messages, message]);
    await submitMessage(input);
    // The message now owns its content, including when submission failed.
    return true;
  }, [activeGatewayId, scope, conversationId, setOptimisticMessages, submitMessage, taskId]);

  const retryMessage = useCallback(async (message: Message): Promise<void> => {
    const current = readLocalMessages(scope).find(row => row.id === message.id);
    if (current?.deliveryState !== 'failed' || !current.submission
      || sendingRef.current
      || readLocalMessages(scope).some(row => row.deliveryState === 'sending')) return;
    await submitMessage(current.submission);
  }, [scope, submitMessage]);

  // ── Abort ────────────────────────────────────────────────
  const abort = useCallback(() => {
    streamRecoveryRef.current.cancelRecovery();
    setClarifyPrompt(null);
    setClarifySubmitError(null);
    setClarifySubmitting(false);
    senderRef.current.abort();
    if (streamingMsgRef.current) {
      finalizeStreamingThinking(streamingMsgRef.current.content);
      finalizeRunningTools(streamingMsgRef.current.content);
      flushStreamingMessage();
    }
    finalizeMessage();
  }, [finalizeMessage, flushStreamingMessage]);

  // ── Clarify answer ───────────────────────────────────────
  const respondToClarification = useCallback(async (
    action: 'answer' | 'agent_decide' | 'cancel',
    answer?: string,
  ) => {
    if (!clarifyPrompt || clarifySubmitting) return;
    const signature = `${clarifyPrompt.requestId}\n${clarifyPrompt.version}\n${action}\n${answer ?? ''}`;
    if (clarificationAttemptRef.current?.signature !== signature) {
      clarificationAttemptRef.current = { signature, idempotencyKey: randomUUID() };
    }
    const idempotencyKey = clarificationAttemptRef.current.idempotencyKey;
    setClarifySubmitting(true);
    setClarifySubmitError(null);
    try {
      await submitClarificationResponse(clarifyPrompt.requestId, {
        action,
        answer,
        expectedVersion: clarifyPrompt.version,
        idempotencyKey,
      });
      clarificationAttemptRef.current = null;
      setClarifyPrompt(null);
    } catch (e) {
      setClarifySubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setClarifySubmitting(false);
    }
  }, [clarifyPrompt, clarifySubmitting]);

  const submitClarifyAnswer = useCallback((answer: string) => respondToClarification('answer', answer), [respondToClarification]);
  const letAgentDecideClarification = useCallback(() => respondToClarification('agent_decide'), [respondToClarification]);
  const cancelClarification = useCallback(() => respondToClarification('cancel'), [respondToClarification]);

  // ── Pending run ──────────────────────────────────────────
  useEffect(() => {
    return subscribePendingAgentRunChanged((detail) => {
      if (detail.conversationId === conversationId) {
        setPendingRunTick((n) => n + 1);
      }
    });
  }, [conversationId]);

  const pendingRunId = useMemo(() => {
    if (!conversationId) return null;
    return readPendingAgentRunId(conversationId);
  }, [conversationId, streaming, pendingRunTick]);

  // ── Resume ───────────────────────────────────────────────
  const resume = useCallback(async (runId: string) => {
    if (resumeInFlightRef.current || sendingRef.current) return;
    resumeInFlightRef.current = true;
    try {
      if (activeConversationIdRef.current !== conversationId) return;
      if (!conversationId || !runId) return;
      if (senderRef.current.isStreamingFor(conversationId)) {
        senderRef.current.detachLocalStream();
      }
      if (senderRef.current.isStreamingFor(conversationId)) return;
      setProgress(null);
      setStreaming(true);
      streamingRef.current = true;
      lastStreamActivityAtRef.current = Date.now();
      try {
        await senderRef.current.resume(
          runId,
          conversationId,
          buildCallbacks(conversationId),
          { replayFromStart: streamingMsgRef.current === null },
        );
        streamRecoveryRef.current.markRecoverySucceeded();
      } catch (e) {
        if (activeConversationIdRef.current !== conversationId) {
          invalidateSessionByKey(conversationId);
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        if (isTransientNetworkError(message)) throw e;
        clearPendingAgentRun(conversationId);
        await reconcileSessionHead(conversationId);
      }
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [
    conversationId,
    invalidateSessionByKey,
    buildCallbacks,
    reconcileSessionHead,
  ]);

  // ── Stream recovery ──────────────────────────────────────
  const streamRecovery = useAgentStreamRecovery({
    conversationId,
    activeConversationIdRef,
    tryResume: resume,
    onParked: () => {
      runBusyRef.current = Boolean(readPendingAgentRunId(conversationId));
      setStreaming(Boolean(readPendingAgentRunId(conversationId)));
      streamingRef.current = Boolean(readPendingAgentRunId(conversationId));
    },
    onReconcile: async () => {
      await reconcileSessionHead(conversationId);
    },
  });
  streamRecoveryRef.current = streamRecovery;

  // ── Stream resume signals ────────────────────────────────
  useAgentStreamResume({
    conversationId,
    senderRef,
    activeConversationIdRef,
    wakeRecovery: streamRecovery.wake,
    streaming,
    sending,
  });

  const wakeStreamRecovery = useCallback(() => {
    if (!conversationId || sendingRef.current) return;
    if (senderRef.current.isStreamingFor(conversationId)) {
      senderRef.current.detachLocalStream();
    }
    sendingRef.current = false;
    runBusyRef.current = streamingRef.current;
    lastStreamActivityAtRef.current = Date.now();
    streamRecoveryRef.current.wake();
  }, [conversationId]);

  const triggerStreamRecovery = useCallback(() => {
    requestMobileRealtimeReconnect();
    wakeStreamRecovery();
  }, [wakeStreamRecovery]);

  // Native timers and socket callbacks can be suspended while the device is
  // locked. On foreground, explicitly replace the old local run attachment;
  // the root realtime owner is responsible for reconnecting the shared socket.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      const previousAppState = previous;
      previous = next;
      const sessionIsActive = Boolean(conversationId) && activeConversationIdRef.current === conversationId;
      if (!shouldWakeStreamRecoveryOnForeground({
        previousAppState,
        nextAppState: next,
        sessionIsActive,
      })) return;
      // Pull the durable transcript immediately so a run that completed while
      // suspended becomes visible without waiting for realtime replay.
      void refreshSessionHeadByKey(conversationId).catch(() => invalidateSessionByKey(conversationId));
      wakeStreamRecovery();
    });
    return () => subscription.remove();
  }, [conversationId, wakeStreamRecovery, refreshSessionHeadByKey, invalidateSessionByKey]);

  // Resolve server-side active runs on session entry. Local pending run storage is
  // only a cache; the gateway is the source of truth when the screen remounts.
  useEffect(() => {
    if (!conversationId) return undefined;
    let cancelled = false;
    void resolveResumeRunId(conversationId).then((runId) => {
      if (cancelled || !runId || sendingRef.current || activeConversationIdRef.current !== conversationId) return;
      streamRecoveryRef.current.wake();
    }).catch(() => {
      // A disconnected session is refreshed when connectivity returns.
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, activeGatewayId]);

  // ── Gateway event subscription ───────────────────────────
  useEffect(() => {
    return subscribeGatewayEvent('session-updated', (detail) => {
      const key = (detail as { key?: string }).key;
      if (!key || key !== conversationId || sendingRef.current) return;
      if (
        readPendingAgentRunId(conversationId) &&
        !senderRef.current.isStreamingFor(conversationId)
      ) {
        streamRecoveryRef.current.wake();
      } else if (!streamingRef.current && !sendingRef.current) {
        void refreshSessionHeadByKey(conversationId).catch(() => invalidateSessionByKey(conversationId));
      }
    });
  }, [conversationId, refreshSessionHeadByKey, invalidateSessionByKey]);

  useEffect(() => {
    return subscribeGatewayEvent('session.transcript_updated', (detail) => {
      const key = (detail as { key?: string } | null)?.key;
      if (key !== conversationId || finalizedMessages.length === 0) return;
      void refreshSessionHeadByKey(conversationId).catch(() => undefined);
    });
  }, [conversationId, finalizedMessages.length, refreshSessionHeadByKey]);

  useEffect(() => subscribeGatewayEvent('clarification.updated', (detail) => {
    if (!detail || typeof detail !== 'object') return;
    const wait = detail as { conversationId?: string };
    if (wait.conversationId !== conversationId) return;
    void refreshClarification(conversationId).catch(() => undefined);
  }), [refreshClarification, conversationId]);

  useEffect(() => subscribeGatewayEvent('session.input-state', (detail) => {
    if (!detail || typeof detail !== 'object') return;
    const state = detail as { conversationId?: string; inputs?: unknown };
    if (state.conversationId !== conversationId) return;
    setOptimisticMessages(messages => acknowledgeLocalSessionInputs(messages, state.inputs));
    void refreshClarification(conversationId).catch(() => undefined);
  }), [refreshClarification, conversationId, setOptimisticMessages]);

  useEffect(() => {
    if (!clarifyPrompt?.expiresAt) return;
    const timer = setTimeout(() => {
      void refreshClarification(conversationId).catch(() => undefined);
    }, Math.max(0, clarifyPrompt.expiresAt - Date.now()) + 250);
    return () => clearTimeout(timer);
  }, [clarifyPrompt?.expiresAt, refreshClarification, conversationId]);

  // ── Cleanup on unmount ───────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      senderRef.current.detachLocalStream();
      clearStreamingFlushTimer();
    };
  }, [clearStreamingFlushTimer]);

  // ── Gateway connectivity effects ─────────────────────────
  // Resume streams when gateway connectivity returns
  useEffect(() => {
    const wasOffline = !prevGatewayOnlineForStreamRef.current;
    prevGatewayOnlineForStreamRef.current = gatewayOnline;
    if (!wasOffline || !gatewayOnline || !conversationId) return;
    const hasResumableStream =
      Boolean(pendingRunId) ||
      (streaming && senderRef.current.isStreamingFor(conversationId));
    if (!hasResumableStream) return;
    triggerStreamRecovery();
  }, [
    gatewayOnline,
    conversationId,
    streaming,
    sending,
    pendingRunId,
    triggerStreamRecovery,
  ]);

  // Recovery when gateway goes offline while streaming
  useEffect(() => {
    if (gatewayOnline || !conversationId) return;
    if (!streaming && !senderRef.current.isStreamingFor(conversationId)) return;
    if (!pendingRunId && !senderRef.current.isStreamingFor(conversationId)) return;
    triggerStreamRecovery();
  }, [gatewayOnline, conversationId, streaming, pendingRunId, triggerStreamRecovery]);

  useEffect(() => {
    return subscribeGatewayEvent('gateway.realtime-connected', () => {
      if (!conversationId || activeConversationIdRef.current !== conversationId) return;
      void refreshClarification(conversationId).catch(() => undefined);
      if (sendingRef.current) return;
      if (!readPendingAgentRunId(conversationId)) return;
      if (senderRef.current.isStreamingFor(conversationId)) return;
      streamRecoveryRef.current.wake();
    });
  }, [refreshClarification, conversationId]);

  // Detect a stalled realtime run
  useEffect(() => {
    if (!streaming || !conversationId) return;
    const interval = setInterval(() => {
      if (!streamingRef.current || activeConversationIdRef.current !== conversationId) return;
      if (!readPendingAgentRunId(conversationId)) return;
      if (Date.now() - lastStreamActivityAtRef.current < STREAM_STALL_MS) return;
      triggerStreamRecovery();
    }, 5000);
    return () => clearInterval(interval);
  }, [streaming, conversationId, triggerStreamRecovery]);

  return {
    // State
    streamingMsg,
    streaming,
    progress,
    snackMsg,
    setSnackMsg,
    clarifyPrompt,
    clarifySubmitting,
    clarifySubmitError,
    optimisticMessages,
    finalizedMessages,
    sending,

    // Actions
    send,
    retryMessage,
    abort,
    cancelRecovery: streamRecovery.cancelRecovery,
    submitClarifyAnswer,
    letAgentDecideClarification,
    cancelClarification,
    clearAllState,
    reconcileFinalizedMessages,

    // Refs
    activeConversationIdRef,
    displayMessagesRef,
    messageListAtBottomRef,
    runningRef: runBusyRef,
  };
}
