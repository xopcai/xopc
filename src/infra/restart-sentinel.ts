/**
 * Restart Sentinel - Upgrade recovery coordination
 *
 * After an auto-update completes, the update runner writes a sentinel file.
 * On next gateway startup, the sentinel is consumed to:
 * 1. Log the version transition
 * 2. Restore active session context
 * 3. Broadcast update-complete via SSE
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { resolveStateDir } from '../config/paths-state.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RestartSentinel');

const SENTINEL_FILENAME = 'restart-sentinel.json';

// ─── Types ───

export interface RestartSentinel {
  previousVersion: string;
  newVersion: string;
  restartedAt: string;
  sessionKeys?: string[];
  reason?: string;
}

// ─── File Path ───

function resolveSentinelPath(): string {
  return path.join(resolveStateDir(), SENTINEL_FILENAME);
}

// ─── Write (called by update-runner after successful install) ───

export function writeRestartSentinel(sentinel: RestartSentinel): void {
  const sentinelPath = resolveSentinelPath();
  mkdirSync(path.dirname(sentinelPath), { recursive: true });
  writeFileSync(sentinelPath, JSON.stringify(sentinel, null, 2), 'utf8');
  log.info(
    { previousVersion: sentinel.previousVersion, newVersion: sentinel.newVersion },
    'Restart sentinel written',
  );
}

// ─── Read & Consume (called by gateway on startup) ───

/** Read and delete the sentinel file atomically. Returns null if not present. */
export function consumeRestartSentinel(): RestartSentinel | null {
  const sentinelPath = resolveSentinelPath();

  try {
    const raw = readFileSync(sentinelPath, 'utf8');
    const parsed = JSON.parse(raw) as RestartSentinel;

    // Validate minimal fields
    if (!parsed.previousVersion || !parsed.newVersion || !parsed.restartedAt) {
      rmSync(sentinelPath, { force: true });
      return null;
    }

    // Remove the file (consume)
    rmSync(sentinelPath, { force: true });

    log.info(
      { previousVersion: parsed.previousVersion, newVersion: parsed.newVersion },
      'Restart sentinel consumed',
    );

    return parsed;
  } catch {
    return null;
  }
}

/** Read without consuming (for inspection) */
export function readRestartSentinel(): RestartSentinel | null {
  try {
    const raw = readFileSync(resolveSentinelPath(), 'utf8');
    const parsed = JSON.parse(raw) as RestartSentinel;
    if (!parsed.previousVersion || !parsed.newVersion) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Check if a sentinel file exists */
export function hasRestartSentinel(): boolean {
  try {
    readFileSync(resolveSentinelPath());
    return true;
  } catch {
    return false;
  }
}
