/**
 * Log Streams
 * Output stream management (console, file, error file)
 */

import { createWriteStream } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import type { DestinationStream } from 'pino';
import type { LogLevel } from '../logger.types.js';
import { config, getLogDir } from './config.js';

// Store file stream references for later cleanup
const fileStreams: ReturnType<typeof createWriteStream>[] = [];

/**
 * Get log file path for a specific date and type
 */
export function getLogPath(type: 'app' | 'error' | 'audit' | 'access' = 'app', date: Date = new Date()): string {
  const dateStr = date.toISOString().split('T')[0];
  return path.join(getLogDir(), `${type}-${dateStr}.log`);
}

/**
 * Ensure log directory exists
 */
function ensureLogDir(): void {
  if (!existsSync(config.logDir)) {
    mkdirSync(config.logDir, { recursive: true });
  }
}

/**
 * Create log stream
 */
function createLogStream(filePath: string): ReturnType<typeof createWriteStream> {
  return createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' });
}

/**
 * Initialize and get all output streams
 */
export function initializeStreams(): Array<{ stream: DestinationStream | NodeJS.WriteStream; level: LogLevel }> {
  ensureLogDir();
  
  const streams: Array<{ stream: DestinationStream | NodeJS.WriteStream; level: LogLevel }> = [];

  if (config.consoleOutput) {
    streams.push({
      stream: process.stdout as unknown as DestinationStream,
      level: config.level,
    });
  }

  if (config.fileOutput) {
    const appStream = createLogStream(getLogPath('app'));
    fileStreams.push(appStream);
    streams.push({
      stream: appStream as unknown as DestinationStream,
      level: config.level,
    });
  }

  if (config.errorFileOutput) {
    const errorStream = createLogStream(getLogPath('error'));
    fileStreams.push(errorStream);
    streams.push({
      stream: errorStream as unknown as DestinationStream,
      level: 'error',
    });
  }

  return streams;
}

/**
 * Get all file streams for cleanup
 */
export function getFileStreams(): ReturnType<typeof createWriteStream>[] {
  return fileStreams;
}

/**
 * Close all file streams gracefully
 */
export async function closeStreams(): Promise<void> {
  await Promise.all(
    fileStreams.map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.writable) {
            stream.end(() => resolve());
          } else {
            resolve();
          }
        }),
    ),
  );
  fileStreams.length = 0;
}
