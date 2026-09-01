import {
  SESSION_INPUT_REQUEST_TIMEOUT_MS,
  SESSION_INPUT_RETRY_DELAYS_MS,
  parseTurnOutcome,
  sessionInputFingerprint,
  shouldRetrySessionInputStatus,
  type AgentStreamRunEndPayload,
  type ToolActivity,
  type TurnOutcome,
} from '@xopcai/gateway-contract';

import { buildSendFailedErrorPayload } from '@/features/chat/messages/agent-run-error-parser';
import type { WireAttachment, WireContextRef } from '@/features/chat/composer/composer.types';
import type { Message, ProgressState } from '@/features/chat/messages/messages.types';
import { userMessageFromStreamPayload } from '@/features/chat/messages/user-message-from-stream';
import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/constants';
import { dispatchPendingAgentRunChanged } from '@/features/chat/follow-up/pending-agent-run-events';
import { apiFetch } from '@/lib/fetch';
import { waitForEndpointTurnClaim } from '@/features/endpoint-tools/turn-claim';
import { formatApiHttpError } from '@/lib/http-error-message';
import { apiUrl } from '@/lib/url';
import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';
import {
  claimSubmissionId,
  completeSubmission,
} from '@/features/chat/messages/session-input-outbox';

async function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (ms === 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function postSessionInput(
  url: string,
  body: string,
  signal: AbortSignal,
  expectedSessionKey?: string,
): Promise<Response> {
  let lastError: unknown;
  for (const delayMs of SESSION_INPUT_RETRY_DELAYS_MS) {
    await retryDelay(delayMs, signal);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_INPUT_REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await apiFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(expectedSessionKey ? { 'X-Xopc-Expected-Session-Key': expectedSessionKey } : {}),
        },
        body,
        signal: controller.signal,
      });
      if (!shouldRetrySessionInputStatus(response.status)) return response;
      lastError = new Error(`Session input temporarily unavailable (${response.status})`);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Session input request failed');
}

export function pendingAgentRunStorageKey(chatId: string): string {
  return `xopc:pendingRun:${chatId}`;
}

type PendingAgentRun = { runId?: unknown; lastSeq?: unknown };

/** True when sessionStorage still holds a runId for a webchat session (in-flight or resumable). */
export function hasPendingAgentRunForChat(chatId: string): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem(pendingAgentRunStorageKey(chatId));
    if (!raw) return false;
    const pr = JSON.parse(raw) as PendingAgentRun;
    return typeof pr.runId === 'string' && pr.runId.trim().length > 0;
  } catch {
    return false;
  }
}

export function readPendingAgentRunId(chatId: string): string | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(pendingAgentRunStorageKey(chatId));
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingAgentRun;
    const runId = typeof pending.runId === 'string' ? pending.runId.trim() : '';
    return runId || null;
  } catch {
    return null;
  }
}

/** Persist a run id for sidebar recovery and `tryResumeAgentRun`. */
export function setPendingAgentRun(chatId: string, runId: string): void {
  const id = runId.trim();
  if (!id) return;
  try {
    const key = pendingAgentRunStorageKey(chatId);
    const previous = JSON.parse(sessionStorage.getItem(key) ?? '{}') as PendingAgentRun;
    const lastSeq = previous.runId === id && typeof previous.lastSeq === 'number'
      ? previous.lastSeq
      : 0;
    sessionStorage.setItem(key, JSON.stringify({ runId: id, lastSeq }));
    dispatchPendingAgentRunChanged(chatId);
  } catch {
    /* ignore */
  }
}

export function readPendingAgentRunCursor(chatId: string, runId: string): number {
  try {
    const raw = sessionStorage.getItem(pendingAgentRunStorageKey(chatId));
    if (!raw) return 0;
    const pending = JSON.parse(raw) as PendingAgentRun;
    return pending.runId === runId && typeof pending.lastSeq === 'number' ? pending.lastSeq : 0;
  } catch {
    return 0;
  }
}

