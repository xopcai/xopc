/**
 * Restart Health - Wait loop after restart to verify gateway is healthy
 *
 * Polls service runtime + port usage + HTTP health probe to confirm:
 * 1. Service is running with a new PID
 * 2. Port is being listened on by the new process
 * 3. HTTP /api/health responds successfully
 * 4. Version matches expected (optional)
 */

import { createLogger } from '../../../utils/logger.js';
import type { GatewayServiceRuntime } from '../../../daemon/types.js';
import type { PortUsage } from '../../../infra/ports.js';
import { formatPortDiagnostics, inspectPortUsage } from '../../../infra/ports.js';

const log = createLogger('RestartHealth');

export const DEFAULT_RESTART_HEALTH_TIMEOUT_MS = 60_000;
export const DEFAULT_RESTART_HEALTH_DELAY_MS = 500;
export const DEFAULT_RESTART_HEALTH_ATTEMPTS = Math.ceil(
  DEFAULT_RESTART_HEALTH_TIMEOUT_MS / DEFAULT_RESTART_HEALTH_DELAY_MS,
);

export type GatewayRestartWaitOutcome =
  | 'healthy'
  | 'version-mismatch'
  | 'stale-pids'
  | 'stopped-free'
  | 'timeout';

export interface GatewayRestartSnapshot {
  runtime?: GatewayServiceRuntime;
  portUsage?: PortUsage;
  healthy: boolean;
  staleGatewayPids: number[];
  gatewayVersion?: string | null;
  expectedVersion?: string;
  versionMismatch?: { expected: string; actual: string | null };
  waitOutcome?: GatewayRestartWaitOutcome;
  elapsedMs?: number;
}

interface RestartHealthService {
  readRuntime: (env?: Record<string, string | undefined>) => Promise<GatewayServiceRuntime>;
}

/**
 * Wait for gateway restart to complete and verify health.
 *
 * Loop:
 * 1. Check service runtime → get PID
 * 2. inspectPortUsage → confirm port is busy with new process
 * 3. HTTP probe /api/health → confirm reachable
 * 4. Version match (if expectedVersion provided)
 */
export async function waitForRestartHealth(params: {
  service: RestartHealthService;
  port: number;
  expectedVersion?: string;
  timeoutMs?: number;
  delayMs?: number;
  token?: string;
  onProgress?: (snapshot: GatewayRestartSnapshot) => void;
}): Promise<GatewayRestartSnapshot> {
  const {
    service,
    port,
    expectedVersion,
    timeoutMs = DEFAULT_RESTART_HEALTH_TIMEOUT_MS,
    delayMs = DEFAULT_RESTART_HEALTH_DELAY_MS,
    token,
    onProgress,
  } = params;

  const { inspectPortUsage, classifyPortListener } = await import('../../../infra/ports.js');

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const elapsed = Date.now() - startedAt;

    // 1. Check service runtime
    const runtime = await service.readRuntime();

    if (runtime.status !== 'running' || !runtime.pid) {
      const snapshot: GatewayRestartSnapshot = {
        runtime,
        healthy: false,
        staleGatewayPids: [],
        elapsedMs: elapsed,
      };
      onProgress?.(snapshot);
      await sleep(delayMs);
      continue;
    }

    // 2. Check port usage
    const portUsage = await inspectPortUsage(port);

    if (portUsage.status !== 'busy') {
      const snapshot: GatewayRestartSnapshot = {
        runtime,
        portUsage,
        healthy: false,
        staleGatewayPids: [],
        elapsedMs: elapsed,
      };
      onProgress?.(snapshot);
      await sleep(delayMs);
      continue;
    }

    // 3. Verify port listener matches runtime PID
    const gatewayListeners = portUsage.listeners.filter(
      (l) => classifyPortListener(l, runtime.pid) === 'gateway',
    );
    const staleListeners = portUsage.listeners.filter(
      (l) => l.pid && l.pid !== runtime.pid && classifyPortListener(l) === 'gateway',
    );
    const staleGatewayPids = staleListeners.map((l) => l.pid!).filter(Boolean);

    if (gatewayListeners.length === 0) {
      const snapshot: GatewayRestartSnapshot = {
        runtime,
        portUsage,
        healthy: false,
        staleGatewayPids,
        elapsedMs: elapsed,
      };
      onProgress?.(snapshot);
      await sleep(delayMs);
      continue;
    }

    // 4. HTTP health probe
    const healthResult = await probeHealth(port, token);

    if (!healthResult.ok) {
      const snapshot: GatewayRestartSnapshot = {
        runtime,
        portUsage,
        healthy: false,
        staleGatewayPids,
        elapsedMs: elapsed,
      };
      onProgress?.(snapshot);
      await sleep(delayMs);
      continue;
    }

    // 5. Version check (optional)
    const gatewayVersion = healthResult.version ?? null;

    if (expectedVersion && gatewayVersion && gatewayVersion !== expectedVersion) {
      const snapshot: GatewayRestartSnapshot = {
        runtime,
        portUsage,
        healthy: false,
        staleGatewayPids,
        gatewayVersion,
        expectedVersion,
        versionMismatch: { expected: expectedVersion, actual: gatewayVersion },
        waitOutcome: 'version-mismatch',
        elapsedMs: elapsed,
      };
      onProgress?.(snapshot);
      return snapshot;
    }

    // Success!
    const snapshot: GatewayRestartSnapshot = {
      runtime,
      portUsage,
      healthy: true,
      staleGatewayPids,
      gatewayVersion,
      expectedVersion,
      waitOutcome: 'healthy',
      elapsedMs: elapsed,
    };
    onProgress?.(snapshot);

    log.info({ pid: runtime.pid, elapsedMs: elapsed, port }, 'Restart health confirmed');
    return snapshot;
  }

  // Timeout
  const finalRuntime = await service.readRuntime();
  const finalSnapshot: GatewayRestartSnapshot = {
    runtime: finalRuntime,
    healthy: false,
    staleGatewayPids: [],
    waitOutcome: 'timeout',
    elapsedMs: Date.now() - startedAt,
  };

  log.warn({ timeoutMs, port }, 'Restart health check timed out');
  return finalSnapshot;
}

