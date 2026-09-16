import type { CreateVoiceSessionResponse, VoiceServerEvent } from './voice.js';
import type { VoiceAudioFrame } from './voice-audio.js';

/** Shared receive state for native and browser transports. No device or vendor APIs. */
export class VoiceReceiveState {
  private eventSeq = 0;
  private audioSeq = 0;
  private ready = false;
  private closed = false;
  private cancelled = new Set<string>();
  constructor(private session: CreateVoiceSessionResponse) {}
  event(event: VoiceServerEvent): void {
    if (this.closed) throw new Error('Voice session closed');
    if (event.sessionId !== this.session.sessionId || event.seq !== this.eventSeq + 1) throw new Error('Invalid voice event sequence');
    this.eventSeq = event.seq;
    if (event.type === 'session.ready') {
      if (this.ready || event.payload.connectionEpoch !== this.session.connectionEpoch || event.payload.purpose !== this.session.purpose || event.payload.inputMode !== this.session.inputMode || event.payload.inputFormat.sampleRate !== this.session.inputFormat.sampleRate || event.payload.mode !== this.session.mode || event.payload.route.engine !== this.session.route.engine) throw new Error('Voice session mismatch');
      this.ready = true;
    }
    if (event.type === 'response.cancelled') this.cancel(event.payload.responseId);
    if (event.type === 'session.closed') { this.ready = false; this.closed = true; }
  }
  audio(frame: VoiceAudioFrame): boolean {
    if (!this.ready || frame.connectionEpoch !== this.session.connectionEpoch || frame.seq !== this.audioSeq + 1) throw new Error('Invalid voice audio sequence');
    this.audioSeq = frame.seq;
    return !this.cancelled.has(frame.responseId);
  }
  cancel(responseId: string): void {
    if (this.cancelled.has(responseId)) return;
    if (this.cancelled.size >= 10000) throw new Error('Voice response limit exceeded');
    this.cancelled.add(responseId);
  }
}
