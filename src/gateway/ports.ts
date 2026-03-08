/**
 * Ports Management - Port management utilities
 */

import { execFileSync } from "node:child_process";
import net from "node:net";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Ports");

export type PortProcess = { pid: number; command?: string };

export type ForceFreePortResult = {
  killed: PortProcess[];
  waitedMs: number;
  escalatedToSigkill: boolean;
};

// Parse lsof output
export function parseLsofOutput(output: string): PortProcess[] {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const results: PortProcess[] = [];
  let current: Partial<PortProcess> = {};

  for (const line of lines) {
    if (line.startsWith("p")) {
      if (current.pid) {
        results.push(current as PortProcess);
      }
      current = { pid: parseInt(line.slice(1), 10) };
    } else if (line.startsWith("c")) {
      current.command = line.slice(1);
    }
  }

  if (current.pid) {
    results.push(current as PortProcess);
  }

  return results;
}

// List processes listening on port
export function listPortListeners(port: number): PortProcess[] {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-FpFc"], {
      encoding: "utf-8",
    });
    return parseLsofOutput(out);
  } catch (err: unknown) {
    const execErr = err as { status?: number; code?: string };

    if (execErr.code === "ENOENT") {
      throw new Error("lsof not found; required for port inspection");
    }
    if (execErr.status === 1) {
      return []; // No listeners
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// Force free port
export async function forceFreePortAndWait(
  port: number,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    sigtermTimeoutMs?: number;
  } = {}
): Promise<ForceFreePortResult> {
  const timeoutMs = Math.max(opts.timeoutMs ?? 2000, 0);
  const intervalMs = Math.max(opts.intervalMs ?? 100, 1);
  const sigtermTimeoutMs = Math.min(Math.max(opts.sigtermTimeoutMs ?? 700, 0), timeoutMs);

  // 1. Get listener list
  const listeners = listPortListeners(port);
  const killed: PortProcess[] = [...listeners];

  // 2. Send SIGTERM
  for (const proc of listeners) {
    try {
      process.kill(proc.pid, "SIGTERM");
      log.info({ pid: proc.pid }, "Sent SIGTERM");
    } catch (err) {
      log.warn({ pid: proc.pid, err }, "Failed to send SIGTERM");
    }
  }

  // 3. Wait for processes to exit
  let waitedMs = 0;
  const checkInterval = () => new Promise<void>((r) => setTimeout(r, intervalMs));

  // Wait for SIGTERM to take effect
  const sigtermTries = Math.ceil(sigtermTimeoutMs / intervalMs);
  for (let i = 0; i < sigtermTries; i++) {
    await checkInterval();
    waitedMs += intervalMs;

    const remaining = listPortListeners(port);
    if (remaining.length === 0) {
      return { killed, waitedMs, escalatedToSigkill: false };
    }
  }

  // 4. SIGTERM timeout, send SIGKILL
  const remaining = listPortListeners(port);
  for (const proc of remaining) {
    try {
      process.kill(proc.pid, "SIGKILL");
      log.info({ pid: proc.pid }, "Sent SIGKILL");
    } catch (err) {
      log.warn({ pid: proc.pid, err }, "Failed to send SIGKILL");
    }
  }

  // 5. Wait for SIGKILL to take effect
  const remainingBudget = Math.max(timeoutMs - waitedMs, 0);
  const sigkillTries = Math.ceil(remainingBudget / intervalMs);

  for (let i = 0; i < sigkillTries; i++) {
    await checkInterval();
    waitedMs += intervalMs;

    const stillRemaining = listPortListeners(port);
    if (stillRemaining.length === 0) {
      return { killed, waitedMs, escalatedToSigkill: true };
    }
  }

  throw new Error(`Port ${port} still has listeners after force free`);
}

// Check if port is available
export async function checkPortAvailable(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        resolve(true);
      }
    });

    server.once("listening", () => {
      server.close();
      resolve(true);
    });

    server.listen(port, host);
  });
}