export function advancePendingAgentRunCursor(chatId: string, runId: string, seq: number): void {
  if (!Number.isInteger(seq) || seq < 1) return;
  try {
    const key = pendingAgentRunStorageKey(chatId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const pending = JSON.parse(raw) as PendingAgentRun;
    if (pending.runId !== runId) return;
    const current = typeof pending.lastSeq === 'number' ? pending.lastSeq : 0;
    if (seq <= current) return;
    sessionStorage.setItem(key, JSON.stringify({ runId, lastSeq: seq }));
  } catch {
    /* ignore */
  }
}

/** Drop stored run id when leaving a session (e.g. New chat). Does not abort HTTP. */
export function clearPendingAgentRunForChat(chatId: string): void {
  const key = String(chatId ?? '').trim();
  if (!key) return;
  try {
    sessionStorage.removeItem(pendingAgentRunStorageKey(key));
    dispatchPendingAgentRunChanged(key);
  } catch {
    /* ignore */
  }
}

/** Clear a pending run only when the terminal event belongs to that exact run. */
export function clearPendingAgentRunIfMatches(chatId: string, runId: string): boolean {
  const key = String(chatId ?? '').trim();
  const expectedRunId = String(runId ?? '').trim();
  if (!key || !expectedRunId) return false;
  try {
    const storageKey = pendingAgentRunStorageKey(key);
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return false;
    const pending = JSON.parse(raw) as PendingAgentRun;
    if (pending.runId !== expectedRunId) return false;
    sessionStorage.removeItem(storageKey);
    dispatchPendingAgentRunChanged(key);
    return true;
  } catch {
    return false;
  }
}

/** Enumerate durable UI run cursors for reconnect reconciliation. */
export function listPendingAgentRuns(): Array<{ sessionKey: string; runId: string }> {
  const prefix = 'xopc:pendingRun:';
  const result: Array<{ sessionKey: string; runId: string }> = [];
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const storageKey = sessionStorage.key(index);
      if (!storageKey?.startsWith(prefix)) continue;
      const sessionKey = storageKey.slice(prefix.length).trim();
      const raw = sessionStorage.getItem(storageKey);
      if (!sessionKey || !raw) continue;
      const pending = JSON.parse(raw) as PendingAgentRun;
      const runId = typeof pending.runId === 'string' ? pending.runId.trim() : '';
      if (runId) result.push({ sessionKey, runId });
    }
  } catch {
    return result;
  }
  return result;
}

export type CompactionState = {
  status: 'started' | 'completed' | 'skipped';
  tokensBefore?: number;
  tokensAfter?: number;
  summary?: string;
};

export type TurnPlanState = {
  explanation?: string;
  plan: { step: string; status: 'pending' | 'in_progress' | 'completed' }[];
};

export type TaskPlanState = {
  planId: string;
  revision: number;
  source: 'update_plan' | 'todo';
  scope: 'turn' | 'session';
  explanation?: string;
  items: Array<{
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  }>;
};

