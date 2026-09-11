export type VoiceResponseDiagnostics = {
  responseId: string;
  textCharacters: number;
  receivedBytes: number;
  queuedBytes: number;
  playedBytes: number;
  peakAmplitude: number;
  invalidPcmFrames: number;
  finishReason?: string;
  cancelReason?: string;
};

export type VoiceNetworkDiagnostics = {
  latestRttMs?: number;
  maxRttMs: number;
  peakInputQueueAgeMs: number;
  droppedInputFrames: number;
  congestionPauses: number;
};

/** Bounded, in-memory counters only: never retain speech, transcripts or credentials. */
export class VoiceDiagnostics {
  private startedAt = 0;
  private engine?: 'agent' | 'omni';
  private inputBytes = 0;
  private responseCount = 0;
  private errorCode?: string;
  private endReason?: string;
  private responses: VoiceResponseDiagnostics[] = [];
  private network: VoiceNetworkDiagnostics = { maxRttMs: 0, peakInputQueueAgeMs: 0, droppedInputFrames: 0, congestionPauses: 0 };
  private audioRoute?: { output: string; echoControl: string; fullDuplex: boolean };

  start() {
    this.startedAt = Date.now(); this.engine = undefined; this.inputBytes = 0;
    this.responseCount = 0; this.errorCode = undefined; this.endReason = undefined; this.responses = [];
    this.network = { maxRttMs: 0, peakInputQueueAgeMs: 0, droppedInputFrames: 0, congestionPauses: 0 };
    this.audioRoute = undefined;
  }
  setEngine(engine: 'agent' | 'omni') { this.engine = engine; this.endReason = undefined; }
  input(bytes: number) { this.inputBytes += bytes; }
  inputResult(bytes: number, result: { accepted: boolean; queueAgeMs: number }) {
    if (Number.isFinite(result.queueAgeMs)) this.network.peakInputQueueAgeMs = Math.max(this.network.peakInputQueueAgeMs, result.queueAgeMs);
    if (result.accepted) this.input(bytes); else this.network.droppedInputFrames += 1;
  }
  congestionPause() { this.network.congestionPauses += 1; }
  rtt(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.network.latestRttMs = durationMs;
    this.network.maxRttMs = Math.max(this.network.maxRttMs, durationMs);
  }
  route(value: { output: string; echoControl: string; fullDuplex: boolean }) { this.audioRoute = { ...value }; }
  error(code: string) { this.errorCode = code; }
  end(reason: string) { this.endReason = reason; }
  response(id: string) {
    this.errorCode = undefined;
    this.responseCount++;
    this.responses.push({ responseId: id, textCharacters: 0, receivedBytes: 0, queuedBytes: 0, playedBytes: 0, peakAmplitude: 0, invalidPcmFrames: 0 });
    if (this.responses.length > 5) this.responses.shift();
  }
  private find(id: string) { return this.responses.find(response => response.responseId === id); }
  text(id: string, characters: number) {
    const response = this.find(id);
    if (response) response.textCharacters += characters;
  }
  received(id: string, pcm: Uint8Array) {
    const response = this.find(id);
    if (!response) return;
    response.receivedBytes += pcm.byteLength;
    if (!pcm.byteLength || pcm.byteLength % 2) response.invalidPcmFrames++;
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
      response.peakAmplitude = Math.max(response.peakAmplitude, Math.abs(view.getInt16(offset, true)));
    }
  }
  queued(id: string, bytes: number) { const response = this.find(id); if (response) response.queuedBytes += bytes; }
  played(id: string, bytes: number) { const response = this.find(id); if (response) response.playedBytes = Math.max(response.playedBytes, bytes); }
  done(id: string, reason: string) { const response = this.find(id); if (response) response.finishReason = reason; }
  cancelled(id: string, reason: string) { const response = this.find(id); if (response) response.cancelReason = reason; }
  snapshot() {
    return { startedAt: this.startedAt, engine: this.engine, inputBytes: this.inputBytes, responseCount: this.responseCount,
      errorCode: this.errorCode, endReason: this.endReason, network: { ...this.network },
      audioRoute: this.audioRoute ? { ...this.audioRoute } : undefined,
      responses: this.responses.map(response => ({ ...response })) };
  }
}

export function voiceDiagnosticFinding(response: VoiceResponseDiagnostics | undefined) {
  if (!response) return 'noResponse' as const;
  if (response.cancelReason) return 'cancelled' as const;
  if (!response.receivedBytes) return 'noAudio' as const;
  if (!response.peakAmplitude) return 'silentAudio' as const;
  if (!response.queuedBytes) return 'notQueued' as const;
  if (!response.playedBytes) return 'notPlayed' as const;
  return 'played' as const;
}
