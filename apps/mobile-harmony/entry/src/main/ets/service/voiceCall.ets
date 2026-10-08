import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { systemDateTime } from '@kit.BasicServicesKit';
import { XopcVoiceTiming } from '../common/voiceTiming';
import { gatewaySession } from './gatewaySession';
import { XopcChatRepository } from '../repository/chatRepository';
import { voiceCapture } from './voiceCapture';
import { chatReadAloud } from './chatReadAloud';
import { voiceCallAudio } from './voiceCallAudio';
import { XopcVoiceCallTransport, XopcVoiceSendResult } from './voiceCallTransport';
import { xopcVoiceShouldReconnect } from '../common/voiceRecovery';
import {
  XopcVoiceApproval, XopcVoiceApprovalsPayload, XopcVoiceAudioFrame, XopcVoiceCallTarget, XopcVoiceClarification,
  XopcVoiceServerEvent, XopcVoiceSession, XopcVoiceSessionRequest, XopcVoiceStatus, XopcVoicePayload
} from '../model/voice';

interface XopcClarificationBody {
  action: string;
  answer?: string;
  expectedVersion: number;
  idempotencyKey: string;
}

interface XopcVoicePendingReply {
  event?: XopcVoiceServerEvent;
  frame?: XopcVoiceAudioFrame;
}

@ObservedV2
export class XopcVoiceCall {
  @Trace phase: string = 'idle';
  @Trace mode: string = 'natural';
  @Trace name: string = '';
  @Trace expanded: boolean = true;
  @Trace muted: boolean = false;
  @Trace speaker: boolean = false;
  @Trace startedAt: number = 0;
  @Trace userText: string = '';
  @Trace assistantText: string = '';
  @Trace activity: string = '';
  @Trace error: string = '';
  @Trace responseId: string = '';
  @Trace responseStage: string = '';
  @Trace taskId: string = '';
  @Trace taskCancelling: boolean = false;
  @Trace networkQuality: string = 'good';
  @Trace route: string = 'system';
  @Trace clarification?: XopcVoiceClarification;
  @Trace approval?: XopcVoiceApproval;
  private target?: XopcVoiceCallTarget;
  private session?: XopcVoiceSession;
  private transport?: XopcVoiceCallTransport;
  private context?: common.UIAbilityContext;
  private generation: number = 0;
  private reconnectTimer: number = -1;
  private reconnectAttempt: number = 0;
  private connectedAt: number = 0;
  private queueTimer: number = -1;
  private responseDone: boolean = false;
  private receivedMs: number = 0;
  private playedMs: number = 0;
  private pendingResponseId: string = '';
  private pendingReply: XopcVoicePendingReply[] = [];
  private pendingReplyBytes: number = 0;
  private approvalTimer: number = -1;
  private limitTimer: number = -1;
  private congested: boolean = false;
  private appliedMuted?: boolean;
  private speechActive: boolean = false;
  private speakingUtterances: string[] = [];
  private timing: XopcVoiceTiming = new XopcVoiceTiming();

  async start(context: common.UIAbilityContext, target: XopcVoiceCallTarget): Promise<void> {
    if (this.phase !== 'idle') { this.expanded = true; return; }
    this.context = context; this.target = target; this.mode = target.mode; this.name = target.name;
    this.phase = 'connecting'; this.expanded = true; this.muted = false; this.speaker = false;
    this.startedAt = Date.now(); this.error = ''; this.userText = ''; this.assistantText = '';
    this.reconnectAttempt = 0;
    await voiceCapture.cancel(); await chatReadAloud.disableContinuous();
    await this.open(false);
  }

