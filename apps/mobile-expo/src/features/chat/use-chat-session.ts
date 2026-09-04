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
  submitClarifyResponse,
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
import { localMessageScope, readLocalMessages, useLocalMessagesStore } from './local-messages-store';
import type { MessageSubmission } from './message-submission';
import { resolveResumeRunId } from './resolve-resume-run-id';
import { shouldWakeStreamRecoveryOnForeground } from './stream-recovery-foreground';
import { formatMobileAgentRunError } from './agent-run-error';

const STREAMING_RENDER_THROTTLE_MS = 100;

export interface UseChatSessionOptions {
  sessionKey: string;
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
  sending: boolean;
  awaitingSessionRefresh: boolean;
  sessionDataUpdatedAtRef: React.MutableRefObject<number>;

  // Actions
  send: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]) => Promise<boolean>;
  retryMessage: (message: Message) => Promise<void>;
  abort: () => void;
  cancelRecovery: () => void;
  submitClarifyAnswer: (answer: string) => Promise<void>;
  skipClarifyAnswer: () => Promise<void>;
  clearAllState: () => void;

  // Refs (needed by parent)
  activeSessionKeyRef: React.MutableRefObject<string>;
  displayMessagesRef: React.MutableRefObject<Message[]>;
  messageListAtBottomRef: React.MutableRefObject<boolean>;
  runningRef: React.MutableRefObject<boolean>;
}

