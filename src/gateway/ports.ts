/**
 * Ports Management - Port management utilities
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
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

/**
 * Parse `ss -tlnp` output to find PIDs listening on a given port.
 * Example line:
 *   LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1234,fd=18))
 */
function listPortListenersViaSs(port: number): PortProcess[] {
  let out: string;
  try {
    out = execFileSync("ss", ["-tlnp", `sport = :${port}`], { encoding: "utf-8" });
  } catch (err: unknown) {
    const execErr = err as { status?: number; code?: string };
    if (execErr.status === 1) {
      return []; // No matching sockets
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
  const results: PortProcess[] = [];

  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTEN")) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const pid = parseInt(match[1], 10);
      if (!results.some((p) => p.pid === pid)) {
        results.push({ pid });
      }
    }
  }

  return results;
}

/**
 * Read /proc/net/tcp (and /proc/net/tcp6) to find PIDs listening on a given port.
 * Falls back to an empty list if /proc is unavailable (non-Linux).
 */
function listPortListenersViaProc(port: number): PortProcess[] {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const results: PortProcess[] = [];
  const inodeSet = new Set<string>();

  for (const procFile of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let content: string;
    try {
      content = fs.readFileSync(procFile, "utf-8");
    } catch {
      continue;
    }

    for (const line of content.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      // state 0A = TCP_LISTEN
      if (parts.length < 10 || parts[3] !== "0A") continue;
      const localAddress = parts[1];
      const portHex = localAddress.split(":")[1];
      if (portHex?.toUpperCase() !== hexPort) continue;
      inodeSet.add(parts[9]);
    }
  }

  if (inodeSet.size === 0) return results;

  // Walk /proc/<pid>/fd to match socket inodes to PIDs
  let pidDirs: string[];
  try {
    pidDirs = fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return results;
  }

  for (const pidStr of pidDirs) {
    const fdDir = `/proc/${pidStr}/fd`;
    let fds: string[];
    try {
      fds = fs.readdirSync(fdDir);
    } catch {
      continue;
    }

    for (const fd of fds) {
      let target: string;
      try {
        target = fs.readlinkSync(`${fdDir}/${fd}`);
      } catch {
        continue;
      }

      // symlink target looks like "socket:[12345]"
      const inodeMatch = /^socket:\[(\d+)\]$/.exec(target);
      if (!inodeMatch || !inodeSet.has(inodeMatch[1])) continue;

      const pid = parseInt(pidStr, 10);
      if (!results.some((p) => p.pid === pid)) {
        let command: string | undefined;
        try {
          command = fs.readFileSync(`/proc/${pidStr}/comm`, "utf-8").trim();
        } catch {
          // comm not readable — leave undefined
        }
        results.push({ pid, command });
      }
      break;
    }
  }

  return results;
}

// List processes listening on port
export function listPortListeners(port: number): PortProcess[] {
  // Try lsof first (macOS + most Linux distros)
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-FpFc"], {
      encoding: "utf-8",
    });
    return parseLsofOutput(out);
  } catch (err: unknown) {
    const execErr = err as { status?: number; code?: string };

    if (execErr.code !== "ENOENT") {
      if (execErr.status === 1) return []; // No listeners
      throw err instanceof Error ? err : new Error(String(err));
    }
    // lsof not available — fall through to Linux alternatives
    log.debug({ port }, "lsof not found; trying ss fallback");
  }

  // Try ss (iproute2, available on most modern Linux systems)
  try {
    return listPortListenersViaSs(port);
  } catch (err: unknown) {
    const execErr = err as { code?: string };
    if (execErr.code !== "ENOENT") {
      throw err instanceof Error ? err : new Error(String(err));
    }
    log.debug({ port }, "ss not found; trying /proc/net/tcp fallback");
  }

  // Last resort: parse /proc/net/tcp directly (no external tools required)
  return listPortListenersViaProc(port);
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
