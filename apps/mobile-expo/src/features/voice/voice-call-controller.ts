import type { CreateVoiceSessionRequest, CreateVoiceSessionResponse, VoiceServerEvent } from '@xopcai/realtime-protocol/voice';
import type { VoiceTransport, VoiceTransportCallbacks } from './voice-transport';
import { VoiceDiagnostics, voiceDiagnosticFinding } from './voice-diagnostics';

type Transport = Pick<VoiceTransport, 'connect' | 'send' | 'audio' | 'close'>;

export type CallTarget = {
  gatewayId: string;
  sessionKey: string;
  engine?: 'agent' | 'omni';
  background: boolean;
  identity?: string;
  name?: string;
};
export type CallState = {
  phase: 'idle' | 'connecting' | 'connected' | 'recovering' | 'paused' | 'ending';
  target?: CallTarget; name: string; engine?: 'agent' | 'omni'; expanded: boolean; muted: boolean;
  startedAt: number; expiresAt?: number; responseId?: string; userText: string; assistantText: string;
  activity?: string; error?: string;
  responseStage?: 'thinking' | 'buffering' | 'speaking';
  clarification?: {
    requestId: string;
    kind: 'input' | 'approval';
    question: string;
    choices?: string[];
    suggestedAnswer?: string;
    version: number;
    createdAt: number;
    expiresAt?: number;
  };
};
export type CallDependencies = {
  audio: {
    start(background: boolean, callbacks: { pcm: (bytes: Uint8Array) => void; played: (id: string, bytes: number) => void; interrupted: (reason: string) => void }): Promise<void>;
    capture(enabled: boolean): void; flush(): Promise<void>; stop(): Promise<void>;
    enqueue(id: string, bytes: Uint8Array): Promise<void>;
  };
  prepare(target: CallTarget, signal: AbortSignal, recovering?: boolean): Promise<{ identity: string; name: string; engine: 'agent' | 'omni' }>;
  create(request: CreateVoiceSessionRequest, signal: AbortSignal): Promise<{ origin: string; session: CreateVoiceSessionResponse }>;
  discard(connection: { origin: string; session: CreateVoiceSessionResponse }): Promise<void>;
  transport(callbacks: VoiceTransportCallbacks): Transport;
  invalidate(target: CallTarget): void;
};
const initial = (): CallState => ({ phase: 'idle', name: '', expanded: true, muted: false, startedAt: 0, userText: '', assistantText: '' });
const PLAYBACK_CAPTURE_GUARD_MS = 300;

export function shouldPauseVoiceForBackground(state: CallState, permissionPromptActive: boolean): boolean {
  if (state.target?.background || !['connecting', 'recovering', 'connected'].includes(state.phase)) return false;
  // Android's permission activity temporarily pauses the app before capture starts.
  return !(permissionPromptActive && (state.phase === 'connecting' || state.phase === 'recovering'));
}

