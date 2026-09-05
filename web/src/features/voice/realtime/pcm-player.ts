export class PcmPlayer {
  private readonly context = new AudioContext({ sampleRate: 24_000 });
  private readonly output = this.context.createGain();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;

  constructor() {
    this.output.connect(this.context.destination);
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
    const startAt = Math.max(this.context.currentTime + 0.08, this.nextStartTime);
    source.start(startAt);
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
    const gain = active ? 0.15 : 1;
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
    this.duck(false);
  }

  async close(): Promise<void> {
    this.clear();
    this.output.disconnect();
    if (this.context.state !== 'closed') await this.context.close();
  }
}
