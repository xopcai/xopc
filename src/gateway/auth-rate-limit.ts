/**
 * Rate limiting for failed gateway token authentication attempts (per client IP).
 */

import { isLoopbackHost } from './host.js';

export type AuthRateLimitConfig = {
  enabled: boolean;
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
  /** When true, loopback client IPs skip rate limiting (default). */
  exemptLoopback: boolean;
};

const DEFAULT_CONFIG: AuthRateLimitConfig = {
  enabled: true,
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockDurationMs: 5 * 60 * 1000,
  exemptLoopback: true,
};

export type GatewayAuthRateLimitInput = {
  enabled?: boolean;
  maxAttempts?: number;
  windowMs?: number;
  blockDurationMs?: number;
  /** OpenClaw alias for blockDurationMs. */
  lockoutMs?: number;
  exemptLoopback?: boolean;
} | undefined;

export function resolveAuthRateLimitConfig(
  input: GatewayAuthRateLimitInput,
): AuthRateLimitConfig {
  if (!input) {
    return { ...DEFAULT_CONFIG };
  }
  const blockDurationMs = input.blockDurationMs ?? input.lockoutMs ?? DEFAULT_CONFIG.blockDurationMs;
  return {
    enabled: input.enabled ?? DEFAULT_CONFIG.enabled,
    maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? DEFAULT_CONFIG.maxAttempts)),
    windowMs: Math.max(1000, Math.floor(input.windowMs ?? DEFAULT_CONFIG.windowMs)),
    blockDurationMs: Math.max(1000, Math.floor(blockDurationMs)),
    exemptLoopback: input.exemptLoopback ?? DEFAULT_CONFIG.exemptLoopback,
  };
}

export function isAuthRateLimitGloballyDisabled(): boolean {
  return process.env.XOPC_AUTH_RATE_LIMIT === 'false';
}

export function isGatewayStrictSecurityEnabled(cfg?: {
  gateway?: { security?: { strict?: boolean } };
}): boolean {
  return (
    cfg?.gateway?.security?.strict === true ||
    process.env.XOPC_GATEWAY_STRICT_SECURITY === '1'
  );
}

export function isLoopbackClientIp(clientIp: string | undefined): boolean {
  if (!clientIp || clientIp === 'unknown') {
    return false;
  }
  const trimmed = clientIp.trim();
  if (trimmed.includes(':') && !trimmed.includes('.')) {
    return isLoopbackHost(trimmed.replace(/^\[/, '').replace(/\]$/, ''));
  }
  return isLoopbackHost(trimmed.split(':')[0]);
}

