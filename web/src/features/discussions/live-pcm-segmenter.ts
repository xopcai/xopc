import { encodePcm16Wav, resamplePcm } from '@/features/chat/composer/pcm-wav-recorder';

const SEGMENT_SECONDS = 20;
const OVERLAP_SECONDS = 1;

export interface LivePcmSegment {
  sequence: number;
  blob: Blob;
  startedAtMs: number;
  endedAtMs: number;
  sha256: string;
}

function merge(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export class LivePcmSegmenter {
  private readonly chunks: Float32Array[] = [];
  private bufferedSamples = 0;
  private sequence = 0;
  private lastEndMs = 0;
  private paused = false;
  private stopped = false;
  private emitTail = Promise.resolve();

  private constructor(
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode,
    private readonly mutedOutput: GainNode,
    private readonly onSegment: (segment: LivePcmSegment) => Promise<void> | void,
  ) {
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.paused || this.stopped) return;
      const chunk = new Float32Array(event.data);
      this.chunks.push(chunk);
      this.bufferedSamples += chunk.length;
      this.flushCompleteSegments();
    };
  }

  static async start(
    stream: MediaStream,
    onSegment: (segment: LivePcmSegment) => Promise<void> | void,
  ): Promise<LivePcmSegmenter> {
    if (!window.AudioWorkletNode) throw new Error('Live transcription is not supported in this browser');
    const context = new AudioContext();
    const workletSource = `
      class XopcDiscussionPcmProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const channel = inputs[0] && inputs[0][0];
          if (channel && channel.length) {
            const copy = new Float32Array(channel);
            this.port.postMessage(copy.buffer, [copy.buffer]);
          }
          return true;
        }
      }
      registerProcessor('xopc-discussion-pcm', XopcDiscussionPcmProcessor);
    `;
    const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'xopc-discussion-pcm');
    const mutedOutput = context.createGain();
    mutedOutput.gain.value = 0;
    source.connect(node);
    node.connect(mutedOutput);
    mutedOutput.connect(context.destination);
    await context.resume();
    return new LivePcmSegmenter(context, source, node, mutedOutput, onSegment);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async stop(): Promise<number> {
    if (this.stopped) return this.sequence - 1;
    this.stopped = true;
    this.disconnect();
    await this.context.close();
    if (this.bufferedSamples >= this.context.sampleRate / 2) this.emitBuffered(true);
    await this.emitTail;
    return this.sequence - 1;
  }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.disconnect();
    void this.context.close();
    this.chunks.length = 0;
    this.bufferedSamples = 0;
  }

  private flushCompleteSegments(): void {
    const segmentSamples = this.context.sampleRate * SEGMENT_SECONDS;
    while (this.bufferedSamples >= segmentSamples) this.emitBuffered(false);
  }

  private emitBuffered(final: boolean): void {
    const sampleRate = this.context.sampleRate;
    const segmentSamples = sampleRate * SEGMENT_SECONDS;
    const overlapSamples = sampleRate * OVERLAP_SECONDS;
    const merged = merge(this.chunks);
    const take = final ? merged.length : segmentSamples;
    const samples = merged.slice(0, take);
    const retainFrom = final ? merged.length : Math.max(0, take - overlapSamples);
    const remainder = merged.slice(retainFrom);
    this.chunks.length = 0;
    if (remainder.length > 0) this.chunks.push(remainder);
    this.bufferedSamples = remainder.length;

    const durationMs = Math.round((samples.length / sampleRate) * 1_000);
    const startedAtMs = this.sequence === 0 ? 0 : Math.max(0, this.lastEndMs - OVERLAP_SECONDS * 1_000);
    const endedAtMs = startedAtMs + durationMs;
    this.lastEndMs = endedAtMs;
    const sequence = this.sequence++;
    const resampled = resamplePcm(samples, sampleRate);
    const blob = new Blob([encodePcm16Wav(resampled)], { type: 'audio/wav' });
    this.emitTail = this.emitTail.then(async () => {
      await this.onSegment({ sequence, blob, startedAtMs, endedAtMs, sha256: await sha256(blob) });
    });
  }

  private disconnect(): void {
    this.node.port.onmessage = null;
    this.source.disconnect();
    this.node.disconnect();
    this.mutedOutput.disconnect();
  }
}