export type MessagingCallbacks = {
  onStreamStart: (turnId: string) => void;
  onReplayGap?: () => void | Promise<void>;
  onToken: (delta: string, messageId?: string) => void;
  onAssistantMessageEnd?: (
    messageId: string,
    presentation: 'narration' | 'answer',
    usage?: Message['usage'],
  ) => void;
  onThinking: (content: string, isDelta: boolean) => void;
  onThinkingEnd: () => void;
  onToolStart: (
    toolName: string,
    args: unknown,
    toolCallId: string | undefined,
    startedAt: number,
    activity: ToolActivity | undefined,
  ) => void;
  onToolEnd: (
    toolName: string,
    isError: boolean,
    result: unknown,
    toolCallId: string | undefined,
    completedAt: number,
    activity: ToolActivity | undefined,
  ) => void;
  /**
   * Mid-execution structured update for a tool whose `partialResult` carried
   * `details`. Only emitted today by the `workflow` tool — feeds the
   * WorkflowCard's live progress tree.
   */
  onToolUpdate?: (toolName: string, toolCallId: string | undefined, details: unknown) => void;
  onProgress: (progress: ProgressState) => void;
  /** Context compaction in progress (pre-turn automatic or manual). */
  onCompaction?: (state: CompactionState) => void;
  /** Current agent turn plan, emitted by the `update_plan` tool. */
  onTurnPlanUpdated?: (state: TurnPlanState) => void;
  /** Structured completion result for the current run. */
  onTurnOutcome?: (outcome: TurnOutcome) => void;
  /** Canonical task plan snapshot emitted by `update_plan` or `todo`. */
  onTaskPlanUpdated?: (state: TaskPlanState) => void;
  /** Isolated `/review` context lifecycle. */
  onReviewStart?: (payload: { reviewId: string; target: string; stage: 'preparing' | 'reviewing' }) => void;
  onReviewDelta?: (payload: { reviewId: string; delta: string }) => void;
  onReviewEnd?: (payload: { reviewId: string; status: 'complete' | 'error'; message?: string }) => void;
  /** Structured code review output emitted by `/review`. */
  onReview?: (payload: { review: unknown }) => void;
  /** Assistant TTS audio persisted under agent home `tts/` (before `run_end`). */
  onTtsAudio?: (payload: {
    uri: string;
    mimeType: string;
    name: string;
    attachTo?: 'last_assistant';
    messageId?: string;
  }) => void;
  /** Agent `clarify` tool — user must answer via POST /api/clarify/:requestId */
  onClarifyRequest?: (payload: {
    requestId: string;
    question: string;
    choices?: string[];
    default?: string;
  }) => void;
  /** User turn from another device or early in the POST stream (before assistant tokens). */
  onUserMessage?: (message: Message) => void;
  /** Slash command or tool path started a persisted workflow run. */
  onWorkflowRunStarted?: (payload: {
    runId: string;
    sessionKey: string;
    definitionId: string;
    parentSessionKey?: string;
  }) => void;
  onResult: (payload: AgentStreamRunEndPayload) => void;
  onError: (msg: string) => void;
};

/**
 * Submit durable session inputs and consume their run over the shared realtime connection.
 */
export class MessageSender {
  private _abort?: AbortController;
  private _chatId = '';
  /** `runId` from the active resume body; do not clear a newer pending run. */
  private _trackedRunId?: string;
  private _streamCleanup?: () => void;
  private _streamFinish?: (value: boolean) => void;
  private _terminalCallbacks?: MessagingCallbacks;

  get isSending() {
    return !!this._abort;
  }

  /** Chat id for the in-flight session input or run-topic subscription, if any. */
  get activeChatId(): string {
    return this._chatId;
  }

  isStreamingFor(chatId: string): boolean {
    return !!this._abort && this._chatId === chatId;
  }

  isTrackingRun(chatId: string, runId: string): boolean {
    return this.isStreamingFor(chatId) && this._trackedRunId === runId;
  }

  /** Settle a run from the low-volume sessions topic when its run topic terminal was lost. */
  reconcileTerminal(chatId: string, runId: string, status: AgentStreamRunEndPayload['status']): boolean {
    if (!this.isTrackingRun(chatId, runId) || !this._streamFinish) return false;
    this._terminalCallbacks?.onResult({ runId, sessionKey: chatId, status });
    this._streamFinish(true);
    return true;
  }

  /** Stop tracking a run proven inactive by the authoritative REST snapshot. */
  reconcileInactive(chatId: string, runId: string): boolean {
    if (!this.isTrackingRun(chatId, runId) || !this._streamFinish) return false;
    this._streamFinish(false);
    return true;
  }

