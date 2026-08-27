import {
  calculateRmsLevel,
  encodePcm16Wav,
  PcmFrameCapture,
  resamplePcm,
} from '@/features/chat/composer/pcm-wav-recorder';

const MIN_SEGMENT_SECONDS = 4;
const MAX_SEGMENT_SECONDS = 15;
const TRAILING_SILENCE_SECONDS = 0.6;
const MAX_SPLIT_OVERLAP_SECONDS = 0.5;
const MIN_FINAL_SECONDS = 0.5;
const SPEECH_THRESHOLD = 0.015;

export interface LivePcmSegment {
  sequence: number;
  blob: Blob;
  startedAtMs: number;
  endedAtMs: number;
  sha256: string;
}

export interface BufferedPcmSegment {
  sequence: number;
  samples: Float32Array;
  startedAtMs: number;
  endedAtMs: number;
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

/** Pure speech-aware segment accumulator. It is independent from browser media APIs and easy to stress-test. */
export class PcmSegmentAccumulator {
  private chunks: Float32Array[] = [];
  private bufferedSamples = 0;
  private segmentStartSample = 0;
  private sequence = 0;
  private silenceSamples = 0;
  private hasSpeech = false;

  constructor(private readonly sampleRate: number) {}

  add(samples: Float32Array): BufferedPcmSegment[] {
    if (samples.length === 0) return [];
    this.chunks.push(samples);
    this.bufferedSamples += samples.length;
    if (calculateRmsLevel(samples) >= SPEECH_THRESHOLD) {
      this.hasSpeech = true;
      this.silenceSamples = 0;
    } else {
      this.silenceSamples += samples.length;
    }

    const maxSamples = this.sampleRate * MAX_SEGMENT_SECONDS;
    if (this.bufferedSamples >= maxSamples) {
      if (!this.hasSpeech) {
        this.discardBuffered();
        return [];
      }
      return [this.emit('max')];
    }
    const reachedPause = this.hasSpeech
      && this.bufferedSamples >= this.sampleRate * MIN_SEGMENT_SECONDS
      && this.silenceSamples >= this.sampleRate * TRAILING_SILENCE_SECONDS;
    return reachedPause ? [this.emit('silence')] : [];
  }

  finish(): BufferedPcmSegment[] {
    if (!this.hasSpeech || this.bufferedSamples < this.sampleRate * MIN_FINAL_SECONDS) {
      this.discardBuffered();
      return [];
    }
    return [this.emit('final')];
  }

  cancel(): void {
    this.chunks = [];
    this.bufferedSamples = 0;
  }

  get lastSequence(): number {
    return this.sequence - 1;
  }

  private emit(reason: 'silence' | 'max' | 'final'): BufferedPcmSegment {
    const merged = merge(this.chunks);
    const take = reason === 'max'
      ? Math.min(merged.length, this.sampleRate * MAX_SEGMENT_SECONDS)
      : merged.length;
    const samples = merged.slice(0, take);
    const overlap = reason === 'max'
      ? Math.min(take, this.sampleRate * MAX_SPLIT_OVERLAP_SECONDS)
      : 0;
    const remainder = merged.slice(take - overlap);
    const startedAtMs = Math.round((this.segmentStartSample / this.sampleRate) * 1_000);
    const endedAtMs = Math.round(((this.segmentStartSample + take) / this.sampleRate) * 1_000);
    const segment = { sequence: this.sequence++, samples, startedAtMs, endedAtMs };

    this.segmentStartSample += take - overlap;
    this.chunks = remainder.length ? [remainder] : [];
    this.bufferedSamples = remainder.length;
    this.hasSpeech = remainder.length > 0 && calculateRmsLevel(remainder) >= SPEECH_THRESHOLD;
    this.silenceSamples = this.hasSpeech ? 0 : remainder.length;
    return segment;
  }

  private discardBuffered(): void {
    this.segmentStartSample += this.bufferedSamples;
    this.chunks = [];
    this.bufferedSamples = 0;
    this.silenceSamples = 0;
    this.hasSpeech = false;
  }
}

type EmitState = {
  pending: Set<Promise<void>>;
  error?: unknown;
};

export class LivePcmSegmenter {
  private stopped = false;

  private constructor(
    private readonly capture: PcmFrameCapture,
    private readonly accumulator: PcmSegmentAccumulator,
    private readonly emitState: EmitState,
    private readonly onSegment: (segment: LivePcmSegment) => Promise<void> | void,
  ) {}

  static async start(
    stream: MediaStream,
    onSegment: (segment: LivePcmSegment) => Promise<void> | void,
  ): Promise<LivePcmSegmenter> {
    const emitState: EmitState = { pending: new Set() };
    let segmenter: LivePcmSegmenter | undefined;
    const earlySamples: Float32Array[] = [];
    const capture = await PcmFrameCapture.start(stream, {
      onSamples: (samples) => {
        if (!segmenter) {
          earlySamples.push(samples);
          return;
        }
        for (const segment of segmenter.accumulator.add(samples)) segmenter.emit(segment);
      },
    });
    segmenter = new LivePcmSegmenter(
      capture,
      new PcmSegmentAccumulator(capture.sampleRate),
      emitState,
      onSegment,
    );
    for (const samples of earlySamples) {
      for (const segment of segmenter.accumulator.add(samples)) segmenter.emit(segment);
    }
    return segmenter;
  }

  pause(): void {
    this.capture.pause();
  }

  resume(): void {
    this.capture.resume();
  }

  async stop(): Promise<number> {
    if (this.stopped) return this.accumulator.lastSequence;
    this.stopped = true;
    await this.capture.stop();
    for (const segment of this.accumulator.finish()) this.emit(segment);
    await Promise.all(this.emitState.pending);
    if (this.emitState.error) throw this.emitState.error;
    return this.accumulator.lastSequence;
  }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.capture.cancel();
    this.accumulator.cancel();
  }

  private emit(segment: BufferedPcmSegment): void {
    const resampled = resamplePcm(segment.samples, this.capture.sampleRate);
    const blob = new Blob([encodePcm16Wav(resampled)], { type: 'audio/wav' });
    const pending = (async () => {
      await this.onSegment({
        sequence: segment.sequence,
        blob,
        startedAtMs: segment.startedAtMs,
        endedAtMs: segment.endedAtMs,
        sha256: await sha256(blob),
      });
    })().catch((error: unknown) => {
      this.emitState.error ??= error;
    });
    this.emitState.pending.add(pending);
    void pending.then(() => this.emitState.pending.delete(pending));
  }
}
