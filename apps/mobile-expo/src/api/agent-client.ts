import {
  dispatchAgentStreamEvent,
  type AgentStreamCallbacks,
  type AgentStreamDispatchOptions,
} from '@xopcai/agent-stream-client';
import {
  SESSION_INPUT_RETRY_DELAYS_MS,
  buildSessionDetailPath,
  parseSessionResponse,
  shouldRetrySessionInputStatus,
} from '@xopcai/gateway-contract';

import {
  apiFetch,
  apiUploadFile,
  formatApiHttpError,
} from './client';
import { readUriAsBase64 } from '../features/chat/attachment-file-io';
import { capAttachments } from '../features/chat/chat-limits';
import type { WireAttachment } from '../features/chat/composer.types';
import {
  advancePendingAgentRunCursor,
  clearPendingAgentRun,
  readPendingAgentRunCursor,
  readPendingAgentRunId,
  setPendingAgentRun,
} from '../features/gateway/pending-agent-run';
import {
  isTransientNetworkError,
  STREAM_ATTACH_TIMEOUT_MS,
} from '../features/chat/network-errors';
import { pendingRunStorageKey, storage } from '../storage/mmkv';
import { waitForMobileEndpointTurnClaim } from '../features/endpoint-tools/turn-claim';
import {
  requestMobileRealtimeReconnect,
  subscribeMobileRealtimeTopic,
} from '../features/gateway/use-gateway-realtime';
import {
  completeSessionInput,
  enqueueSessionInput,
  markSessionInputAttempt,
  updatePendingSessionInput,
  readPendingSessionInput,
  type PendingSessionInput,
} from '../features/gateway/session-input-outbox';
import { useGatewayStore } from '../stores/gateway-store';
import { readCachedSessionDetail } from '../features/gateway/session-detail-cache';
import { retainOutboxAttachments, releaseOutboxAttachments } from '../features/gateway/outbox-attachments';
import { usePreferencesStore } from '../stores/preferences-store';
import { DataSharingConsentError } from '../features/privacy/consent-controller';

