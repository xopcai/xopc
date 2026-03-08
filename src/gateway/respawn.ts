/**
 * Process Respawn - Process respawn logic
 */

import { spawn } from "node:child_process";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ProcessRespawn");

type RespawnMode = "spawned" | "supervised" | "disabled" | "failed";

export type GatewayRespawnResult = {
  mode: RespawnMode;
  pid?: number;
  detail?: string;
};

// Supervisor environment variable markers
const SUPERVISOR_HINT_ENV_VARS = [
  "LAUNCH_JOB_LABEL",      // macOS launchd
  "LAUNCH_JOB_NAME",
  "INVOCATION_ID",         // Linux systemd
  "SYSTEMD_EXEC_PID",
  "JOURNAL_STREAM",
  "XOPCBOT_SERVICE_MARKER", // Custom marker
];

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function hasSupervisorHint(env: NodeJS.ProcessEnv = process.env): boolean {
  return SUPERVISOR_HINT_ENV_VARS.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

/**
 * Restart gateway process
 * - Supervised environment: exit and let supervisor restart
 * - XOPCBOT_NO_RESPAWN=1: in-process restart
 * - Otherwise: spawn detached child, then exit
 */
export function restartGatewayProcessWithFreshPid(): GatewayRespawnResult {
  // Respawn disabled, use in-process restart
  if (isTruthy(process.env.XOPCBOT_NO_RESPAWN)) {
    log.info("Respawn disabled (XOPCBOT_NO_RESPAWN)");
    return { mode: "disabled" };
  }

  // Supervised environment
  if (hasSupervisorHint(process.env)) {
    log.info("Detected supervisor environment, exiting for supervisor restart");
    return { mode: "supervised" };
  }

  // Normal environment: spawn new process
  try {
    const args = [...process.execArgv, ...process.argv.slice(1)];
    log.info({ args }, "Spawning new gateway process");

    const child = spawn(process.execPath, args, {
      env: process.env,
      detached: true,
      stdio: "inherit",
    });

    child.unref();

    log.info({ pid: child.pid }, "New process spawned, exiting");
    return { mode: "spawned", pid: child.pid ?? undefined };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.error({ err }, "Failed to spawn new process");
    return { mode: "failed", detail };
  }
}
