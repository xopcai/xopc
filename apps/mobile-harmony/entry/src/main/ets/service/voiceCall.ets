import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { gatewaySession } from './gatewaySession';
import { voiceCapture } from './voiceCapture';
import { chatReadAloud } from './chatReadAloud';
import { voiceCallAudio } from './voiceCallAudio';
import { XopcVoiceCallTransport, XopcVoiceSendResult } from './voiceCallTransport';
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
  private queueTimer: number = -1;
  private responseDone: boolean = false;
  private receivedMs: number = 0;
  private playedMs: number = 0;
  private ducked: boolean = false;
  private approvalTimer: number = -1;
  private limitTimer: number = -1;

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
        onInput: (bytes: Uint8Array): void => { if (generation === this.generation) this.sendAudio(bytes); },
        onSpeech: (active: boolean): void => { if (generation === this.generation) this.speech(active); },
        onPlayed: (id: string, milliseconds: number): void => { if (generation === this.generation) this.played(id, milliseconds); },
        onRoute: (route: string): void => { if (generation === this.generation) this.route = route; },
        onFailure: (reason: string): void => { if (generation === this.generation) { if (reason === 'ended') this.end(); else this.recover(reason); } }
      });
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
      transport.send('input.mute', { muted: this.muted });
      this.phase = 'connected'; this.reconnectAttempt = 0;
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

  private sendAudio(bytes: Uint8Array): void {
    if (this.phase !== 'connected' || this.muted || this.clarification) return;
    const result = this.transport?.audio(bytes);
    if (result) this.applyQuality(result);
  }

  private applyQuality(result: XopcVoiceSendResult): void {
    this.networkQuality = result.quality;
    if (result.quality === 'good') return;
    voiceCallAudio.setMuted(true); this.transport?.send('input.mute', { muted: true });
    clearInterval(this.queueTimer);
    this.queueTimer = setInterval((): void => {
      if ((this.transport?.inputQueueAgeMs() ?? 1000) >= 80 || this.phase !== 'connected') return;
      clearInterval(this.queueTimer); this.queueTimer = -1; this.networkQuality = 'good';
      voiceCallAudio.setMuted(this.muted || !!this.clarification);
      this.transport?.send('input.mute', { muted: this.muted || !!this.clarification });
    }, 50);
  }

  private onAudio(frame: XopcVoiceAudioFrame): void {
    if (!this.responseId || frame.responseId !== this.responseId) return;
    this.receivedMs += frame.durationMs; this.responseStage = this.playedMs ? 'speaking' : 'buffering';
    voiceCallAudio.enqueue(frame.responseId, frame.audio);
  }

  private played(id: string, milliseconds: number): void {
    if (id !== this.responseId) return;
    this.playedMs = milliseconds; this.responseStage = 'speaking';
    this.transport?.send('response.audio.played', { responseId: id, playedDurationMs: milliseconds });
    if (this.responseDone && milliseconds >= this.receivedMs) this.finishResponse();
  }

  private speech(active: boolean): void {
    if (!this.session?.bargeIn || !this.responseId) return;
    if (active && !this.ducked) { this.ducked = true; voiceCallAudio.setDucked(true); }
    if (!active && this.ducked) { this.ducked = false; voiceCallAudio.setDucked(false); }
  }

  private onEvent(event: XopcVoiceServerEvent): void {
    const payload = event.payload;
    if (event.type === 'input.transcript.final') this.userText = payload.text ?? '';
    else if (event.type === 'response.created') {
      this.responseId = payload.responseId ?? ''; this.assistantText = ''; this.activity = ''; this.error = '';
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
      voiceCallAudio.setMuted(true); this.transport?.send('input.mute', { muted: true });
    } else if (event.type === 'response.cancelled' && payload.responseId === this.responseId) {
      voiceCallAudio.flush(); this.finishResponse();
    } else if (event.type === 'response.done' && payload.responseId === this.responseId) {
      this.responseDone = true;
      if (!payload.audio && this.assistantText) this.error = 'NO_RESPONSE_AUDIO';
      if (this.playedMs >= this.receivedMs) this.finishResponse();
    } else if (event.type === 'session.error' && payload.recoverable) this.error = payload.code ?? 'SERVICE_UNAVAILABLE';
  }

  private finishResponse(): void {
    this.responseId = ''; this.responseStage = ''; this.activity = ''; this.ducked = false;
    voiceCallAudio.setDucked(false);
  }

  async setMuted(value: boolean): Promise<void> {
    this.muted = value; voiceCallAudio.setMuted(value || !!this.clarification);
    this.transport?.send('input.mute', { muted: value || !!this.clarification });
  }

  async setSpeaker(value: boolean): Promise<void> {
    this.speaker = value;
    try { await voiceCallAudio.setSpeaker(value); } catch (_error) { this.error = 'ROUTE_CHANGE_FAILED'; }
  }

  async stopReply(): Promise<void> {
    const id = this.responseId; if (!id) return;
    this.responseId = ''; this.responseStage = ''; await voiceCallAudio.flush();
    this.transport?.send('response.stop_playback', { responseId: id });
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
    this.clarification = undefined; voiceCallAudio.setMuted(this.muted);
    this.transport?.send('input.mute', { muted: this.muted });
  }

  private async loadApproval(): Promise<void> {
    const target = this.target;
    if (!target || this.phase !== 'connected') return;
    try {
      const path = '/api/connectors/approvals?status=pending&conversationId=' + encodeURIComponent(target.conversationId);
      const result = (JSON.parse(await gatewaySession.request(path)) as XopcVoicePayload<XopcVoiceApprovalsPayload>).payload;
      this.approval = result.approvals.find((item: XopcVoiceApproval): boolean => item.conversationId === target.conversationId
        && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now());
      const waiting = !!this.approval; voiceCallAudio.setMuted(this.muted || waiting || !!this.clarification);
      this.transport?.send('input.mute', { muted: this.muted || waiting || !!this.clarification });
    } catch (_error) {}
  }

  async respondApproval(approved: boolean): Promise<void> {
    const approval = this.approval; if (!approval) return;
    await gatewaySession.request('/api/connectors/approvals/respond', 'POST', JSON.stringify({
      id: approval.id, decision: approved ? 'approved' : 'denied', conversationId: approval.conversationId
    }));
    this.approval = undefined; voiceCallAudio.setMuted(this.muted || !!this.clarification);
    this.transport?.send('input.mute', { muted: this.muted || !!this.clarification });
  }

  private recover(reason: string): void {
    if (!['NETWORK', 'route_lost', 'CAPTURE_FAILED', 'PLAYBACK_FAILED', 'CAPTURE_INTERRUPTED'].includes(reason)) {
      this.pause(reason); return;
    }
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
