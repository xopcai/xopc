import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeWavToMonoFloat32,
  type DecodedPcmAudio,
  UnsupportedWavEncodingError,
} from '../local/wav.js';

const TARGET_SAMPLE_RATE = 16_000;
const MAX_DECODED_DURATION_SECONDS = 15 * 60;
const MAX_DECODED_BYTES = TARGET_SAMPLE_RATE * 4 * MAX_DECODED_DURATION_SECONDS;
const MAX_SEGMENTED_DURATION_SECONDS = 30 * 60;

export type AudioFormat = 'wav' | 'webm' | 'ogg' | 'mp3' | 'mp4' | 'unknown';

export class AudioNormalizationError extends Error {
  readonly code = 'unsupported_audio_codec';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AudioNormalizationError';
  }
}

export interface AudioDecoderStatus {
  available: boolean;
  command: string;
  error?: string;
}

function ffmpegCommand(): string {
  return process.env.XOPC_FFMPEG_PATH?.trim() || 'ffmpeg';
}

/** Reports whether compressed browser/mobile recordings can be decoded on this host. */
export function getAudioDecoderStatus(): AudioDecoderStatus {
  const command = ffmpegCommand();
  const result = spawnSync(command, ['-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 5_000,
  });
  if (!result.error && result.status === 0) return { available: true, command };

  const cause = result.error instanceof Error
    ? result.error.message
    : result.stderr?.trim() || `decoder exited with status ${String(result.status)}`;
  return {
    available: false,
    command,
    error: `Audio decoder is unavailable (${command}): ${cause}. Install ffmpeg or set XOPC_FFMPEG_PATH.`,
  };
}

export function detectAudioFormat(buffer: Buffer): AudioFormat {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0) return 'mp3';
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  return 'unknown';
}

function runFfmpeg(
  args: string[],
  options: { input?: Buffer; signal?: AbortSignal; maxOutputBytes?: number } = {},
): Promise<Buffer> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const command = ffmpegCommand();
    const child = spawn(command, ['-hide_banner', '-loglevel', 'error', ...args], {
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(Buffer.concat(stdout));
    };
    const abort = () => {
      child.kill('SIGTERM');
      finish(new AudioNormalizationError('Audio decoding was cancelled'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (options.maxOutputBytes != null && outputBytes > options.maxOutputBytes) {
        child.kill('SIGTERM');
        finish(new AudioNormalizationError('Decoded audio exceeds the supported duration'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errorBytes >= 8_192) return;
      const bounded = chunk.subarray(0, 8_192 - errorBytes);
      stderr.push(bounded);
      errorBytes += bounded.length;
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'ENOENT'
        ? `Audio decoder is unavailable (${command}); install ffmpeg or set XOPC_FFMPEG_PATH to transcribe this format`
        : `Audio decoder failed to start: ${error.message}`;
      finish(new AudioNormalizationError(message, { cause: error }));
    });
    child.once('close', (code) => {
      if (settled) return;
      if (code === 0) finish();
      else {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        finish(new AudioNormalizationError(detail || `Unsupported or corrupt audio (decoder exit ${code})`));
      }
    });
    if (options.input) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input);
    }
  });
}

export async function decodeAudioToMonoFloat32(input: {
  buffer: Buffer;
  signal?: AbortSignal;
}): Promise<DecodedPcmAudio> {
  if (detectAudioFormat(input.buffer) === 'wav') {
    try {
      const decoded = decodeWavToMonoFloat32(input.buffer);
      if (decoded.durationSeconds > MAX_DECODED_DURATION_SECONDS) {
        throw new AudioNormalizationError('Decoded audio exceeds the supported duration');
      }
      return decoded;
    } catch (error) {
      if (!(error instanceof UnsupportedWavEncodingError)) throw error;
    }
  }
  const bytes = await runFfmpeg([
    '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(TARGET_SAMPLE_RATE),
    '-f', 'f32le', 'pipe:1',
  ], { input: input.buffer, signal: input.signal, maxOutputBytes: MAX_DECODED_BYTES });
  if (bytes.length === 0 || bytes.length % 4 !== 0) {
    throw new AudioNormalizationError('Audio decoder produced no usable samples');
  }
  const copied = Uint8Array.from(bytes);
  const samples = new Float32Array(copied.buffer);
  return {
    samples,
    sampleRate: TARGET_SAMPLE_RATE,
    durationSeconds: samples.length / TARGET_SAMPLE_RATE,
  };
}

/** Decodes a recording into bounded PCM WAV files and removes all temporary files afterwards. */
export async function forEachNormalizedAudioSegment(
  input: {
    filePath: string;
    segmentSeconds?: number;
    maxDurationSeconds?: number;
    signal?: AbortSignal;
  },
  consume: (buffer: Buffer, index: number) => Promise<void>,
): Promise<number> {
  const segmentSeconds = input.segmentSeconds ?? 20;
  const maxDurationSeconds = input.maxDurationSeconds ?? MAX_SEGMENTED_DURATION_SECONDS;
  if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) {
    throw new AudioNormalizationError('Audio segment duration must be positive');
  }
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new AudioNormalizationError('Maximum audio duration must be positive');
  }
  const directory = await mkdtemp(join(tmpdir(), 'xopc-audio-'));
  const outputPattern = join(directory, 'segment-%05d.wav');
  try {
    await runFfmpeg([
      '-i', input.filePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(TARGET_SAMPLE_RATE),
      '-t', String(maxDurationSeconds + segmentSeconds),
      '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', String(segmentSeconds),
      '-reset_timestamps', '1', outputPattern,
    ], { signal: input.signal });
    const files = (await readdir(directory)).filter((name) => name.endsWith('.wav')).sort();
    if (files.length === 0) throw new AudioNormalizationError('Audio decoder produced no segments');
    let decodedDurationSeconds = 0;
    for (const file of files) {
      const decoded = decodeWavToMonoFloat32(await readFile(join(directory, file)));
      decodedDurationSeconds += decoded.durationSeconds;
      if (decodedDurationSeconds > maxDurationSeconds + 0.05) {
        throw new AudioNormalizationError(
          `Decoded audio exceeds the ${Math.round(maxDurationSeconds)} second limit`,
        );
      }
    }
    for (let index = 0; index < files.length; index += 1) {
      await consume(await readFile(join(directory, files[index]!)), index);
    }
    return files.length;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
