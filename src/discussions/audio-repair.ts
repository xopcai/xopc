import type { DecodedPcmAudio } from '../voice/audio/wav.js';

export interface AudioRange { startedAtMs: number; endedAtMs: number }

/** Subtract already confirmed ranges without guessing word-level boundaries. */
export function missingAudioRanges(start: number, end: number, confirmed: AudioRange[]): AudioRange[] {
  let cursor = start;
  const missing: AudioRange[] = [];
  for (const range of [...confirmed].sort((a, b) => a.startedAtMs - b.startedAtMs)) {
    if (range.endedAtMs <= cursor || range.startedAtMs >= end) continue;
    if (range.startedAtMs > cursor) missing.push({ startedAtMs: cursor, endedAtMs: Math.min(end, range.startedAtMs) });
    cursor = Math.max(cursor, Math.min(end, range.endedAtMs));
  }
  if (cursor < end) missing.push({ startedAtMs: cursor, endedAtMs: end });
  return missing;
}

export function slicePcmWav(audio: DecodedPcmAudio, startMs: number, endMs: number): Buffer {
  const start = Math.max(0, Math.round(startMs * audio.sampleRate / 1000));
  const end = Math.min(audio.samples.length, Math.round(endMs * audio.sampleRate / 1000));
  const samples = audio.samples.subarray(start, end);
  const output = Buffer.alloc(44 + samples.length * 2);
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(audio.sampleRate, 24); output.writeUInt32LE(audio.sampleRate * 2, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36);
  output.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  return output;
}
