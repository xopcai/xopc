/**
 * Gateway restart coordination — OpenClaw-aligned SIGUSR1 authorization and restart intent.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveStateDir } from '../config/paths-state.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Restart');

const SIGUSR1_AUTH_GRACE_MS = 5000;
const GATEWAY_RESTART_INTENT_FILENAME = 'gateway-restart-intent.json';
const GATEWAY_RESTART_INTENT_TTL_MS = 60_000;

type GatewayRestartIntentPayload = {
  kind: 'gateway-restart';
  pid: number;
  createdAt: number;
};

let sigusr1AuthorizedCount = 0;
let sigusr1AuthorizedUntil = 0;
let sigusr1ExternalAllowed = false;
let pendingRestartTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRestartCallback: (() => void) | null = null;

function resolveGatewayRestartIntentPath(env: NodeJS.ProcessEnv = process.env): string {
  const stateDir = env.XOPC_STATE_DIR?.trim() || resolveStateDir();
  return path.join(stateDir, GATEWAY_RESTART_INTENT_FILENAME);
}

function normalizeRestartIntentPid(pid: number | undefined): number | null {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function writeGatewayRestartIntentSync(opts: {
  env?: NodeJS.ProcessEnv;
  targetPid?: number;
} = {}): boolean {
  const targetPid = normalizeRestartIntentPid(opts.targetPid);
  if (targetPid === null) {
    return false;
  }
  const env = opts.env ?? process.env;
  const intentPath = resolveGatewayRestartIntentPath(env);
  const payload: GatewayRestartIntentPayload = {
    kind: 'gateway-restart',
    pid: targetPid,
    createdAt: Date.now(),
  };
  try {
    mkdirSync(path.dirname(intentPath), { recursive: true });
    writeFileSync(intentPath, `${JSON.stringify(payload)}\n`, 'utf8');
    return true;
  } catch (err) {
    log.warn({ err }, 'Failed to write gateway restart intent');
    return false;
  }
}

export function clearGatewayRestartIntentSync(env: NodeJS.ProcessEnv = process.env): void {
  try {
    rmSync(resolveGatewayRestartIntentPath(env));
  } catch {
    // File may not exist
  }
}

function parseGatewayRestartIntent(raw: string): GatewayRestartIntentPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GatewayRestartIntentPayload>;
    if (
      parsed.kind === 'gateway-restart' &&
      typeof parsed.pid === 'number' &&
      Number.isFinite(parsed.pid) &&
      typeof parsed.createdAt === 'number' &&
      Number.isFinite(parsed.createdAt)
    ) {
      return parsed as GatewayRestartIntentPayload;
    }
  } catch {
    return null;
  }
  return null;
}

export function consumeGatewayRestartIntentSync(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  const intentPath = resolveGatewayRestartIntentPath(env);
  let raw: string;
  try {
    raw = readFileSync(intentPath, 'utf8');
  } catch {
    return false;
  } finally {
    clearGatewayRestartIntentSync(env);
  }
  const payload = parseGatewayRestartIntent(raw);
  if (!payload) {
    return false;
  }
  if (payload.pid !== process.pid) {
    return false;
  }
  const ageMs = now - payload.createdAt;
  return ageMs >= 0 && ageMs <= GATEWAY_RESTART_INTENT_TTL_MS;
}

export function setGatewaySigusr1RestartPolicy(opts?: { allowExternal?: boolean }): void {
  sigusr1ExternalAllowed = opts?.allowExternal === true;
}

export function isGatewaySigusr1RestartExternallyAllowed(): boolean {
  return sigusr1ExternalAllowed;
}

function resetSigusr1AuthorizationIfExpired(now = Date.now()): void {
  if (sigusr1AuthorizedCount <= 0) {
    return;
  }
  if (now <= sigusr1AuthorizedUntil) {
    return;
  }
  sigusr1AuthorizedCount = 0;
  sigusr1AuthorizedUntil = 0;
}

export function authorizeGatewaySigusr1Restart(delayMs = 0): void {
  const delay = Math.max(0, Math.floor(delayMs));
  const expiresAt = Date.now() + delay + SIGUSR1_AUTH_GRACE_MS;
  sigusr1AuthorizedCount += 1;
  if (expiresAt > sigusr1AuthorizedUntil) {
    sigusr1AuthorizedUntil = expiresAt;
  }
}

export function consumeGatewaySigusr1RestartAuthorization(): boolean {
  resetSigusr1AuthorizationIfExpired();
  if (sigusr1AuthorizedCount <= 0) {
    return false;
  }
  sigusr1AuthorizedCount -= 1;
  if (sigusr1AuthorizedCount <= 0) {
    sigusr1AuthorizedUntil = 0;
  }
  return true;
}

export function resetGatewayRestartStateForInProcessRestart(): void {
  if (pendingRestartTimer) {
    clearTimeout(pendingRestartTimer);
    pendingRestartTimer = null;
  }
  pendingRestartCallback = null;
}

export function scheduleGatewaySigusr1Restart(params: {
  delayMs?: number;
  reason?: string;
  onRestart: () => void;
}): void {
  if (pendingRestartTimer) {
    clearTimeout(pendingRestartTimer);
  }
  pendingRestartCallback = params.onRestart;
  const delayMs = Math.max(0, params.delayMs ?? 0);
  pendingRestartTimer = setTimeout(() => {
    pendingRestartTimer = null;
    const callback = pendingRestartCallback;
    pendingRestartCallback = null;
    callback?.();
  }, delayMs);
}
