import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decodeWavToMonoFloat32 } from '../../local/wav.js';
import {
  decodeAudioToMonoFloat32,
  detectAudioFormat,
  forEachNormalizedAudioSegment,
  getAudioDecoderStatus,
} from '../normalize.js';

function pcmWav(seconds: number, sampleRate = 16_000): Buffer {
  const sampleCount = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 20) * 2_000), 44 + index * 2);
  }
  return buffer;
}

describe('audio normalization', () => {
  it('detects supported containers from bytes rather than MIME labels', () => {
    expect(detectAudioFormat(pcmWav(0.01))).toBe('wav');
    expect(detectAudioFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm');
    expect(detectAudioFormat(Buffer.from('OggS'))).toBe('ogg');
    expect(detectAudioFormat(Buffer.from('ID3'))).toBe('mp3');
    expect(detectAudioFormat(Buffer.from('0000ftyp0000'))).toBe('mp4');
    expect(detectAudioFormat(Buffer.from('not audio'))).toBe('unknown');
  });

  it('normalizes PCM WAV without requiring an external decoder', async () => {
    const decoded = await decodeAudioToMonoFloat32({ buffer: pcmWav(0.25) });
    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.durationSeconds).toBeCloseTo(0.25, 3);
  });

  it('reports a missing configured decoder before compressed audio is submitted', async () => {
    const previous = process.env.XOPC_FFMPEG_PATH;
    process.env.XOPC_FFMPEG_PATH = '/definitely/missing/xopc-ffmpeg';
    try {
      expect(getAudioDecoderStatus()).toMatchObject({
        available: false,
        command: '/definitely/missing/xopc-ffmpeg',
      });
      await expect(decodeAudioToMonoFloat32({
        buffer: Buffer.from('0000ftyp0000'),
      })).rejects.toThrow('install ffmpeg or set XOPC_FFMPEG_PATH');
    } finally {
      if (previous == null) delete process.env.XOPC_FFMPEG_PATH;
      else process.env.XOPC_FFMPEG_PATH = previous;
    }
  });

  const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  it.runIf(hasFfmpeg)('splits a long recording into bounded normalized WAV segments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xopc-normalize-test-'));
    const filePath = join(directory, 'recording.wav');
    try {
      await writeFile(filePath, pcmWav(41));
      const durations: number[] = [];
      const count = await forEachNormalizedAudioSegment({ filePath, segmentSeconds: 20 }, async (buffer) => {
        const decoded = decodeWavToMonoFloat32(buffer);
        durations.push(decoded.durationSeconds);
      });
      expect(count).toBe(3);
      expect(durations.every((duration) => duration > 0 && duration <= 20.1)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(hasFfmpeg)('decodes browser and mobile recording containers to mono PCM', async () => {
    const source = pcmWav(0.5);
    const formats = [
      { name: 'webm', args: ['-c:a', 'libopus', '-f', 'webm'] },
      { name: 'ogg', args: ['-c:a', 'libopus', '-f', 'ogg'] },
      { name: 'mp3', args: ['-c:a', 'libmp3lame', '-f', 'mp3'] },
      { name: 'mp4', args: ['-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4'] },
    ] as const;

    for (const format of formats) {
      const encoded = spawnSync(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...format.args, 'pipe:1'],
        { input: source, maxBuffer: 4 * 1024 * 1024 },
      );
      expect(encoded.status, encoded.stderr.toString()).toBe(0);
      expect(detectAudioFormat(encoded.stdout)).toBe(format.name);
      const decoded = await decodeAudioToMonoFloat32({ buffer: encoded.stdout });
      expect(decoded.sampleRate).toBe(16_000);
      expect(decoded.durationSeconds).toBeGreaterThan(0.3);
    }
  });

  it.runIf(hasFfmpeg)('falls back to ffmpeg for WAV encodings outside the native fast path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xopc-normalize-wav-test-'));
    const filePath = join(directory, 'pcm24.wav');
    try {
      const encoded = spawnSync(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'pcm_s24le', '-y', filePath],
        { input: pcmWav(0.5), maxBuffer: 4 * 1024 * 1024 },
      );
      expect(encoded.status, encoded.stderr.toString()).toBe(0);
      const decoded = await decodeAudioToMonoFloat32({ buffer: await readFile(filePath) });
      expect(decoded.sampleRate).toBe(16_000);
      expect(decoded.durationSeconds).toBeCloseTo(0.5, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(hasFfmpeg)('rejects recordings whose decoded duration exceeds the segment limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xopc-normalize-limit-test-'));
    const filePath = join(directory, 'recording.wav');
    try {
      await writeFile(filePath, pcmWav(2.1));
      await expect(forEachNormalizedAudioSegment({
        filePath,
        segmentSeconds: 1,
        maxDurationSeconds: 1,
      }, async () => undefined)).rejects.toThrow('Decoded audio exceeds the 1 second limit');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