// ─── HTTP Health Probe ───

interface HealthProbeResult {
  ok: boolean;
  version?: string;
  error?: string;
}

async function probeHealth(port: number, token?: string): Promise<HealthProbeResult> {
  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const body = await response.json() as { version?: string };
    return { ok: true, version: body.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Utility ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type GatewayPortHealthSnapshot = {
  portUsage?: PortUsage;
  healthy: boolean;
};

async function inspectGatewayPortHealth(port: number, token?: string): Promise<GatewayPortHealthSnapshot> {
  let portUsage: PortUsage;
  try {
    portUsage = await inspectPortUsage(port);
  } catch (err) {
    portUsage = {
      port,
      status: 'unknown',
      listeners: [],
      hints: [],
      errors: [String(err)],
    };
  }

  let healthy = false;
  if (portUsage.status === 'busy') {
    const healthResult = await probeHealth(port, token);
    healthy = healthResult.ok;
  }

  return { portUsage, healthy };
}

export async function waitForGatewayHealthyListener(params: {
  port: number;
  attempts?: number;
  delayMs?: number;
  token?: string;
}): Promise<GatewayPortHealthSnapshot> {
  const attempts = params.attempts ?? DEFAULT_RESTART_HEALTH_ATTEMPTS;
  const delayMs = params.delayMs ?? DEFAULT_RESTART_HEALTH_DELAY_MS;

  let snapshot = await inspectGatewayPortHealth(params.port, params.token);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (snapshot.healthy) {
      return snapshot;
    }
    await sleep(delayMs);
    snapshot = await inspectGatewayPortHealth(params.port, params.token);
  }
  return snapshot;
}

export function renderGatewayPortHealthDiagnostics(snapshot: GatewayPortHealthSnapshot): string[] {
  const lines: string[] = [];
  if (!snapshot.portUsage) {
    lines.push('Gateway port health unavailable.');
    return lines;
  }
  if (snapshot.portUsage.status === 'busy') {
    lines.push(...formatPortDiagnostics(snapshot.portUsage));
  } else {
    lines.push(`Gateway port ${snapshot.portUsage.port} status: ${snapshot.portUsage.status}.`);
  }
  if (snapshot.portUsage.errors?.length) {
    lines.push(`Port diagnostics errors: ${snapshot.portUsage.errors.join('; ')}`);
  }
  return lines;
}