export class VoiceCallController {
  private diagnostics = new VoiceDiagnostics();
  private state = initial();
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private transport?: Transport;
  private opening: Promise<void> = Promise.resolve();
  private cleanup: Promise<void> = Promise.resolve();
  private identity?: string;
  private resuming = false;
  private approvalPending = false;
  private receivedBytes = 0;
  private renderedBytes = 0;
  private responseComplete = false;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private playbackTimer?: ReturnType<typeof setTimeout>;
  private playbackCaptureTimer?: ReturnType<typeof setTimeout>;
  private playbackCaptureGuarded = false;
  private playbackCaptureGuardApplied = false;
  private inputReset = Promise.resolve();
  private playbackReset = Promise.resolve();
  constructor(private deps: CallDependencies) {}
  getSnapshot = (): CallState => this.state;
  getDiagnostics = () => {
    const snapshot = this.diagnostics.snapshot();
    return { ...snapshot, phase: this.state.phase, errorCode: this.state.error ?? snapshot.errorCode,
      finding: voiceDiagnosticFinding(snapshot.responses.at(-1)) };
  };
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private update(value: Partial<CallState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  expand = (expanded = true) => this.update({ expanded });

  start(target: CallTarget): Promise<void> {
    if (this.state.phase !== 'idle') { this.expand(); return Promise.resolve(); }
    this.diagnostics.start();
    this.identity = undefined;
    this.approvalPending = false;
    this.update({ ...initial(), phase: 'connecting', target, startedAt: Date.now() });
    this.opening = this.open(false);
    return this.opening;
  }
  private async open(recovering: boolean): Promise<void> {
    const target = this.state.target!;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const deadline = recovering ? setTimeout(() => { if (generation === this.generation) void this.pause('NETWORK'); }, 10_000) : undefined;
    this.update({ phase: recovering ? 'recovering' : 'connecting', error: undefined, responseId: undefined, responseStage: undefined, clarification: undefined });
    const current = () => generation === this.generation && !abort.signal.aborted;
    try {
      const prepared = await this.deps.prepare(target, abort.signal, recovering);
      if (!current()) return;
      if (this.identity && this.identity !== prepared.identity) throw new Error('SESSION_CHANGED');
      this.identity = prepared.identity;
      this.diagnostics.setEngine(prepared.engine);
      this.update({ name: prepared.name, engine: prepared.engine, target: { ...target, engine: prepared.engine } });
      const audioStart = this.deps.audio.start(target.background, {
        pcm: bytes => {
          if (!current() || this.state.phase !== 'connected' || this.state.muted || this.state.clarification || this.approvalPending) return;
          try { this.transport?.audio(bytes); this.diagnostics.input(bytes.byteLength); } catch { void this.pause('INPUT_DROPPED'); }
        },
        played: (id, bytes) => {
          if (!current() || id !== this.state.responseId || bytes <= this.renderedBytes) return;
          this.renderedBytes = bytes;
          this.diagnostics.played(id, bytes);
          const responseStage = bytes < this.receivedBytes ? 'speaking' : 'thinking';
          if (this.state.responseStage !== responseStage) this.update({ responseStage });
          this.watchPlayback(true);
          this.transport?.send('response.audio.played', { responseId: id, playedBytes: bytes });
          this.finishResponse();
        },
        interrupted: reason => { if (current()) { if (reason === 'ended') void this.end(); else void this.pause(reason); } },
      });
      let created: { origin: string; session: CreateVoiceSessionResponse } | undefined;
      const create = this.deps.create(
        { purpose: 'conversation', sessionKey: target.sessionKey, engine: prepared.engine },
        abort.signal,
      ).then((connection) => {
        created = connection;
        return connection;
      });
      let connection: { origin: string; session: CreateVoiceSessionResponse };
      try {
        [connection] = await Promise.all([create, audioStart]);
      } catch (error) {
        if (created) void this.deps.discard(created).catch(() => undefined);
        else void create.then((late) => this.deps.discard(late)).catch(() => undefined);
        throw error;
      }
      if (!current()) {
        void this.deps.discard(connection).catch(() => undefined);
        return;
      }
      const transport = this.deps.transport({
        event: event => { if (current()) this.onEvent(event); },
        audio: (id, pcm) => {
          if (!current() || id !== this.state.responseId) return;
          this.guardCaptureForPlayback();
          this.receivedBytes += pcm.byteLength;
          this.diagnostics.received(id, pcm);
          if (this.state.responseStage === 'thinking') this.update({ responseStage: 'buffering' });
          this.watchPlayback();
          void this.playbackReset.then(() => {
            if (!current() || id !== this.state.responseId) return;
            return this.deps.audio.enqueue(id, pcm);
          }).then(() => {
            if (current() && id === this.state.responseId) this.diagnostics.queued(id, pcm.byteLength);
          }).catch(() => { if (current()) void this.pause('PLAYBACK_FAILED'); });
        },
        close: reason => { if (current()) void this.disconnected(reason); },
      });
      this.transport = transport;
      await transport.connect(connection.origin, connection.session, abort.signal);
      if (!current()) return;
      transport.send('input.mute', { muted: this.state.muted });
      if (!current()) return;
      this.update({ phase: 'connected', expiresAt: Date.now() + connection.session.limits.maxSessionMs });
      this.deps.audio.capture(!this.state.muted && !this.approvalPending);
      this.limitTimer = setTimeout(() => void this.pause('TIME_LIMIT'), connection.session.limits.maxSessionMs);
    } catch (error) {
      if (current()) {
        this.transport?.close();
        this.transport = undefined;
        await this.deps.audio.stop();
        if (current()) this.update({ phase: 'paused', error: error instanceof Error ? error.message : 'SERVICE_UNAVAILABLE' });
      }
    } finally {
      clearTimeout(deadline);
      if (!current()) await this.deps.audio.stop();
    }
  }
  private finishResponse() {
    if (this.responseComplete && this.renderedBytes >= this.receivedBytes) {
      clearTimeout(this.playbackTimer); this.playbackTimer = undefined;
      this.clearPlaybackCaptureGuard(true);
      this.update({ responseId: undefined, responseStage: undefined, activity: undefined });
    }
  }
  private shouldCapture(): boolean {
    return this.state.phase === 'connected'
      && !this.state.muted
      && !this.state.clarification
      && !this.approvalPending
      && !this.playbackCaptureGuarded;
  }
  private guardCaptureForPlayback(): void {
    if (this.playbackCaptureGuardApplied || this.playbackCaptureGuarded || !this.shouldCapture()) return;
    this.playbackCaptureGuardApplied = true;
    this.playbackCaptureGuarded = true;
    this.deps.audio.capture(false);
    const generation = this.generation;
    const responseId = this.state.responseId;
    this.playbackCaptureTimer = setTimeout(() => {
      this.playbackCaptureTimer = undefined;
      if (generation !== this.generation || responseId !== this.state.responseId) return;
      this.playbackCaptureGuarded = false;
      this.deps.audio.capture(this.shouldCapture());
    }, PLAYBACK_CAPTURE_GUARD_MS);
  }
  private clearPlaybackCaptureGuard(restore: boolean): void {
    clearTimeout(this.playbackCaptureTimer);
    this.playbackCaptureTimer = undefined;
    const wasGuarded = this.playbackCaptureGuarded;
    this.playbackCaptureGuarded = false;
    if (restore && wasGuarded) this.deps.audio.capture(this.shouldCapture());
  }
  private watchPlayback(progress = false) {
    if (progress) { clearTimeout(this.playbackTimer); this.playbackTimer = undefined; }
    if (this.renderedBytes >= this.receivedBytes || this.playbackTimer) return;
    const generation = this.generation;
    const id = this.state.responseId;
    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = undefined;
      if (generation === this.generation && id === this.state.responseId && this.renderedBytes < this.receivedBytes) void this.pause('PLAYBACK_STALLED');
    }, 5000);
  }
  private onEvent(event: VoiceServerEvent) {
    switch (event.type) {
      case 'input.transcript.final': this.update({ userText: event.payload.text }); break;
      case 'response.created':
        this.diagnostics.response(event.payload.responseId);
        clearTimeout(this.playbackTimer); this.playbackTimer = undefined;
        this.clearPlaybackCaptureGuard(true);
        this.playbackCaptureGuardApplied = false;
        this.receivedBytes = 0; this.renderedBytes = 0; this.responseComplete = false;
        this.update({ responseId: event.payload.responseId, responseStage: 'thinking', assistantText: '', activity: undefined, error: undefined }); break;
      case 'response.audio.started':
        if (event.payload.format.sampleRate !== 24000) void this.pause('UNSUPPORTED_FORMAT');
        break;
      case 'response.text.delta':
        this.diagnostics.text(event.payload.responseId, event.payload.delta.length);
        if (event.payload.responseId === this.state.responseId) this.update({ assistantText: (this.state.assistantText + event.payload.delta).slice(-32_000) }); break;
      case 'response.activity':
        if (event.payload.responseId === this.state.responseId) this.update({ activity: event.payload.status === 'running' ? event.payload.toolName : undefined }); break;
      case 'response.clarification':
        if (event.payload.responseId !== this.state.responseId) break;
        this.deps.audio.capture(false);
        this.transport?.send('input.mute', { muted: true });
        this.update({ clarification: event.payload }); break;
      case 'response.cancelled':
        this.diagnostics.cancelled(event.payload.responseId, event.payload.reason);
        if (event.payload.responseId === this.state.responseId) {
          clearTimeout(this.playbackTimer); this.playbackTimer = undefined;
          this.clearPlaybackCaptureGuard(true);
          void this.flushPlayback().catch(() => { if (this.state.phase === 'connected') void this.pause('PLAYBACK_FAILED'); });
          this.update({ responseId: undefined, responseStage: undefined, activity: undefined, clarification: undefined });
        }
        break;
      case 'response.done':
        this.diagnostics.done(event.payload.responseId, event.payload.finishReason);
        if (event.payload.responseId === this.state.responseId) {
          if (!event.payload.audio && this.state.assistantText && this.receivedBytes === 0 && !this.state.error) this.update({ error: 'NO_RESPONSE_AUDIO' });
          this.responseComplete = true; this.finishResponse();
        }
        if (this.state.target) this.deps.invalidate(this.state.target);
        break;
      case 'session.error':
        this.diagnostics.error(event.payload.code);
        if (event.payload.recoverable && event.payload.code !== 'NO_ACTIVE_RESPONSE') this.update({ error: event.payload.code });
        break;
    }
  }
  async setMuted(muted: boolean): Promise<void> {
    this.update({ muted });
    this.deps.audio.capture(false);
    this.inputReset = this.inputReset.then(() => {
      if (this.state.phase !== 'connected') return;
      this.transport?.send('input.mute', { muted: this.state.muted || Boolean(this.state.clarification) || this.approvalPending });
      this.deps.audio.capture(this.shouldCapture());
    });
    await this.inputReset;
  }
  async stopReply(): Promise<void> {
    const id = this.state.responseId;
    if (!id) return;
    const generation = this.generation;
    const transport = this.transport;
    const startedAt = performance.now();
    this.diagnostics.cancelled(id, 'client_cancelled');
    clearTimeout(this.playbackTimer); this.playbackTimer = undefined;
    this.clearPlaybackCaptureGuard(false);
    this.deps.audio.capture(false);
    this.update({ responseId: undefined, responseStage: undefined, activity: undefined, clarification: undefined });
    try { await this.flushPlayback(); }
    catch { if (generation === this.generation) await this.pause('PLAYBACK_FAILED'); return; }
    if (generation !== this.generation) return;
    transport?.send('session.metric', { responseId: id, metric: 'local_stop', durationMs: Math.min(600_000, Math.max(0, performance.now() - startedAt)) });
    transport?.send('response.cancel', { responseId: id });
    this.deps.audio.capture(this.shouldCapture());
  }
  private flushPlayback(): Promise<void> {
    const flush = this.playbackReset.then(() => this.deps.audio.flush());
    this.playbackReset = flush.catch(() => {});
    return flush;
  }
  setApprovalPending(pending: boolean) {
    if (this.approvalPending === pending) return;
    this.approvalPending = pending;
    void this.setMuted(this.state.muted);
  }
  confirmationSent() {
    this.update({ clarification: undefined });
    void this.setMuted(this.state.muted);
  }
  private async disconnected(reason: string) {
    await this.pause(reason);
    if (reason !== 'NETWORK' || this.state.phase !== 'paused') return;
    this.update({ phase: 'recovering' });
    // Retry only preparation; an ambiguous creation is never replayed.
    this.recoveryTimer = setTimeout(() => { if (this.state.phase === 'recovering') void this.resume(); }, 1000);
  }
  async pause(reason: string): Promise<void> { await this.stopResources(false, reason); }
  async end(): Promise<void> { await this.stopResources(true); }
  private stopResources(end: boolean, reason?: string): Promise<void> {
    if (this.state.phase === 'idle') return Promise.resolve();
    this.diagnostics.end(reason ?? 'user_finished');
    const stoppingGeneration = ++this.generation;
    clearTimeout(this.limitTimer); clearTimeout(this.recoveryTimer);
    clearTimeout(this.playbackTimer); this.playbackTimer = undefined;
    this.clearPlaybackCaptureGuard(false);
    this.deps.audio.capture(false);
    this.transport?.send('session.stop', { reason: 'user_finished' });
    this.transport?.close(); this.transport = undefined;
    this.abort?.abort();
    this.update({ phase: 'ending', responseId: undefined, responseStage: undefined, activity: undefined, clarification: undefined });
    const opening = this.opening;
    this.cleanup = this.cleanup.then(async () => {
      await opening;
      await this.deps.audio.stop();
      if (this.state.target) this.deps.invalidate(this.state.target);
      if (stoppingGeneration !== this.generation) return;
      if (end) { this.state = initial(); this.update({}); }
      else this.update({ phase: 'paused', error: reason });
    });
    return this.cleanup;
  }
  async resume(): Promise<void> {
    if (this.resuming || !['paused', 'recovering'].includes(this.state.phase)) return;
    this.resuming = true;
    clearTimeout(this.recoveryTimer);
    try {
      await this.cleanup;
      if (!this.state.target) return;
      this.opening = this.open(true);
      await this.opening;
    } finally { this.resuming = false; }
  }
}
