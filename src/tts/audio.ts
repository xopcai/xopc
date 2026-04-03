/**
 * Audio Compression Utilities
 */

import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AudioUtils');

/**
 * Execute a command using spawn (avoids shell injection)
 */
function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: 'ignore' });
    process.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    process.on('error', reject);
  });
}

export interface CompressionResult {
  buffer: Buffer;
  format: string;
}

/** When TTS returns WAV, ffmpeg can target Opus (Telegram, etc.) or MP3 (Weixin VoiceItem, webchat). */
export type WavCompressionTarget = 'opus' | 'mp3';

/**
 * Compress WAV using ffmpeg. Non-WAV inputs are returned unchanged.
 * Default `wavTarget` is Opus for backward compatibility.
 */
export async function compressAudio(
  audioBuffer: Buffer,
  inputFormat: string,
  wavTarget: WavCompressionTarget = 'opus',
): Promise<CompressionResult> {
  if (inputFormat !== 'wav') {
    return { buffer: audioBuffer, format: inputFormat };
  }

  const tempDir = tmpdir();
  const inputPath = join(tempDir, `input_${Date.now()}.wav`);
  const outExt = wavTarget === 'mp3' ? 'mp3' : 'opus';
  const outputPath = join(tempDir, `output_${Date.now()}.${outExt}`);

  try {
    await writeFile(inputPath, audioBuffer);

    if (wavTarget === 'mp3') {
      await spawnAsync('ffmpeg', [
        '-i', inputPath,
        '-c:a', 'libmp3lame',
        '-b:a', '64k',
        outputPath,
        '-y',
      ]);
    } else {
      await spawnAsync('ffmpeg', [
        '-i', inputPath,
        '-c:a', 'libopus',
        '-b:a', '24k',
        '-vbr', 'on',
        outputPath,
        '-y',
      ]);
    }

    const { readFile } = await import('fs/promises');
    const compressedBuffer = await readFile(outputPath);

    log.info(
      {
        originalSize: audioBuffer.length,
        compressedSize: compressedBuffer.length,
        ratio: ((compressedBuffer.length / audioBuffer.length) * 100).toFixed(1) + '%',
        wavTarget,
      },
      'Audio compressed successfully',
    );

    return { buffer: compressedBuffer, format: wavTarget === 'mp3' ? 'mp3' : 'opus' };
  } catch (error) {
    const hint =
      error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? ' (install ffmpeg and ensure it is on PATH for wav compression)'
        : '';
    log.warn({ error, inputFormat, wavTarget }, `Audio compression failed, using original${hint}`);
    return { buffer: audioBuffer, format: inputFormat };
  } finally {
    try {
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    } catch {}
  }
}