  private async open(recovering: boolean): Promise<void> {
    const target = this.target; const context = this.context;
    if (!target || !context) return;
    const generation = ++this.generation;
    this.phase = recovering ? 'recovering' : 'connecting'; this.error = '';
    try {
      await new XopcChatRepository().materialize(target.conversationId, 'voice');
      const status = (JSON.parse(await gatewaySession.request('/api/voice/realtime/status')) as XopcVoicePayload<XopcVoiceStatus>).payload;
      if (!status.enabled) throw new Error('VOICE_DISABLED');
      const availability = this.mode === 'assistant' ? status.capabilities.assistant : status.capabilities.natural;
      if (!availability.available) throw new Error(availability.reasonCode ?? 'PROVIDER_UNAVAILABLE');
      const request: XopcVoiceSessionRequest = { purpose: 'conversation', conversationId: target.conversationId,
        mode: this.mode, supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] };
      await gatewaySession.request('/api/voice/realtime/preflight', 'POST', JSON.stringify(request));
      const session = (JSON.parse(await gatewaySession.request('/api/voice/realtime/sessions', 'POST',
        JSON.stringify(request))) as XopcVoicePayload<XopcVoiceSession>).payload;
      if (generation !== this.generation) { await this.cancelSession(session); return; }
      this.session = session;
      await voiceCallAudio.start(context, target.background, {
        onInput: (bytes: Uint8Array, capturedAtMs: number): void => { if (generation === this.generation) this.sendAudio(bytes, capturedAtMs); },
        onBuffered: (id: string, milliseconds: number): void => { if (generation === this.generation) this.buffered(id, milliseconds); },
        onPlayed: (id: string, milliseconds: number, source: string): void => { if (generation === this.generation) this.played(id, milliseconds, source); },
        onRoute: (route: string): void => { if (generation === this.generation) this.route = route; },
        onFailure: (reason: string): void => { if (generation === this.generation) { if (reason === 'ended') this.end(); else this.recover(reason); } }
      });
      voiceCallAudio.setMuted(true);
      const auth = await gatewaySession.transferAuth();
      if (generation !== this.generation) return;
      const transport = new XopcVoiceCallTransport({
        onEvent: (event: XopcVoiceServerEvent): void => { if (generation === this.generation) this.onEvent(event); },
        onAudio: (frame: XopcVoiceAudioFrame): void => { if (generation === this.generation) this.onAudio(frame); },
        onClose: (reason: string): void => { if (generation === this.generation) this.recover(reason); },
        onRtt: (milliseconds: number): void => { if (generation === this.generation) this.networkQuality = milliseconds > 800 ? 'degraded' : 'good'; }
      });
      this.transport = transport;
      await transport.connect(auth.origin, session);
      if (generation !== this.generation) return;
      this.phase = 'connected'; this.connectedAt = Date.now();
      this.appliedMuted = undefined; this.syncInput();
      clearTimeout(this.limitTimer);
      this.limitTimer = setTimeout((): void => { if (generation === this.generation) this.pause('TIME_LIMIT'); }, session.limits.maxSessionMs);
      if (this.mode === 'assistant') { this.loadApproval(); this.approvalTimer = setInterval((): void => { this.loadApproval(); }, 3000); }
      if (this.speaker) await voiceCallAudio.setSpeaker(true);
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = (error as Error).message || 'SERVICE_UNAVAILABLE';
      const failedSession = this.session; this.session = undefined;
      await this.release(false); if (failedSession) await this.cancelSession(failedSession); this.phase = 'paused';
    }
  }

  private sendAudio(bytes: Uint8Array, capturedAtMs?: number): void {
    if (this.inputBlocked()) return;
    const result = this.transport?.audio(bytes, capturedAtMs);
    if (result) this.applyQuality(result);
  }

  private applyQuality(result: XopcVoiceSendResult): void {
    this.networkQuality = result.quality;
    if (result.quality === 'good') return;
    if (this.congested) return;
    this.congested = true; this.syncInput();
    hilog.warn(0x0000, 'XopcVoice', 'Voice input paused for congestion: %{public}s', JSON.stringify(this.transport?.inputDiagnostics()));
    if (!result.accepted) this.error = 'INPUT_DROPPED';
    clearInterval(this.queueTimer);
    const generation = this.generation;
    this.queueTimer = setInterval((): void => {
      if (generation !== this.generation || this.phase !== 'connected') return;
      if ((this.transport?.inputQueueAgeMs() ?? 1000) >= 80) return;
      clearInterval(this.queueTimer); this.queueTimer = -1; this.networkQuality = 'good';
      this.congested = false; this.syncInput();
    }, 50);
  }

  private inputBlocked(): boolean {
    return this.phase !== 'connected' || this.muted || this.congested || !!this.clarification || !!this.approval;
  }

  private syncInput(): void {
    const muted = this.inputBlocked();
    voiceCallAudio.setMuted(muted);
    if (muted) this.setSpeechActive(false);
    if (muted === this.appliedMuted || !this.transport) return;
    this.appliedMuted = muted; this.transport.send('input.mute', { muted });
  }

  private setSpeechActive(value: boolean): void {
    this.speechActive = value;
    if (!value) this.speakingUtterances = [];
    voiceCallAudio.duck(value && !!this.responseId && this.receivedMs > this.playedMs && !!this.session?.bargeIn);
  }

  private now(): number { return systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false); }

  private onAudio(frame: XopcVoiceAudioFrame): void {
    const durationMs = this.timing.received(frame.responseId, this.now());
    if (durationMs !== undefined) this.transport?.send('session.metric', {
      responseId: frame.responseId, metric: 'speech_end_to_audio_received', durationMs
    });
    if (this.pendingResponseId && frame.responseId === this.pendingResponseId) {
      this.deferReply({ frame }, frame.audio.byteLength); return;
    }
    if (!this.responseId || frame.responseId !== this.responseId) return;
    this.receivedMs += frame.durationMs; this.responseStage = this.playedMs ? 'speaking' : 'buffering';
    this.setSpeechActive(this.speechActive);
    voiceCallAudio.enqueue(frame.responseId, frame.audio);
  }

  private played(id: string, milliseconds: number, source: string = 'timestamp'): void {
    this.timing.played(id, milliseconds, this.now(), source);
    if (id !== this.responseId) return;
    this.playedMs = milliseconds; this.responseStage = 'speaking';
    if (this.responseDone && milliseconds >= this.receivedMs) this.finishResponse();
  }

  private buffered(id: string, milliseconds: number): void {
    this.timing.buffered(id, milliseconds, this.now());
    if (id !== this.responseId) return;
    // Ack renderer-owned audio so the server can finish sending; drain still gates the visible reply.
    this.transport?.send('response.audio.played', { responseId: id, playedDurationMs: milliseconds });
  }

  private onEvent(event: XopcVoiceServerEvent): void {
    const payload = event.payload;
    if (event.type === 'response.created' && payload.responseId) this.timing.created(payload.responseId, this.now());
    if (event.type === 'input.speech_started' && !this.inputBlocked()) {
      const id = payload.utteranceId ?? '';
      if (!this.speakingUtterances.includes(id) && this.speakingUtterances.length < 32) this.speakingUtterances.push(id);
      this.timing.speechStarted(); this.setSpeechActive(true);
    } else if (event.type === 'input.speech_stopped' && !this.inputBlocked()
      && this.speakingUtterances.includes(payload.utteranceId ?? '')) {
      const id = payload.utteranceId ?? '';
      this.speakingUtterances = this.speakingUtterances.filter((value: string): boolean => value !== id);
      if (!this.speakingUtterances.length) { this.timing.speechStopped(this.now()); this.setSpeechActive(false); }
    }
    if (this.pendingResponseId && payload.responseId === this.pendingResponseId) {
      this.deferReply({ event }, JSON.stringify(event).length * 2); return;
    }
    if (event.type === 'input.transcript.final') this.userText = payload.text ?? '';
    else if (event.type === 'response.created') {
      if (this.responseId && payload.responseId !== this.responseId) {
        // Server completion acknowledges buffered audio; the native renderer may still be draining.
        if (this.responseDone && payload.responseId) {
          hilog.info(0x0000, 'XopcVoice', 'Voice reply queued behind playback: %{public}s', payload.responseId);
          this.pendingResponseId = payload.responseId;
          this.deferReply({ event }, JSON.stringify(event).length * 2); return;
        }
        if (payload.responseId) this.transport?.send('response.stop_playback', { responseId: payload.responseId });
        return;
      }
      this.responseId = payload.responseId ?? ''; this.assistantText = ''; this.activity = ''; this.error = '';
      hilog.info(0x0000, 'XopcVoice', 'Voice reply started: %{public}s', this.responseId);
      this.responseStage = 'thinking'; this.receivedMs = 0; this.playedMs = 0; this.responseDone = false;
    } else if (event.type === 'response.text.delta' && payload.responseId === this.responseId) {
      this.assistantText = (this.assistantText + (payload.delta ?? '')).slice(-32000);
    } else if (event.type === 'response.audio.started' && payload.format?.sampleRate !== 24000) this.pause('UNSUPPORTED_FORMAT');
    else if (event.type === 'task.created') { this.taskId = payload.taskId ?? ''; this.taskCancelling = false; }
    else if (event.type === 'task.activity' && payload.taskId === this.taskId) this.activity = payload.status === 'running' ? payload.toolName ?? '' : '';
    else if (event.type === 'task.done' && payload.taskId === this.taskId) { this.taskId = ''; this.taskCancelling = false; this.activity = ''; }
    else if (event.type === 'response.clarification' && payload.responseId === this.responseId) {
      this.clarification = { requestId: payload.requestId ?? '', question: payload.question ?? '', choices: payload.choices ?? [],
        suggestedAnswer: payload.suggestedAnswer ?? '', version: payload.version ?? 1, kind: payload.kind ?? 'input' };
      this.syncInput();
    } else if (event.type === 'response.cancelled' && payload.responseId === this.responseId) {
      voiceCallAudio.flush(); this.finishResponse('cancelled');
    } else if (event.type === 'response.done' && payload.responseId === this.responseId) {
      this.responseDone = true;
      if (!payload.audio && this.assistantText) this.error = 'NO_RESPONSE_AUDIO';
      if (!payload.audio || this.playedMs >= this.receivedMs) this.finishResponse();
      else voiceCallAudio.finish(this.responseId);
    } else if (event.type === 'session.error' && payload.recoverable) this.error = payload.code ?? 'SERVICE_UNAVAILABLE';
  }

  private finishResponse(outcome: string = 'completed'): void {
    if (this.responseId) hilog.info(0x0000, 'XopcVoice', 'Voice reply playback finished: %{public}s', this.responseId);
    const report = this.timing.finish(this.responseId, this.mode, this.route, outcome);
    if (report) hilog.info(0x0000, 'XopcVoice', 'Voice timing: %{public}s', JSON.stringify(report));
    voiceCallAudio.duck(false);
    this.responseId = ''; this.responseStage = ''; this.activity = '';
    this.responseDone = false; this.receivedMs = 0; this.playedMs = 0;
    const pending = this.pendingReply;
    this.pendingReply = []; this.pendingResponseId = ''; this.pendingReplyBytes = 0;
    for (const item of pending) {
      if (item.event) this.onEvent(item.event);
      else if (item.frame) this.onAudio(item.frame);
    }
  }

  private deferReply(item: XopcVoicePendingReply, bytes: number): void {
    if (this.pendingReply.length >= 1024 || this.pendingReplyBytes + bytes > 256000) {
      this.pause('PLAYBACK_FAILED'); return;
    }
    this.pendingReply.push(item); this.pendingReplyBytes += bytes;
  }

  async setMuted(value: boolean): Promise<void> {
    this.muted = value; this.syncInput();
  }

  async setSpeaker(value: boolean): Promise<void> {
    this.speaker = value;
    try { await voiceCallAudio.setSpeaker(value); } catch (_error) { this.error = 'ROUTE_CHANGE_FAILED'; }
  }

  async stopReply(): Promise<void> {
    const id = this.responseId; if (!id) return;
    const startedAt = this.now(); const generation = this.generation;
    const flushing = voiceCallAudio.flush();
    this.finishResponse('client_cancelled');
    this.transport?.send('response.stop_playback', { responseId: id });
    await flushing;
    if (generation !== this.generation) return;
    this.transport?.send('session.metric', { responseId: id, metric: 'local_stop', durationMs: this.now() - startedAt });
  }

  cancelTask(): void {
    if (!this.taskId || this.taskCancelling) return;
    this.taskCancelling = true; this.transport?.send('task.cancel', { taskId: this.taskId });
  }

  async submitClarification(action: string, answer: string = ''): Promise<void> {
    const clarification = this.clarification; if (!clarification || !this.target) return;
    const body: XopcClarificationBody = { action, expectedVersion: clarification.version,
      idempotencyKey: util.generateRandomUUID() };
    if (action === 'answer') body.answer = answer;
    await gatewaySession.request('/api/clarifications/' + encodeURIComponent(clarification.requestId) + '/responses', 'POST', JSON.stringify(body));
    if (this.clarification !== clarification) return;
    this.clarification = undefined; this.syncInput();
  }

  private async loadApproval(): Promise<void> {
    const target = this.target;
    if (!target || this.phase !== 'connected') return;
    const generation = this.generation;
    try {
      const path = '/api/connectors/approvals?status=pending&conversationId=' + encodeURIComponent(target.conversationId);
      const result = (JSON.parse(await gatewaySession.request(path)) as XopcVoicePayload<XopcVoiceApprovalsPayload>).payload;
      if (generation !== this.generation || this.phase !== 'connected' || this.target !== target) return;
      this.approval = result.approvals.find((item: XopcVoiceApproval): boolean => item.conversationId === target.conversationId
        && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now());
      this.syncInput();
    } catch (_error) {}
  }

  async respondApproval(approved: boolean): Promise<void> {
    const approval = this.approval; if (!approval) return;
    await gatewaySession.request('/api/connectors/approvals/respond', 'POST', JSON.stringify({
      id: approval.id, decision: approved ? 'approved' : 'denied', conversationId: approval.conversationId
    }));
    if (this.approval !== approval) return;
    this.approval = undefined; this.syncInput();
  }

  private recover(reason: string): void {
    if (!xopcVoiceShouldReconnect(reason)) {
      this.pause(reason); return;
    }
    if (this.connectedAt && Date.now() - this.connectedAt >= 30000) this.reconnectAttempt = 0;
    this.pause(reason, true);
  }

  async resume(): Promise<void> {
    if (this.phase !== 'paused' && this.phase !== 'recovering') return;
    await this.open(true);
  }

  private async pause(reason: string, reconnect: boolean = false): Promise<void> {
    if (this.phase === 'idle' || this.phase === 'ending') return;
    this.error = reason; this.phase = reconnect ? 'recovering' : 'paused';
    const oldSession = this.session; this.session = undefined;
    await this.release(false); if (oldSession) await this.cancelSession(oldSession);
    if (!reconnect || this.reconnectAttempt >= 5) return;
    const delays: number[] = [500, 1000, 2000, 4000, 8000];
    const delay = delays[this.reconnectAttempt++]; clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout((): void => { if (this.phase === 'recovering') this.open(true); }, delay);
  }

  onBackground(): void { if (this.target && !this.target.background && this.phase !== 'idle') this.pause('background'); }
  onForeground(): void { if (this.phase === 'paused' && this.error === 'background') this.resume(); }

  async end(): Promise<void> {
    if (this.phase === 'idle') return;
    this.phase = 'ending'; ++this.generation; clearTimeout(this.reconnectTimer); clearInterval(this.queueTimer);
    clearInterval(this.approvalTimer); this.approvalTimer = -1;
    clearTimeout(this.limitTimer); this.limitTimer = -1;
    this.transport?.send('session.stop', { reason: 'user_finished' });
    const session = this.session; await this.release(false); if (session) await this.cancelSession(session);
    this.target = undefined; this.context = undefined; this.session = undefined; this.phase = 'idle'; this.error = '';
    this.responseId = ''; this.taskId = ''; this.clarification = undefined; this.approval = undefined;
  }

  private async release(clearSession: boolean): Promise<void> {
    ++this.generation;
    clearInterval(this.queueTimer); this.queueTimer = -1;
    this.pendingReply = []; this.pendingResponseId = ''; this.pendingReplyBytes = 0;
    this.finishResponse('session_released'); this.timing.reset(); this.setSpeechActive(false);
    this.congested = false; this.appliedMuted = undefined;
    this.taskId = ''; this.taskCancelling = false;
    this.clarification = undefined; this.approval = undefined;
    clearInterval(this.approvalTimer); this.approvalTimer = -1;
    clearTimeout(this.limitTimer); this.limitTimer = -1;
    const transport = this.transport; this.transport = undefined;
    await transport?.close(); await voiceCallAudio.stop();
    if (clearSession) this.session = undefined;
  }

  private async cancelSession(session: XopcVoiceSession): Promise<void> {
    try { await gatewaySession.request('/api/voice/realtime/sessions/cancel', 'POST',
      JSON.stringify({ sessionId: session.sessionId, ticket: session.ticket })); } catch (_error) {}
  }
}

export const voiceCall: XopcVoiceCall = new XopcVoiceCall();
