import type { Config } from '../config/schema.js';
import type { GatewayBindMode } from '../config/schema.js';
import type { ResolvedGatewayAuth } from './auth.js';
import { isAuthRateLimitGloballyDisabled, isGatewayStrictSecurityEnabled } from './auth-rate-limit.js';
import {
  buildDefaultCorsOrigins,
  isAllInterfacesHost,
  isLoopbackHost,
} from './host.js';
import { resolveGatewayListenPlan } from './listen.js';
import { assertTailscaleExposureCompatible } from './tailscale-lifecycle.js';

export type GatewayRuntimeConfig = {
  bindMode: GatewayBindMode;
  bindHost: string;
  customBindHost?: string;
  loopback: boolean;
  auth: ResolvedGatewayAuth;
  corsOrigins: string[];
  dangerouslyAllowHostHeaderOriginFallback: boolean;
  rateLimitEnabled: boolean;
  tlsEnabled: boolean;
};

function normalizeCorsOrigins(cfg: Config): string[] {
  return (cfg.gateway?.corsOrigins ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasSharedSecret(auth: ResolvedGatewayAuth): boolean {
  if (auth.mode === 'trusted-proxy') {
    return true;
  }
  if (auth.mode === 'token') {
    return typeof auth.token === 'string' && auth.token.trim().length > 0;
  }
  if (auth.mode === 'password') {
    return typeof auth.password === 'string' && auth.password.trim().length > 0;
  }
  return false;
}

/**
 * Fail-closed gateway startup guards (OpenClaw-aligned).
 * Throws when bind/auth/origin combinations are unsafe for network exposure.
 */
export function assertGatewayRuntimeConfig(params: {
  cfg: Config;
  auth: ResolvedGatewayAuth;
  bindOverride?: GatewayBindMode;
  port: number;
}): GatewayRuntimeConfig {
  const plan = resolveGatewayListenPlan({
    cfg: params.cfg,
    bindOverride: params.bindOverride,
  });
  const { bindMode, bindHost, customBindHost } = plan;
  const loopback = isLoopbackHost(bindHost);
  const corsOrigins = normalizeCorsOrigins(params.cfg);
  const dangerouslyAllowHostHeaderOriginFallback =
    params.cfg.gateway?.dangerouslyAllowHostHeaderOriginFallback === true;

  if (bindMode === 'loopback' && !loopback) {
    throw new Error(
      `gateway bind=loopback resolved to non-loopback host ${bindHost}; refusing fallback to a network bind`,
    );
  }

  if (bindMode === 'custom') {
    const configuredCustom = params.cfg.gateway?.customBindHost?.trim();
    if (!configuredCustom) {
      throw new Error('gateway.bind=custom requires gateway.customBindHost');
    }
    if (bindHost !== configuredCustom) {
      throw new Error(
        `gateway bind=custom requested ${configuredCustom} but resolved ${bindHost}`,
      );
    }
  }

  if (!loopback) {
    if (params.auth.mode === 'none') {
      throw new Error(
        `refusing to bind gateway to ${bindHost}:${params.port} without auth ` +
          '(set gateway.auth.mode to "token", "password", or "trusted-proxy" and configure credentials)',
      );
    }

    if (!hasSharedSecret(params.auth)) {
      throw new Error(
        `refusing to bind gateway to ${bindHost}:${params.port} without auth ` +
          '(set gateway.auth.token/password, XOPC_GATEWAY_TOKEN/XOPC_GATEWAY_PASSWORD, or trusted-proxy config)',
      );
    }

    if (params.auth.mode === 'trusted-proxy') {
      const trustedProxies = (params.cfg.gateway?.trustedProxies ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (trustedProxies.length === 0) {
        throw new Error(
          'gateway auth mode=trusted-proxy requires gateway.trustedProxies to be configured with at least one proxy IP',
        );
      }
    }

    if (corsOrigins.length === 0 && !dangerouslyAllowHostHeaderOriginFallback) {
      const suggested = buildDefaultCorsOrigins({ port: params.port, bindHost }).join(', ');
      throw new Error(
        'network-accessible gateway requires gateway.corsOrigins ' +
          `(e.g. [${suggested}]), or set ` +
          'gateway.dangerouslyAllowHostHeaderOriginFallback=true for Host-header origin fallback',
      );
    }

    if (corsOrigins.some((origin) => origin === '*')) {
      throw new Error(
        'gateway.corsOrigins must not include "*" when binding to a network-accessible address',
      );
    }
  }

  if (isAllInterfacesHost(bindHost) && params.auth.mode === 'none') {
    throw new Error(
      'refusing to bind gateway to all interfaces (0.0.0.0) without authentication',
    );
  }

  assertTailscaleExposureCompatible(params.cfg);

  const rateLimitConfigured = params.cfg.gateway?.auth?.rateLimit !== undefined;
  const rateLimitEnabled =
    params.cfg.gateway?.auth?.rateLimit?.enabled !== false &&
    !isAuthRateLimitGloballyDisabled();
  const tailscaleMode = params.cfg.gateway?.tailscale?.mode ?? 'off';
  const tlsEnabled =
    params.cfg.tunnel?.enabled === true ||
    tailscaleMode !== 'off' ||
    params.cfg.gateway?.tls?.enabled === true;

  if (
    !loopback &&
    isGatewayStrictSecurityEnabled(params.cfg) &&
    !rateLimitConfigured
  ) {
    throw new Error(
      'gateway.security.strict requires gateway.auth.rateLimit on network-accessible binds ' +
        '(e.g. { maxAttempts: 10, windowMs: 60000, blockDurationMs: 300000 })',
    );
  }

  return {
    bindMode,
    bindHost,
    customBindHost,
    loopback,
    auth: params.auth,
    corsOrigins,
    dangerouslyAllowHostHeaderOriginFallback,
    rateLimitEnabled,
    tlsEnabled,
  };
}
