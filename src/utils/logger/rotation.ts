/**
 * Log Rotation
 * Automatic log rotation based on size and retention policy
 */

import { readdirSync, statSync, unlinkSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { gzip } from 'zlib';
import { promisify } from 'util';
import type { RotationResult } from './types.js';
import { config, getLogDir } from './config.js';

const compressAsync = promisify(gzip);

/**
 * Get compressed log path
 */
function getCompressedLogPath(originalPath: string): string {
  return `${originalPath}.gz`;
}

/**
 * Rotate logs if they exceed max size
 */
export async function rotateLogs(): Promise<RotationResult> {
  const result: RotationResult = {
    rotated: 0,
    deleted: 0,
    compressed: 0,
    errors: [],
  };

  try {
    const files = readdirSync(getLogDir());
    const maxSizeBytes = config.maxFileSizeMB * 1024 * 1024;

    for (const file of files) {
      if (!file.endsWith('.log') || file.endsWith('.gz')) continue;

      const filePath = join(getLogDir(), file);
      const stats = statSync(filePath);

      if (stats.size >= maxSizeBytes) {
        const compressedPath = getCompressedLogPath(filePath);
        
        try {
          const content = readFileSync(filePath);
          const compressed = await compressAsync(content);
          await writeFile(compressedPath, compressed);
          unlinkSync(filePath);
          result.compressed++;
          result.rotated++;
        } catch (err) {
          result.errors.push(`Failed to compress ${file}: ${err}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Rotation failed: ${err}`);
  }

  return result;
}

/**
 * Clean old logs based on retention policy
 */
export function cleanOldLogs(keepDays: number = config.retentionDays): RotationResult {
  const result: RotationResult = {
    rotated: 0,
    deleted: 0,
    compressed: 0,
    errors: [],
  };

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);

    const files = readdirSync(getLogDir());

    for (const file of files) {
      if (!file.endsWith('.log') && !file.endsWith('.log.gz')) continue;

      const filePath = join(getLogDir(), file);
      const stats = statSync(filePath);

      if (new Date(stats.mtime) < cutoff) {
        try {
          unlinkSync(filePath);
          result.deleted++;
        } catch (err) {
          result.errors.push(`Failed to delete ${file}: ${err}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Cleanup failed: ${err}`);
  }

  return result;
}
