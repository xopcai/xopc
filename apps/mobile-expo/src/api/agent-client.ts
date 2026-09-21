import {
  dispatchAgentStreamEvent,
  type AgentStreamCallbacks,
  type AgentStreamDispatchOptions,
} from '@xopcai/agent-stream-client';
import {
  buildSessionDetailPath,
  parseSessionResponse,
  type ClarificationResponseAction,
  type ClarificationWaitSnapshot,
} from '@xopcai/gateway-contract';

import {
  apiFetch,
  apiUploadFile,
  formatApiHttpError,
} from './client';
import { readUriAsBase64 } from '../features/chat/attachment-file-io';
import type { WireAttachment } from '../features/chat/composer.types';
import {
  advancePendingAgentRunCursor,
  clearPendingAgentRun,
  readPendingAgentRunCursor,
  resetPendingAgentRunCursor,
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
import { useGatewayStore } from '../stores/gateway-store';
import type { MessageSubmission } from '../features/chat/message-submission';
import { usePreferencesStore } from '../stores/preferences-store';

export type MessagingCallbacks = AgentStreamCallbacks;

export type AgentStreamResumeOptions = {
  /** Cancels this local attachment, never the server run. */
  signal?: AbortSignal;
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
  const preferredLanguage = usePreferencesStore.getState().language === 'zh' ? 'zh' : 'en';
  // STT providers expect a language code, not a UI locale such as zh-CN.
  const language = (options?.language?.trim() || preferredLanguage).toLowerCase().split(/[-_]/)[0];
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

export async function fetchClarificationSnapshot(conversationId: string): Promise<ClarificationWaitSnapshot> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/clarification`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const json = await res.json() as { ok?: boolean; payload?: ClarificationWaitSnapshot; error?: { message?: string } };
  if (!json.ok || !json.payload) throw new Error(json.error?.message ?? 'Clarification state unavailable');
  return json.payload;
}

export async function submitClarificationResponse(
  requestId: string,
  payload: {
    action: ClarificationResponseAction;
    expectedVersion: number;
    idempotencyKey: string;
    answer?: string;
  },
): Promise<void> {
  const res = await apiFetch(`/api/clarifications/${encodeURIComponent(requestId)}/responses`, {
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

function streamDispatchOptions(conversationId: string, sender: AgentMessageSender): AgentStreamDispatchOptions {
  return {
    conversationId: conversationId,
    savePendingRunId: (conversationId, runId) => {
      sender.trackPendingRunId(runId);
      setPendingAgentRun(conversationId, runId);
    },
  };
}

/**
 * Submits messages and manages an independently attached run stream.
 */
export class AgentMessageSender {
  private _gatewayId: string | null | undefined;
  private _abort?: AbortController;
  private _conversationId = '';
  /** `runId` from the `run_start` event for this POST/resume; do not clear a newer pending run. */
  private _trackedRunId?: string;
  /** Abort controllers detached locally without cancelling their server runs. */
  private readonly _localDetaches = new WeakSet<AbortController>();
  private _streamCleanup?: () => void;

  isStreamingFor(conversationId: string): boolean {
    return !!this._abort && this._conversationId === conversationId;
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

  /** Close a stale local attachment without sending an abort or retaining its pending run. */
  settleCompletedStream(): void {
    if (!this._abort) return;
    if (this._gatewayId === useGatewayStore.getState().activeGatewayId && this._trackedRunId) {
      this._clearPendingRun(this._conversationId, this._trackedRunId);
    }
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
    if (this._gatewayId !== useGatewayStore.getState().activeGatewayId) return;
    if (!this._conversationId) return;
    try {
      const raw = storage.getString(pendingRunStorageKey(this._conversationId));
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
    const conversationId = this._conversationId;
    if (!conversationId) return;
    try {
      storage.delete(pendingRunStorageKey(conversationId));
      clearPendingAgentRun(conversationId);
    } catch {
      /* ignore */
    }
    this._trackedRunId = undefined;
  }

  private _clearPendingRun(conversationId: string, expectedRunId: string): void {
    if (!conversationId) return;
    try {
      const key = pendingRunStorageKey(conversationId);
      const raw = storage.getString(key);
      if (raw) {
        const pr = JSON.parse(raw) as { runId?: string };
        const stored = typeof pr?.runId === 'string' ? pr.runId : '';
        if (stored && stored !== expectedRunId) {
          return;
        }
      }
      storage.delete(key);
      clearPendingAgentRun(conversationId);
    } catch {
      /* ignore */
    }
    this._trackedRunId = undefined;
  }

  /** Resolves when the gateway accepts the message; run streaming is separate. */
  async sendMessage(input: MessageSubmission): Promise<{ runId?: string }> {
    const generation = useGatewayStore.getState().connectionGeneration;
    const assertCurrent = () => {
      const state = useGatewayStore.getState();
      if (state.activeGatewayId !== input.gatewayId || state.connectionGeneration !== generation) {
        throw new Error('Active work computer changed');
      }
    };
    assertCurrent();
    if (!input.expectedTranscriptId) {
      const response = await apiFetch(buildSessionDetailPath(input.conversationId));
      assertCurrent();
      if (!response.ok) throw new Error(formatApiHttpError(response.status, response.statusText));
      const identity = parseSessionResponse(await response.json()).session?.transcriptId;
      if (!identity) throw new Error('Session identity is unavailable');
      input.expectedTranscriptId = identity;
    }
    // Keep uploaded references on the same submission so manual retries use identical media.
    input.attachments = await materializeAttachments(input.attachments);
    assertCurrent();
    const origin = await waitForMobileEndpointTurnClaim(undefined, requestMobileRealtimeReconnect);
    assertCurrent();
    const response = await apiFetch(input.taskId
      ? `/api/tasks/${encodeURIComponent(input.taskId)}/inputs`
      : `/api/sessions/${encodeURIComponent(input.conversationId)}/inputs`, {
      method: 'POST',
      ...(input.taskId ? { headers: { 'X-Xopc-Expected-Session-Key': input.conversationId } } : {}),
      body: JSON.stringify({
        clientMessageId: input.clientMessageId,
        expectedTranscriptId: input.expectedTranscriptId,
        delivery: input.delivery,
        content: input.content,
        origin,
        ...(input.attachments.length ? { attachments: input.attachments } : {}),
        ...(input.contextRefs.length ? { contextRefs: input.contextRefs } : {}),
      }),
    });
    assertCurrent();
    const json = await response.json().catch(() => null) as {
      error?: { message?: string };
      payload?: { state?: { activeRunId?: string; inputs?: Array<{ clientMessageId: string }> } };
    } | null;
    if (!response.ok) {
      throw new Error(formatApiHttpError(response.status, response.statusText, json?.error?.message));
    }
    assertCurrent();
    const state = json?.payload?.state;
    // Completed idempotent retries have no row in the active input list.
    if (!state || !Array.isArray(state.inputs)) {
      throw new Error('Network response was invalid');
    }
    return { runId: state.activeRunId };
  }

  async resume(
    runId: string,
    conversationId: string,
    callbacks?: MessagingCallbacks,
    options: AgentStreamResumeOptions = {},
  ): Promise<void> {
    if (options.signal?.aborted) return;
    this.detachLocalStream();
    this._trackedRunId = undefined;
    this._abort = new AbortController();
    const abortController = this._abort;
    this._conversationId = conversationId;
    const gatewayId = useGatewayStore.getState().activeGatewayId;
    const generation = useGatewayStore.getState().connectionGeneration;
    this._gatewayId = gatewayId;
    const isCurrentConnection = () => useGatewayStore.getState().activeGatewayId === gatewayId && useGatewayStore.getState().connectionGeneration === generation;
    this.trackPendingRunId(runId);
    setPendingAgentRun(conversationId, runId);
    if (options.replayFromStart) resetPendingAgentRunCursor(conversationId, runId);
    const terminal = wrapTerminalCallbacks(callbacks);
    const opts = streamDispatchOptions(conversationId, this);
    let preservePending = false;
    let unsubscribe: (() => void) | undefined;
    const cleanupStream = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (this._streamCleanup === cleanupStream) this._streamCleanup = undefined;
    };
    const detach = () => {
      this._localDetaches.add(abortController);
      abortController.abort();
    };
    options.signal?.addEventListener('abort', detach, { once: true });

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
          : readPendingAgentRunCursor(conversationId, runId);
        unsubscribe = subscribeMobileRealtimeTopic(`run:${runId}`, {
          onSubscribed: () => {
            if (attachDeadline.timer) clearTimeout(attachDeadline.timer);
          },
          onEvent: (message) => {
            if (settled || abortController.signal.aborted) return;
            if (!isCurrentConnection() || this._abort !== abortController) { finish(); return; }
            if (attachDeadline.timer) clearTimeout(attachDeadline.timer);
            const event = message.data && typeof message.data === 'object'
              ? { ...(message.data as Record<string, unknown>), seq: message.seq }
              : { type: message.event, seq: message.seq, payload: message.data };
            dispatchAgentStreamEvent(message.event, JSON.stringify(event), terminal.wrapped, opts);
            advancePendingAgentRunCursor(conversationId, runId, message.seq);
            if (message.event === 'run_end' || message.event === 'error') finish();
          },
          onGap: (gap) => {
            if (settled || abortController.signal.aborted) return;
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
      options.signal?.removeEventListener('abort', detach);
      const localDetach = this._localDetaches.has(abortController);
      this._localDetaches.delete(abortController);
      cleanupStream();
      if (!isCurrentConnection() || this._abort !== abortController) {
        // The previous computer keeps its cursor; never mutate the new connection.
      } else if (!localDetach && !preservePending) {
        this._clearPendingRun(conversationId, runId);
      }
      if (this._abort === abortController) {
        this._abort = undefined;
      }
    }
  }

}
