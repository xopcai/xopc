/**
 * Gateway Run Loop - Core run loop for gateway process management
 */

import type { GatewayServer } from "./server.js";
import { acquireGatewayLock } from "./lock.js";
import { restartGatewayProcessWithFreshPid } from "./respawn.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("GatewayRunLoop");

type GatewayRunSignalAction = "stop" | "restart";

export type RunGatewayLoopOptions = {
  start: () => Promise<GatewayServer>;
  configPath: string;
  port: number;
};

export async function runGatewayLoop(opts: RunGatewayLoopOptions): Promise<void> {
  // 1. Acquire lock
  let lock = await acquireGatewayLock(opts.configPath, { port: opts.port });
  let server: GatewayServer | null = null;
  let shuttingDown = false;
  let restartResolver: (() => void) | null = null;

  // Cleanup functions
  const cleanupSignals = () => {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGUSR1", onSigusr1);
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

  // Handle restart after close
  const handleRestartAfterClose = async () => {
    await releaseLock();

    const respawn = restartGatewayProcessWithFreshPid();

    if (respawn.mode === "spawned" || respawn.mode === "supervised") {
      const modeLabel = respawn.mode === "spawned"
        ? `spawned pid ${respawn.pid ?? "unknown"}`
        : "supervisor restart";
      log.info(`Restart mode: full process restart (${modeLabel})`);
      exitProcess(0);
      return;
    }

    if (respawn.mode === "failed") {
      log.warn(`Full process restart failed: ${respawn.detail ?? "unknown error"}`);
    } else {
      log.info("Restart mode: in-process restart (XOPCBOT_NO_RESPAWN)");
    }

    // In-process restart: reacquire lock
    try {
      lock = await acquireGatewayLock(opts.configPath, { port: opts.port });
    } catch (err) {
      log.error(`Failed to reacquire lock: ${String(err)}`);
      exitProcess(1);
      return;
    }

    shuttingDown = false;
    restartResolver?.();
  };

  // Handle stop after close
  const handleStopAfterClose = async () => {
    await releaseLock();
    exitProcess(0);
  };

  // Signal handling
  const DRAIN_TIMEOUT_MS = 30_000;
  const SHUTDOWN_TIMEOUT_MS = 5_000;

  const requestShutdown = (action: GatewayRunSignalAction, signal: string) => {
    if (shuttingDown) {
      log.info(`Received ${signal} during shutdown; ignoring`);
      return;
    }

    shuttingDown = true;
    const isRestart = action === "restart";
    log.info(`Received ${signal}; ${isRestart ? "restarting" : "shutting down"}`);

    // Force exit timer
    const forceExitMs = isRestart ? DRAIN_TIMEOUT_MS + SHUTDOWN_TIMEOUT_MS : SHUTDOWN_TIMEOUT_MS;
    const forceExitTimer = setTimeout(() => {
      log.error("Shutdown timed out; force exiting");
      exitProcess(0);
    }, forceExitMs);

    // Async shutdown
    void (async () => {
      try {
        // TODO: Add task draining when task queue is implemented
        if (isRestart) {
          log.info("Draining active tasks before restart...");
        }

        await server?.close?.({
          reason: isRestart ? "gateway restarting" : "gateway stopping",
          restartExpectedMs: isRestart ? 1500 : null,
        });
      } catch (err) {
        log.error(`Shutdown error: ${String(err)}`);
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
    log.info("SIGTERM received");
    requestShutdown("stop", "SIGTERM");
  };

  const onSigint = () => {
    log.info("SIGINT received");
    requestShutdown("stop", "SIGINT");
  };

  const onSigusr1 = () => {
    log.info("SIGUSR1 received");
    // Check if external restart is allowed
    if (process.env.XOPCBOT_ALLOW_SIGUSR1_RESTART !== "1") {
      log.warn("SIGUSR1 restart ignored (set XOPCBOT_ALLOW_SIGUSR1_RESTART=1 to enable)");
      return;
    }
    requestShutdown("restart", "SIGUSR1");
  };

  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);
  process.on("SIGUSR1", onSigusr1);

  // Main loop
  try {
    while (true) {
      log.info("Starting gateway server...");
      try {
        server = await opts.start();
      } catch (err) {
        log.error({ err }, "Failed to start gateway server");
        // Release lock before exiting
        await releaseLock();
        exitProcess(1);
        return;
      }

      // Wait for restart signal
      await new Promise<void>((resolve) => {
        restartResolver = resolve;
      });

      log.info("Restart signal received, restarting gateway...");
    }
  } finally {
    await releaseLock();
    cleanupSignals();
  }
}
