/**
 * Gateway Run Loop - Core run loop for gateway process management
 */

import { isRestartEnabled } from '../config/commands.flags.js';
import { loadConfig } from '../config/index.js';
import { runBootstrapMigrationsSync } from '../migrations/runner.js';
import type { GatewayServer } from './server.js';
import { acquireGatewayLock } from './lock.js';
import { restartGatewayProcessWithFreshPid } from './respawn.js';
import {
  consumeGatewayRestartIntentSync,
  consumeGatewaySigusr1RestartAuthorization,
  isGatewaySigusr1RestartExternallyAllowed,
  resetGatewayRestartStateForInProcessRestart,
  scheduleGatewaySigusr1Restart,
  setGatewaySigusr1RestartPolicy,
} from '../infra/restart.js';

type GatewayRunSignalAction = 'stop' | 'restart';

export type RunGatewayLoopOptions = {
  start: () => Promise<GatewayServer>;
  configPath: string;
  port: number;
};

export async function runGatewayLoop(opts: RunGatewayLoopOptions): Promise<void> {
  runBootstrapMigrationsSync(opts.configPath);
  const config = loadConfig(opts.configPath);
  setGatewaySigusr1RestartPolicy({ allowExternal: isRestartEnabled(config) });

  let lock = await acquireGatewayLock(opts.configPath, { port: opts.port });
  let server: GatewayServer | null = null;
  let shuttingDown = false;
  let forceCloseRequested = false;
  let loopResolver: ((action: GatewayRunSignalAction) => void) | null = null;

  const cleanupSignals = () => {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGUSR1', onSigusr1);
  };

  const exitProcess = (code: number) => {
    cleanupSignals();
    process.exit(code);
  };

  const releaseLock = async (): Promise<void> => {
    if (lock) {
      await lock.release();
      lock = null;
    }
  };

  const handleRestartAfterClose = async () => {
    await releaseLock();

    const respawn = restartGatewayProcessWithFreshPid();

    if (respawn.mode === 'spawned' || respawn.mode === 'supervised') {
      const modeLabel = respawn.mode === 'spawned'
        ? `spawned pid ${respawn.pid ?? 'unknown'}`
        : 'supervisor restart';
      console.log(`[GatewayRunLoop] Restart mode: full process restart (${modeLabel})`);
      exitProcess(0);
      return;
    }

    if (respawn.mode === 'failed') {
      console.warn(`[GatewayRunLoop] Full process restart failed: ${respawn.detail ?? 'unknown error'}`);
    } else {
      console.log('[GatewayRunLoop] Restart mode: in-process restart (XOPC_NO_RESPAWN)');
    }

    resetGatewayRestartStateForInProcessRestart();

    try {
      lock = await acquireGatewayLock(opts.configPath, { port: opts.port });
    } catch (err) {
      console.error(`[GatewayRunLoop] Failed to reacquire lock: ${String(err)}`);
      exitProcess(1);
      return;
    }

    shuttingDown = false;
    forceCloseRequested = false;
    loopResolver?.('restart');
  };

  const handleStopAfterClose = async () => {
    await releaseLock();
    loopResolver?.('stop');
  };

  const DRAIN_TIMEOUT_MS = 30_000;
  const SHUTDOWN_TIMEOUT_MS = 15_000;

  const requestShutdown = (action: GatewayRunSignalAction, signal: string) => {
    if (shuttingDown) {
      if (!forceCloseRequested && (signal === 'SIGINT' || signal === 'SIGTERM')) {
        forceCloseRequested = true;
        console.warn(`[GatewayRunLoop] Received ${signal} again; force closing connections`);
        server?.forceCloseConnections();
      }
      return;
    }

    shuttingDown = true;
    const isRestart = action === 'restart';
    console.log(`[GatewayRunLoop] Received ${signal}; ${isRestart ? 'restarting' : 'shutting down'}`);

    const forceExitMs = isRestart ? DRAIN_TIMEOUT_MS + SHUTDOWN_TIMEOUT_MS : SHUTDOWN_TIMEOUT_MS;
    const forceExitTimer = setTimeout(() => {
      console.error('[GatewayRunLoop] Shutdown timed out; force exiting');
      exitProcess(0);
    }, forceExitMs);

    void (async () => {
      try {
        if (isRestart) {
          console.log('[GatewayRunLoop] Draining active tasks before restart...');
        }

        await server?.close?.({
          reason: isRestart ? 'gateway restarting' : 'gateway stopping',
          restartExpectedMs: isRestart ? 1500 : null,
        });
      } catch (err) {
        console.error(`[GatewayRunLoop] Shutdown error: ${String(err)}`);
      } finally {
        clearTimeout(forceExitTimer);
        server = null;

        if (isRestart) {
          await handleRestartAfterClose();
        } else {
          await handleStopAfterClose();
        }
      }
    })();
  };

  const onSigterm = () => {
    console.log('[GatewayRunLoop] SIGTERM received');
    const isRestart = consumeGatewayRestartIntentSync();
    requestShutdown(isRestart ? 'restart' : 'stop', 'SIGTERM');
  };

  const onSigint = () => {
    console.log('[GatewayRunLoop] SIGINT received');
    requestShutdown('stop', 'SIGINT');
  };

  const onSigusr1 = () => {
    console.log('[GatewayRunLoop] SIGUSR1 received');
    const authorized = consumeGatewaySigusr1RestartAuthorization();
    if (!authorized) {
      if (!isGatewaySigusr1RestartExternallyAllowed()) {
        console.warn(
          '[GatewayRunLoop] SIGUSR1 restart ignored (commands.restart=false or unauthorized).',
        );
        return;
      }
      if (shuttingDown) {
        console.log('[GatewayRunLoop] Received SIGUSR1 during shutdown; ignoring');
        return;
      }
      scheduleGatewaySigusr1Restart({
        delayMs: 0,
        reason: 'SIGUSR1',
        onRestart: () => requestShutdown('restart', 'SIGUSR1'),
      });
      return;
    }
    requestShutdown('restart', 'SIGUSR1');
  };

  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);
  process.on('SIGUSR1', onSigusr1);

  try {
    while (true) {
      console.log('[GatewayRunLoop] Starting gateway server...');
      try {
        server = await opts.start();
      } catch (err) {
        console.error('[GatewayRunLoop] Failed to start gateway server:', err);
        await releaseLock();
        exitProcess(1);
        return;
      }

      const action = await new Promise<GatewayRunSignalAction>((resolve) => {
        loopResolver = resolve;
      });

      loopResolver = null;
      if (action === 'stop') {
        return;
      }

      console.log('[GatewayRunLoop] Restart signal received, restarting gateway...');
    }
  } finally {
    await releaseLock();
    cleanupSignals();
  }
}
