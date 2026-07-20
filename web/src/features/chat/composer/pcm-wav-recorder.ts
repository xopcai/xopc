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

export class PcmWavRecorder {
  private readonly chunks: Float32Array[] = [];
  private readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly processor: ScriptProcessorNode;
  private readonly mutedOutput: GainNode;
  private stopped = false;

  private constructor(stream: MediaStream, options: PcmWavRecorderOptions = {}) {
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.mutedOutput = this.context.createGain();
    this.mutedOutput.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      if (this.stopped) return;
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      this.chunks.push(chunk);
      if (options.onAudioLevel) {
        const level = calculateRmsLevel(chunk);
        options.onAudioLevel({
          level,
          speaking: level >= (options.speechThreshold ?? 0.015),
        });
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.mutedOutput);
    this.mutedOutput.connect(this.context.destination);
  }

  static async start(stream: MediaStream, options: PcmWavRecorderOptions = {}): Promise<PcmWavRecorder> {
    const recorder = new PcmWavRecorder(stream, options);
    await recorder.context.resume();
    return recorder;
  }

  async stop(): Promise<Blob> {
    if (this.stopped) return new Blob([], { type: 'audio/wav' });
    this.stopped = true;
    const sourceRate = this.context.sampleRate;
    this.disconnect();
    await this.context.close();
    const merged = mergeChunks(this.chunks);
    const samples = resamplePcm(merged, sourceRate);
    return new Blob([encodePcm16Wav(samples)], { type: 'audio/wav' });
  }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.disconnect();
    void this.context.close();
    this.chunks.length = 0;
  }

  private disconnect(): void {
    this.processor.onaudioprocess = null;
    this.source.disconnect();
    this.processor.disconnect();
    this.mutedOutput.disconnect();
  }
}
