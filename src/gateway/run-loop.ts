/**
 * Gateway Run Loop - Core run loop for gateway process management
 */

import type { GatewayServer } from "./server.js";
import { acquireGatewayLock } from "./lock.js";
import { restartGatewayProcessWithFreshPid } from "./respawn.js";

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
      console.log(`[GatewayRunLoop] Restart mode: full process restart (${modeLabel})`);
      exitProcess(0);
      return;
    }

    if (respawn.mode === "failed") {
      console.warn(`[GatewayRunLoop] Full process restart failed: ${respawn.detail ?? "unknown error"}`);
    } else {
      console.log("[GatewayRunLoop] Restart mode: in-process restart (XOPCBOT_NO_RESPAWN)");
    }

    // In-process restart: reacquire lock
    try {
      lock = await acquireGatewayLock(opts.configPath, { port: opts.port });
    } catch (err) {
      console.error(`[GatewayRunLoop] Failed to reacquire lock: ${String(err)}`);
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
      // Already shutting down, ignore subsequent signals silently
      return;
    }

    shuttingDown = true;
    const isRestart = action === "restart";
    console.log(`[GatewayRunLoop] Received ${signal}; ${isRestart ? "restarting" : "shutting down"}`);

    // Remove signal listeners to prevent repeated logging
    cleanupSignals();

    // Force exit timer
    const forceExitMs = isRestart ? DRAIN_TIMEOUT_MS + SHUTDOWN_TIMEOUT_MS : SHUTDOWN_TIMEOUT_MS;
    const forceExitTimer = setTimeout(() => {
      console.error("[GatewayRunLoop] Shutdown timed out; force exiting");
      exitProcess(0);
    }, forceExitMs);

    // Async shutdown
    void (async () => {
      try {
        // TODO: Add task draining when task queue is implemented
        if (isRestart) {
          console.log("[GatewayRunLoop] Draining active tasks before restart...");
        }

        await server?.close?.({
          reason: isRestart ? "gateway restarting" : "gateway stopping",
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
    console.log("[GatewayRunLoop] SIGTERM received");
    requestShutdown("stop", "SIGTERM");
  };

  const onSigint = () => {
    console.log("[GatewayRunLoop] SIGINT received");
    requestShutdown("stop", "SIGINT");
  };

  const onSigusr1 = () => {
    console.log("[GatewayRunLoop] SIGUSR1 received");
    // Check if external restart is allowed
    if (process.env.XOPCBOT_ALLOW_SIGUSR1_RESTART !== "1") {
      console.warn("[GatewayRunLoop] SIGUSR1 restart ignored (set XOPCBOT_ALLOW_SIGUSR1_RESTART=1 to enable)");
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
      console.log("[GatewayRunLoop] Starting gateway server...");
      try {
        server = await opts.start();
      } catch (err) {
        console.error("[GatewayRunLoop] Failed to start gateway server:", err);
        // Release lock before exiting
        await releaseLock();
        exitProcess(1);
        return;
      }

      // Wait for restart signal
      await new Promise<void>((resolve) => {
        restartResolver = resolve;
      });

      console.log("[GatewayRunLoop] Restart signal received, restarting gateway...");
    }
  } finally {
    await releaseLock();
    cleanupSignals();
  }
}
