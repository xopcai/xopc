const FRAME_SAMPLES = 80; // A 20 ms frame sampled at 4 kHz.
const REFERENCE_FRAMES = 150;
const REFERENCE_MAX_AGE_MS = 3_000;
const MIN_FRAME_ENERGY = FRAME_SAMPLES * 48 ** 2;
const MIN_SIMILARITY = 0.9996;

interface ReferenceFrame {
  samples: Float64Array;
  sentAt: number;
}

function normalizedFrame(bytes: Uint8Array, stride: number, output: Float64Array): boolean {
  if (bytes.byteLength !== FRAME_SAMPLES * stride * 2) return false;
  const pcm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    const sample = pcm.getInt16(i * stride * 2, true);
    output[i] = sample;
    sum += sample;
    squares += sample ** 2;
  }
  const mean = sum / FRAME_SAMPLES;
  const energy = squares - sum * mean;
  if (energy < MIN_FRAME_ENERGY) return false;
  const scale = 1 / Math.sqrt(energy);
  for (let i = 0; i < FRAME_SAMPLES; i++) output[i] = (output[i] - mean) * scale;
  return true;
}

/** Filters near-exact playback copies while leaving mixed or transformed speech to ASR. */
export class PcmPlaybackEcho {
  private readonly frames = new Array<ReferenceFrame | undefined>(REFERENCE_FRAMES);
  private readonly input = new Float64Array(FRAME_SAMPLES);
  private readonly output = new Float64Array(FRAME_SAMPLES);
  private cursor = 0;
  private lastPlaybackAt = -Infinity;

  remember(bytes: Uint8Array, now: number): void {
    if (!normalizedFrame(bytes, 6, this.output)) return;
    const frame = this.frames[this.cursor] ?? { samples: new Float64Array(FRAME_SAMPLES), sentAt: -Infinity };
    frame.samples.set(this.output);
    frame.sentAt = now;
    this.frames[this.cursor] = frame;
    this.cursor = (this.cursor + 1) % REFERENCE_FRAMES;
    this.lastPlaybackAt = now;
  }

  matches(bytes: Uint8Array, now: number): boolean {
    if (now - this.lastPlaybackAt > REFERENCE_MAX_AGE_MS || !normalizedFrame(bytes, 4, this.input)) return false;
    for (const frame of this.frames) {
      if (!frame || now - frame.sentAt > REFERENCE_MAX_AGE_MS) continue;
      let similarity = 0;
      for (let i = 0; i < FRAME_SAMPLES; i++) similarity += frame.samples[i] * this.input[i];
      if (similarity >= MIN_SIMILARITY) return true;
    }
    return false;
  }
}
