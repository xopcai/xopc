import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import {
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_MAX_SSE_CONNECTIONS,
  MAX_CHANNEL_DEFER_LIST_SIZE,
  type GatewayAuthMode,
  type GatewayAuthRateLimitState,
  type GatewayBindMode,
  type GatewayChannelConnectDeferMode,
  type GatewaySettingsState,
  type GatewayTrustedProxyState,
  type UpdatePackageChannel,
} from './gateway-settings.types';

export type {
  GatewayAuthMode,
  GatewayAuthRateLimitState,
  GatewayChannelConnectDeferMode,
  GatewaySettingsState,
  GatewayTrustedProxyState,
  UpdatePackageChannel,
} from './gateway-settings.types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isMaskedGatewaySecret(value: string): boolean {
  return value === '***' || value === '••••••••••••';
}

function normalizeSecretForRestartCompare(value: string): string {
  return isMaskedGatewaySecret(value) ? '' : value.trim();
}

function sortedStringList(values: string[]): string[] {
  return [...values].map((value) => value.trim()).sort();
}

/** Snapshot of gateway settings that require a process restart (listen, auth, CORS). */
function snapshotGatewayRestartSettings(state: GatewaySettingsState): string {
  return JSON.stringify({
    bind: state.bind,
    customBindHost: state.customBindHost.trim(),
    port: state.port,
    auth: {
      mode: state.auth.mode,
      token: normalizeSecretForRestartCompare(state.auth.token),
      password: normalizeSecretForRestartCompare(state.auth.password),
      rateLimit: state.auth.rateLimit,
      trustedProxy: {
        userHeader: state.auth.trustedProxy.userHeader.trim(),
        requiredHeaders: sortedStringList(state.auth.trustedProxy.requiredHeaders),
        allowUsers: sortedStringList(state.auth.trustedProxy.allowUsers),
        allowLoopback: state.auth.trustedProxy.allowLoopback,
      },
    },
    corsOrigins: sortedStringList(state.corsOrigins),
    trustedProxies: sortedStringList(state.trustedProxies),
    allowRealIpFallback: state.allowRealIpFallback,
    dangerouslyAllowHostHeaderOriginFallback: state.dangerouslyAllowHostHeaderOriginFallback,
  });
}

/** True when listen address, authentication, or CORS settings differ between two states. */
export function gatewaySettingsRequireRestart(
  from: GatewaySettingsState,
  to: GatewaySettingsState,
): boolean {
  return snapshotGatewayRestartSettings(from) !== snapshotGatewayRestartSettings(to);
}

function normalizeAuthMode(raw: unknown): GatewayAuthMode {
  if (raw === 'none' || raw === 'token' || raw === 'password' || raw === 'trusted-proxy') return raw;
  return 'token';
}

function normalizeRateLimit(raw: unknown): GatewayAuthRateLimitState {
  const rl = isRecord(raw) ? raw : {};
  return {
    enabled: rl.enabled !== false,
    maxAttempts:
      typeof rl.maxAttempts === 'number' && Number.isFinite(rl.maxAttempts)
        ? Math.max(1, Math.floor(rl.maxAttempts))
        : DEFAULT_AUTH_RATE_LIMIT.maxAttempts,
    windowMs:
      typeof rl.windowMs === 'number' && Number.isFinite(rl.windowMs) && rl.windowMs > 0
        ? Math.floor(rl.windowMs)
        : DEFAULT_AUTH_RATE_LIMIT.windowMs,
    blockDurationMs:
      typeof rl.blockDurationMs === 'number' &&
      Number.isFinite(rl.blockDurationMs) &&
      rl.blockDurationMs > 0
        ? Math.floor(rl.blockDurationMs)
        : typeof rl.lockoutMs === 'number' &&
            Number.isFinite(rl.lockoutMs) &&
            rl.lockoutMs > 0
          ? Math.floor(rl.lockoutMs)
          : DEFAULT_AUTH_RATE_LIMIT.blockDurationMs,
    exemptLoopback: rl.exemptLoopback !== false,
  };
}

function normalizeTrustedProxy(raw: unknown): GatewayTrustedProxyState {
  const tp = isRecord(raw) ? raw : {};
  return {
    userHeader: typeof tp.userHeader === 'string' ? tp.userHeader : '',
    requiredHeaders: normalizeStringIdList(tp.requiredHeaders, 32),
    allowUsers: normalizeStringIdList(tp.allowUsers, 128),
    allowLoopback: tp.allowLoopback === true,
  };
}