/** True when a browser Origin header targets the local gateway console (Electron / loopback SPA). */
export function isLoopbackBrowserOrigin(origin: string | undefined): boolean {
  const trimmed = origin?.trim();
  if (!trimmed || trimmed === 'null') {
    return false;
  }
  try {
    return isLoopbackHost(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

/** Loopback gateway console in a same-machine browser (Electron embedded UI, local dev). */
export function isLoopbackEmbeddedBrowserClient(
  origin: string | undefined,
  clientIp: string,
): boolean {
  if (!isLoopbackBrowserOrigin(origin)) {
    return false;
  }
  if (clientIp === 'unknown') {
    return true;
  }
  return isLoopbackClientIp(clientIp);
}

function parseBrowserOriginRateLimitKey(clientKey: string): { origin: string; clientIp: string } | null {
  if (!clientKey.startsWith('browser-origin:')) {
    return null;
  }
  const pipeIdx = clientKey.indexOf('|');
  if (pipeIdx === -1) {
    return null;
  }
  return {
    origin: clientKey.slice('browser-origin:'.length, pipeIdx),
    clientIp: clientKey.slice(pipeIdx + 1),
  };
}

function isLocalBrowserAuthClient(clientKey: string): boolean {
  const parsed = parseBrowserOriginRateLimitKey(clientKey);
  if (!parsed) {
    return false;
  }
  return isLoopbackEmbeddedBrowserClient(parsed.origin, parsed.clientIp);
}

/** Browser-origin auth failures are tracked independently from CLI/server clients. */
export function buildBrowserOriginRateLimitKey(origin: string, clientIp: string): string {
  const normalizedOrigin = origin.trim().toLowerCase();
  return `browser-origin:${normalizedOrigin}|${clientIp.trim()}`;
}

function shouldSkipRateLimit(clientKey: string, cfg: AuthRateLimitConfig): boolean {
  if (!cfg.exemptLoopback) {
    return false;
  }
  if (clientKey.startsWith('browser-origin:')) {
    return isLocalBrowserAuthClient(clientKey);
  }
  return isLoopbackClientIp(clientKey);
}

type IpState = {
  windowStart: number;
  count: number;
  blockedUntil?: number;
};

/**
 * Tracks failed auth attempts per IP; blocks further attempts after the threshold.
 */
export class AuthFailureRateLimiter {
  private readonly store = new Map<string, IpState>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    const interval = 10 * 60 * 1000;
    this.cleanupTimer = setInterval(() => this.cleanupStale(), interval);
    this.cleanupTimer.unref?.();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.store.clear();
  }

  private cleanupStale(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    for (const [ip, state] of this.store.entries()) {
      const last = state.blockedUntil ?? state.windowStart;
      if (now - last > maxAge) {
        this.store.delete(ip);
      }
    }
  }

  checkBlocked(
    clientKey: string,
    cfg: AuthRateLimitConfig,
    nowMs: number = Date.now(),
  ): { blocked: false } | { blocked: true; retryAfterSec: number } {
    if (shouldSkipRateLimit(clientKey, cfg)) {
      return { blocked: false };
    }

    const state = this.store.get(clientKey);
    if (!state?.blockedUntil) {
      return { blocked: false };
    }
    if (nowMs >= state.blockedUntil) {
      state.blockedUntil = undefined;
      state.count = 0;
      state.windowStart = nowMs;
      return { blocked: false };
    }
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((state.blockedUntil - nowMs) / 1000)),
    };
  }

  recordFailure(clientKey: string, cfg: AuthRateLimitConfig, nowMs: number = Date.now()): void {
    if (shouldSkipRateLimit(clientKey, cfg)) {
      return;
    }

    let state = this.store.get(clientKey);
    if (!state) {
      state = { windowStart: nowMs, count: 0 };
      this.store.set(clientKey, state);
    }

    if (state.blockedUntil && nowMs < state.blockedUntil) {
      return;
    }
    if (state.blockedUntil && nowMs >= state.blockedUntil) {
      state.blockedUntil = undefined;
      state.count = 0;
      state.windowStart = nowMs;
    }

    if (nowMs - state.windowStart > cfg.windowMs) {
      state.count = 0;
      state.windowStart = nowMs;
    }

    state.count += 1;
    if (state.count >= cfg.maxAttempts) {
      state.blockedUntil = nowMs + cfg.blockDurationMs;
    }
  }

  recordSuccess(clientKey: string): void {
    this.store.delete(clientKey);
  }

  resetForTests(): void {
    this.store.clear();
  }
}

let singleton: AuthFailureRateLimiter | null = null;
let browserOriginSingleton: AuthFailureRateLimiter | null = null;

export function getAuthFailureRateLimiter(): AuthFailureRateLimiter {
  if (!singleton) {
    singleton = new AuthFailureRateLimiter();
  }
  return singleton;
}

/** Browser-origin limiter: never exempts loopback (defense-in-depth). */
export function getBrowserOriginAuthFailureRateLimiter(): AuthFailureRateLimiter {
  if (!browserOriginSingleton) {
    browserOriginSingleton = new AuthFailureRateLimiter();
  }
  return browserOriginSingleton;
}

export function resetAuthRateLimitersForTests(): void {
  getAuthFailureRateLimiter().resetForTests();
  getBrowserOriginAuthFailureRateLimiter().resetForTests();
}

export function getClientIpFromHeaders(headers: {
  get(name: string): string | undefined;
}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  return 'unknown';
}

export function resolveAuthRateLimitTracking(params: {
  clientIp: string;
  origin?: string | null;
  cfg: AuthRateLimitConfig;
}): { limiter: AuthFailureRateLimiter; key: string; cfg: AuthRateLimitConfig } {
  const origin = params.origin?.trim();
  if (origin) {
    const localBrowserClient = isLoopbackEmbeddedBrowserClient(origin, params.clientIp);
    return {
      limiter: getBrowserOriginAuthFailureRateLimiter(),
      key: buildBrowserOriginRateLimitKey(origin, params.clientIp),
      cfg: {
        ...params.cfg,
        exemptLoopback: localBrowserClient ? params.cfg.exemptLoopback : false,
      },
    };
  }
  return {
    limiter: getAuthFailureRateLimiter(),
    key: params.clientIp,
    cfg: params.cfg,
  };
}
