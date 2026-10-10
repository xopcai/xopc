export interface XopcVoiceTimingReport {
  kind: string;
  responseId: string;
  mode: string;
  route: string;
  outcome: string;
  speechStopToResponseMs?: number;
  speechStopToAudioReceivedMs?: number;
  audioReceivedToBufferedMs?: number;
  audioReceivedToPlaybackProgressMs?: number;
  bufferedDurationMs: number;
  playedDurationMs: number;
}

interface XopcVoiceResponseTiming {
  id: string;
  stoppedAt?: number;
  createdAt: number;
  receivedAt?: number;
  bufferedAt?: number;
  playedAt?: number;
  bufferedMs: number;
  playedMs: number;
}

// Client-observed provider endpoints exclude provider VAD latency; hardware progress is sampled, not exact first sound.
export class XopcVoiceTiming {
  private stoppedAt?: number;
  private responses: XopcVoiceResponseTiming[] = [];

  speechStarted(): void { this.stoppedAt = undefined; }
  speechStopped(now: number): void { this.stoppedAt = now; }

  created(id: string, now: number): void {
    if (!id || this.find(id)) return;
    if (this.responses.length >= 32) this.responses.shift();
    this.responses.push({ id, stoppedAt: this.stoppedAt, createdAt: now, bufferedMs: 0, playedMs: 0 });
    this.stoppedAt = undefined;
  }

  received(id: string, now: number): number | undefined {
    const response = this.find(id);
    if (!response || response.receivedAt !== undefined) return undefined;
    response.receivedAt = now;
    return response.stoppedAt === undefined ? undefined : Math.max(0, now - response.stoppedAt);
  }

  buffered(id: string, milliseconds: number, now: number): number | undefined {
    const response = this.find(id); if (!response) return undefined;
    const first = response.bufferedAt === undefined;
    if (first) response.bufferedAt = now;
    response.bufferedMs = Math.max(response.bufferedMs, milliseconds);
    return first ? this.elapsed(response.stoppedAt, now) : undefined;
  }

  played(id: string, milliseconds: number, now: number, source: string): void {
    const response = this.find(id); if (!response) return;
    if (milliseconds > 0 && source === 'timestamp' && response.playedAt === undefined) response.playedAt = now;
    response.playedMs = Math.max(response.playedMs, milliseconds);
  }

  finish(id: string, mode: string, route: string, outcome: string): XopcVoiceTimingReport | undefined {
    const response = this.find(id); if (!response) return undefined;
    this.responses.splice(this.responses.indexOf(response), 1);
    return { kind: 'voice_timing', responseId: id, mode, route, outcome,
      speechStopToResponseMs: this.elapsed(response.stoppedAt, response.createdAt),
      speechStopToAudioReceivedMs: this.elapsed(response.stoppedAt, response.receivedAt),
      audioReceivedToBufferedMs: this.elapsed(response.receivedAt, response.bufferedAt),
      audioReceivedToPlaybackProgressMs: this.elapsed(response.receivedAt, response.playedAt),
      bufferedDurationMs: response.bufferedMs, playedDurationMs: response.playedMs };
  }

  reset(): void { this.stoppedAt = undefined; this.responses = []; }

  private find(id: string): XopcVoiceResponseTiming | undefined {
    return this.responses.find((response: XopcVoiceResponseTiming): boolean => response.id === id);
  }

  private elapsed(start?: number, end?: number): number | undefined {
    return start === undefined || end === undefined ? undefined : Math.max(0, end - start);
  }
}
