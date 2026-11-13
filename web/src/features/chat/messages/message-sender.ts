import { readInputControl } from '@/features/chat/session/session-input-control';
import { readClarificationCapabilities } from '@/features/chat/clarification/clarification-capabilities';
import { readClarificationPresentation } from '@xopcai/gateway-contract';
import { captureTurnEnvironment } from '@/features/endpoint-tools/turn-environment';
import { useChatSessionStore } from '../session/chat-session-store';
import {
  SESSION_INPUT_REQUEST_TIMEOUT_MS,
  SESSION_INPUT_RETRY_DELAYS_MS,
  parseTurnOutcome,
  parseAppContextEnvelope,
  sessionInputFingerprint,
  shouldRetrySessionInputStatus,
  sessionInputCommandSchema,
  canonicalSessionCommand,
  type AgentStreamRunEndPayload,
  type AgentStreamRunStatus,
  type AgentStreamToolExecutionMetadata,
  type ToolActivity,
  type TurnOutcome,
  type AppContextEnvelope,
} from '@xopcai/gateway-contract';

import { buildSendFailedErrorPayload } from '@/features/chat/messages/agent-run-error-parser';
import type { WireAttachment, WireContextRef } from '@/features/chat/composer/composer.types';
import type { Message, ProgressState } from '@/features/chat/messages/messages.types';
import { userMessageFromStreamPayload } from '@/features/chat/messages/user-message-from-stream';
import { normalizeTaskTrigger } from '@/features/chat/messages/agent-messages';
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
import { readLocalSessionDraft, saveLocalSessionDraft, readSessionTranscript, readPendingSessionCommand, savePendingSessionCommand, clearPendingSessionCommand, confirmSessionCommand } from '../session/local-session-drafts';
import { useGatewayStore } from '@/stores/gateway-store';
import { patchSessionAgentConfigView } from '../session/patch-session-agent-config-view';
import { SessionManager, type SessionAgentConfig } from '../session/session-manager';
import { watchSubmittedRun } from './submitted-run-watch';
import { beginResponseLatency, bindResponseLatency, discardPendingResponseLatency, markResponseSubmission, recordResponseText, finishResponseLatency } from './response-latency';

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
  expectedConversationId?: string,
  onAttempt?: () => void,
): Promise<Response> {
  let lastError: unknown;
  for (const delayMs of SESSION_INPUT_RETRY_DELAYS_MS) {
    await retryDelay(delayMs, signal);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_INPUT_REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      onAttempt?.();
      const response = await apiFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(expectedConversationId ? { 'X-Xopc-Expected-Session-Key': expectedConversationId } : {}),
        },
        body,
        signal: controller.signal,
      });
      signal.throwIfAborted();
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
export function setPendingAgentRun(chatId: string, runId: string, resetCursor = false): void {
  const id = runId.trim();
  if (!id) return;
  try {
    const key = pendingAgentRunStorageKey(chatId);
    const previous = JSON.parse(sessionStorage.getItem(key) ?? '{}') as PendingAgentRun;
    const lastSeq = !resetCursor && previous.runId === id && typeof previous.lastSeq === 'number'
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
export function listPendingAgentRuns(): Array<{ conversationId: string; runId: string }> {
  const prefix = 'xopc:pendingRun:';
  const result: Array<{ conversationId: string; runId: string }> = [];
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const storageKey = sessionStorage.key(index);
      if (!storageKey?.startsWith(prefix)) continue;
      const conversationId = storageKey.slice(prefix.length).trim();
      const raw = sessionStorage.getItem(storageKey);
      if (!conversationId || !raw) continue;
      const pending = JSON.parse(raw) as PendingAgentRun;
      const runId = typeof pending.runId === 'string' ? pending.runId.trim() : '';
      if (runId) result.push({ conversationId, runId });
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
  onTextSurface?: (textSurface: 'conversation') => void;
  /** The server durably accepted this input, before its run finishes. */
  onInputAccepted?: () => void;
  onStreamStart: (turnId: string, startsNewBubble?: boolean, taskTrigger?: Message['taskTrigger']) => void;
  onReplayGap?: (recovery?: { runId?: string; signal: AbortSignal; terminal?: boolean }) => void | Promise<void>;
  onToken: (delta: string, messageId?: string, offset?: number) => void;
  onAssistantMessageEnd?: (
    messageId: string,
    presentation: 'narration' | 'answer',
    usage?: Message['usage'],
  ) => void;
  onThinking: (content: string, isDelta: boolean, messageId?: string) => void;
  onThinkingEnd: (messageId?: string) => void;
  onToolStart: (
    toolName: string,
    args: unknown,
    toolCallId: string | undefined,
    startedAt: number,
    activity: ToolActivity | undefined,
    metadata?: AgentStreamToolExecutionMetadata,
  ) => void;
  onToolEnd: (
    toolName: string,
    isError: boolean,
    result: unknown,
    toolCallId: string | undefined,
    completedAt: number,
    activity: ToolActivity | undefined,
    metadata?: AgentStreamToolExecutionMetadata,
  ) => void;
  /**
   * Mid-execution structured update for a tool whose `partialResult` carried
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
  /** Durable agent clarification projected from the gateway. */
  onClarifyRequest?: (payload: import('@xopcai/gateway-contract').ClarificationPresentation & {
    requestId: string;
    kind: 'input' | 'approval';
    question: string;
    choices?: string[];
    suggestedAnswer?: string;
    version: number;
    createdAt: number;
    expiresAt?: number;
  }) => void;
  /** User turn from another device or early in the POST stream (before assistant tokens). */
  onUserMessage?: (message: Message) => void;
  /** A slash command changed persisted model/thinking/session settings. */
  onSessionConfigUpdated?: () => void;
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
  private _streamRecover?: (status?: AgentStreamRunStatus) => Promise<void>;
  private _terminalCallbacks?: MessagingCallbacks;

  get isSending() {
    return !!this._abort;
  }

  /** Chat id for the in-flight session input or run-topic subscription, if any. */
  get trackedRunId(): string | undefined {
    return this._trackedRunId;
  }

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
    if (this._streamRecover) {
      void this._streamRecover(status);
      return true;
    }
    this._terminalCallbacks?.onResult({ runId, conversationId: chatId, status });
    this._streamFinish(true);
    return true;
  }

  /** Stop tracking a run proven inactive by the authoritative REST snapshot. */
  reconcileInactive(chatId: string, runId: string, recoverTerminal = false): boolean {
    if (!this.isTrackingRun(chatId, runId) || !this._streamFinish) return false;
    if (recoverTerminal && this._streamRecover) {
      void this._streamRecover();
      return true;
    }
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
    appContext?: AppContextEnvelope,
    submittedAt?: number,
  ): Promise<void> {
    if (this.isSending) throw new Error('A submission is already in progress');
    if (replaceTurnId && appContext) throw new Error('Application context requires a new input');
    const capturedContext = appContext === undefined ? undefined : parseAppContextEnvelope(appContext);
    attachments = attachments === undefined ? undefined : structuredClone(attachments);
    // Composer references carry display metadata that the strict input protocol rejects.
    contextRefs = contextRefs?.map(({ refId, kind, sourceId, expectedVersion }) => ({
      refId, kind, sourceId, expectedVersion,
    }));
    this._trackedRunId = undefined;
    const controller = new AbortController();
    this._abort = controller;
    this._chatId = chatId;

    const latency = beginResponseLatency(chatId, submittedAt);
    let watch: ReturnType<typeof watchSubmittedRun> | undefined;
    const captureEnvironment = async () => {
      const startedAt = performance.now();
      const environment = await captureTurnEnvironment();
      markResponseSubmission(latency, 'environmentCaptureMs', startedAt);
      return environment;
    };

    try {
      const capped =
        attachments && attachments.length > MAX_CHAT_ATTACHMENTS
          ? attachments.slice(0, MAX_CHAT_ATTACHMENTS)
          : attachments;

      const selection = useChatSessionStore.getState().sessions[chatId];
      const scope = useGatewayStore.getState().conversationId;
      const assertScope = () => { if (scope !== useGatewayStore.getState().conversationId) throw new Error('Active Gateway changed'); };
      if (selection?.modelConfigSaving) throw new Error('Wait for model configuration to finish saving');
      let configVersion = selection?.configVersion;
      const inputControl = readInputControl(chatId);
      const claimStartedAt = performance.now();
      const origin = await waitForEndpointTurnClaim(controller.signal);
      markResponseSubmission(latency, 'endpointClaimMs', claimStartedAt);
      const fingerprint = `${sessionInputFingerprint({ content, attachments: capped, thinking: thinkingLevel, contextRefs, appContext: capturedContext })}:${configVersion ?? ''}${replaceTurnId ? `:replace:${replaceTurnId}` : ''}`;
      let clientMessageId = claimSubmissionId(chatId, fingerprint);
      const input = { content, attachments: capped, contextRefs, appContext: capturedContext, endpointContext: undefined as import('@xopcai/gateway-contract').EndpointContext | undefined, interactionCapabilities: undefined as import('@xopcai/gateway-contract').InteractionCapabilities | undefined };
      let body: object;
      if (taskId || replaceTurnId) {
        if (!replaceTurnId) input.endpointContext = await captureEnvironment();
        body = { clientMessageId, configVersion, delivery: 'next', ...input, thinking: thinkingLevel, origin,
          expectedTranscriptId: replaceTurnId ? await readSessionTranscript(chatId) : undefined, controlVersion: inputControl.version };
      } else {
        assertScope();
        let draft = await readLocalSessionDraft(chatId);
        assertScope();
        if (draft?.materialization) {
          const manager = new SessionManager();
          await manager.confirmPendingMaterialization(chatId, controller.signal);
          const agentConfig = await manager.loadSessionAgentConfig(chatId);
          controller.signal.throwIfAborted();
          assertScope();
          patchSessionAgentConfigView(chatId, agentConfig);
          configVersion = agentConfig.configVersion;
          draft = await readLocalSessionDraft(chatId);
        }
        const pending = await readPendingSessionCommand(chatId);
        assertScope();
        if (!draft && !pending && configVersion === undefined) {
          const agentConfig = await new SessionManager().loadSessionAgentConfig(chatId);
          controller.signal.throwIfAborted();
          assertScope();
          patchSessionAgentConfigView(chatId, agentConfig);
          configVersion = agentConfig.configVersion;
        }
        input.interactionCapabilities = pending ? pending.input.interactionCapabilities : draft?.submission ? draft.submission.input.interactionCapabilities : await readClarificationCapabilities();
        if (pending) {
          input.endpointContext = pending.input.endpointContext;
          if (canonicalSessionCommand(pending.input) !== canonicalSessionCommand(input)) throw new Error('The previous input is awaiting confirmation');
          clientMessageId = pending.clientMessageId;
          body = sessionInputCommandSchema.parse({ ...pending, origin });
        } else if (draft) {
          input.endpointContext = draft.submission?.input.endpointContext ?? await captureEnvironment();
          const proposed = { kind: 'start' as const, clientMessageId, creation: draft.creation, input };
          if (draft.submission && canonicalSessionCommand(draft.submission.input) !== canonicalSessionCommand(input)) {
            throw new Error('The first input is awaiting confirmation. Retry it before sending different content.');
          }
          body = sessionInputCommandSchema.parse({ ...(draft.submission ?? proposed), origin });
          clientMessageId = draft.submission?.clientMessageId ?? clientMessageId;
          draft.submission ??= proposed;
          await saveLocalSessionDraft(draft);
        } else {
          input.endpointContext = await captureEnvironment();
          body = sessionInputCommandSchema.parse({ kind: 'append', clientMessageId,
            expectedTranscriptId: await readSessionTranscript(chatId), configVersion, delivery: 'next', input, origin,
            controlVersion: inputControl.version, ...(inputControl.paused ? { execution: 'single' } : {}) });
        }
        assertScope();
        const { origin: _origin, ...durable } = sessionInputCommandSchema.parse(body);
        await savePendingSessionCommand(chatId, durable);
      }
      assertScope();
      if (!taskId && !replaceTurnId) watch = watchSubmittedRun(chatId, clientMessageId, controller.signal);
      const res = await postSessionInput(
        apiUrl(taskId
          ? `/api/tasks/${encodeURIComponent(taskId)}/inputs`
          : replaceTurnId
            ? `/api/sessions/${encodeURIComponent(chatId)}/turns/${encodeURIComponent(replaceTurnId)}/replace`
            : `/api/sessions/${encodeURIComponent(chatId)}/inputs`),
        JSON.stringify(body),
        controller.signal,
        taskId ? chatId : undefined,
        () => markResponseSubmission(latency, 'postStartedMs'),
      );
      markResponseSubmission(latency, 'postResponseMs');
      const receiptDuration = res.headers?.get('Server-Timing')?.match(/(?:^|,)\s*session_input;dur=(\d+(?:\.\d+)?)/)?.[1];
      if (receiptDuration !== undefined) latency.gatewayInputReceiptMs = Number(receiptDuration);

      if (!res.ok) {
        assertScope();
        if (!taskId && !replaceTurnId && res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status)) await clearPendingSessionCommand(chatId);
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
        if (!taskId && !replaceTurnId && res.status === 400 && body.error?.code === 'BAD_REQUEST') {
          const rejected = await readLocalSessionDraft(chatId);
          assertScope();
          if (rejected?.submission?.clientMessageId === clientMessageId) {
            delete rejected.submission;
            await saveLocalSessionDraft(rejected);
          }
          completeSubmission(chatId, clientMessageId);
        }
        if (body.error?.code === 'CONFIG_CHANGED') window.dispatchEvent(new CustomEvent('session-model-config-stale', { detail: { conversationId: chatId } }));
        throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
      }

      const json = await res.json() as {
        payload?: {
          conversationId?: string;
          receipt?: { conversationId: string; clientMessageId: string; transcriptId: string; inputId?: string | null };
          session?: { transcriptId?: string };
          agentConfig?: SessionAgentConfig;
          inputState?: { activeRunId?: string; activeInputId?: string; inputs?: Array<{ id: string; clientMessageId: string }> };
          state?: { activeRunId?: string; activeInputId?: string; inputs?: Array<{ id: string; clientMessageId: string }> };
        };
      };
      controller.signal.throwIfAborted();
      assertScope();
      if (!taskId && !replaceTurnId) {
        const receipt = json.payload?.receipt;
        if (!receipt || receipt.conversationId !== chatId || receipt.clientMessageId !== clientMessageId) throw new Error('Invalid input receipt');
        if (json.payload?.session?.transcriptId !== receipt.transcriptId) throw new Error('Conversation was reset; reload before sending');
        await confirmSessionCommand(chatId, receipt.transcriptId);
        window.dispatchEvent(new CustomEvent('session-input-state', { detail: { ...json.payload?.inputState, conversationId: chatId } }));
        if (json.payload?.agentConfig) patchSessionAgentConfigView(chatId, json.payload.agentConfig);
      }
      completeSubmission(chatId, clientMessageId);
      markResponseSubmission(latency, 'inputAcceptedMs');
      callbacks?.onInputAccepted?.();
      const state = taskId || replaceTurnId ? json.payload?.state : json.payload?.inputState;
      if (replaceTurnId && state) window.dispatchEvent(new CustomEvent('session-input-state', { detail: { ...state, conversationId: chatId } }));
      const resolvedChatId = json.payload?.conversationId?.trim() || chatId;
      const ownInput = state?.inputs?.find((input) => input.clientMessageId === clientMessageId);
      if (taskId || replaceTurnId) {
        if (state?.activeRunId && ownInput?.id === state.activeInputId) {
          if (ownInput) bindResponseLatency(chatId, state.activeRunId, latency, 'receipt');
          await this.resume(state.activeRunId, resolvedChatId, callbacks, { replayFromStart: true });
        }
        return;
      }

      const receipt = json.payload?.receipt;
      const inputId = receipt?.inputId ?? ownInput?.id;
      if (inputId) watch?.accept(inputId);
      const lookupExecution = async (signal: AbortSignal) => {
        if (!receipt || !inputId) return;
        const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(chatId)}/input-receipts/${encodeURIComponent(clientMessageId)}`), { signal });
        signal.throwIfAborted();
        assertScope();
        if (!response.ok) return;
        const body = await response.json() as { payload?: {
          receipt?: { inputId?: string; transcriptId?: string; clientMessageId?: string; conversationId?: string };
          session?: { transcriptId?: string };
          execution?: { runId?: string; status?: string };
        } };
        signal.throwIfAborted();
        assertScope();
        const returned = body.payload?.receipt;
        if (returned?.inputId !== inputId || returned.clientMessageId !== clientMessageId || returned.conversationId !== chatId
          || returned.transcriptId !== receipt.transcriptId || body.payload?.session?.transcriptId !== receipt.transcriptId) return;
        return body.payload?.execution;
      };
      const terminalStatus = (status: string | undefined): AgentStreamRunStatus | undefined => {
        if (status === 'completed') return 'success';
        if (status === 'failed') return 'error';
        if (status === 'cancelled' || status === 'suspended') return status;
        return undefined;
      };
      const recover = async (runId: string | undefined, status: AgentStreamRunStatus | undefined, signal: AbortSignal) => {
        await callbacks?.onReplayGap?.({ runId, signal, terminal: true });
        signal.throwIfAborted();
        assertScope();
        // A short run may have persisted a clarification before the client saw its stream.
        if ((!status || status === 'suspended') && callbacks?.onClarifyRequest) {
          const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(resolvedChatId)}/clarification`), { signal }).catch(() => null);
          const snapshot = response?.ok ? await response.json() : null;
          signal.throwIfAborted();
          assertScope();
          const wait = snapshot?.payload?.clarification;
          if (wait?.status === 'open' && typeof wait.id === 'string') {
            callbacks.onClarifyRequest({ ...readClarificationPresentation(wait), requestId: wait.id,
              question: wait.question, kind: wait.kind === 'approval' ? 'approval' : 'input', version: wait.version,
              createdAt: wait.createdAt, expiresAt: wait.expiresAt });
            return 'suspended' as const;
          }
        }
        return status ?? 'success';
      };
      const follow = async (runId: string, association: 'realtime' | 'receipt' | 'poll', status?: AgentStreamRunStatus) => {
        controller.signal.throwIfAborted();
        assertScope();
        bindResponseLatency(chatId, runId, latency, association);
        if (status) {
          const recoveredStatus = await recover(runId, status, controller.signal);
          finishResponseLatency(runId, recoveredStatus);
          callbacks?.onResult({ runId, conversationId: resolvedChatId, status: recoveredStatus });
          return;
        }
        await this.resume(runId, resolvedChatId, callbacks, {
          replayFromStart: true,
          recoverTerminal: async (completedStatus, signal) => {
            let status = completedStatus;
            if (!status) {
              // A REST lookup can see a claimed run before its realtime topic exists.
              let execution = await lookupExecution(signal);
              while (execution?.runId === runId && execution.status === 'running') {
                await retryDelay(400, signal);
                execution = await lookupExecution(signal);
              }
              status = execution?.runId === runId ? terminalStatus(execution.status) : undefined;
            }
            return recover(runId, status, signal);
          },
        });
      };

      const announced = () => inputId ? watch?.current(inputId) : undefined;
      const early = announced();
      const receiptRunId = inputId && state?.activeInputId === inputId ? state.activeRunId : undefined;
      if (early && (!receiptRunId || early.runId === receiptRunId)) return await follow(early.runId, 'realtime', early.status);
      if (receiptRunId) return await follow(receiptRunId, 'receipt');

      const fallbackSignal = watch?.fallbackSignal ?? controller.signal;
      while (inputId && (ownInput || !state?.inputs)) {
        await watch?.wait(inputId, 400);
        const event = announced();
        if (event) return await follow(event.runId, 'realtime', event.status);
        const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(chatId)}/input-state`), {
          signal: fallbackSignal,
        }).catch(() => undefined);
        controller.signal.throwIfAborted();
        assertScope();
        const duringPoll = announced();
        if (duringPoll) return await follow(duringPoll.runId, 'realtime', duringPoll.status);
        if (!response?.ok) continue;
        const snapshot = await response.json().catch(() => undefined) as {
          payload?: { activeRunId?: string; activeInputId?: string; inputs?: Array<{ id: string }> };
        } | undefined;
        controller.signal.throwIfAborted();
        assertScope();
        const afterPoll = announced();
        if (afterPoll) return await follow(afterPoll.runId, 'realtime', afterPoll.status);
        const current = snapshot?.payload;
        if (current?.activeRunId && current.activeInputId === inputId) return await follow(current.activeRunId, 'poll');
        if (current?.inputs && !current.inputs.some(input => input.id === inputId)) break;
      }

      const execution = await lookupExecution(fallbackSignal).catch(() => undefined);
      controller.signal.throwIfAborted();
      assertScope();
      const late = announced();
      if (late) return await follow(late.runId, 'realtime', late.status);
      const runId = execution?.runId;
      const status = terminalStatus(execution?.status);
      if (runId && !status && execution?.status === 'running') return await follow(runId, 'poll');
      if (runId) bindResponseLatency(chatId, runId, latency, 'history');
      const recoveredStatus = await recover(runId, status, controller.signal);
      if (runId) finishResponseLatency(runId, recoveredStatus);
      callbacks?.onResult({ runId: runId ?? '', conversationId: resolvedChatId, status: recoveredStatus });
    } finally {
      watch?.dispose();
      discardPendingResponseLatency(chatId, latency);
      if (this._abort === controller) {
        this._abort = undefined;
        dispatchPendingAgentRunChanged(chatId);
      }
    }
  }

  abort(notifyServer = true): void {
    if (this._trackedRunId) finishResponseLatency(this._trackedRunId, 'cancelled');
    if (notifyServer) this._notifyServerAbort();
    this._abort?.abort();
    this._streamCleanup?.();
    this._streamCleanup = undefined;
    this._abort = undefined;
    this._clearPendingRun();
  }

  /** Best-effort server-side abort (runId) so the agent stops even if the HTTP signal is flaky. */
  private _notifyServerAbort(): void {
    // sessionStorage may already point at a successor announced on the sessions
    // topic. A sender may only cancel the execution it actually subscribed to.
    const runId = this._trackedRunId;
    if (!this._chatId || !runId) return;
    try {
      void Promise.resolve(apiFetch(apiUrl('/api/agent/abort'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }),
      })).catch(() => {});
    } catch { /* Cancellation remains best effort when the transport is unavailable. */ }
  }

  async resume(runId: string, chatId: string, callbacks?: MessagingCallbacks, options?: {
    replayFromStart: boolean;
    afterSteerId?: string;
    recoverTerminal?: (status: AgentStreamRunStatus | undefined, signal: AbortSignal) => Promise<AgentStreamRunStatus>;
  }): Promise<boolean> {
    // A resumed successor owns its own controller and subscription. A predecessor's
    // completion must never dispose or clear the successor's recovery cursor.
    this._abort?.abort();
    const controller = new AbortController();
    this._abort = controller;
    this._chatId = chatId;
    this._trackedRunId = runId;
    setPendingAgentRun(chatId, runId, options?.replayFromStart);
    const terminal = this._wrapTerminalCallbacks(callbacks);
    this._terminalCallbacks = terminal.wrapped;
    const resumed = await new Promise<boolean>(resolve => {
      let settled = false;
      let cleanup: (() => void) | undefined;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        cleanup?.();
        if (this._abort === controller) this._streamCleanup = undefined;
        resolve(value);
      };
      this._streamFinish = finish;
      let recovering = false;
      const recover = options?.recoverTerminal;
      this._streamRecover = recover ? async status => {
        if (settled || recovering || this._abort !== controller) return;
        recovering = true;
        try {
          const recoveredStatus = await recover(status, controller.signal);
          if (settled || this._abort !== controller) return;
          finishResponseLatency(runId, recoveredStatus);
          terminal.wrapped?.onResult({ runId, conversationId: chatId, status: recoveredStatus });
          finish(true);
        } catch {
          finish(false);
        }
      } : undefined;
      const afterSeq = readPendingAgentRunCursor(chatId, runId);
      let afterSteerId = options?.afterSteerId;
      cleanup = subscribeRealtimeTopic(`run:${runId}`, {
        onEvent: message => {
          if (this._abort !== controller) return;
          const event = message.data && typeof message.data === 'object'
            ? { ...(message.data as Record<string, unknown>), seq: message.seq }
            : { type: message.event, seq: message.seq, payload: message.data };
          if (afterSteerId && message.event !== 'run_end' && message.event !== 'error') {
            const payload = event.payload as { message?: { metadata?: { clientMessageId?: string } } } | undefined;
            if (message.event === 'user_message' && payload?.message?.metadata?.clientMessageId === afterSteerId) {
              afterSteerId = undefined;
              advancePendingAgentRunCursor(chatId, runId, message.seq);
            }
            return;
          }
          this._dispatchStreamEvent(message.event, event, terminal.wrapped);
          advancePendingAgentRunCursor(chatId, runId, message.seq);
          if (message.event === 'run_end' || message.event === 'error') finish(true);
        },
        onGap: gap => {
          if (this._abort !== controller) return;
          afterSteerId = undefined;
          if (gap.recoverable) return terminal.wrapped?.onReplayGap?.({ runId, signal: controller.signal });
          if (this._streamRecover) return this._streamRecover();
          finish(false);
        },
      }, afterSeq);
      if (settled) cleanup();
      else if (this._abort === controller) this._streamCleanup = cleanup;
      else finish(false);
      controller.signal.addEventListener('abort', () => finish(false), { once: true });
      if (controller.signal.aborted) finish(false);
    });
    if (this._abort === controller) {
      this._abort = undefined;
      this._streamFinish = undefined;
      this._streamRecover = undefined;
      this._terminalCallbacks = undefined;
      this._clearPendingRun();
    }
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

    if ((event === 'run_start' || event === 'assistant_message_start' || event === 'assistant_delta')
      && payload.textSurface === 'conversation') cb?.onTextSurface?.('conversation');

    switch (event) {
      case 'run_start':
        if (typeof parsed.runId === 'string' && this._chatId) {
          this._trackedRunId = parsed.runId;
          setPendingAgentRun(this._chatId, parsed.runId);
        }
        if (typeof parsed.runId === 'string') cb?.onStreamStart(parsed.runId, payload.startsNewBubble === true,
          normalizeTaskTrigger(payload.taskTrigger) ?? undefined);
        break;
      case 'user_message': {
        const rawMessage = payload.message && typeof payload.message === 'object'
          ? payload.message as Record<string, unknown>
          : {};
        const userMsg = userMessageFromStreamPayload({
          ...rawMessage,
          turnId: typeof rawMessage.turnId === 'string' ? rawMessage.turnId : parsed.runId,
        });
        if (userMsg) cb?.onUserMessage?.(userMsg);
        break;
      }
      case 'user_transcript': {
        const userMsg = userMessageFromStreamPayload({
          text: payload.text,
          media: payload.media,
          timestamp: parsed.timestamp,
          turnId: parsed.runId,
        });
        if (userMsg) cb?.onUserMessage?.(userMsg);
        break;
      }
      case 'assistant_message_start':
        if (typeof parsed.runId === 'string') cb?.onStreamStart(parsed.runId);
        break;
      case 'assistant_delta':
        if (typeof payload.delta === 'string' && payload.delta) {
          if (typeof parsed.runId === 'string' && payload.delta.trim()) recordResponseText(parsed.runId, 'realtime');
          cb?.onToken(
            payload.delta,
            typeof payload.messageId === 'string' ? payload.messageId : undefined,
            typeof payload.offset === 'number' ? payload.offset : undefined,
          );
        }
        break;
      case 'thinking_delta':
        if (typeof payload.delta === 'string' && payload.delta) cb?.onThinking(payload.delta, true,
          typeof payload.messageId === 'string' ? payload.messageId : undefined);
        break;
      case 'thinking_end':
        cb?.onThinkingEnd(typeof payload.messageId === 'string' ? payload.messageId : undefined);
        break;
      case 'assistant_message_end':
        cb?.onThinkingEnd(typeof payload.messageId === 'string' ? payload.messageId : undefined);
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
          toolExecutionMetadata(payload),
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
          toolExecutionMetadata(payload),
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
      case 'session_config_updated':
        cb?.onSessionConfigUpdated?.();
        break;
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

          cb.onClarifyRequest({
            ...readClarificationPresentation(payload),
            requestId,
            kind: payload.kind === 'approval' ? 'approval' : 'input',
            question,

            version: typeof payload.version === 'number' ? payload.version : 1,
            createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : Date.now(),
            expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
          });
        }
        break;
      }
      case 'run_end':
        if (
          typeof parsed.runId === 'string'
          && typeof parsed.conversationId === 'string'
          && (payload.status === 'success' || payload.status === 'error' || payload.status === 'cancelled' || payload.status === 'suspended')
        ) {
          finishResponseLatency(parsed.runId, payload.status);
          cb?.onResult({
            runId: parsed.runId,
            conversationId: parsed.conversationId,
            status: payload.status,
            ...(typeof payload.summary === 'string' && payload.summary ? { summary: payload.summary } : {}),
          });
        }
        break;
      case 'error':
        if (typeof parsed.runId === 'string') finishResponseLatency(parsed.runId, 'error');
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

function toolExecutionMetadata(payload: Record<string, unknown>): AgentStreamToolExecutionMetadata {
  return {
    ...(typeof payload.parentToolCallId === 'string' ? { parentToolCallId: payload.parentToolCallId } : {}),
    ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
  };
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
