/**
 * PID File Management for Gateway Process
 * 
 * Handles tracking of gateway process via PID file.
 * Location: ~/.xopcbot/gateway.pid
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PIDFile');

const XOPCBOT_DIR = join(homedir(), '.xopcbot');
const PID_FILE_PATH = join(XOPCBOT_DIR, 'gateway.pid');

/**
 * Check if a process with given PID exists
 */
export function processExists(pid: number): boolean {
  try {
    // Kill signal 0 doesn't actually kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH = No such process, EPERM = Process exists but no permission
    return false;
  }
}

/**
 * Ensure xopcbot config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(XOPCBOT_DIR)) {
    mkdirSync(XOPCBOT_DIR, { recursive: true });
  }
}

/**
 * Write PID to file
 */
export function writePidFile(pid: number): void {
  try {
    ensureConfigDir();
    writeFileSync(PID_FILE_PATH, String(pid), 'utf-8');
    log.debug({ pid, path: PID_FILE_PATH }, 'PID file written');
  } catch (err) {
    log.error({ err, pid }, 'Failed to write PID file');
    throw err;
  }
}

/**
 * Read PID from file
 * Returns null if file doesn't exist or is invalid
 */
export function readPidFile(): number | null {
  try {
    if (!existsSync(PID_FILE_PATH)) {
      return null;
    }
    const content = readFileSync(PID_FILE_PATH, 'utf-8').trim();
    const pid = parseInt(content, 10);
    if (isNaN(pid)) {
      log.warn({ content }, 'Invalid PID in file');
      return null;
    }
    return pid;
  } catch (err) {
    log.error({ err }, 'Failed to read PID file');
    return null;
  }
}

/**
 * Remove PID file
 */
export function removePidFile(): void {
  try {
    if (existsSync(PID_FILE_PATH)) {
      unlinkSync(PID_FILE_PATH);
      log.debug({ path: PID_FILE_PATH }, 'PID file removed');
    }
  } catch (err) {
    log.error({ err }, 'Failed to remove PID file');
  }
}

/**
 * Check if PID file is stale (process no longer exists)
 */
export function isPidFileStale(): boolean {
  const pid = readPidFile();
  if (pid === null) {
    return false; // No PID file = not stale
  }
  return !processExists(pid);
}

/**
 * Get PID file path (for testing)
 */
export function getPidFilePath(): string {
  return PID_FILE_PATH;
}

/**
 * Clean up stale PID file if process is gone
 */
export function cleanupStalePidFile(): void {
  if (isPidFileStale()) {
    log.info('Cleaning up stale PID file');
    removePidFile();
  }
}
