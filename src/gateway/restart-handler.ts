/**
 * Gateway Restart Handler - SIGUSR1 signal handler for graceful restart
 *
 * Reads restart intent from disk to determine restart behavior:
 * - force=true: exit immediately (KeepAlive will restart)
 * - force=false/unset: wait for active agent turns to complete, then exit
 */

import { createLogger } from '../utils/logger.js';
import {
  readGatewayRestartIntentSync,
  clearGatewayRestartIntentSync,
} from '../infra/restart-intent.js';

const log = createLogger('RestartHandler');

const DEFAULT_GRACEFUL_WAIT_MS = 30_000;

let restartHandlerRegistered = false;
let activeAgentTurnCounter: (() => number) | null = null;

/**
 * Register the SIGUSR1 handler for gateway restart.
 * Call once during gateway startup.
 */
export function registerGatewayRestartHandler(params?: {
  getActiveAgentTurnCount?: () => number;
}): void {
  if (restartHandlerRegistered) return;
  restartHandlerRegistered = true;

  if (params?.getActiveAgentTurnCount) {
    activeAgentTurnCounter = params.getActiveAgentTurnCount;
  }

  process.on('SIGUSR1', handleSigusr1);
  log.info('SIGUSR1 restart handler registered');
}

async function handleSigusr1(): Promise<void> {
  log.info('Received SIGUSR1 restart signal');

  const intent = readGatewayRestartIntentSync();
  clearGatewayRestartIntentSync();

  if (intent?.force) {
    log.info('Force restart requested, exiting immediately');
    process.exit(0);
  }

  // Graceful restart: wait for active agent turns to complete
  const waitMs = intent?.waitMs ?? DEFAULT_GRACEFUL_WAIT_MS;

  if (!activeAgentTurnCounter) {
    log.info('No active turn counter registered, exiting');
    process.exit(0);
  }

  const activeTurns = activeAgentTurnCounter();
  if (activeTurns <= 0) {
    log.info('No active agent turns, exiting immediately');
    process.exit(0);
  }

  log.info({ activeTurns, waitMs }, 'Waiting for active agent turns to complete');

  await waitForActiveAgentTurnsToComplete(waitMs);
  log.info('Active turns completed, exiting for restart');
  process.exit(0);
}

async function waitForActiveAgentTurnsToComplete(maxWaitMs: number): Promise<void> {
  const startedAt = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - startedAt < maxWaitMs) {
    if (!activeAgentTurnCounter) break;

    const activeTurns = activeAgentTurnCounter();
    if (activeTurns <= 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout reached, exit anyway
  const remaining = activeAgentTurnCounter?.() ?? 0;
  if (remaining > 0) {
    log.warn({ remaining, maxWaitMs }, 'Graceful wait timed out, forcing exit');
  }
}
