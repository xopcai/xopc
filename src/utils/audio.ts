/**
 * Audio Compression Utilities
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('AudioUtils');
const execAsync = promisify(exec);

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

    // Compress using ffmpeg
    await execAsync(`ffmpeg -i "${inputPath}" -c:a libopus -b:a 24k -vbr on "${outputPath}" -y`);

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
