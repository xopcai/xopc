/**
 * Gateway Lock - Prevents multiple gateway instances from running simultaneously
 */

import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { homedir } from "os";
import { createLogger } from "../utils/logger.js";

const log = createLogger("GatewayLock");

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_PORT_PROBE_TIMEOUT_MS = 1000;

type LockPayload = {
  pid: number;
  createdAt: string;
  configPath: string;
  startTime?: number;
};

export type GatewayLockHandle = {
  lockPath: string;
  configPath: string;
  release: () => Promise<void>;
};

export type GatewayLockOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  staleMs?: number;
  port?: number;
};

export class GatewayLockError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GatewayLockError";
  }
}

// Get lock file directory
function resolveLockDir(): string {
  return path.join(homedir(), ".xopcbot", "locks");
}

// Generate lock file path based on config path
function resolveLockPath(configPath: string): string {
  const hash = createHash("sha256").update(configPath).digest("hex").slice(0, 8);
  return path.join(resolveLockDir(), `gateway.${hash}.lock`);
}

// Check if port is available
async function checkPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(true), DEFAULT_PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
  });
}

// Check if PID is alive
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Linux: read process start time to prevent PID reuse
function readLinuxStartTime(pid: number): number | null {
  if (process.platform !== "linux") return null;
  try {
    const raw = fsSync.readFileSync(`/proc/${pid}/stat`, "utf8").trim();
    const closeParen = raw.lastIndexOf(")");
    if (closeParen < 0) return null;
    const rest = raw.slice(closeParen + 1).trim();
    const fields = rest.split(/\s+/);
    const startTime = parseInt(fields[19] ?? "", 10);
    return Number.isFinite(startTime) ? startTime : null;
  } catch {
    return null;
  }
}

// Parse lock file content
async function readLockPayload(lockPath: string): Promise<LockPayload | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockPayload>;
    if (typeof parsed.pid !== "number") return null;
    if (typeof parsed.createdAt !== "string") return null;
    if (typeof parsed.configPath !== "string") return null;
    return {
      pid: parsed.pid,
      createdAt: parsed.createdAt,
      configPath: parsed.configPath,
      startTime: typeof parsed.startTime === "number" ? parsed.startTime : undefined,
    };
  } catch {
    return null;
  }
}

// Get lock owner status
async function resolveOwnerStatus(
  pid: number,
  payload: LockPayload | null,
  port: number | undefined
): Promise<"alive" | "dead" | "unknown"> {
  // 1. Check port
  if (port != null) {
    const portFree = await checkPortFree(port);
    if (portFree) return "dead";
  }

  // 2. Check PID alive
  if (!isPidAlive(pid)) return "dead";

  // 3. Linux: check start time to prevent PID reuse
  if (process.platform === "linux") {
    const payloadStartTime = payload?.startTime;
    if (Number.isFinite(payloadStartTime)) {
      const currentStartTime = readLinuxStartTime(pid);
      if (currentStartTime == null) return "unknown";
      return currentStartTime === payloadStartTime ? "alive" : "dead";
    }
  }

  return "alive";
}

// Acquire lock
export async function acquireGatewayLock(
  configPath: string,
  opts: GatewayLockOptions = {}
): Promise<GatewayLockHandle> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const port = opts.port;

  const lockPath = resolveLockPath(configPath);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const startedAt = Date.now();
  let lastPayload: LockPayload | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      // Try to create lock file (wx = exclusive creation)
      const handle = await fs.open(lockPath, "wx");

      const startTime = process.platform === "linux" ? readLinuxStartTime(process.pid) : null;
      const payload: LockPayload = {
        pid: process.pid,
        createdAt: new Date().toISOString(),
        configPath,
        ...(Number.isFinite(startTime) ? { startTime } : {}),
      };

      await handle.writeFile(JSON.stringify(payload), "utf8");

      log.info({ pid: process.pid, lockPath }, "Gateway lock acquired");

      return {
        lockPath,
        configPath,
        release: async () => {
          await handle.close().catch(() => undefined);
          await fs.rm(lockPath, { force: true });
          log.info({ lockPath }, "Gateway lock released");
        },
      };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code !== "EEXIST") {
        throw new GatewayLockError(`Failed to acquire lock at ${lockPath}`, err);
      }

      // Lock exists, check owner status
      lastPayload = await readLockPayload(lockPath);
      const ownerPid = lastPayload?.pid;
      const ownerStatus = ownerPid
        ? await resolveOwnerStatus(ownerPid, lastPayload, port)
        : "unknown";

      // Owner dead, clean up lock file
      if (ownerStatus === "dead" && ownerPid) {
        log.warn({ pid: ownerPid }, "Cleaning up stale gateway lock");
        await fs.rm(lockPath, { force: true });
        continue;
      }

      // Unknown status, check if expired
      if (ownerStatus !== "alive") {
        let stale = false;
        if (lastPayload?.createdAt) {
          const createdAt = Date.parse(lastPayload.createdAt);
          stale = Number.isFinite(createdAt) ? Date.now() - createdAt > staleMs : false;
        }
        if (!stale) {
          try {
            const st = await fs.stat(lockPath);
            stale = Date.now() - st.mtimeMs > staleMs;
          } catch {
            stale = false;
          }
        }
        if (stale) {
          log.warn({ lockPath }, "Removing stale lock file");
          await fs.rm(lockPath, { force: true });
          continue;
        }
      }

      // Wait and retry
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  const owner = lastPayload?.pid ? ` (pid ${lastPayload.pid})` : "";
  throw new GatewayLockError(`Gateway already running${owner}; lock timeout after ${timeoutMs}ms`);
}