async function postSessionInput(path: string, body: string, headers?: Record<string, string>, assertCurrent: () => void = () => {}): Promise<Response> {
  let lastError: unknown;
  for (const delayMs of SESSION_INPUT_RETRY_DELAYS_MS) {
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    assertCurrent();
    try {
      const response = await apiFetch(path, { method: 'POST', body, ...(headers ? { headers } : {}) });
      assertCurrent();
      if (!shouldRetrySessionInputStatus(response.status)) return response;
      lastError = new Error(`Session input temporarily unavailable (${response.status})`);
    } catch (error) {
      assertCurrent();
      if (error instanceof DataSharingConsentError) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Session input request failed');
}

export type MessagingCallbacks = AgentStreamCallbacks;

export type AgentStreamResumeOptions = {
  /** Rebuild an empty in-memory assistant projection from the retained run log. */
  replayFromStart?: boolean;
};

export class AgentStreamReplayExpiredError extends Error {
  constructor() {
    super('Run not found or realtime replay expired');
    this.name = 'AgentStreamReplayExpiredError';
  }
}

async function materializeAttachments(attachments: WireAttachment[]): Promise<WireAttachment[]> {
  return Promise.all(attachments.map(async ({ localUri, ...attachment }) => {
    const isAudio = attachment.type === 'voice' || attachment.mimeType?.startsWith('audio/');
    if (isAudio) {
      const audioAttachment = { ...attachment };
      delete audioAttachment.data;
      if (audioAttachment.uri || audioAttachment.workspaceRelativePath) return audioAttachment;
      if (!localUri) throw new Error('Audio attachment is missing a native file URI');
      const uploaded = await uploadMediaFile({
        uri: localUri,
        mimeType: audioAttachment.mimeType ?? 'audio/mp4',
      });
      return { ...audioAttachment, ...uploaded };
    }
    if (!localUri || attachment.uri || attachment.workspaceRelativePath) return attachment;
    const { content, size } = await readUriAsBase64(localUri, attachment.name);
    return { ...attachment, data: content, size };
  }));
}

async function uploadMediaFile(input: {
  uri: string;
  mimeType: string;
}): Promise<{ uri: string; name: string; mimeType: string; size: number }> {
  const res = await apiUploadFile('/api/media', {
    uri: input.uri,
    fieldName: 'file',
    mimeType: input.mimeType,
    timeoutMs: 60_000,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const json = await res.json() as {
    ok?: boolean;
    payload?: { uri?: string; name?: string; mimeType?: string; size?: number };
    error?: { message?: string };
  };
  const payload = json.payload;
  if (!json.ok || !payload?.uri || !payload.name || !payload.mimeType || typeof payload.size !== 'number') {
    throw new Error(json.error?.message ?? 'Media upload failed');
  }
  return {
    uri: payload.uri,
    name: payload.name,
    mimeType: payload.mimeType,
    size: payload.size,
  };
}

export type VoiceMessagePayload = {
  uri: string;
  durationMillis: number;
  mimeType?: string;
  name?: string;
};

export interface VoiceTranscribeResult {
  text: string;
  refinementAvailable: boolean;
  language?: string;
}

/** Transcribe audio through the gateway and return provider text immediately. */
export async function transcribeVoice(
  uri: string,
  mimeType: string,
  options?: { language?: string },
): Promise<VoiceTranscribeResult> {
  const preferredLanguage = usePreferencesStore.getState().language === 'zh' ? 'zh-CN' : 'en-US';
  const language = options?.language?.trim() || preferredLanguage;
  const res = await apiUploadFile('/api/voice/transcriptions', {
    uri,
    fieldName: 'audio',
    mimeType,
    parameters: { language },
    timeoutMs: 60_000,
    recoverRouteOnNetworkError: true,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(
      formatApiHttpError(res.status, res.statusText, body.error?.message),
    );
  }
  const json = (await res.json()) as { ok: boolean; payload?: VoiceTranscribeResult; error?: { message?: string } };
  if (!json.ok || !json.payload) {
    throw new Error(json.error?.message ?? 'Transcription failed');
  }
  return json.payload;
}

export async function refineVoiceTranscript(text: string): Promise<string> {
  const res = await apiFetch('/api/voice/transcriptions/refine', {
    method: 'POST',
    body: JSON.stringify({ text }),
    timeoutMs: 60_000,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const json = await res.json() as { ok?: boolean; payload?: { text?: string }; error?: { message?: string } };
  if (!json.ok || typeof json.payload?.text !== 'string') {
    throw new Error(json.error?.message ?? 'Transcript refinement failed');
  }
  return json.payload.text;
}

export async function submitClarifyResponse(
  requestId: string,
  payload: { answer: string } | { skip: true },
): Promise<void> {
  const res = await apiFetch(`/api/clarify/${encodeURIComponent(requestId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
}

function wrapTerminalCallbacks(cb?: MessagingCallbacks): {
  wrapped: MessagingCallbacks | undefined;
  sawTerminal: boolean;
  onMissingTerminal: (payload: Parameters<MessagingCallbacks['onResult']>[0]) => void;
} {
  if (!cb) {
    return { wrapped: undefined, sawTerminal: false, onMissingTerminal: () => {} };
  }
  let sawTerminal = false;
  const markTerminal = () => {
    sawTerminal = true;
  };
  const guarded = <T extends unknown[]>(fn: ((...args: T) => void) | undefined) =>
    (...args: T) => {
      if (sawTerminal) return;
      fn?.(...args);
    };
  return {
    get sawTerminal() {
      return sawTerminal;
    },
    wrapped: {
      ...cb,
      onStreamStart: guarded(cb.onStreamStart),
      onUserTranscript: guarded(cb.onUserTranscript),
      onToken: guarded(cb.onToken),
      onAssistantMessageEnd: guarded(cb.onAssistantMessageEnd),
      onThinking: guarded(cb.onThinking),
      onThinkingEnd: guarded(cb.onThinkingEnd),
      onToolStart: guarded(cb.onToolStart),
      onToolUpdate: guarded(cb.onToolUpdate),
      onToolEnd: guarded(cb.onToolEnd),
      onCommandStarted: guarded(cb.onCommandStarted),
      onCommandOutputDelta: guarded(cb.onCommandOutputDelta),
      onCommandCompleted: guarded(cb.onCommandCompleted),
      onPatchApplied: guarded(cb.onPatchApplied),
      onTurnPlanUpdated: guarded(cb.onTurnPlanUpdated),
      onTurnDiff: guarded(cb.onTurnDiff),
      onReview: guarded(cb.onReview),
      onProgress: guarded(cb.onProgress),
      onTtsAudio: cb.onTtsAudio,
      onClarifyRequest: guarded(cb.onClarifyRequest),
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
    onMissingTerminal: (payload) => {
      if (sawTerminal) return;
      markTerminal();
      cb.onResult(payload);
    },
  };
}

function streamDispatchOptions(sessionKey: string, sender: AgentMessageSender): AgentStreamDispatchOptions {
  return {
    sessionKey: sessionKey,
    savePendingRunId: (sessionKey, runId) => {
      sender.trackPendingRunId(runId);
      setPendingAgentRun(sessionKey, runId);
    },
  };
}

/**
 * Submits a durable session input and attaches to its active run, matching the web console.
 */
export class AgentMessageSender {
  private _gatewayId: string | null | undefined;
  private _abort?: AbortController;
  private _sessionKey = '';
  /** `runId` from the `run_start` event for this POST/resume; do not clear a newer pending run. */
  private _trackedRunId?: string;
  /** Abort controllers detached locally without cancelling their server runs. */
  private readonly _localDetaches = new WeakSet<AbortController>();
  private _streamCleanup?: () => void;

  get isSending() {
    return !!this._abort;
  }

  isStreamingFor(sessionKey: string): boolean {
    return !!this._abort && this._sessionKey === sessionKey;
  }

  trackPendingRunId(runId: string): void {
    const id = runId.trim();
    if (id) this._trackedRunId = id;
  }

  /**
   * Detach the local run-topic listener without notifying the server or clearing the pending runId.
   * Used when the connection stalls and the shared realtime client must reattach.
   */
  detachLocalStream(): void {
    if (!this._abort) return;
    const abortController = this._abort;
    this._localDetaches.add(abortController);
    abortController.abort();
    this._streamCleanup?.();
    this._streamCleanup = undefined;
    if (this._abort === abortController) {
      this._abort = undefined;
    }
  }

  abort(): void {
    this._notifyServerAbort();
    this._forceClearPendingRun();
    this._abort?.abort();
    this._streamCleanup?.();
    this._streamCleanup = undefined;
    this._abort = undefined;
  }

  private _notifyServerAbort(): void {
    if (this._gatewayId !== useGatewayStore.getState().activeGatewayId) return;
    if (!this._sessionKey) return;
    try {
      const raw = storage.getString(pendingRunStorageKey(this._sessionKey));
      if (!raw) return;
      const parsed = JSON.parse(raw) as { runId?: string };
      if (typeof parsed.runId !== 'string' || !parsed.runId) return;
      void apiFetch('/api/agent/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: parsed.runId }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private _forceClearPendingRun(): void {
    if (this._gatewayId !== useGatewayStore.getState().activeGatewayId) return;
    const sessionKey = this._sessionKey;
    if (!sessionKey) return;
    try {
      storage.delete(pendingRunStorageKey(sessionKey));
      clearPendingAgentRun(sessionKey);
    } catch {
      /* ignore */
    }
    this._trackedRunId = undefined;
  }

  private _clearPendingRun(sessionKey: string, expectedRunId: string): void {
    if (!sessionKey) return;
    try {
      const key = pendingRunStorageKey(sessionKey);
      const raw = storage.getString(key);
      if (raw) {
        const pr = JSON.parse(raw) as { runId?: string };
        const stored = typeof pr?.runId === 'string' ? pr.runId : '';
        if (stored && stored !== expectedRunId) {
          return;
        }
      }
      storage.delete(key);
      clearPendingAgentRun(sessionKey);
    } catch {
      /* ignore */
    }
    this._trackedRunId = undefined;
  }

  async sendMessage(
    message: string,
    sessionKey: string,
    callbacks?: MessagingCallbacks,
    attachments?: WireAttachment[],
    taskId?: string,
  ): Promise<void> {
    const capped = capAttachments(attachments);
    let entry = enqueueSessionInput(sessionKey, message, capped ?? [], taskId);
    try {
      entry = updatePendingSessionInput(entry, { attachments: retainOutboxAttachments(entry.clientMessageId, entry.attachments), ...(entry.needsReview ? { needsReview: false, createdAt: Date.now() } : {}) });
    } catch (error) {
      updatePendingSessionInput(entry, { needsReview: true });
      throw error;
    }
    await this._submitPendingInput(entry, callbacks, true, true);
  }

  async retryPendingMessage(sessionKey: string, callbacks?: MessagingCallbacks): Promise<boolean> {
    const entry = readPendingSessionInput(sessionKey);
    if (!entry || entry.needsReview) return false;
    await this._submitPendingInput(entry, callbacks, true);
    return true;
  }

  async flushPendingMessage(sessionKey: string): Promise<boolean> {
    const entry = readPendingSessionInput(sessionKey);
    if (!entry || entry.needsReview) return false;
    await this._submitPendingInput(entry, undefined, false);
    return true;
  }

  private async _submitPendingInput(
    queuedEntry: PendingSessionInput,
    callbacks?: MessagingCallbacks,
    attachRun = true,
    resolveIdentity = false,
  ): Promise<void> {
    const generation = useGatewayStore.getState().connectionGeneration;
    const assertCurrent = () => {
      const state = useGatewayStore.getState();
      if (state.activeGatewayId !== queuedEntry.gatewayId || state.connectionGeneration !== generation) throw new Error('Active work computer changed');
      if (readPendingSessionInput(queuedEntry.sessionKey, queuedEntry.gatewayId)?.clientMessageId !== queuedEntry.clientMessageId) throw new Error('Pending input was removed');
    };
    assertCurrent();
    if (queuedEntry.needsReview) throw new Error('Message needs review');
    const cachedId = readCachedSessionDetail(queuedEntry.gatewayId, queuedEntry.sessionKey)?.sessionId;
    if ((queuedEntry.expectedSessionId && cachedId && cachedId !== queuedEntry.expectedSessionId)
      || (!queuedEntry.expectedSessionId && (!resolveIdentity || queuedEntry.attemptCount > 0))) {
      updatePendingSessionInput(queuedEntry, { needsReview: true });
      throw new Error('Message needs review');
    }
    if (!queuedEntry.expectedSessionId) {
      const response = await apiFetch(buildSessionDetailPath(queuedEntry.sessionKey)).catch(error => {
        updatePendingSessionInput(queuedEntry, { needsReview: true });
        throw error;
      });
      assertCurrent();
      const identity = response.ok ? parseSessionResponse(await response.json()).session?.sessionId : undefined;
      if (!identity) {
        updatePendingSessionInput(queuedEntry, { needsReview: true });
        throw new Error('Message needs review');
      }
      queuedEntry = updatePendingSessionInput(queuedEntry, { expectedSessionId: identity });
    }
    const entry = markSessionInputAttempt(queuedEntry);
    let attachments: WireAttachment[];
    try {
      attachments = await materializeAttachments(entry.attachments);
    } catch (error) {
      if (error instanceof DataSharingConsentError || !isTransientNetworkError(error instanceof Error ? error.message : String(error))) updatePendingSessionInput(entry, { needsReview: true });
      throw error;
    }
    assertCurrent();
    const origin = await waitForMobileEndpointTurnClaim(
      undefined,
      requestMobileRealtimeReconnect,
    );
    assertCurrent();
    const res = await postSessionInput(
      entry.taskId
        ? `/api/tasks/${encodeURIComponent(entry.taskId)}/inputs`
        : `/api/sessions/${encodeURIComponent(entry.sessionKey)}/inputs`,
      JSON.stringify({
        clientMessageId: entry.clientMessageId,
        delivery: 'next',
        ...(entry.expectedSessionId ? { expectedSessionId: entry.expectedSessionId } : {}),
        content: entry.content,
        origin,
        ...(attachments.length ? { attachments } : {}),
      }),
      entry.taskId ? { 'X-Xopc-Expected-Session-Key': entry.sessionKey } : undefined,
      assertCurrent,
    ).catch((error: unknown) => {
      if (error instanceof DataSharingConsentError) updatePendingSessionInput(entry, { needsReview: true });
      throw error;
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      updatePendingSessionInput(entry, { needsReview: true });
      throw new Error(formatApiHttpError(res.status, res.statusText, body?.error?.message));
    }
    const json = await res.json().catch(() => {
      throw new Error('Network response was invalid');
    }) as { payload?: { state?: {
      activeRunId?: string; activeInputId?: string;
      inputs?: Array<{ id: string; clientMessageId: string }>;
    } } };
    // Keep the durable outbox entry until the acknowledgement body is usable.
    // A truncated 202 response is ambiguous: the gateway may already be
    // running the input, and retrying the same clientMessageId is idempotent.
    if (!json.payload?.state || !Array.isArray(json.payload.state.inputs)) throw new Error('Network response was invalid');
    assertCurrent();
    completeSessionInput(entry.sessionKey, entry.clientMessageId, entry.gatewayId);
    releaseOutboxAttachments(entry.clientMessageId);
    const state = json.payload?.state;
    const own = state?.inputs?.find((input) => input.clientMessageId === entry.clientMessageId);
    if (attachRun && state?.activeRunId && own?.id === state.activeInputId) {
      return this.resume(
        state.activeRunId,
        entry.sessionKey,
        callbacks,
        { replayFromStart: true },
      );
    }
  }

  async sendVoiceMessage(
    payload: VoiceMessagePayload,
    sessionKey: string,
    callbacks?: MessagingCallbacks,
    taskId?: string,
  ): Promise<void> {
    const mimeType = payload.mimeType || 'audio/mp4';
    const name = payload.name || (mimeType.includes('mpeg') ? 'voice.mp3' : 'voice.m4a');
    const secs = payload.durationMillis / 1000;
    const durationSeconds =
      Number.isFinite(secs) && secs >= 0.05 ? Math.round(secs * 1000) / 1000 : undefined;
    const wire: WireAttachment = {
      type: 'voice',
      mimeType,
      localUri: payload.uri,
      name,
      ...(durationSeconds != null ? { durationSeconds } : {}),
    };
    return this.sendMessage('', sessionKey, callbacks, [wire], taskId);
  }

  async resume(
    runId: string,
    sessionKey: string,
    callbacks?: MessagingCallbacks,
    options: AgentStreamResumeOptions = {},
  ): Promise<void> {
    if (this.isStreamingFor(sessionKey)) {
      this.detachLocalStream();
    }
    this._trackedRunId = undefined;
    this._abort = new AbortController();
    const abortController = this._abort;
    this._sessionKey = sessionKey;
    const gatewayId = useGatewayStore.getState().activeGatewayId;
    const generation = useGatewayStore.getState().connectionGeneration;
    this._gatewayId = gatewayId;
    const isCurrentConnection = () => useGatewayStore.getState().activeGatewayId === gatewayId && useGatewayStore.getState().connectionGeneration === generation;
    this.trackPendingRunId(runId);
    setPendingAgentRun(sessionKey, runId);
    const terminal = wrapTerminalCallbacks(callbacks);
    const opts = streamDispatchOptions(sessionKey, this);
    let preservePending = false;
    let unsubscribe: (() => void) | undefined;
    const cleanupStream = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (this._streamCleanup === cleanupStream) this._streamCleanup = undefined;
    };

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const attachDeadline: { timer?: ReturnType<typeof setTimeout> } = {};
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (attachDeadline.timer) clearTimeout(attachDeadline.timer);
          cleanupStream();
          if (error) reject(error);
          else resolve();
        };
        attachDeadline.timer = setTimeout(() => {
          requestMobileRealtimeReconnect();
          finish(new Error('Realtime stream attach timed out'));
        }, STREAM_ATTACH_TIMEOUT_MS);
        // The persisted cursor belongs to the previous UI projection. After a
        // cold start or screen remount that projection is empty, so replay the
        // retained run from zero and reconstruct the full assistant message.
        const afterSeq = options.replayFromStart
          ? 0
          : readPendingAgentRunCursor(sessionKey, runId);
        unsubscribe = subscribeMobileRealtimeTopic(`run:${runId}`, {
          onEvent: (message) => {
            if (!isCurrentConnection()) { finish(); return; }
            if (attachDeadline.timer) clearTimeout(attachDeadline.timer);
            const event = message.data && typeof message.data === 'object'
              ? { ...(message.data as Record<string, unknown>), seq: message.seq }
              : { type: message.event, seq: message.seq, payload: message.data };
            dispatchAgentStreamEvent(message.event, JSON.stringify(event), terminal.wrapped, opts);
            advancePendingAgentRunCursor(sessionKey, runId, message.seq);
            if (message.event === 'run_end' || message.event === 'error') finish();
          },
          onGap: (gap) => {
            if (!isCurrentConnection()) { finish(); return; }
            if (gap.recoverable) return terminal.wrapped?.onReplayGap?.();
            finish(new AgentStreamReplayExpiredError());
          },
        }, afterSeq);
        this._streamCleanup = cleanupStream;
        abortController.signal.addEventListener('abort', () => finish(), { once: true });
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const localDetach = this._localDetaches.has(abortController);
      preservePending = localDetach
        || (!abortController.signal.aborted && isTransientNetworkError(message));
      if (localDetach) return;
      throw e;
    } finally {
      const localDetach = this._localDetaches.has(abortController);
      this._localDetaches.delete(abortController);
      cleanupStream();
      if (!isCurrentConnection()) {
        // The previous computer keeps its cursor; never mutate the new connection.
      } else if (localDetach || preservePending) {
        this._rePersistPendingRunAfterDetach(sessionKey, runId);
      } else {
        this._clearPendingRun(sessionKey, runId);
      }
      if (this._abort === abortController) {
        this._abort = undefined;
      }
    }
  }

  private _rePersistPendingRunAfterDetach(sessionKey: string, runId: string): void {
    const storedRunId = readPendingAgentRunId(sessionKey);
    if (storedRunId && storedRunId !== runId) return;
    setPendingAgentRun(sessionKey, runId);
  }

}
