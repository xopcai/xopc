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

import { AgentMessageSender, submitClarifyResponse, type MessagingCallbacks } from '../../api/agent-client';
import { queryKeys } from '../../query/keys';
import { invalidateSessionLists } from '../../query/workspace-sync';
import { fetchSessionMessagePage, type SessionMessagePage } from '../../query/sessions';
import {
  useAgentStreamResume,
  type AgentStreamResumeOptions,
} from './use-agent-stream-resume';
import { useAgentStreamRecovery } from './use-agent-stream-recovery';
import { isTransientNetworkError, STREAM_STALL_MS } from './network-errors';
import { useChatFollowUp } from './use-chat-follow-up';
import { useMessages, t } from '../../i18n/messages';
import {
  canSendComposerDraft,
  buildOptimisticUserMessage,
} from './composer-send-helpers';
import type { WireAttachment } from './composer.types';
import type { AudioContent, Message, ProgressState } from './messages.types';
import type { ClarifyPromptState } from './ClarifyPrompt';
import {
  appendTextDelta,
  appendThinkingDelta,
  appendToolStart,
  cloneMessageForRender,
  completeTool,
  ensureAssistantMessage,
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
import { resolveResumeRunId } from './resolve-resume-run-id';

const STREAMING_RENDER_THROTTLE_MS = 100;
const FOLLOW_UP_AUTO_SEND_IDLE_MS = 5000;
const MAX_PENDING_FOLLOW_UPS = 5;

export interface UseChatSessionOptions {
  sessionKey: string;
  effectiveModelId: string | null;
}

export interface UseChatSessionReturn {
  // Streaming state
  streamingMsg: Message | null;
  streaming: boolean;
  streamReconnecting: boolean;
  resumePromptVisible: boolean;
  progress: ProgressState | null;
  snackMsg: string;
  setSnackMsg: React.Dispatch<React.SetStateAction<string>>;
  clarifyPrompt: ClarifyPromptState | null;
  clarifySubmitting: boolean;
  clarifySubmitError: string | null;
  optimisticMessages: Message[];
  awaitingSessionRefresh: boolean;
  sessionDataUpdatedAtRef: React.MutableRefObject<number>;

  // Actions
  send: (text: string, attachments?: WireAttachment[]) => Promise<boolean>;
  sendVoice: (payload: { uri: string; durationMillis: number; mimeType?: string }) => Promise<void>;
  abort: () => void;
  resume: (opts?: AgentStreamResumeOptions) => Promise<void>;
  submitClarifyAnswer: (answer: string) => Promise<void>;
  skipClarifyAnswer: () => Promise<void>;
  clearAllState: () => void;

  // Follow-up
  followUp: ReturnType<typeof useChatFollowUp>;

  // Refs (needed by parent)
  activeSessionKeyRef: React.MutableRefObject<string>;
  streamRecoveryRef: React.MutableRefObject<{
    handleRecoverableFailure: (error: unknown) => boolean;
    markRecoverySucceeded: () => void;
    cancelRecovery: () => void;
  }>;
  displayMessagesRef: React.MutableRefObject<Message[]>;
  messageListAtBottomRef: React.MutableRefObject<boolean>;
  runningRef: React.MutableRefObject<boolean>;
}

export function useChatSession(options: UseChatSessionOptions): UseChatSessionReturn {
  const { sessionKey, effectiveModelId } = options;

  const queryClient = useQueryClient();
  const { gatewayOnline } = useGatewayHealth();
  const m = useMessages();

  // ── Core refs ───────────────────────────────────────────
  const senderRef = useRef(new AgentMessageSender());
  const activeSessionKeyRef = useRef(sessionKey);
  const lastStreamActivityAtRef = useRef(0);
  const streamingRef = useRef(false);
  const sendingRef = useRef(false);
  const runBusyRef = useRef(false);
  const streamActiveRef = useRef(false);
  const clarifyActiveRef = useRef(false);
  const resumeInFlightRef = useRef(false);
  const streamingMsgRef = useRef<Message | null>(null);
  const streamingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResumeFailedRef = useRef(false);
  const displayMessagesRef = useRef<Message[]>([]);
  const messageListAtBottomRef = useRef(true);
  const followUpFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionDataUpdatedAtRef = useRef(0);
  const prevGatewayOnlineForStreamRef = useRef(gatewayOnline);

  const streamRecoveryRef = useRef({
    handleRecoverableFailure: (_error: unknown): boolean => false,
    markRecoverySucceeded: () => {},
    cancelRecovery: () => {},
  });

  const sendRef = useRef<(text: string, attachments?: WireAttachment[]) => Promise<boolean>>(
    async () => false,
  );

  // ── Streaming state ──────────────────────────────────────
  const [streamingMsg, setStreamingMsg] = useState<Message | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamReconnecting, setStreamReconnecting] = useState(false);
  const [resumePromptVisible, setResumePromptVisible] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [snackMsg, setSnackMsg] = useState('');
  const [clarifyPrompt, setClarifyPrompt] = useState<ClarifyPromptState | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifySubmitError, setClarifySubmitError] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
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
    setOptimisticMessages([]);
    setAwaitingSessionRefresh(false);
  }, [clearStreamingMessage]);


  // ── Session invalidation ─────────────────────────────────
  const invalidateSessionByKey = useCallback((targetSessionKey: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionHistory(targetSessionKey) });
    invalidateSessionLists(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoal(targetSessionKey) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoalRuns(targetSessionKey, 1) });
  }, [queryClient]);

  const refreshSessionHeadByKey = useCallback(async (targetSessionKey: string) => {
    const latestPage = await fetchSessionMessagePage(targetSessionKey, { limit: 50 });
    if (!latestPage) {
      invalidateSessionByKey(targetSessionKey);
      return;
    }

    void import('./session-history-cache').then((mod) => {
      mod.writeCachedSessionHistoryHead(targetSessionKey, latestPage);
    });
    queryClient.setQueryData<InfiniteData<SessionMessagePage | null, string | undefined>>(
      queryKeys.sessionHistory(targetSessionKey),
      (oldData) => mergeLatestSessionHistoryPage(oldData, latestPage),
    );
    invalidateSessionLists(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoal(targetSessionKey) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoalRuns(targetSessionKey, 1) });
  }, [invalidateSessionByKey, queryClient]);

  const invalidateSession = useCallback(() => {
    invalidateSessionByKey(sessionKey);
  }, [invalidateSessionByKey, sessionKey]);

  // ── Session key change ───────────────────────────────────
  useEffect(() => {
    activeSessionKeyRef.current = sessionKey;
    autoResumeFailedRef.current = false;
    setResumePromptVisible(false);
    setStreamReconnecting(false);
    clearAllState();
  }, [sessionKey, clearAllState]);

  // ── Clarify active tracking ──────────────────────────────
  useEffect(() => {
    clarifyActiveRef.current = Boolean(clarifyPrompt);
  }, [clarifyPrompt]);

  // ── Run busy tracking ────────────────────────────────────
  useEffect(() => {
    streamActiveRef.current = streaming || sendingRef.current;
    runBusyRef.current = streaming || awaitingSessionRefresh || sendingRef.current;
  }, [streaming, awaitingSessionRefresh]);

  // ── Follow-up ────────────────────────────────────────────
  const followUp = useChatFollowUp({
    sessionKey,
    sessionKeyRef: activeSessionKeyRef,
    streamActiveRef,
    clarifyActiveRef,
    sendRef,
    onQueueFull: () => {
      setSnackMsg(t(m.chat.followUpQueueMaxReached, { max: MAX_PENDING_FOLLOW_UPS }));
    },
  });

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
      queryClient.getQueryState(queryKeys.sessionHistory(targetSessionKey))?.dataUpdatedAt ?? 0;
    setAwaitingSessionRefresh(true);
    void refreshSessionHeadByKey(targetSessionKey).catch(() => {
      invalidateSessionByKey(targetSessionKey);
    });
  }, [invalidateSessionByKey, queryClient, refreshSessionHeadByKey, sessionKey]);

  // Safety: never leave the composer blocked if history refresh stalls (common on slow FRP).
  useEffect(() => {
    if (!awaitingSessionRefresh) return;
    const timer = setTimeout(() => setAwaitingSessionRefresh(false), 15_000);
    return () => clearTimeout(timer);
  }, [awaitingSessionRefresh]);

  // ── Build callbacks ──────────────────────────────────────
  const buildCallbacks = useCallback((callbackSessionKey: string): MessagingCallbacks => {
    const isCurrentSession = () => activeSessionKeyRef.current === callbackSessionKey;
    const touchStreamActivity = () => {
      lastStreamActivityAtRef.current = Date.now();
    };

    return {
      onStreamStart: () => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        streamRecoveryRef.current.markRecoverySucceeded();
        setStreamReconnecting(false);
        setStreaming(true);
        streamingRef.current = true;
        updateStreamingMessage(() => {}, true);
      },
      onUserTranscript: ({ text, attachments }) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        setProgress(null);
        setOptimisticMessages((prev) => {
          const head = prev[0];
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
          return [{ ...head, content }];
        });
      },
      onToken: (delta) => {
        if (!isCurrentSession()) return;
        touchStreamActivity();
        updateStreamingMessage((message) => {
          appendTextDelta(message.content, delta);
        });
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
        }
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
        streamActiveRef.current = false;
        runBusyRef.current = true;
        if (streamingMsgRef.current) {
          finalizeStreamingThinking(streamingMsgRef.current.content);
          finalizeRunningTools(streamingMsgRef.current.content);
          flushStreamingMessage();
        }
        finalizeMessage(callbackSessionKey);
        if (followUpFlushTimerRef.current) {
          clearTimeout(followUpFlushTimerRef.current);
        }
        followUpFlushTimerRef.current = setTimeout(() => {
          void followUp.flushSteeringQueue(callbackSessionKey);
        }, FOLLOW_UP_AUTO_SEND_IDLE_MS);
      },
      onError: (msg) => {
        if (!isCurrentSession()) {
          invalidateSessionByKey(callbackSessionKey);
          return;
        }
        if (isTransientNetworkError(msg) && streamRecoveryRef.current.handleRecoverableFailure(msg)) {
          sendingRef.current = false;
          streamActiveRef.current = streamingRef.current;
          runBusyRef.current = streamingRef.current || awaitingSessionRefresh;
          return;
        }
        sendingRef.current = false;
        setStreaming(false);
        streamingRef.current = false;
        streamActiveRef.current = false;
        runBusyRef.current = awaitingSessionRefresh;
        clearStreamingMessage();
        setProgress(null);
        setClarifyPrompt(null);
        setClarifySubmitError(null);
        setClarifySubmitting(false);
        setSnackMsg(msg);
        setAwaitingSessionRefresh(false);
        invalidateSession();
      },
    };
  }, [
    invalidateSessionByKey,
    invalidateSession,
    updateStreamingMessage,
    appendAudioToStreamingAssistant,
    flushStreamingMessage,
    clearStreamingMessage,
    finalizeMessage,
    followUp,
    awaitingSessionRefresh,
  ]);

  // ── Send ─────────────────────────────────────────────────
  const send = useCallback(
    async (text: string, attachments?: WireAttachment[]): Promise<boolean> => {
      if (!canSendComposerDraft(text, attachments?.length ?? 0) || !sessionKey || streaming) {
        return false;
      }
      sendingRef.current = true;
      streamActiveRef.current = true;
      runBusyRef.current = true;
      const userMsg = buildOptimisticUserMessage(text, attachments);
      setOptimisticMessages([userMsg]);
      clearStreamingMessage();
      setProgress(null);
      setClarifyPrompt(null);
      setClarifySubmitError(null);
      setClarifySubmitting(false);
      streamRecoveryRef.current.cancelRecovery();
      setAwaitingSessionRefresh(false);
      lastStreamActivityAtRef.current = Date.now();
      try {
        await senderRef.current.sendMessage(
          text.trim(),
          sessionKey,
          buildCallbacks(sessionKey),
          attachments,
          effectiveModelId ? { modelRef: effectiveModelId } : undefined,
        );
        return true;
      } catch (e) {
        if (activeSessionKeyRef.current !== sessionKey) {
          invalidateSessionByKey(sessionKey);
          return true;
        }
        if (streamRecoveryRef.current.handleRecoverableFailure(e)) {
          sendingRef.current = false;
          streamActiveRef.current = streamingRef.current;
          runBusyRef.current = streamingRef.current || awaitingSessionRefresh;
          return true;
        }
        setOptimisticMessages([]);
        setSnackMsg(e instanceof Error ? e.message : String(e));
        setStreaming(false);
        streamingRef.current = false;
        sendingRef.current = false;
        streamActiveRef.current = streaming || false;
        runBusyRef.current = streaming || awaitingSessionRefresh;
        return false;
      }
    },
    [sessionKey, streaming, awaitingSessionRefresh, invalidateSessionByKey, clearStreamingMessage, buildCallbacks, effectiveModelId],
  );

  sendRef.current = send;

  // ── Send voice ───────────────────────────────────────────
  const sendVoice = useCallback(
    async (payload: { uri: string; durationMillis: number; mimeType?: string }) => {
      if (!payload.uri || !sessionKey || streaming || awaitingSessionRefresh) return;
      const userMsg: Message = {
        role: 'user-with-attachments',
        content: [
          {
            type: 'audio',
            uri: payload.uri,
            mimeType: payload.mimeType,
            name: 'voice.m4a',
            durationSeconds: Math.round(payload.durationMillis / 1000),
          },
        ],
        timestamp: Date.now(),
      };
      setOptimisticMessages([userMsg]);
      clearStreamingMessage();
      setProgress({
        stage: 'voice',
        message: m.chat.voiceSending,
        timestamp: Date.now(),
      });
      setClarifyPrompt(null);
      setClarifySubmitError(null);
      setClarifySubmitting(false);
      streamRecoveryRef.current.cancelRecovery();
      setAwaitingSessionRefresh(false);
      try {
        await senderRef.current.sendVoiceMessage(
          payload,
          sessionKey,
          buildCallbacks(sessionKey),
          effectiveModelId ? { modelRef: effectiveModelId } : undefined,
        );
      } catch (e) {
        if (activeSessionKeyRef.current !== sessionKey) {
          invalidateSessionByKey(sessionKey);
          return;
        }
        if (streamRecoveryRef.current.handleRecoverableFailure(e)) {
          return;
        }
        setSnackMsg(e instanceof Error ? e.message : String(e));
        setStreaming(false);
        streamingRef.current = false;
        setProgress(null);
      }
    },
    [sessionKey, streaming, awaitingSessionRefresh, invalidateSessionByKey, clearStreamingMessage, buildCallbacks, m.chat.voiceSending, effectiveModelId],
  );

  // ── Abort ────────────────────────────────────────────────
  const abort = useCallback(() => {
    streamRecoveryRef.current.cancelRecovery();
    setStreamReconnecting(false);
    setResumePromptVisible(false);
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
  const resume = useCallback(async (opts?: AgentStreamResumeOptions) => {
    const background = opts?.background === true;
    if (resumeInFlightRef.current) return;
    resumeInFlightRef.current = true;
    try {
      const runId = sessionKey ? await resolveResumeRunId(sessionKey) : null;
      if (activeSessionKeyRef.current !== sessionKey) return;
      if (!sessionKey || !runId) return;
      if (senderRef.current.isStreamingFor(sessionKey)) {
        senderRef.current.detachLocalStream();
      }
      if (senderRef.current.isStreamingFor(sessionKey)) return;
      if (!background && (streaming || awaitingSessionRefresh)) return;

      if (background) {
        setAwaitingSessionRefresh(false);
      } else {
        clearStreamingMessage();
        setAwaitingSessionRefresh(false);
      }
      setProgress(null);
      setStreaming(true);
      streamingRef.current = true;
      lastStreamActivityAtRef.current = Date.now();
      try {
        await senderRef.current.resume(runId, sessionKey, buildCallbacks(sessionKey));
        autoResumeFailedRef.current = false;
        setResumePromptVisible(false);
        streamRecoveryRef.current.markRecoverySucceeded();
      } catch (e) {
        if (activeSessionKeyRef.current !== sessionKey) {
          invalidateSessionByKey(sessionKey);
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        if (background && isTransientNetworkError(message)) {
          throw e;
        }
        if (/404|not found/i.test(message)) {
          clearPendingAgentRun(sessionKey);
        }
        if (!background && streamRecoveryRef.current.handleRecoverableFailure(e)) {
          setStreaming(false);
          streamingRef.current = false;
          return;
        }
        autoResumeFailedRef.current = true;
        setResumePromptVisible(true);
        setStreaming(false);
        streamingRef.current = false;
        if (!background) {
          setSnackMsg(message);
        }
      }
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [
    sessionKey,
    streaming,
    awaitingSessionRefresh,
    invalidateSessionByKey,
    clearStreamingMessage,
    buildCallbacks,
  ]);

  // ── Stream resume hook ───────────────────────────────────
  useAgentStreamResume({
    sessionKey,
    senderRef,
    activeSessionKeyRef,
    tryResume: resume,
    streaming,
  });

  // ── Stream recovery ──────────────────────────────────────
  const streamRecovery = useAgentStreamRecovery({
    sessionKey,
    activeSessionKeyRef,
    tryResume: resume,
    autoResumeFailedRef,
    onReconnectingChange: setStreamReconnecting,
    onRecoveryExhausted: () => {
      sendingRef.current = false;
      streamActiveRef.current = false;
      runBusyRef.current = awaitingSessionRefresh;
      setStreaming(false);
      streamingRef.current = false;
      setResumePromptVisible(true);
      if (!readPendingAgentRunId(sessionKey)) {
        setSnackMsg(m.chat.streamRecoveryFailed);
      }
    },
  });
  streamRecoveryRef.current = streamRecovery;

  const triggerStreamRecovery = useCallback(() => {
    if (!sessionKey) return;
    if (senderRef.current.isStreamingFor(sessionKey)) {
      senderRef.current.detachLocalStream();
    }
    sendingRef.current = false;
    streamActiveRef.current = streamingRef.current;
    runBusyRef.current = streamingRef.current || awaitingSessionRefresh;
    autoResumeFailedRef.current = false;
    setResumePromptVisible(false);
    lastStreamActivityAtRef.current = Date.now();
    streamRecoveryRef.current.handleRecoverableFailure(new Error('Network request failed'));
  }, [awaitingSessionRefresh, sessionKey]);

  // Resolve server-side active runs on session entry. Local pending run storage is
  // only a cache; the gateway is the source of truth when the screen remounts.
  useEffect(() => {
    if (!sessionKey) return undefined;
    let cancelled = false;
    void resolveResumeRunId(sessionKey).then((runId) => {
      if (cancelled || !runId || activeSessionKeyRef.current !== sessionKey) return;
      setPendingRunTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  // ── Auto-resume pending run ──────────────────────────────
  useEffect(() => {
    if (!pendingRunId || autoResumeFailedRef.current) return;
    if (senderRef.current.isStreamingFor(sessionKey)) return;
    if (streaming && !awaitingSessionRefresh) return;
    void resume({ background: awaitingSessionRefresh });
  }, [pendingRunId, streaming, awaitingSessionRefresh, resume, sessionKey]);

  // ── Gateway event subscription ───────────────────────────
  useEffect(() => {
    return subscribeGatewayEvent('session-updated', (detail) => {
      const key = (detail as { key?: string }).key;
      if (!key || key !== sessionKey) return;
      // Avoid invalidating goal queries on every transcript tick while agent is streaming.
      if (streamingRef.current || sendingRef.current || awaitingSessionRefresh) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoal(sessionKey) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoalRuns(sessionKey, 1) });
    });
  }, [queryClient, sessionKey, awaitingSessionRefresh]);

  // ── Cleanup on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
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
      streamReconnecting ||
      resumePromptVisible ||
      (streaming && senderRef.current.isStreamingFor(sessionKey));
    if (!hasResumableStream) return;
    triggerStreamRecovery();
  }, [
    gatewayOnline,
    sessionKey,
    streaming,
    pendingRunId,
    streamReconnecting,
    resumePromptVisible,
    triggerStreamRecovery,
  ]);

  // Recovery when gateway goes offline while streaming
  useEffect(() => {
    if (gatewayOnline || !sessionKey) return;
    if (!streaming && !senderRef.current.isStreamingFor(sessionKey)) return;
    if (!pendingRunId && !senderRef.current.isStreamingFor(sessionKey)) return;
    triggerStreamRecovery();
  }, [gatewayOnline, sessionKey, streaming, pendingRunId, triggerStreamRecovery]);

  // Detect stalled SSE
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
    streamReconnecting,
    resumePromptVisible,
    progress,
    snackMsg,
    setSnackMsg,
    clarifyPrompt,
    clarifySubmitting,
    clarifySubmitError,
    optimisticMessages,
    awaitingSessionRefresh,
    sessionDataUpdatedAtRef,

    // Actions
    send,
    sendVoice,
    abort,
    resume,
    submitClarifyAnswer,
    skipClarifyAnswer,
    clearAllState,

    // Follow-up
    followUp,

    // Refs
    activeSessionKeyRef,
    streamRecoveryRef,
    displayMessagesRef,
    messageListAtBottomRef,
    runningRef: runBusyRef,
  };
}
