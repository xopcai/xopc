import { gatewaySession } from './gatewaySession';
import { XopcVoiceCallTransport } from './voiceCallTransport';
import {
  XopcVoiceAudioFrame, XopcVoicePayload, XopcVoiceServerEvent, XopcVoiceSession,
  XopcVoiceSessionRequest, XopcVoiceStatus
} from '../model/voice';

export interface XopcDiscussionLiveTranscriptionCallbacks {
  onTranscript: (text: string) => void;
  onAvailability: (available: boolean) => void;
}

/** Streams recording PCM to the same low-latency dictation route used by web voice input. */
export class XopcDiscussionLiveTranscription {
  private callbacks: XopcDiscussionLiveTranscriptionCallbacks;
  private transport?: XopcVoiceCallTransport;
  private session?: XopcVoiceSession;
  private finals: Map<string, string> = new Map<string, string>();
  private revisions: Map<string, number> = new Map<string, number>();
  private partial: string = '';
  private generation: number = 0;
  private bufferedAudio: Uint8Array[] = [];
  private bufferedBytes: number = 0;
  private connected: boolean = false;

  constructor(callbacks: XopcDiscussionLiveTranscriptionCallbacks) { this.callbacks = callbacks; }

  async start(): Promise<void> {
    const generation = ++this.generation;
    try {
      const status = (JSON.parse(await gatewaySession.request('/api/voice/realtime/status')) as
        XopcVoicePayload<XopcVoiceStatus>).payload;
      if (!status.enabled || !status.capabilities.dictation.available) return;
      const request: XopcVoiceSessionRequest = { purpose: 'dictation', supportedProtocolVersions: [3],
        mediaPreferences: ['websocket-pcm'] };
      await gatewaySession.request('/api/voice/realtime/preflight', 'POST', JSON.stringify(request));
      const session = (JSON.parse(await gatewaySession.request('/api/voice/realtime/sessions', 'POST',
        JSON.stringify(request))) as XopcVoicePayload<XopcVoiceSession>).payload;
      if (generation !== this.generation) { await this.cancelSession(session); return; }
      const transport = new XopcVoiceCallTransport({
        onEvent: (event: XopcVoiceServerEvent): void => { if (generation === this.generation) this.onEvent(event); },
        onAudio: (_frame: XopcVoiceAudioFrame): void => {},
        onClose: (_reason: string): void => { if (generation === this.generation) this.callbacks.onAvailability(false); },
        onRtt: (_milliseconds: number): void => {}
      });
      this.session = session; this.transport = transport;
      const auth = await gatewaySession.transferAuth();
      await transport.connect(auth.origin, session);
      if (generation !== this.generation) { await transport.close(); await this.cancelSession(session); return; }
      this.connected = true;
      for (const audio of this.bufferedAudio) transport.audio(audio);
      this.bufferedAudio = []; this.bufferedBytes = 0;
      this.callbacks.onAvailability(true);
    } catch (_error) {
      const transport = this.transport; const session = this.session;
      this.transport = undefined; this.session = undefined; this.connected = false;
      await transport?.close();
      if (session) await this.cancelSession(session);
      this.bufferedAudio = []; this.bufferedBytes = 0;
      if (generation === this.generation) this.callbacks.onAvailability(false);
    }
  }

  audio(bytes: Uint8Array): void {
    if (this.transport && this.connected) { this.transport.audio(bytes); return; }
    if (this.bufferedBytes + bytes.byteLength > 64000) return;
    this.bufferedAudio.push(bytes); this.bufferedBytes += bytes.byteLength;
  }

  commit(): void { this.transport?.send('input.commit', {}); }

  async close(reason: 'user_finished' | 'surface_closed' = 'surface_closed'): Promise<void> {
    ++this.generation;
    const transport = this.transport; const session = this.session;
    this.transport = undefined; this.session = undefined; this.connected = false;
    this.bufferedAudio = []; this.bufferedBytes = 0;
    if (reason === 'surface_closed') transport?.send('session.stop', { reason });
    await transport?.close();
    if (session) await this.cancelSession(session);
    this.callbacks.onAvailability(false);
  }

  private onEvent(event: XopcVoiceServerEvent): void {
    if (event.type !== 'input.transcript.delta' && event.type !== 'input.transcript.final') return;
    const id = event.payload.utteranceId ?? '';
    const revision = event.payload.revision ?? 0;
    const previousRevision = this.revisions.get(id) ?? 0;
    if (!id || revision < previousRevision || (revision === previousRevision && event.type !== 'input.transcript.final')) return;
    this.revisions.set(id, revision);
    if (event.type === 'input.transcript.final') {
      const text = (event.payload.text ?? '').trim();
      if (text) this.finals.set(id, text);
      this.partial = '';
    } else this.partial = event.payload.text ?? '';
    const text = Array.from(this.finals.values()).concat(this.partial ? [this.partial] : []).join(' ').trim();
    this.callbacks.onTranscript(text);
  }

  private async cancelSession(session: XopcVoiceSession): Promise<void> {
    try { await gatewaySession.request('/api/voice/realtime/sessions/cancel', 'POST',
      JSON.stringify({ sessionId: session.sessionId, ticket: session.ticket })); } catch (_error) {}
  }
}
