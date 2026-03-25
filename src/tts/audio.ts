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

/**
 * Compress audio buffer using ffmpeg (wav -> opus)
 * Returns original buffer if compression fails
 */
export async function compressAudio(
  audioBuffer: Buffer,
  inputFormat: string
): Promise<CompressionResult> {
  if (inputFormat !== 'wav') {
    return { buffer: audioBuffer, format: inputFormat };
  }

  const tempDir = tmpdir();
  const inputPath = join(tempDir, `input_${Date.now()}.wav`);
  const outputPath = join(tempDir, `output_${Date.now()}.opus`);

  try {
    // Write input file
    await writeFile(inputPath, audioBuffer);

    // Compress using ffmpeg with spawn (avoids shell injection)
    await spawnAsync('ffmpeg', [
      '-i', inputPath,
      '-c:a', 'libopus',
      '-b:a', '24k',
      '-vbr', 'on',
      outputPath,
      '-y',
    ]);

    // Read output file
    const { readFile } = await import('fs/promises');
    const compressedBuffer = await readFile(outputPath);

    log.info({
      originalSize: audioBuffer.length,
      compressedSize: compressedBuffer.length,
      ratio: ((compressedBuffer.length / audioBuffer.length) * 100).toFixed(1) + '%',
    }, 'Audio compressed successfully');

    return { buffer: compressedBuffer, format: 'opus' };
  } catch (error) {
    log.warn({ error, inputFormat }, 'Audio compression failed, using original');
    return { buffer: audioBuffer, format: inputFormat };
  } finally {
    // Cleanup temp files
    try {
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    } catch {}
  }
}