  async send(
    content: string,
    chatId: string,
    attachments?: WireAttachment[],
    thinkingLevel?: string,
    callbacks?: MessagingCallbacks,
    taskId?: string,
    replaceTurnId?: string,
    contextRefs?: WireContextRef[],
  ): Promise<void> {
    this._trackedRunId = undefined;
    this._abort = new AbortController();
    this._chatId = chatId;

    const capped =
      attachments && attachments.length > MAX_CHAT_ATTACHMENTS
        ? attachments.slice(0, MAX_CHAT_ATTACHMENTS)
        : attachments;

    const origin = await waitForEndpointTurnClaim(this._abort.signal);
    const fingerprint = `${sessionInputFingerprint({ content, attachments: capped, thinking: thinkingLevel, contextRefs })}${replaceTurnId ? `:replace:${replaceTurnId}` : ''}`;
    const clientMessageId = claimSubmissionId(chatId, fingerprint);
    const res = await postSessionInput(
      apiUrl(taskId
        ? `/api/tasks/${encodeURIComponent(taskId)}/inputs`
        : replaceTurnId
          ? `/api/sessions/${encodeURIComponent(chatId)}/turns/${encodeURIComponent(replaceTurnId)}/replace`
          : `/api/sessions/${encodeURIComponent(chatId)}/inputs`),
      JSON.stringify({
        clientMessageId,
        delivery: 'next',
        content,
        attachments: capped,
        thinking: thinkingLevel,
        origin,
        contextRefs,
      }),
      this._abort.signal,
      taskId ? chatId : undefined,
    );

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
    }

