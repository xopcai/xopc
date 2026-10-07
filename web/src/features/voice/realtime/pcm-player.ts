export const REALTIME_VOICE_OUTPUT_GAIN = 1.7;

export class PcmPlayer {
  private readonly context = new AudioContext({ sampleRate: 24_000 });
  private readonly output = this.context.createGain();
  private readonly ringbackOutput = this.context.createGain();
  private readonly limiter = this.context.createDynamicsCompressor();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly ringbackSources = new Map<OscillatorNode, GainNode>();
  private ringbackDelay: ReturnType<typeof setTimeout> | null = null;
  private ringbackInterval: ReturnType<typeof setInterval> | null = null;
  private ringbackActive = false;
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
    this.ringbackOutput.gain.value = 0;
    this.ringbackOutput.connect(this.context.destination);
  }

  async start(): Promise<void> {
    await this.context.resume();
  }

  get hasPendingAudio(): boolean {
    return this.sources.size > 0;
  }

  startRingback(): void {
    this.stopRingback();
    if (this.context.state === 'closed') return;
    this.ringbackActive = true;
    this.ringbackDelay = setTimeout(() => {
      this.ringbackDelay = null;
      if (!this.ringbackActive || this.context.state !== 'running') return;
      this.ringbackOutput.gain.cancelScheduledValues(this.context.currentTime);
      this.ringbackOutput.gain.setValueAtTime(0.14, this.context.currentTime);
      this.playRingbackPulse();
      this.ringbackInterval = setInterval(() => this.playRingbackPulse(), 3_000);
    }, 500);
  }

  private playRingbackPulse(): void {
    if (!this.ringbackActive || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    for (const [index, frequency] of [392, 494].entries()) {
      const startAt = now + index * 0.4;
      const source = this.context.createOscillator();
      const envelope = this.context.createGain();
      source.type = 'sine';
      source.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, startAt);
      envelope.gain.linearRampToValueAtTime(0.5, startAt + 0.04);
      envelope.gain.setValueAtTime(0.5, startAt + 0.18);
      envelope.gain.linearRampToValueAtTime(0, startAt + 0.28);
      source.connect(envelope);
      envelope.connect(this.ringbackOutput);
      this.ringbackSources.set(source, envelope);
      source.onended = () => {
        this.ringbackSources.delete(source);
        source.disconnect();
        envelope.disconnect();
      };
      source.start(startAt);
      source.stop(startAt + 0.29);
    }
  }

  stopRingback(): void {
    this.ringbackActive = false;
    if (this.ringbackDelay !== null) clearTimeout(this.ringbackDelay);
    if (this.ringbackInterval !== null) clearInterval(this.ringbackInterval);
    this.ringbackDelay = null;
    this.ringbackInterval = null;
    if (this.context.state === 'closed') return;
    this.ringbackOutput.gain.cancelScheduledValues(this.context.currentTime);
    this.ringbackOutput.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
    for (const [source, envelope] of this.ringbackSources) {
      envelope.gain.cancelScheduledValues(this.context.currentTime);
      envelope.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
      try { source.stop(this.context.currentTime + 0.12); } catch { /* already stopped */ }
    }
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
    this.stopRingback();
    this.clear();
    this.output.disconnect();
    this.ringbackOutput.disconnect();
    this.limiter.disconnect();
    if (this.context.state !== 'closed') await this.context.close();
    for (const [source, envelope] of this.ringbackSources) {
      source.onended = null;
      source.disconnect();
      envelope.disconnect();
    }
    this.ringbackSources.clear();
  }
}
