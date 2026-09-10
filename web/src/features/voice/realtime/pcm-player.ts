export const REALTIME_VOICE_OUTPUT_GAIN = 1.7;

export class PcmPlayer {
  private readonly context = new AudioContext({ sampleRate: 24_000 });
  private readonly output = this.context.createGain();
  private readonly limiter = this.context.createDynamicsCompressor();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private hasStartedAudio = false;

  constructor() {
    this.output.gain.value = REALTIME_VOICE_OUTPUT_GAIN;
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;
    this.output.connect(this.limiter);
    this.limiter.connect(this.context.destination);
  }

  async start(): Promise<void> {
    await this.context.resume();
  }

  get hasPendingAudio(): boolean {
    return this.sources.size > 0;
  }

  enqueue(pcm: ArrayBuffer, onPlayed: () => void, sampleRate = 24_000): void {
    if (pcm.byteLength < 2 || this.context.state === 'closed') return;
    const view = new DataView(pcm);
    const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    }
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    const schedulingLead = this.hasStartedAudio ? 0.015 : 0.08;
    const startAt = Math.max(this.context.currentTime + schedulingLead, this.nextStartTime);
    source.start(startAt);
    this.hasStartedAudio = true;
    this.nextStartTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      if (!this.sources.delete(source)) return;
      source.disconnect();
      onPlayed();
    };
  }

  duck(active: boolean): void {
    if (this.context.state === 'closed') return;
    const gain = active ? REALTIME_VOICE_OUTPUT_GAIN * 0.15 : REALTIME_VOICE_OUTPUT_GAIN;
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.setTargetAtTime(gain, this.context.currentTime, 0.015);
  }

  clear(): void {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this.sources.clear();
    this.nextStartTime = this.context.currentTime;
    this.hasStartedAudio = false;
    this.duck(false);
  }

  async close(): Promise<void> {
    this.clear();
    this.output.disconnect();
    this.limiter.disconnect();
    if (this.context.state !== 'closed') await this.context.close();
  }
}