function normalizeDeferMode(raw: unknown): GatewayChannelConnectDeferMode {
  if (raw === 'auto' || raw === 'off' || raw === 'explicit') return raw;
  return 'auto';
}

function normalizeStringIdList(raw: unknown, max = MAX_CHANNEL_DEFER_LIST_SIZE): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function normalizeBindMode(raw: unknown): GatewayBindMode {
  if (raw === 'auto' || raw === 'loopback' || raw === 'lan' || raw === 'tailnet' || raw === 'custom') {
    return raw;
  }
  return 'loopback';
}

/** True when the bind mode likely exposes the gateway beyond loopback. */
export function isNonLoopbackGatewayBind(state: GatewaySettingsState): boolean {
  if (state.bind === 'loopback') return false;
  if (state.bind === 'lan') return true;
  if (state.bind === 'custom') {
    const host = state.customBindHost.trim().toLowerCase();
    if (!host) return true;
    return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
  }
  return true;
}

function buildDefaultCorsOrigins(port: number, bindHost?: string): string[] {
  const origins = new Set<string>([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  const host = bindHost?.trim();
  if (
    host &&
    host !== '127.0.0.1' &&
    host !== 'localhost' &&
    host !== '::1' &&
    host !== '0.0.0.0' &&
    host !== '::'
  ) {
    origins.add(`http://${host}:${port}`);
  }
  return [...origins];
}

export function validateGatewaySettings(state: GatewaySettingsState): string | null {
  const nonLoopback = isNonLoopbackGatewayBind(state);

  if (nonLoopback && state.auth.mode === 'none') {
    return 'Network-accessible gateway requires authentication (token, password, or trusted-proxy).';
  }

  if (nonLoopback && state.auth.mode === 'trusted-proxy' && state.trustedProxies.length === 0) {
    return 'Trusted-proxy auth on a network bind requires at least one gateway.trustedProxies entry.';
  }

  if (state.auth.mode === 'trusted-proxy' && !state.auth.trustedProxy.userHeader.trim()) {
    return 'Trusted-proxy auth requires gateway.auth.trustedProxy.userHeader.';
  }

  if (
    nonLoopback &&
    state.corsOrigins.length === 0 &&
    !state.dangerouslyAllowHostHeaderOriginFallback
  ) {
    const bindHost =
      state.bind === 'custom'
        ? state.customBindHost.trim()
        : state.bind === 'lan'
          ? '0.0.0.0'
          : undefined;
    const suggested = buildDefaultCorsOrigins(state.port, bindHost).join(', ');
    return `Network-accessible gateway requires CORS origins (e.g. ${suggested}) or enable Host-header origin fallback.`;
  }

  if (nonLoopback && state.corsOrigins.includes('*')) {
    return 'CORS wildcard "*" is not allowed on network-accessible binds.';
  }

  if (state.bind === 'custom' && !state.customBindHost.trim()) {
    return 'Custom bind mode requires a bind address.';
  }

  return null;
}

export function normalizeGatewayFromConfig(config: unknown): GatewaySettingsState {
  const c = isRecord(config) ? config : {};
  const gw = isRecord(c.gateway) ? c.gateway : {};
  const auth = isRecord(gw.auth) ? gw.auth : {};
  const security = isRecord(gw.security) ? gw.security : {};
  const upd = isRecord(c.update) ? c.update : {};
  const auto = isRecord(upd.auto) ? upd.auto : {};
  const ch = upd.channel;
  const updateChannel: UpdatePackageChannel =
    ch === 'beta' || ch === 'dev' || ch === 'stable' ? ch : 'stable';
  const corsOrigins = Array.isArray(gw.corsOrigins)
    ? gw.corsOrigins.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const bind = normalizeBindMode(gw.bind);
  const customBindHost =
    typeof gw.customBindHost === 'string' && gw.customBindHost.trim()
      ? gw.customBindHost.trim()
      : '';
  return {
    bind,
    customBindHost,
    port:
      typeof gw.port === 'number' && Number.isFinite(gw.port) ? Math.floor(gw.port) : DEFAULT_GATEWAY_PORT,
    auth: {
      mode: normalizeAuthMode(auth.mode),
      token: typeof auth.token === 'string' ? auth.token : '',
      password: typeof auth.password === 'string' ? auth.password : '',
      rateLimit: normalizeRateLimit(auth.rateLimit),
      trustedProxy: normalizeTrustedProxy(auth.trustedProxy),
    },
    corsOrigins,
    trustedProxies: normalizeStringIdList(gw.trustedProxies, 64),
    allowRealIpFallback: gw.allowRealIpFallback === true,
    dangerouslyAllowHostHeaderOriginFallback: gw.dangerouslyAllowHostHeaderOriginFallback === true,
    securityStrict: security.strict === true,
    maxSseConnections:
      typeof gw.maxSseConnections === 'number' && Number.isFinite(gw.maxSseConnections)
        ? Math.max(1, Math.floor(gw.maxSseConnections))
        : DEFAULT_MAX_SSE_CONNECTIONS,
    channelConnectDeferMode: normalizeDeferMode(gw.channelConnectDeferMode),
    channelConnectDeferIds: normalizeStringIdList(gw.channelConnectDeferIds),
    channelConnectDeferSkipIds: normalizeStringIdList(gw.channelConnectDeferSkipIds),
    updateChannel,
    updateCheckOnStart: upd.checkOnStart !== false,
    updateAutoEnabled: auto.enabled === true,
    updateAutoStableDelayHours:
      typeof auto.stableDelayHours === 'number' && Number.isFinite(auto.stableDelayHours)
        ? Math.max(0, Math.floor(auto.stableDelayHours))
        : 6,
    updateAutoStableJitterHours:
      typeof auto.stableJitterHours === 'number' && Number.isFinite(auto.stableJitterHours)
        ? Math.max(0, Math.floor(auto.stableJitterHours))
        : 12,
    updateAutoBetaCheckIntervalHours:
      typeof auto.betaCheckIntervalHours === 'number' && Number.isFinite(auto.betaCheckIntervalHours)
        ? Math.max(0.25, auto.betaCheckIntervalHours)
        : 1,
  };
}

function buildAuthPatch(state: GatewaySettingsState): Record<string, unknown> {
  const auth: Record<string, unknown> = {
    mode: state.auth.mode,
    rateLimit: state.auth.rateLimit,
  };

  if (state.auth.mode === 'token') {
    const token = state.auth.token.trim();
    if (token.length > 0 && !isMaskedGatewaySecret(token)) {
      auth.token = state.auth.token;
    }
    auth.password = null;
    auth.trustedProxy = null;
  } else if (state.auth.mode === 'password') {
    const password = state.auth.password.trim();
    if (password.length > 0 && !isMaskedGatewaySecret(password)) {
      auth.password = state.auth.password;
    }
    auth.token = null;
    auth.trustedProxy = null;
  } else if (state.auth.mode === 'trusted-proxy') {
    auth.token = null;
    auth.password = null;
    const tp = state.auth.trustedProxy;
    auth.trustedProxy = {
      userHeader: tp.userHeader.trim(),
      ...(tp.requiredHeaders.length > 0 ? { requiredHeaders: tp.requiredHeaders } : {}),
      ...(tp.allowUsers.length > 0 ? { allowUsers: tp.allowUsers } : {}),
      ...(tp.allowLoopback ? { allowLoopback: true } : {}),
    };
  } else {
    auth.token = null;
    auth.password = null;
    auth.trustedProxy = null;
  }

  return auth;
}

export async function fetchGatewaySettings(): Promise<GatewaySettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  return normalizeGatewayFromConfig(res.payload?.config ?? {});
}

export async function patchGatewaySettings(state: GatewaySettingsState): Promise<void> {
  const validationError = validateGatewaySettings(state);
  if (validationError) {
    throw new Error(validationError);
  }

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      gateway: {
        bind: state.bind,
        ...(state.bind === 'custom' ? { customBindHost: state.customBindHost.trim() } : {}),
        port: state.port,
        auth: buildAuthPatch(state),
        corsOrigins: state.corsOrigins,
        trustedProxies: state.trustedProxies,
        allowRealIpFallback: state.allowRealIpFallback,
        dangerouslyAllowHostHeaderOriginFallback: state.dangerouslyAllowHostHeaderOriginFallback,
        security: { strict: state.securityStrict },
        maxSseConnections: state.maxSseConnections,
        channelConnectDeferMode: state.channelConnectDeferMode,
        channelConnectDeferIds: state.channelConnectDeferIds,
        channelConnectDeferSkipIds: state.channelConnectDeferSkipIds,
      },
      update: {
        channel: state.updateChannel,
        checkOnStart: state.updateCheckOnStart,
        auto: {
          enabled: state.updateAutoEnabled,
          stableDelayHours: state.updateAutoStableDelayHours,
          stableJitterHours: state.updateAutoStableJitterHours,
          betaCheckIntervalHours: state.updateAutoBetaCheckIntervalHours,
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