export function useChatSession(options: UseChatSessionOptions): UseChatSessionReturn {
  const { sessionKey, taskId } = options;

  const queryClient = useQueryClient();
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const { gatewayOnline } = useGatewayHealth();
  const m = useMessages();

  // ── Core refs ───────────────────────────────────────────
  const senderRef = useRef(new AgentMessageSender());
  const activeSessionKeyRef = useRef(sessionKey);
  const lastStreamActivityAtRef = useRef(0);
  const streamingRef = useRef(false);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const runBusyRef = useRef(false);
  const resumeInFlightRef = useRef(false);
  const streamingMsgRef = useRef<Message | null>(null);
  const streamingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayMessagesRef = useRef<Message[]>([]);
  const messageListAtBottomRef = useRef(true);
  const sessionDataUpdatedAtRef = useRef(0);
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
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [snackMsg, setSnackMsg] = useState('');
  const [clarifyPrompt, setClarifyPrompt] = useState<ClarifyPromptState | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifySubmitError, setClarifySubmitError] = useState<string | null>(null);
  const scope = localMessageScope(activeGatewayId, sessionKey);
  const optimisticMessages = useLocalMessagesStore(state => state.sessions[scope] ?? readLocalMessages(scope));
  const setOptimisticMessages = useCallback((update: (messages: Message[]) => Message[]) => {
    useLocalMessagesStore.getState().update(scope, update);
  }, [scope]);
  const activeMessageIdRef = useRef<string | null>(null);
  const sending = optimisticMessages.some(message => message.deliveryState === 'sending');
  const [awaitingSessionRefresh, setAwaitingSessionRefresh] = useState(false);
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
    setAwaitingSessionRefresh(false);
  }, [clearStreamingMessage, setOptimisticMessages]);


  // ── Session invalidation ─────────────────────────────────
  const invalidateSessionByKey = useCallback((targetSessionKey: string) => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.sessionHistory(targetSessionKey, activeGatewayId),
    });
    invalidateSessionLists(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionContext(targetSessionKey) });
  }, [activeGatewayId, queryClient]);

  const refreshSessionHeadByKey = useCallback(async (targetSessionKey: string) => {
    const generations = sessionHeadRefreshGenerationRef.current;
    const generation = (generations.get(targetSessionKey) ?? 0) + 1;
    generations.set(targetSessionKey, generation);
    let latestPage: SessionMessagePage | null;
    try {
      latestPage = await fetchSessionMessagePage(targetSessionKey, { limit: 50 });
    } catch (error) {
      if (generations.get(targetSessionKey) !== generation) return;
      throw error;
    }
    // Weak networks can complete an older foreground/finalize request after a
    // newer one. Only the newest started refresh may update the transcript.
    if (generations.get(targetSessionKey) !== generation) return;
    if (!latestPage) {
      invalidateSessionByKey(targetSessionKey);
      return;
    }

    void import('./session-history-cache').then((mod) => {
      mod.writeCachedSessionHistoryHead(activeGatewayId, targetSessionKey, latestPage);
    });
    queryClient.setQueryData<InfiniteData<SessionMessagePage | null, string | undefined>>(
      queryKeys.sessionHistory(targetSessionKey, activeGatewayId),
      (oldData) => mergeLatestSessionHistoryPage(oldData, latestPage),
    );
    invalidateSessionLists(queryClient);
  }, [activeGatewayId, invalidateSessionByKey, queryClient]);

  const invalidateSession = useCallback(() => {
    invalidateSessionByKey(sessionKey);
  }, [invalidateSessionByKey, sessionKey]);

  const reconcileSessionHead = useCallback(async (targetSessionKey = sessionKey) => {
    await refreshSessionHeadByKey(targetSessionKey).catch(() => {
      invalidateSessionByKey(targetSessionKey);
    });
    if (activeSessionKeyRef.current !== targetSessionKey) return;
    sendingRef.current = false;
    runBusyRef.current = false;
    clearAllState();
  }, [clearAllState, invalidateSessionByKey, refreshSessionHeadByKey, sessionKey]);

  // ── Session key change ───────────────────────────────────
  useEffect(() => {
    senderRef.current.detachLocalStream();
    activeSessionKeyRef.current = sessionKey;
    sendingRef.current = false;
    runBusyRef.current = false;
    clearAllState();
  }, [sessionKey, clearAllState]);

  // ── Run busy tracking ────────────────────────────────────
  useEffect(() => {
    runBusyRef.current = streaming || awaitingSessionRefresh || sending;
    sendingRef.current = sending;
  }, [streaming, awaitingSessionRefresh, sending]);

  // ── Finalize message ─────────────────────────────────────
  const finalizeMessage = useCallback((targetSessionKey = sessionKey) => {
    if (activeSessionKeyRef.current !== targetSessionKey) {
      void refreshSessionHeadByKey(targetSessionKey).catch(() => {
        invalidateSessionByKey(targetSessionKey);
      });
      return;
    }

    setStreaming(false);
    streamingRef.current = false;
    setProgress(null);
    setClarifyPrompt(null);
    setClarifySubmitError(null);
    setClarifySubmitting(false);
    sessionDataUpdatedAtRef.current =
      queryClient.getQueryState(
        queryKeys.sessionHistory(targetSessionKey, activeGatewayId),
      )?.dataUpdatedAt ?? 0;
    setAwaitingSessionRefresh(true);
    void refreshSessionHeadByKey(targetSessionKey).catch(() => {
      invalidateSessionByKey(targetSessionKey);
    });
  }, [activeGatewayId, invalidateSessionByKey, queryClient, refreshSessionHeadByKey, sessionKey]);

  // Safety: never leave the composer blocked if history refresh stalls (common on slow FRP).
  useEffect(() => {
    if (!awaitingSessionRefresh) return;
    const timer = setTimeout(() => setAwaitingSessionRefresh(false), 15_000);
    return () => clearTimeout(timer);
  }, [awaitingSessionRefresh]);

  // ── Build callbacks ──────────────────────────────────────
  const buildCallbacks = useCallback((callbackSessionKey: string): MessagingCallbacks => {
    const isCurrentSession = () => mountedRef.current
      && activeSessionKeyRef.current === callbackSessionKey
      && useGatewayStore.getState().activeGatewayId === activeGatewayId;
    const touchStreamActivity = () => {
      lastStreamActivityAtRef.current = Date.now();
    };

    return {
      onReplayGap: () => {
        return queryClient.invalidateQueries({
          queryKey: queryKeys.sessionHistory(callbackSessionKey, activeGatewayId),
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
      onThinking: (text, isDelta) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          if (!isDelta && text === '') startThinkingSegment(message.content);
          else appendThinkingDelta(message.content, text, isDelta);
        });
      },
      onThinkingEnd: () => {
        if (!isCurrentSession() || !streamingMsgRef.current) return;
        finalizeStreamingThinking(streamingMsgRef.current.content);
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
        appendAudioToStreamingAssistant(audio);
      },
      onClarifyRequest: (payload) => {
        if (!isCurrentSession()) return;
        flushStreamingMessage();
        setClarifyPrompt(payload);
        setClarifySubmitError(null);
        setClarifySubmitting(false);
      },
      onResult: () => {
        if (!isCurrentSession()) {
          invalidateSessionByKey(callbackSessionKey);
          return;
        }
        sendingRef.current = false;
        runBusyRef.current = true;
        if (streamingMsgRef.current) {
          finalizeStreamingThinking(streamingMsgRef.current.content);
          finalizeRunningTools(streamingMsgRef.current.content);
          flushStreamingMessage();
        }
        finalizeMessage(callbackSessionKey);
      },
      onError: (msg) => {
        if (!isCurrentSession()) {
          invalidateSessionByKey(callbackSessionKey);
          return;
        }
        if (isTransientNetworkError(msg) && streamRecoveryRef.current.recover(msg)) {
          sendingRef.current = false;
          runBusyRef.current = streamingRef.current || awaitingSessionRefresh;
          return;
        }
        sendingRef.current = false;
        setStreaming(false);
        streamingRef.current = false;
        runBusyRef.current = awaitingSessionRefresh;
        clearStreamingMessage();
        setProgress(null);
        setClarifyPrompt(null);
        setClarifySubmitError(null);
        setClarifySubmitting(false);
        setSnackMsg(formatMobileAgentRunError(msg, {
          modelQuotaExhausted: m.chat.modelQuotaExhausted,
          platformTokenLimitExceeded: m.chat.platformTokenLimitExceeded,
        }));
        setAwaitingSessionRefresh(false);
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
    awaitingSessionRefresh,
    setOptimisticMessages,
    m.chat.modelQuotaExhausted,
    m.chat.platformTokenLimitExceeded,
  ]);

  // ── Submit once; only the message retry action submits again. ──────
  const submitMessage = useCallback(async (input: MessageSubmission): Promise<void> => {
    const targetScope = localMessageScope(input.gatewayId, input.sessionKey);
    const updateMessage = (deliveryState: Message['deliveryState']) => {
      useLocalMessagesStore.getState().update(targetScope, messages => messages.map(message =>
        message.id === input.clientMessageId ? { ...message, deliveryState } : message));
    };
    const isCurrent = () => mountedRef.current && activeSessionKeyRef.current === input.sessionKey
      && useGatewayStore.getState().activeGatewayId === input.gatewayId;
    sendingRef.current = true;
    runBusyRef.current = true;
    activeMessageIdRef.current = input.clientMessageId;
    updateMessage('sending');
    clearStreamingMessage();
    setProgress(null);
    streamRecoveryRef.current.cancelRecovery();
    let runId: string | undefined;
    try {
      ({ runId } = await senderRef.current.sendMessage(input));
      updateMessage('sent');
    } catch (error) {
      updateMessage('failed');
      if (isCurrent()) {
        sendingRef.current = false;
        runBusyRef.current = false;
        setSnackMsg(error instanceof Error ? error.message : m.chat.sendFailed);
      }
      return;
    }
    if (!isCurrent()) return;
    sendingRef.current = false;
    if (!runId) {
      runBusyRef.current = false;
      finalizeMessage(input.sessionKey);
      return;
    }
    setStreaming(true);
    streamingRef.current = true;
    lastStreamActivityAtRef.current = Date.now();
    // A stream failure cannot change an accepted message back to failed.
    void senderRef.current.resume(runId, input.sessionKey, buildCallbacks(input.sessionKey), {
      replayFromStart: true,
    }).catch(async error => {
      if (!isCurrent()) return;
      if (streamRecoveryRef.current.recover(error)) return;
      await reconcileSessionHead(input.sessionKey);
    });
  }, [buildCallbacks, clearStreamingMessage, finalizeMessage, m.chat.sendFailed, reconcileSessionHead]);

  const send = useCallback(async (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]): Promise<boolean> => {
    if (!canSendComposerDraft(text, attachments?.length ?? 0, contextRefs?.length ?? 0) || !sessionKey || !activeGatewayId
      || runBusyRef.current || sendingRef.current
      || readLocalMessages(scope).some(message => message.deliveryState === 'sending')) return false;
    const input: MessageSubmission = {
      clientMessageId: randomUUID(),
      gatewayId: activeGatewayId,
      sessionKey,
      expectedSessionId: readCachedSessionDetail(activeGatewayId, sessionKey)?.sessionId,
      taskId,
      content: text.trim(),
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
  }, [activeGatewayId, scope, sessionKey, setOptimisticMessages, submitMessage, taskId]);

  const retryMessage = useCallback(async (message: Message): Promise<void> => {
    const current = readLocalMessages(scope).find(row => row.id === message.id);
    if (current?.deliveryState !== 'failed' || !current.submission
      || runBusyRef.current || sendingRef.current
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
  const submitClarifyAnswer = useCallback(async (answer: string) => {
    if (!clarifyPrompt || clarifySubmitting) return;
    setClarifySubmitting(true);
    setClarifySubmitError(null);
    try {
      await submitClarifyResponse(clarifyPrompt.requestId, { answer });
      setClarifyPrompt(null);
    } catch (e) {
      setClarifySubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setClarifySubmitting(false);
    }
  }, [clarifyPrompt, clarifySubmitting]);

  const skipClarifyAnswer = useCallback(async () => {
    if (!clarifyPrompt || clarifySubmitting) return;
    setClarifySubmitting(true);
    setClarifySubmitError(null);
    try {
      await submitClarifyResponse(clarifyPrompt.requestId, { skip: true });
      setClarifyPrompt(null);
    } catch (e) {
      setClarifySubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setClarifySubmitting(false);
    }
  }, [clarifyPrompt, clarifySubmitting]);

  // ── Pending run ──────────────────────────────────────────
  useEffect(() => {
    return subscribePendingAgentRunChanged((detail) => {
      if (detail.sessionKey === sessionKey) {
        setPendingRunTick((n) => n + 1);
      }
    });
  }, [sessionKey]);

  const pendingRunId = useMemo(() => {
    if (!sessionKey) return null;
    return readPendingAgentRunId(sessionKey);
  }, [sessionKey, streaming, pendingRunTick]);

  // ── Resume ───────────────────────────────────────────────
  const resume = useCallback(async (runId: string) => {
    if (resumeInFlightRef.current || sendingRef.current) return;
    resumeInFlightRef.current = true;
    try {
      if (activeSessionKeyRef.current !== sessionKey) return;
      if (!sessionKey || !runId) return;
      if (senderRef.current.isStreamingFor(sessionKey)) {
        senderRef.current.detachLocalStream();
      }
      if (senderRef.current.isStreamingFor(sessionKey)) return;
      setAwaitingSessionRefresh(false);
      setProgress(null);
      setStreaming(true);
      streamingRef.current = true;
      lastStreamActivityAtRef.current = Date.now();
      try {
        await senderRef.current.resume(
          runId,
          sessionKey,
          buildCallbacks(sessionKey),
          { replayFromStart: streamingMsgRef.current === null },
        );
        streamRecoveryRef.current.markRecoverySucceeded();
      } catch (e) {
        if (activeSessionKeyRef.current !== sessionKey) {
          invalidateSessionByKey(sessionKey);
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        if (isTransientNetworkError(message)) throw e;
        clearPendingAgentRun(sessionKey);
        await reconcileSessionHead(sessionKey);
      }
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [
    sessionKey,
    invalidateSessionByKey,
    buildCallbacks,
    reconcileSessionHead,
  ]);

  // ── Stream recovery ──────────────────────────────────────
  const streamRecovery = useAgentStreamRecovery({
    sessionKey,
    activeSessionKeyRef,
    tryResume: resume,
    onParked: () => {
      runBusyRef.current = Boolean(readPendingAgentRunId(sessionKey));
      setStreaming(Boolean(readPendingAgentRunId(sessionKey)));
      streamingRef.current = Boolean(readPendingAgentRunId(sessionKey));
    },
    onReconcile: async () => {
      await reconcileSessionHead(sessionKey);
    },
  });
  streamRecoveryRef.current = streamRecovery;

  // ── Stream resume signals ────────────────────────────────
  useAgentStreamResume({
    sessionKey,
    senderRef,
    activeSessionKeyRef,
    wakeRecovery: streamRecovery.wake,
    streaming,
    sending,
  });

  const wakeStreamRecovery = useCallback(() => {
    if (!sessionKey || sendingRef.current) return;
    if (senderRef.current.isStreamingFor(sessionKey)) {
      senderRef.current.detachLocalStream();
    }
    sendingRef.current = false;
    runBusyRef.current = streamingRef.current || awaitingSessionRefresh;
    lastStreamActivityAtRef.current = Date.now();
    streamRecoveryRef.current.wake();
  }, [awaitingSessionRefresh, sessionKey]);

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
      const sessionIsActive = Boolean(sessionKey) && activeSessionKeyRef.current === sessionKey;
      if (!shouldWakeStreamRecoveryOnForeground({
        previousAppState,
        nextAppState: next,
        sessionIsActive,
      })) return;
      // Pull the durable transcript immediately so a run that completed while
      // suspended becomes visible without waiting for realtime replay.
      void refreshSessionHeadByKey(sessionKey).catch(() => invalidateSessionByKey(sessionKey));
      wakeStreamRecovery();
    });
    return () => subscription.remove();
  }, [sessionKey, wakeStreamRecovery, refreshSessionHeadByKey, invalidateSessionByKey]);

  // Resolve server-side active runs on session entry. Local pending run storage is
  // only a cache; the gateway is the source of truth when the screen remounts.
  useEffect(() => {
    if (!sessionKey) return undefined;
    let cancelled = false;
    void resolveResumeRunId(sessionKey).then((runId) => {
      if (cancelled || !runId || sendingRef.current || activeSessionKeyRef.current !== sessionKey) return;
      streamRecoveryRef.current.wake();
    }).catch(() => {
      // A disconnected session is refreshed when connectivity returns.
    });
    return () => {
      cancelled = true;
    };
  }, [sessionKey, activeGatewayId]);

  // ── Gateway event subscription ───────────────────────────
  useEffect(() => {
    return subscribeGatewayEvent('session-updated', (detail) => {
      const key = (detail as { key?: string }).key;
      if (!key || key !== sessionKey || sendingRef.current) return;
      if (
        readPendingAgentRunId(sessionKey) &&
        !senderRef.current.isStreamingFor(sessionKey)
      ) {
        streamRecoveryRef.current.wake();
      } else if (!streamingRef.current && !sendingRef.current && !awaitingSessionRefresh) {
        void refreshSessionHeadByKey(sessionKey).catch(() => invalidateSessionByKey(sessionKey));
      }
    });
  }, [sessionKey, awaitingSessionRefresh, refreshSessionHeadByKey, invalidateSessionByKey]);

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
    if (!wasOffline || !gatewayOnline || !sessionKey) return;
    const hasResumableStream =
      Boolean(pendingRunId) ||
      (streaming && senderRef.current.isStreamingFor(sessionKey));
    if (!hasResumableStream) return;
    triggerStreamRecovery();
  }, [
    gatewayOnline,
    sessionKey,
    streaming,
    sending,
    pendingRunId,
    triggerStreamRecovery,
  ]);

  // Recovery when gateway goes offline while streaming
  useEffect(() => {
    if (gatewayOnline || !sessionKey) return;
    if (!streaming && !senderRef.current.isStreamingFor(sessionKey)) return;
    if (!pendingRunId && !senderRef.current.isStreamingFor(sessionKey)) return;
    triggerStreamRecovery();
  }, [gatewayOnline, sessionKey, streaming, pendingRunId, triggerStreamRecovery]);

  useEffect(() => {
    return subscribeGatewayEvent('gateway.realtime-connected', () => {
      if (!sessionKey || sendingRef.current || activeSessionKeyRef.current !== sessionKey) return;
      if (!readPendingAgentRunId(sessionKey)) return;
      if (senderRef.current.isStreamingFor(sessionKey)) return;
      streamRecoveryRef.current.wake();
    });
  }, [sessionKey]);

  // Detect a stalled realtime run
  useEffect(() => {
    if (!streaming || !sessionKey) return;
    const interval = setInterval(() => {
      if (!streamingRef.current || activeSessionKeyRef.current !== sessionKey) return;
      if (!readPendingAgentRunId(sessionKey)) return;
      if (Date.now() - lastStreamActivityAtRef.current < STREAM_STALL_MS) return;
      triggerStreamRecovery();
    }, 5000);
    return () => clearInterval(interval);
  }, [streaming, sessionKey, triggerStreamRecovery]);

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
    sending,
    awaitingSessionRefresh,
    sessionDataUpdatedAtRef,

    // Actions
    send,
    retryMessage,
    abort,
    cancelRecovery: streamRecovery.cancelRecovery,
    submitClarifyAnswer,
    skipClarifyAnswer,
    clearAllState,

    // Refs
    activeSessionKeyRef,
    displayMessagesRef,
    messageListAtBottomRef,
    runningRef: runBusyRef,
  };
}
