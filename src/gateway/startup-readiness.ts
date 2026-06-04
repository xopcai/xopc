import { createLogger } from '../utils/logger.js';

const log = createLogger('GatewayStartup');

export const STARTUP_UNAVAILABLE_GATEWAY_METHODS = [
  'sessions.history',
  'sessions.messages',
  'sessions.list',
  'sessions.run',
  'sessions.reset',
  'models.list',
] as const;

export type StartupUnavailableGatewayMethod = (typeof STARTUP_UNAVAILABLE_GATEWAY_METHODS)[number];

export type GatewayReadinessSnapshot = {
  ready: boolean;
  httpListening: boolean;
  startedAtMs: number;
  readyAtMs: number | null;
  startupDurationMs: number | null;
};

export type StartupUnavailablePayload = {
  ok: false;
  error: string;
  code: 'STARTUP_UNAVAILABLE';
  retryable: true;
  retryAfterMs: number;
  method: StartupUnavailableGatewayMethod;
};

const DEFAULT_RETRY_AFTER_MS = 500;
const MAX_RETRY_AFTER_MS = 5_000;

export class GatewayReadiness {
  private ready = false;
  private httpListening = false;
  private startedAtMs = Date.now();
  private readyAtMs: number | null = null;

  markStarting(startedAtMs: number = Date.now()): void {
    this.startedAtMs = startedAtMs;
    this.readyAtMs = null;
    this.ready = false;
    this.httpListening = false;
  }

  markHttpListening(): void {
    this.httpListening = true;
  }

  markReady(): void {
    if (this.ready) {
      return;
    }
    this.ready = true;
    this.readyAtMs = Date.now();
    const durationMs = this.readyAtMs - this.startedAtMs;
    log.info(
      { phase: 'gateway.startup', ready: true, startupDurationMs: Math.round(durationMs) },
      `Gateway ready in ${(durationMs / 1000).toFixed(1)}s`,
    );
  }

  isReady(): boolean {
    return this.ready;
  }

  isHttpListening(): boolean {
    return this.httpListening;
  }

  getSnapshot(): GatewayReadinessSnapshot {
    return {
      ready: this.ready,
      httpListening: this.httpListening,
      startedAtMs: this.startedAtMs,
      readyAtMs: this.readyAtMs,
      startupDurationMs:
        this.readyAtMs === null ? null : Math.max(0, this.readyAtMs - this.startedAtMs),
    };
  }

  resolveRetryAfterMs(headerValue: string | undefined): number {
    if (headerValue) {
      const parsed = Number.parseInt(headerValue, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(parsed, MAX_RETRY_AFTER_MS);
      }
    }
    return DEFAULT_RETRY_AFTER_MS;
  }
}

export function buildStartupUnavailablePayload(params: {
  method: StartupUnavailableGatewayMethod;
  retryAfterMs?: number;
}): StartupUnavailablePayload {
  const retryAfterMs = Math.min(
    Math.max(params.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, 100),
    MAX_RETRY_AFTER_MS,
  );
  return {
    ok: false,
    error: `${params.method} unavailable during gateway startup`,
    code: 'STARTUP_UNAVAILABLE',
    retryable: true,
    retryAfterMs,
    method: params.method,
  };
}

export function parseStartupRetryAfterMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(Math.max(value, 100), MAX_RETRY_AFTER_MS);
  }
  return DEFAULT_RETRY_AFTER_MS;
}