    const json = await res.json() as {
      payload?: {
        sessionKey?: string;
        state?: { activeRunId?: string; activeInputId?: string; inputs?: Array<{ id: string; clientMessageId: string }> };
      };
    };
    completeSubmission(chatId, clientMessageId);
    const state = json.payload?.state;
    const resolvedChatId = json.payload?.sessionKey?.trim() || chatId;
    const ownInput = state?.inputs?.find((input) => input.clientMessageId === clientMessageId);
    if (state?.activeRunId && ownInput?.id === state.activeInputId) {
      await this.resume(state.activeRunId, resolvedChatId, callbacks);
      return;
    }
    this._abort = undefined;
  }

  abort(): void {
    this._notifyServerAbort();
    this._abort?.abort();
    this._streamCleanup?.();
    this._streamCleanup = undefined;
    this._abort = undefined;
    this._clearPendingRun();
  }

  /** Best-effort server-side abort (runId) so the agent stops even if the HTTP signal is flaky. */
  private _notifyServerAbort(): void {
    if (!this._chatId) {
      return;
    }
    try {
      const raw = sessionStorage.getItem(pendingAgentRunStorageKey(this._chatId));
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { runId?: string };
      if (typeof parsed.runId !== 'string' || !parsed.runId) {
        return;
      }
      void apiFetch(apiUrl('/api/agent/abort'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: parsed.runId }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  async resume(runId: string, chatId: string, callbacks?: MessagingCallbacks): Promise<boolean> {
    this._trackedRunId = undefined;
    this._abort = new AbortController();
    this._chatId = chatId;

    this._trackedRunId = runId;
    setPendingAgentRun(chatId, runId);
    const terminal = this._wrapTerminalCallbacks(callbacks);
    this._terminalCallbacks = terminal.wrapped;
    const resumed = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        this._streamCleanup?.();
        this._streamCleanup = undefined;
        resolve(value);
      };
      this._streamFinish = finish;
      const afterSeq = readPendingAgentRunCursor(chatId, runId);
      this._streamCleanup = subscribeRealtimeTopic(`run:${runId}`, {
        onEvent: (message) => {
          const event = message.data && typeof message.data === 'object'
            ? { ...(message.data as Record<string, unknown>), seq: message.seq }
            : { type: message.event, seq: message.seq, payload: message.data };
          this._dispatchStreamEvent(message.event, event, terminal.wrapped);
          advancePendingAgentRunCursor(chatId, runId, message.seq);
          if (message.event === 'run_end' || message.event === 'error') finish(true);
        },
        onGap: (gap) => {
          if (gap.recoverable) return terminal.wrapped?.onReplayGap?.();
          finish(false);
        },
      }, afterSeq);
      this._abort?.signal.addEventListener('abort', () => finish(false), { once: true });
    });
    this._abort = undefined;
    this._streamFinish = undefined;
    this._terminalCallbacks = undefined;
    this._clearPendingRun();
    return resumed;
  }

  /** Ensures at most one of onResult/onError fires from the wrapped callbacks. */
  private _wrapTerminalCallbacks(cb?: MessagingCallbacks): {
    wrapped: MessagingCallbacks | undefined;
    sawTerminal: boolean;
    onMissingTerminal: () => void;
  } {
    if (!cb) {
      return { wrapped: undefined, sawTerminal: false, onMissingTerminal: () => {} };
    }
    let sawTerminal = false;
    const markTerminal = () => {
      sawTerminal = true;
    };
    return {
      get sawTerminal() {
        return sawTerminal;
      },
      wrapped: {
        ...cb,
        onResult: (payload) => {
          if (sawTerminal) return;
          markTerminal();
          cb.onResult(payload);
        },
        onError: (msg: string) => {
          if (sawTerminal) return;
          markTerminal();
          cb.onError(msg);
        },
      },
      onMissingTerminal: () => {
        if (sawTerminal) return;
        markTerminal();
        cb.onError('Agent run ended without a terminal event');
      },
    };
  }

  private _clearPendingRun(): void {
    const chatId = this._chatId;
    if (chatId) {
      try {
        const key = pendingAgentRunStorageKey(chatId);
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const pr = JSON.parse(raw) as { runId?: string };
          const stored = typeof pr?.runId === 'string' ? pr.runId : '';
          if (this._trackedRunId && stored && stored !== this._trackedRunId) {
            return;
          }
        }
        sessionStorage.removeItem(key);
        dispatchPendingAgentRunChanged(chatId);
      } catch {
        /* ignore */
      }
    }
    this._trackedRunId = undefined;
  }

  private _dispatchStreamEvent(event: string, parsed: Record<string, unknown>, cb?: MessagingCallbacks): void {
    const payload = (parsed.payload && typeof parsed.payload === 'object'
      ? parsed.payload
      : {}) as Record<string, unknown>;

    switch (event) {
      case 'run_start':
        if (typeof parsed.runId === 'string' && this._chatId) {
          this._trackedRunId = parsed.runId;
          setPendingAgentRun(this._chatId, parsed.runId);
        }
        if (typeof parsed.runId === 'string') cb?.onStreamStart(parsed.runId);
        break;
      case 'user_message': {
        const userMsg = userMessageFromStreamPayload(payload.message as Record<string, unknown>);
        if (userMsg) cb?.onUserMessage?.(userMsg);
        break;
      }
      case 'user_transcript': {
        const userMsg = userMessageFromStreamPayload({
          text: payload.text,
          media: payload.media,
          timestamp: parsed.timestamp,
        });
        if (userMsg) cb?.onUserMessage?.(userMsg);
        break;
      }
      case 'assistant_message_start':
        if (typeof parsed.runId === 'string') cb?.onStreamStart(parsed.runId);
        break;
      case 'assistant_delta':
        if (typeof payload.delta === 'string' && payload.delta) {
          cb?.onToken(
            payload.delta,
            typeof payload.messageId === 'string' ? payload.messageId : undefined,
          );
        }
        break;
      case 'thinking_delta':
        if (typeof payload.delta === 'string' && payload.delta) cb?.onThinking(payload.delta, true);
        break;
      case 'thinking_end':
        cb?.onThinkingEnd();
        break;
      case 'assistant_message_end':
        cb?.onThinkingEnd();
        if (
          typeof payload.messageId === 'string'
          && (payload.presentation === 'narration' || payload.presentation === 'answer')
        ) {
          cb?.onAssistantMessageEnd?.(
            payload.messageId,
            payload.presentation,
            payload.usage as Message['usage'] | undefined,
          );
        }
        break;
      case 'tool_start': {
        const toolName = String(payload.toolName || 'unknown');
        const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
        if (toolName === 'clarify') break;
        cb?.onToolStart(
          toolName,
          payload.args,
          toolCallId,
          protocolTimestamp(parsed.timestamp),
          payload.activity as ToolActivity | undefined,
        );
        break;
      }
      case 'tool_update': {
        const toolName = typeof payload.toolName === 'string' && payload.toolName ? payload.toolName : 'unknown';
        const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
        if (payload.details !== undefined) cb?.onToolUpdate?.(toolName, toolCallId, payload.details);
        if (typeof payload.textDelta === 'string' && payload.textDelta) cb?.onToolUpdate?.(toolName, toolCallId, { textDelta: payload.textDelta });
        break;
      }
      case 'tool_end':
        cb?.onToolEnd(
          typeof payload.toolName === 'string' && payload.toolName ? payload.toolName : 'unknown',
          payload.status === 'error' || payload.status === 'cancelled',
          serializeProtocolPayload(payload.result),
          typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined,
          protocolTimestamp(parsed.timestamp),
          payload.activity as ToolActivity | undefined,
        );
        break;
      case 'review_start':
        if (typeof payload.reviewId === 'string' && payload.reviewId) {
          cb?.onReviewStart?.({
            reviewId: payload.reviewId,
            target: typeof payload.target === 'string' ? payload.target : 'working tree changes',
            stage: payload.stage === 'preparing' ? 'preparing' : 'reviewing',
          });
        }
        break;
      case 'review_delta':
        if (typeof payload.reviewId === 'string' && typeof payload.delta === 'string' && payload.delta) {
          cb?.onReviewDelta?.({ reviewId: payload.reviewId, delta: payload.delta });
        }
        break;
      case 'review_end':
        if (typeof payload.reviewId === 'string' && payload.reviewId) {
          cb?.onReviewEnd?.({
            reviewId: payload.reviewId,
            status: payload.status === 'error' ? 'error' : 'complete',
            ...(typeof payload.message === 'string' && payload.message ? { message: payload.message } : {}),
          });
        }
        break;
      case 'progress':
        cb?.onProgress({
          stage: String(payload.stage || 'thinking'),
          message: String(payload.message || ''),
          detail: payload.detail as string | undefined,
          toolName: payload.toolName as string | undefined,
          completed: typeof payload.completed === 'number' ? payload.completed : undefined,
          total: typeof payload.total === 'number' ? payload.total : undefined,
          timestamp: Date.now(),
        });
        break;
      case 'compaction':
        cb?.onCompaction?.({
          status: (payload.status as 'started' | 'completed' | 'skipped') || 'started',
          tokensBefore: typeof payload.tokensBefore === 'number' ? payload.tokensBefore : undefined,
          tokensAfter: typeof payload.tokensAfter === 'number' ? payload.tokensAfter : undefined,
          summary: typeof payload.summary === 'string' ? payload.summary : undefined,
        });
        break;
      case 'turn_plan': {
        const plan = normalizeTurnPlan(payload.plan);
        if (plan.length > 0) {
          cb?.onTurnPlanUpdated?.({
            explanation: typeof payload.explanation === 'string' && payload.explanation.trim()
              ? payload.explanation.trim()
              : undefined,
            plan,
          });
        }
        break;
      }
      case 'task_plan_updated': {
        const items = normalizeTaskPlanItems(payload.items);
        const source = payload.source === 'todo' ? 'todo' : 'update_plan';
        const scope = payload.scope === 'session' ? 'session' : 'turn';
        const planId = typeof payload.planId === 'string' ? payload.planId.trim() : '';
        const revision = typeof payload.revision === 'number' && Number.isInteger(payload.revision)
          ? payload.revision
          : 0;
        if (planId && revision > 0) {
          cb?.onTaskPlanUpdated?.({
            planId,
            revision,
            source,
            scope,
            explanation: typeof payload.explanation === 'string' && payload.explanation.trim()
              ? payload.explanation.trim()
              : undefined,
            items,
          });
        }
        break;
      }
      case 'turn_outcome': {
        const outcome = parseTurnOutcome(payload);
        if (outcome) cb?.onTurnOutcome?.(outcome);
        break;
      }
      case 'tts_audio':
        cb?.onTtsAudio?.({
          uri: String(payload.uri || ''),
          mimeType: String(payload.mimeType || 'audio/mpeg'),
          name: String(payload.name || 'voice.mp3'),
          attachTo: payload.attachTo === 'last_assistant' ? 'last_assistant' : undefined,
          messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
        });
        break;
      case 'clarify_request': {
        const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
        const question = typeof payload.question === 'string' ? payload.question.trim() : '';
        if (requestId && question && cb?.onClarifyRequest) {
          const choices = Array.isArray(payload.choices)
            ? (payload.choices as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            : undefined;
          const def = typeof payload.default === 'string' && payload.default.trim() ? payload.default.trim() : undefined;
          cb.onClarifyRequest({ requestId, question, choices: choices && choices.length >= 2 ? choices : undefined, default: def });
        }
        break;
      }
      case 'memory_consent_required': {
        const requests = Array.isArray(payload.requests)
          ? payload.requests.filter((request): request is Record<string, unknown> => Boolean(request) && typeof request === 'object')
          : [];
        if (requests.length > 0 && this._chatId) {
          window.dispatchEvent(new CustomEvent('memory-consent-required', {
            detail: { sessionKey: this._chatId, requests },
          }));
        }
        break;
      }
      case 'memory_captured': {
        const records = Array.isArray(payload.records)
          ? payload.records.filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === 'object')
          : [];
        if (records.length > 0 && this._chatId) {
          window.dispatchEvent(new CustomEvent('memory-captured', {
            detail: { sessionKey: this._chatId, records },
          }));
        }
        break;
      }
      case 'memory_candidate': {
        const records = Array.isArray(payload.records)
          ? payload.records.filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === 'object')
          : [];
        if (records.length > 0 && this._chatId) {
          window.dispatchEvent(new CustomEvent('memory-candidate', {
            detail: { sessionKey: this._chatId, records },
          }));
        }
        break;
      }
      case 'workflow_run_started': {
        const workflowRun = payload.workflowRun as Record<string, unknown> | undefined;
        if (workflowRun?.ok === true) {
          const runId = typeof workflowRun.runId === 'string' ? workflowRun.runId : '';
          const sessionKey = typeof workflowRun.sessionKey === 'string' ? workflowRun.sessionKey : '';
          const definitionId = typeof workflowRun.definitionId === 'string' ? workflowRun.definitionId : '';
          const parentSessionKey = typeof workflowRun.parentSessionKey === 'string' ? workflowRun.parentSessionKey : undefined;
          if (runId && sessionKey && definitionId) {
            cb?.onWorkflowRunStarted?.({ runId, sessionKey, definitionId, parentSessionKey });
          }
        }
        break;
      }
      case 'run_end':
        if (
          typeof parsed.runId === 'string'
          && typeof parsed.sessionKey === 'string'
          && (payload.status === 'success' || payload.status === 'error' || payload.status === 'cancelled')
        ) {
          cb?.onResult({
            runId: parsed.runId,
            sessionKey: parsed.sessionKey,
            status: payload.status,
            ...(typeof payload.summary === 'string' && payload.summary ? { summary: payload.summary } : {}),
          });
        }
        break;
      case 'error':
        cb?.onError(String(payload.message || JSON.stringify(buildSendFailedErrorPayload())));
        break;
    }
  }
}

function serializeProtocolPayload(result: unknown): unknown {
  if (typeof result === 'string' || result == null) return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function protocolTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Chat stream event is missing a numeric timestamp');
  }
  return value;
}

function normalizeTurnPlan(raw: unknown): TurnPlanState['plan'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const rec = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : undefined;
      const step = typeof rec?.step === 'string' ? rec.step.trim() : '';
      const status = rec?.status;
      if (!step || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
        return undefined;
      }
      return { step, status };
    })
    .filter((item): item is TurnPlanState['plan'][number] => Boolean(item));
}

function normalizeTaskPlanItems(raw: unknown): TaskPlanState['items'] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const rec = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : undefined;
    const id = typeof rec?.id === 'string' ? rec.id.trim() : '';
    const title = typeof rec?.title === 'string' ? rec.title.trim() : '';
    const status = rec?.status;
    if (
      !id
      || !title
      || (status !== 'pending'
        && status !== 'in_progress'
        && status !== 'completed'
        && status !== 'cancelled')
    ) {
      return [];
    }
    return [{ id, title, status }];
  });
}
