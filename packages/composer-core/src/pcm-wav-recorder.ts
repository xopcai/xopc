import pcmCaptureWorkletUrl from './pcm-capture-worklet.ts?worker&url';

const TARGET_SAMPLE_RATE = 16_000;

export interface RecorderAudioLevel {
  /** Root-mean-square amplitude, normalized to 0..1. */
  level: number;
  /** True when the current frame is likely to contain speech. */
  speaking: boolean;
}

export interface PcmWavRecorderOptions {
  onAudioLevel?: (sample: RecorderAudioLevel) => void;
  speechThreshold?: number;
}

export interface PcmFrameCaptureOptions extends PcmWavRecorderOptions {
  onSamples: (samples: Float32Array) => void;
}

export function calculateRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSquares += samples[i] * samples[i];
  }
  return Math.min(1, Math.sqrt(sumSquares / samples.length));
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function resamplePcm(input: Float32Array, sourceRate: number, targetRate = TARGET_SAMPLE_RATE): Float32Array {
  if (sourceRate === targetRate) return input;
  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return buffer;
}

export function encodePcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return buffer;
}

/** Stateful linear resampler for continuous microphone chunks. */
export class PcmStreamEncoder {
  private pending = new Float32Array(0);
  private position = 0;

  constructor(
    private readonly sourceRate: number,
    private readonly targetRate = TARGET_SAMPLE_RATE,
  ) {
    if (sourceRate <= 0 || targetRate <= 0) throw new Error('PCM sample rates must be positive');
  }

  push(chunk: Float32Array): ArrayBuffer {
    if (chunk.length === 0) return new ArrayBuffer(0);
    const input = new Float32Array(this.pending.length + chunk.length);
    input.set(this.pending);
    input.set(chunk, this.pending.length);
    const ratio = this.sourceRate / this.targetRate;
    const output: number[] = [];
    while (this.position + 1 < input.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      output.push(input[left] * (1 - fraction) + input[left + 1] * fraction);
      this.position += ratio;
    }
    const consumed = Math.min(input.length - 1, Math.floor(this.position));
    this.pending = input.slice(consumed);
    this.position -= consumed;
    return encodePcm16(Float32Array.from(output));
  }

  flush(): ArrayBuffer {
    if (this.pending.length === 0) return new ArrayBuffer(0);
    const sample = this.pending[Math.min(this.pending.length - 1, Math.floor(this.position))];
    this.pending = new Float32Array(0);
    this.position = 0;
    return encodePcm16(Float32Array.of(sample));
  }
}

const WORKLET_NAME = 'xopc-pcm-capture';
const WORKLET_FLUSH_TIMEOUT_MS = 1_000;

type CaptureMessage =
  | { type: 'samples'; buffer: ArrayBuffer }
  | { type: 'flushed' };

/** Shared AudioWorklet PCM source used by short dictation and long discussions. */
export class PcmFrameCapture {
  readonly sampleRate: number;
  private paused = false;
  private accepting = true;
  private processorFailed = false;
  private stopPromise?: Promise<void>;
  private flushResolve?: () => void;

  private constructor(
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode,
    private readonly mutedOutput: GainNode,
    private readonly options: PcmFrameCaptureOptions,
  ) {
    this.sampleRate = context.sampleRate;
    this.node.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
      if (event.data.type === 'flushed') {
        this.flushResolve?.();
        return;
      }
      if (!this.accepting || this.paused) return;
      const samples = new Float32Array(event.data.buffer);
      this.options.onSamples(samples);
      if (this.options.onAudioLevel) {
        const level = calculateRmsLevel(samples);
        this.options.onAudioLevel({
          level,
          speaking: level >= (this.options.speechThreshold ?? 0.015),
        });
      }
    };
    this.node.onprocessorerror = () => {
      this.processorFailed = true;
      this.flushResolve?.();
    };
  }

  static async start(stream: MediaStream, options: PcmFrameCaptureOptions): Promise<PcmFrameCapture> {
    if (typeof AudioWorkletNode === 'undefined') {
      throw new Error('PCM audio recording is not supported in this browser');
    }
    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule(pcmCaptureWorkletUrl);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, WORKLET_NAME);
      const mutedOutput = context.createGain();
      mutedOutput.gain.value = 0;
      const capture = new PcmFrameCapture(context, source, node, mutedOutput, options);
      source.connect(node);
      node.connect(mutedOutput);
      mutedOutput.connect(context.destination);
      await context.resume();
      return capture;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.finish();
    return this.stopPromise;
  }

  cancel(): void {
    if (!this.accepting) return;
    this.accepting = false;
    this.flushResolve?.();
    this.flushResolve = undefined;
    this.disconnect();
    void this.context.close().catch(() => undefined);
  }

  private async finish(): Promise<void> {
    if (!this.accepting) return;
    if (!this.processorFailed) await this.flushWorklet();
    this.flushResolve = undefined;
    if (!this.accepting) return;
    this.accepting = false;
    this.disconnect();
    await this.context.close().catch(() => undefined);
  }

  private flushWorklet(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const complete = () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve();
      };
      const timeout = globalThis.setTimeout(complete, WORKLET_FLUSH_TIMEOUT_MS);
      this.flushResolve = complete;
      try {
        this.node.port.postMessage('flush');
      } catch {
        complete();
      }
    });
  }

  private disconnect(): void {
    this.node.port.onmessage = null;
    this.node.onprocessorerror = null;
    this.source.disconnect();
    this.node.disconnect();
    this.mutedOutput.disconnect();
  }
}

export class PcmWavRecorder {
  private stopped = false;

  private constructor(
    private readonly capture: PcmFrameCapture,
    private readonly chunks: Float32Array[],
  ) {}

  static async start(stream: MediaStream, options: PcmWavRecorderOptions = {}): Promise<PcmWavRecorder> {
    const chunks: Float32Array[] = [];
    const capture = await PcmFrameCapture.start(stream, {
      ...options,
      onSamples: (samples) => chunks.push(samples),
    });
    return new PcmWavRecorder(capture, chunks);
  }

  async stop(): Promise<Blob> {
    if (this.stopped) return new Blob([], { type: 'audio/wav' });
    this.stopped = true;
    await this.capture.stop();
    const merged = mergeChunks(this.chunks);
    const samples = resamplePcm(merged, this.capture.sampleRate);
    return new Blob([encodePcm16Wav(samples)], { type: 'audio/wav' });
  }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.capture.cancel();
    this.chunks.length = 0;
  }
}
