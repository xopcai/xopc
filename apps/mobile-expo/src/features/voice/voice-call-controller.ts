import type { CreateVoiceSessionRequest, CreateVoiceSessionResponse, VoiceServerEvent } from '@xopcai/realtime-protocol/voice';
import type { VoiceTransport, VoiceTransportCallbacks } from './voice-transport';

type Transport = Pick<VoiceTransport, 'connect' | 'send' | 'audio' | 'close'>;

export type CallTarget = { gatewayId: string; sessionKey: string; engine?: 'agent' | 'omni'; background: boolean };
export type CallState = {
  phase: 'idle' | 'connecting' | 'connected' | 'recovering' | 'paused' | 'ending';
  target?: CallTarget; name: string; engine?: 'agent' | 'omni'; expanded: boolean; muted: boolean;
  startedAt: number; expiresAt?: number; responseId?: string; userText: string; assistantText: string;
  activity?: string; error?: string;
  clarification?: { requestId: string; question: string; choices?: string[] };
};
export type CallDependencies = {
  audio: {
    start(background: boolean, callbacks: { pcm: (bytes: Uint8Array) => void; played: (id: string, bytes: number) => void; interrupted: (reason: string) => void }): Promise<void>;
    capture(enabled: boolean): void; flush(): Promise<void>; stop(): Promise<void>;
    enqueue(id: string, bytes: Uint8Array): Promise<void>;
  };
  prepare(target: CallTarget, signal: AbortSignal, recovering?: boolean): Promise<{ identity: string; name: string; engine: 'agent' | 'omni' }>;
  create(request: CreateVoiceSessionRequest, signal: AbortSignal, identity: string): Promise<{ origin: string; session: CreateVoiceSessionResponse }>;
  transport(callbacks: VoiceTransportCallbacks): Transport;
  invalidate(target: CallTarget): void;
};
const initial = (): CallState => ({ phase: 'idle', name: '', expanded: true, muted: false, startedAt: 0, userText: '', assistantText: '' });

export function shouldPauseVoiceForBackground(state: CallState, permissionPromptActive: boolean): boolean {
  if (state.target?.background || !['connecting', 'recovering', 'connected'].includes(state.phase)) return false;
  // Android's permission activity temporarily pauses the app before capture starts.
  return !(permissionPromptActive && (state.phase === 'connecting' || state.phase === 'recovering'));
}

export class VoiceCallController {
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
  private inputReset = Promise.resolve();
  constructor(private deps: CallDependencies) {}
  getSnapshot = (): CallState => this.state;
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private update(value: Partial<CallState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  expand = (expanded = true) => this.update({ expanded });

  start(target: CallTarget): Promise<void> {
    if (this.state.phase !== 'idle') { this.expand(); return Promise.resolve(); }
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
    this.update({ phase: recovering ? 'recovering' : 'connecting', error: undefined, responseId: undefined, clarification: undefined });
    const current = () => generation === this.generation && !abort.signal.aborted;
    try {
      const prepared = await this.deps.prepare(target, abort.signal, recovering);
      if (!current()) return;
      if (this.identity && this.identity !== prepared.identity) throw new Error('SESSION_CHANGED');
      this.identity = prepared.identity;
      this.update({ name: prepared.name, engine: prepared.engine, target: { ...target, engine: prepared.engine } });
      await this.deps.audio.start(target.background, {
        pcm: bytes => {
          if (!current() || this.state.phase !== 'connected' || this.state.muted || this.state.clarification || this.approvalPending) return;
          try { this.transport?.audio(bytes); } catch { void this.pause('INPUT_DROPPED'); }
        },
        played: (id, bytes) => {
          if (!current() || id !== this.state.responseId) return;
          this.renderedBytes = bytes;
          this.transport?.send('response.audio.played', { responseId: id, playedBytes: bytes });
          this.finishResponse();
        },
        interrupted: reason => { if (current()) { if (reason === 'ended') void this.end(); else void this.pause(reason); } },
      });
      if (!current()) return;
      const connection = await this.deps.create({ purpose: 'conversation', sessionKey: target.sessionKey, engine: prepared.engine }, abort.signal, prepared.identity);
      if (!current()) return;
      const transport = this.deps.transport({
        event: event => { if (current()) this.onEvent(event); },
        audio: (id, pcm) => {
          if (!current() || id !== this.state.responseId) return;
          this.receivedBytes += pcm.byteLength;
          void this.deps.audio.enqueue(id, pcm).catch(() => { if (current()) void this.pause('PLAYBACK_FAILED'); });
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
    if (this.responseComplete && this.renderedBytes >= this.receivedBytes) this.update({ responseId: undefined, activity: undefined });
  }
  private onEvent(event: VoiceServerEvent) {
    switch (event.type) {
      case 'input.transcript.final': this.update({ userText: event.payload.text }); break;
      case 'response.created':
        this.receivedBytes = 0; this.renderedBytes = 0; this.responseComplete = false;
        this.update({ responseId: event.payload.responseId, assistantText: '', activity: undefined }); break;
      case 'response.audio.started':
        if (event.payload.format.sampleRate !== 24000) void this.pause('UNSUPPORTED_FORMAT');
        break;
      case 'response.text.delta':
        if (event.payload.responseId === this.state.responseId) this.update({ assistantText: (this.state.assistantText + event.payload.delta).slice(-32_000) }); break;
      case 'response.activity':
        if (event.payload.responseId === this.state.responseId) this.update({ activity: event.payload.status === 'running' ? event.payload.toolName : undefined }); break;
      case 'response.clarification':
        if (event.payload.responseId !== this.state.responseId) break;
        this.deps.audio.capture(false);
        this.transport?.send('input.mute', { muted: true });
        this.update({ clarification: event.payload }); break;
      case 'response.cancelled':
        if (event.payload.responseId === this.state.responseId) {
          void this.deps.audio.flush();
          this.update({ responseId: undefined, activity: undefined, clarification: undefined });
        }
        break;
      case 'response.done':
        if (event.payload.responseId === this.state.responseId) { this.responseComplete = true; this.finishResponse(); }
        if (this.state.target) this.deps.invalidate(this.state.target);
        break;
      case 'session.error':
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
      this.deps.audio.capture(this.state.phase === 'connected' && !this.state.muted && !this.state.clarification && !this.approvalPending);
    });
    await this.inputReset;
  }
  async stopReply(): Promise<void> {
    const id = this.state.responseId;
    if (!id) return;
    const generation = this.generation;
    const transport = this.transport;
    const startedAt = performance.now();
    this.deps.audio.capture(false);
    this.update({ responseId: undefined, activity: undefined, clarification: undefined });
    try { await this.deps.audio.flush(); }
    catch { if (generation === this.generation) await this.pause('PLAYBACK_FAILED'); return; }
    if (generation !== this.generation) return;
    transport?.send('session.metric', { responseId: id, metric: 'local_stop', durationMs: Math.min(600_000, Math.max(0, performance.now() - startedAt)) });
    transport?.send('response.cancel', { responseId: id });
    this.deps.audio.capture(!this.state.muted && !this.approvalPending && this.state.phase === 'connected');
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
    const stoppingGeneration = ++this.generation;
    clearTimeout(this.limitTimer); clearTimeout(this.recoveryTimer);
    this.deps.audio.capture(false);
    this.transport?.send('session.stop', { reason: 'user_finished' });
    this.transport?.close(); this.transport = undefined;
    this.abort?.abort();
    this.update({ phase: 'ending', responseId: undefined, activity: undefined, clarification: undefined });
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
