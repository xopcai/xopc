import {
  dispatchAgentStreamEvent,
  type AgentStreamCallbacks,
  type AgentStreamDispatchOptions,
} from '@xopcai/agent-stream-client';
import {
  SESSION_INPUT_RETRY_DELAYS_MS,
  shouldRetrySessionInputStatus,
} from '@xopcai/gateway-contract';

import {
  apiFetch,
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
  readPendingSessionInput,
  type PendingSessionInput,
} from '../features/gateway/session-input-outbox';

async function postSessionInput(path: string, body: string): Promise<Response> {
  let lastError: unknown;
  for (const delayMs of SESSION_INPUT_RETRY_DELAYS_MS) {
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    try {
      const response = await apiFetch(path, { method: 'POST', body });
      if (!shouldRetrySessionInputStatus(response.status)) return response;
      lastError = new Error(`Session input temporarily unavailable (${response.status})`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Session input request failed');
}

export type MessagingCallbacks = AgentStreamCallbacks;

async function materializeAttachments(attachments: WireAttachment[]): Promise<WireAttachment[]> {
  return Promise.all(attachments.map(async ({ localUri, ...attachment }) => {
    if (!localUri || attachment.uri || attachment.workspaceRelativePath) return attachment;
    const { content, size } = await readUriAsBase64(localUri, attachment.name);
    return { ...attachment, data: content, size };
  }));
}

export type VoiceMessagePayload = {
  uri: string;
  durationMillis: number;
  mimeType?: string;
  name?: string;
};

export interface VoiceTranscribeResult {
  raw: string;
  refined?: string;
  language?: string;
}

/**
 * Transcribe audio via gateway STT + optional LLM refine.
 * Returns { raw, refined?, language? }.
 */
export async function transcribeVoice(
  uri: string,
  mimeType: string,
  options?: { language?: string },
): Promise<VoiceTranscribeResult> {
  const { content } = await readUriAsBase64(uri, 'voice.m4a');
  const res = await apiFetch('/api/voice/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio: content,
      mimeType,
      ...(options?.language ? { language: options.language } : {}),
    }),
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
  private _abort?: AbortController;
  private _sessionKey = '';
  /** `runId` from the `run_start` event for this POST/resume; do not clear a newer pending run. */
  private _trackedRunId?: string;
  /** Local transport teardown for resume/recovery — do not abort the server run or clear pending runId. */
  private _localDetach = false;
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
    this._localDetach = true;
    const abortController = this._abort;
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

  private _clearPendingRun(): void {
    const sessionKey = this._sessionKey;
    if (!sessionKey) return;
    try {
      const key = pendingRunStorageKey(sessionKey);
      const raw = storage.getString(key);
      if (raw) {
        const pr = JSON.parse(raw) as { runId?: string };
        const stored = typeof pr?.runId === 'string' ? pr.runId : '';
        if (this._trackedRunId && stored && stored !== this._trackedRunId) {
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
  ): Promise<void> {
    const capped = capAttachments(attachments);
    const entry = enqueueSessionInput(sessionKey, message, capped ?? []);
    await this._submitPendingInput(entry, callbacks);
  }

  async retryPendingMessage(sessionKey: string, callbacks?: MessagingCallbacks): Promise<boolean> {
    const entry = readPendingSessionInput(sessionKey);
    if (!entry) return false;
    await this._submitPendingInput(entry, callbacks, true);
    return true;
  }

  async flushPendingMessage(sessionKey: string): Promise<boolean> {
    const entry = readPendingSessionInput(sessionKey);
    if (!entry) return false;
    await this._submitPendingInput(entry, undefined, false);
    return true;
  }

  private async _submitPendingInput(
    queuedEntry: PendingSessionInput,
    callbacks?: MessagingCallbacks,
    attachRun = true,
  ): Promise<void> {
    const entry = markSessionInputAttempt(queuedEntry);
    let attachments: WireAttachment[];
    try {
      attachments = await materializeAttachments(entry.attachments);
    } catch (error) {
      completeSessionInput(entry.sessionKey, entry.clientMessageId);
      throw error;
    }
    const origin = await waitForMobileEndpointTurnClaim(
      undefined,
      requestMobileRealtimeReconnect,
    );
    const res = await postSessionInput(
      `/api/sessions/${encodeURIComponent(entry.sessionKey)}/inputs`,
      JSON.stringify({
        clientMessageId: entry.clientMessageId,
        delivery: 'next',
        content: entry.content,
        origin,
        ...(attachments.length ? { attachments } : {}),
      }),
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      completeSessionInput(entry.sessionKey, entry.clientMessageId);
      throw new Error(formatApiHttpError(res.status, res.statusText, body?.error?.message));
    }
    completeSessionInput(entry.sessionKey, entry.clientMessageId);
    const json = await res.json().catch(() => {
      throw new Error('Network response was invalid');
    }) as { payload?: { state?: {
      activeRunId?: string; activeInputId?: string;
      inputs?: Array<{ id: string; clientMessageId: string }>;
    } } };
    const state = json.payload?.state;
    const own = state?.inputs?.find((input) => input.clientMessageId === entry.clientMessageId);
    if (attachRun && state?.activeRunId && own?.id === state.activeInputId) {
      return this.resume(state.activeRunId, entry.sessionKey, callbacks);
    }
  }

  async sendVoiceMessage(
    payload: VoiceMessagePayload,
    sessionKey: string,
    callbacks?: MessagingCallbacks,
  ): Promise<void> {
    const mimeType = payload.mimeType || 'audio/mp4';
    const name = payload.name || (mimeType.includes('mpeg') ? 'voice.mp3' : 'voice.m4a');
    const { content, size } = await readUriAsBase64(payload.uri, name);
    const secs = payload.durationMillis / 1000;
    const durationSeconds =
      Number.isFinite(secs) && secs >= 0.05 ? Math.round(secs * 1000) / 1000 : undefined;
    const wire: WireAttachment = {
      type: 'voice',
      mimeType,
      data: content,
      localUri: payload.uri,
      name,
      size,
      ...(durationSeconds != null ? { durationSeconds } : {}),
    };
    return this.sendMessage('', sessionKey, callbacks, [wire]);
  }

  async resume(runId: string, sessionKey: string, callbacks?: MessagingCallbacks): Promise<void> {
    if (this.isStreamingFor(sessionKey)) {
      this.detachLocalStream();
    }
    this._trackedRunId = undefined;
    this._abort = new AbortController();
    const abortController = this._abort;
    this._sessionKey = sessionKey;
    this.trackPendingRunId(runId);
    setPendingAgentRun(sessionKey, runId);
    const terminal = wrapTerminalCallbacks(callbacks);
    const opts = streamDispatchOptions(sessionKey, this);
    let preservePending = false;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const attachDeadline: { timer?: ReturnType<typeof setTimeout> } = {};
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (attachDeadline.timer) clearTimeout(attachDeadline.timer);
          this._streamCleanup?.();
          this._streamCleanup = undefined;
          if (error) reject(error);
          else resolve();
        };
        attachDeadline.timer = setTimeout(() => {
          requestMobileRealtimeReconnect();
          finish(new Error('Realtime stream attach timed out'));
        }, STREAM_ATTACH_TIMEOUT_MS);
        const afterSeq = readPendingAgentRunCursor(sessionKey, runId);
        this._streamCleanup = subscribeMobileRealtimeTopic(`run:${runId}`, {
          onEvent: (message) => {
            if (attachDeadline.timer) clearTimeout(attachDeadline.timer);
            const event = message.data && typeof message.data === 'object'
              ? { ...(message.data as Record<string, unknown>), seq: message.seq }
              : { type: message.event, seq: message.seq, payload: message.data };
            dispatchAgentStreamEvent(message.event, JSON.stringify(event), terminal.wrapped, opts);
            advancePendingAgentRunCursor(sessionKey, runId, message.seq);
            if (message.event === 'run_end' || message.event === 'error') finish();
          },
          onGap: (gap) => {
            if (gap.recoverable) return terminal.wrapped?.onReplayGap?.();
            finish(new Error('Run not found or realtime replay expired'));
          },
        }, afterSeq);
        abortController.signal.addEventListener('abort', () => finish(), { once: true });
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      preservePending = this._localDetach
        || (!abortController.signal.aborted && isTransientNetworkError(message));
      if (this._localDetach) return;
      throw e;
    } finally {
      const localDetach = this._localDetach;
      this._localDetach = false;
      if (localDetach || preservePending) {
        this._rePersistPendingRunAfterDetach();
      } else {
        this._clearPendingRun();
      }
      if (this._abort === abortController) {
        this._abort = undefined;
      }
    }
  }

  private _rePersistPendingRunAfterDetach(): void {
    const sessionKey = this._sessionKey;
    const runId =
      this._trackedRunId?.trim() ||
      (sessionKey ? readPendingAgentRunId(sessionKey) : null) ||
      undefined;
    if (sessionKey && runId) {
      setPendingAgentRun(sessionKey, runId);
    }
  }

}
