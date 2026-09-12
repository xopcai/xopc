import type { CreateVoiceSessionRequest, CreateVoiceSessionResponse, VoiceMode, VoiceServerEvent } from '@xopcai/realtime-protocol/voice';
import type { AudioRouteCapabilities } from './native-audio-session';
import type { VoiceAudioSendResult, VoiceInputQuality, VoiceTransport, VoiceTransportCallbacks } from './voice-transport';
import { VoiceDiagnostics, voiceDiagnosticFinding } from './voice-diagnostics';

type Transport = Pick<VoiceTransport, 'connect' | 'send' | 'audio' | 'inputQueueAgeMs' | 'close'>;

export type CallTarget = {
  gatewayId: string;
  sessionKey: string;
  mode?: VoiceMode;
  background: boolean;
  identity?: string;
  name?: string;
};
export type CallState = {
  phase: 'idle' | 'connecting' | 'connected' | 'recovering' | 'paused' | 'ending';
  target?: CallTarget; name: string; mode?: VoiceMode; engine?: 'agent' | 'omni'; expanded: boolean; muted: boolean;
  startedAt: number; expiresAt?: number; responseId?: string; userText: string; assistantText: string;
  activity?: string; error?: string;
  taskId?: string;
  taskStage?: 'running' | 'cancelling';
  networkQuality: VoiceInputQuality;
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
    start(background: boolean, callbacks: { pcm: (bytes: Uint8Array) => void; played: (id: string, bytes: number) => void;
      interrupted: (reason: string) => void; speechCandidate: (active: boolean) => void;
      route: (capabilities: AudioRouteCapabilities) => void }): Promise<AudioRouteCapabilities>;
    capture(enabled: boolean): void; flush(): Promise<void>; stop(): Promise<void>;
    enqueue(id: string, bytes: Uint8Array): Promise<void>;
    duck(): Promise<void>; resumeOutput(): Promise<void>;
  };
  prepare(target: CallTarget, signal: AbortSignal, recovering?: boolean): Promise<{ identity: string; name: string; mode: VoiceMode; engine: 'agent' | 'omni' }>;
  create(request: CreateVoiceSessionRequest, signal: AbortSignal): Promise<{ origin: string; session: CreateVoiceSessionResponse }>;
  discard(connection: { origin: string; session: CreateVoiceSessionResponse }): Promise<void>;
  transport(callbacks: VoiceTransportCallbacks): Transport;
  invalidate(target: CallTarget): void;
};
const initial = (): CallState => ({ phase: 'idle', name: '', expanded: true, muted: false, startedAt: 0, userText: '', assistantText: '', networkQuality: 'good' });
const INPUT_RECOVERY_QUEUE_AGE_MS = 80;
const INPUT_RECOVERY_POLL_MS = 50;

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
  private fullDuplex = false;
  private playbackCaptureBlocked = false;
  private bargeInDucked = false;
  private inputCongested = false;
  private inputRecoveryTimer?: ReturnType<typeof setTimeout>;
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
    this.fullDuplex = false; this.playbackCaptureBlocked = false; this.bargeInDucked = false; this.inputCongested = false;
    this.update({ ...initial(), phase: 'connecting', target, startedAt: Date.now() });
    this.opening = this.open(false);
    return this.opening;
  }
  private async open(recovering: boolean): Promise<void> {
    const target = this.state.target!;
    const generation = ++this.generation;
    const abort = new AbortController();
    let createPromise: Promise<{ origin: string; session: CreateVoiceSessionResponse }> | undefined;
    let created: { origin: string; session: CreateVoiceSessionResponse } | undefined;
    const discardIssuedConnection = async () => {
      const connection = created;
      const pending = createPromise;
      created = undefined;
      createPromise = undefined;
      if (connection) {
        await this.deps.discard(connection).catch(() => undefined);
      } else if (pending) {
        void pending.then((late) => this.deps.discard(late)).catch(() => undefined);
      }
    };
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
      this.update({ name: prepared.name, mode: prepared.mode, engine: prepared.engine, target: { ...target, mode: prepared.mode } });
      const audioStart = this.deps.audio.start(target.background, {
        pcm: bytes => {
          if (!current() || this.state.phase !== 'connected' || this.state.muted || this.state.clarification || this.approvalPending) return;
          const result = this.transport?.audio(bytes);
          if (!result) return;
          this.diagnostics.inputResult(bytes.byteLength, result);
          this.handleInputQuality(result);
        },
        played: (id, bytes) => {
          if (!current() || id !== this.state.responseId || bytes <= this.renderedBytes) return;
          this.renderedBytes = bytes;
          this.diagnostics.played(id, bytes);
          const responseStage = bytes < this.receivedBytes ? 'speaking' : 'thinking';
          if (this.state.responseStage !== responseStage) this.update({ responseStage });
          this.watchPlayback(true);
          this.transport?.send('response.audio.played', { responseId: id, playedDurationMs: Math.floor(bytes / 48) });
          this.finishResponse();
        },
        interrupted: reason => { if (current()) { if (reason === 'ended') void this.end(); else void this.pause(reason); } },
        speechCandidate: active => { if (current()) this.handleSpeechCandidate(active); },
        route: capabilities => { if (current()) this.applyAudioCapabilities(capabilities); },
      });
      createPromise = this.deps.create(
        { purpose: 'conversation', sessionKey: target.sessionKey, mode: prepared.mode,
          supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] },
        abort.signal,
      ).then((connection) => {
        created = connection;
        return connection;
      });
      const [connection, audioCapabilities] = await Promise.all([createPromise, audioStart]);
      if (!current()) {
        await discardIssuedConnection();
        return;
      }
      this.applyAudioCapabilities(audioCapabilities);
      const transport = this.deps.transport({
        event: event => { if (current()) this.onEvent(event); },
        audio: (id, pcm) => {
          if (!current() || id !== this.state.responseId) return;
          this.blockCaptureForPlayback();
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
        networkRtt: rttMs => this.diagnostics.rtt(rttMs),
      });
      this.transport = transport;
      await transport.connect(connection.origin, connection.session, abort.signal);
      created = undefined;
      createPromise = undefined;
      if (!current()) return;
      transport.send('input.mute', { muted: this.inputShouldBeMuted() });
      if (!current()) return;
      this.update({ phase: 'connected', expiresAt: Date.now() + connection.session.limits.maxSessionMs });
      this.deps.audio.capture(this.shouldCapture());
      this.limitTimer = setTimeout(() => void this.pause('TIME_LIMIT'), connection.session.limits.maxSessionMs);
    } catch (error) {
      await discardIssuedConnection();
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
      this.clearPlaybackCaptureBlock(true);
      this.restoreOutput();
      this.update({ responseId: undefined, responseStage: undefined, activity: undefined });
    }
  }
  private shouldCapture(): boolean {
    return this.state.phase === 'connected'
      && !this.state.muted
      && !this.state.clarification
      && !this.approvalPending
      && !this.inputCongested
      && !this.playbackCaptureBlocked;
  }
  private inputShouldBeMuted(): boolean {
    return this.state.muted || Boolean(this.state.clarification) || this.approvalPending || this.inputCongested;
  }
  private handleInputQuality(result: VoiceAudioSendResult): void {
    if (result.quality !== 'good') { this.suspendCongestedInput(result.quality === 'critical'); return; }
    if (!this.inputCongested && this.state.networkQuality !== result.quality) this.update({ networkQuality: result.quality });
  }
  private suspendCongestedInput(dropped: boolean): void {
    if (this.inputCongested || this.state.phase !== 'connected') return;
    this.inputCongested = true;
    this.diagnostics.congestionPause();
    this.restoreOutput();
    this.deps.audio.capture(false);
    this.transport?.send('input.mute', { muted: true });
    this.update({ networkQuality: dropped ? 'critical' : 'degraded', ...(dropped ? { error: 'INPUT_DROPPED' } : {}) });
    this.scheduleInputRecovery(this.generation);
  }
  private scheduleInputRecovery(generation: number): void {
    clearTimeout(this.inputRecoveryTimer);
    this.inputRecoveryTimer = setTimeout(() => {
      this.inputRecoveryTimer = undefined;
      if (generation !== this.generation || !this.inputCongested || this.state.phase !== 'connected') return;
      if ((this.transport?.inputQueueAgeMs() ?? Number.POSITIVE_INFINITY) >= INPUT_RECOVERY_QUEUE_AGE_MS) { this.scheduleInputRecovery(generation); return; }
      this.inputCongested = false;
      this.transport?.send('input.mute', { muted: this.inputShouldBeMuted() });
      this.update({ networkQuality: 'good', ...(this.state.error === 'INPUT_DROPPED' ? { error: undefined } : {}) });
      this.deps.audio.capture(this.shouldCapture());
    }, INPUT_RECOVERY_POLL_MS);
  }
  private applyAudioCapabilities(capabilities: AudioRouteCapabilities): void {
    this.diagnostics.route(capabilities);
    this.fullDuplex = capabilities.fullDuplex;
    if (this.fullDuplex) this.clearPlaybackCaptureBlock(true);
    else if (this.receivedBytes > this.renderedBytes) { this.restoreOutput(); this.blockCaptureForPlayback(); }
  }
  private blockCaptureForPlayback(): void {
    if (this.fullDuplex || this.playbackCaptureBlocked) return;
    this.playbackCaptureBlocked = true;
    this.deps.audio.capture(false);
  }
  private clearPlaybackCaptureBlock(restore: boolean): void {
    const wasBlocked = this.playbackCaptureBlocked;
    this.playbackCaptureBlocked = false;
    if (restore && wasBlocked) this.deps.audio.capture(this.shouldCapture());
  }
  private handleSpeechCandidate(active: boolean): void {
    if (!active) { this.restoreOutput(); return; }
    const audible = Boolean(this.state.responseId) && this.receivedBytes > this.renderedBytes;
    if (!this.fullDuplex || !audible || this.bargeInDucked) return;
    this.bargeInDucked = true;
    void this.deps.audio.duck().catch(() => { if (this.state.phase === 'connected') void this.pause('PLAYBACK_FAILED'); });
  }
  private restoreOutput(): void {
    if (!this.bargeInDucked) return;
    this.bargeInDucked = false;
    void this.deps.audio.resumeOutput().catch(() => { if (this.state.phase === 'connected') void this.pause('PLAYBACK_FAILED'); });
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
        this.clearPlaybackCaptureBlock(true);
        this.restoreOutput();
        this.receivedBytes = 0; this.renderedBytes = 0; this.responseComplete = false;
        this.update({ responseId: event.payload.responseId, responseStage: 'thinking', assistantText: '', activity: undefined, error: undefined }); break;
      case 'response.audio.started':
        if (event.payload.format.sampleRate !== 24000) void this.pause('UNSUPPORTED_FORMAT');
        break;
      case 'response.text.delta':
        this.diagnostics.text(event.payload.responseId, event.payload.delta.length);
        if (event.payload.responseId === this.state.responseId) this.update({ assistantText: (this.state.assistantText + event.payload.delta).slice(-32_000) }); break;
      case 'task.activity':
        if (event.payload.taskId === this.state.taskId) this.update({ activity: event.payload.status === 'running' ? event.payload.toolName : undefined });
        break;
      case 'task.created':
        this.update({ taskId: event.payload.taskId, taskStage: 'running' }); break;
      case 'task.done':
        if (event.payload.taskId === this.state.taskId) this.update({ taskId: undefined, taskStage: undefined, activity: undefined });
        break;
      case 'response.clarification':
        if (event.payload.responseId !== this.state.responseId) break;
        this.deps.audio.capture(false);
        this.transport?.send('input.mute', { muted: true });
        this.update({ clarification: event.payload }); break;
      case 'response.cancelled':
        this.diagnostics.cancelled(event.payload.responseId, event.payload.reason);
        if (event.payload.responseId === this.state.responseId) {
          clearTimeout(this.playbackTimer); this.playbackTimer = undefined;
          this.clearPlaybackCaptureBlock(true);
          this.restoreOutput();
          void this.flushPlayback().catch(() => { if (this.state.phase === 'connected') void this.pause('PLAYBACK_FAILED'); });
          this.update({ responseId: undefined, responseStage: undefined });
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
    if (muted) this.restoreOutput();
    this.deps.audio.capture(false);
    this.inputReset = this.inputReset.then(() => {
      if (this.state.phase !== 'connected') return;
      this.transport?.send('input.mute', { muted: this.inputShouldBeMuted() });
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
    this.clearPlaybackCaptureBlock(false);
    this.restoreOutput();
    this.deps.audio.capture(false);
    this.update({ responseId: undefined, responseStage: undefined });
    try { await this.flushPlayback(); }
    catch { if (generation === this.generation) await this.pause('PLAYBACK_FAILED'); return; }
    if (generation !== this.generation) return;
    transport?.send('session.metric', { responseId: id, metric: 'local_stop', durationMs: Math.min(600_000, Math.max(0, performance.now() - startedAt)) });
    transport?.send('response.stop_playback', { responseId: id });
    this.deps.audio.capture(this.shouldCapture());
  }
  cancelTask(): void {
    const taskId = this.state.taskId;
    if (!taskId || this.state.taskStage === 'cancelling') return;
    this.transport?.send('task.cancel', { taskId });
    this.update({ taskStage: 'cancelling', activity: undefined });
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
    clearTimeout(this.inputRecoveryTimer); this.inputRecoveryTimer = undefined;
    this.inputCongested = false;
    this.clearPlaybackCaptureBlock(false);
    this.bargeInDucked = false;
    this.deps.audio.capture(false);
    this.transport?.send('session.stop', { reason: 'user_finished' });
    this.transport?.close(); this.transport = undefined;
    this.abort?.abort();
    this.update({ phase: 'ending', responseId: undefined, responseStage: undefined, activity: undefined, clarification: undefined, taskId: undefined, taskStage: undefined });
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
