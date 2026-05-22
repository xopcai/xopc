/**
 * Restart Intent - File-based coordination between CLI and gateway
 *
 * CLI writes an intent file before sending restart signal.
 * Gateway reads it in SIGUSR1 handler to determine restart behavior.
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { resolveStateDir } from '../config/paths-state.js';
import type { GatewayRestartIntent } from '../daemon/types.js';

const INTENT_FILENAME = 'restart-intent.json';

function resolveIntentPath(): string {
  return path.join(resolveStateDir(), INTENT_FILENAME);
}

/** Write restart intent (CLI side, before sending restart signal) */
export function writeGatewayRestartIntentSync(intent: GatewayRestartIntent): void {
  const intentPath = resolveIntentPath();
  mkdirSync(path.dirname(intentPath), { recursive: true });
  writeFileSync(intentPath, JSON.stringify(intent, null, 2), 'utf8');
}

/** Read restart intent (gateway side, in SIGUSR1 handler) */
export function readGatewayRestartIntentSync(): GatewayRestartIntent | null {
  try {
    const raw = readFileSync(resolveIntentPath(), 'utf8');
    return JSON.parse(raw) as GatewayRestartIntent;
  } catch {
    return null;
  }
}

/** Clear restart intent (after consumption) */
export function clearGatewayRestartIntentSync(): void {
  try {
    rmSync(resolveIntentPath());
  } catch {
    // File may not exist
  }
}
