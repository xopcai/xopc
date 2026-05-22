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
  type GatewayChannelConnectDeferMode,
  type GatewaySettingsState,
  type UpdatePackageChannel,
} from './gateway-settings.types';

export type {
  GatewayAuthMode,
  GatewayAuthRateLimitState,
  GatewayChannelConnectDeferMode,
  GatewaySettingsState,
  UpdatePackageChannel,
} from './gateway-settings.types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isMaskedGatewaySecret(value: string): boolean {
  return value === '***' || value === '••••••••••••';
}

function normalizeAuthMode(raw: unknown): GatewayAuthMode {
  if (raw === 'none' || raw === 'token' || raw === 'password') return raw;
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
        : DEFAULT_AUTH_RATE_LIMIT.blockDurationMs,
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

export function normalizeGatewayFromConfig(config: unknown): GatewaySettingsState {
  const c = isRecord(config) ? config : {};
  const gw = isRecord(c.gateway) ? c.gateway : {};
  const auth = isRecord(gw.auth) ? gw.auth : {};
  const upd = isRecord(c.update) ? c.update : {};
  const ch = upd.channel;
  const updateChannel: UpdatePackageChannel =
    ch === 'beta' || ch === 'dev' || ch === 'stable' ? ch : 'stable';
  const corsOrigins = Array.isArray(gw.corsOrigins)
    ? gw.corsOrigins.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  return {
    host: typeof gw.host === 'string' ? gw.host : '',
    port:
      typeof gw.port === 'number' && Number.isFinite(gw.port) ? Math.floor(gw.port) : DEFAULT_GATEWAY_PORT,
    auth: {
      mode: normalizeAuthMode(auth.mode),
      token: typeof auth.token === 'string' ? auth.token : '',
      password: typeof auth.password === 'string' ? auth.password : '',
      rateLimit: normalizeRateLimit(auth.rateLimit),
    },
    corsOrigins,
    maxSseConnections:
      typeof gw.maxSseConnections === 'number' && Number.isFinite(gw.maxSseConnections)
        ? Math.max(1, Math.floor(gw.maxSseConnections))
        : DEFAULT_MAX_SSE_CONNECTIONS,
    channelConnectDeferMode: normalizeDeferMode(gw.channelConnectDeferMode),
    channelConnectDeferIds: normalizeStringIdList(gw.channelConnectDeferIds),
    channelConnectDeferSkipIds: normalizeStringIdList(gw.channelConnectDeferSkipIds),
    updateChannel,
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
  } else if (state.auth.mode === 'password') {
    const password = state.auth.password.trim();
    if (password.length > 0 && !isMaskedGatewaySecret(password)) {
      auth.password = state.auth.password;
    }
    auth.token = null;
  }

  return auth;
}

export async function fetchGatewaySettings(): Promise<GatewaySettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  return normalizeGatewayFromConfig(res.payload?.config ?? {});
}

export async function patchGatewaySettings(state: GatewaySettingsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      gateway: {
        host: state.host.trim() || '127.0.0.1',
        port: state.port,
        auth: buildAuthPatch(state),
        corsOrigins: state.corsOrigins,
        maxSseConnections: state.maxSseConnections,
        channelConnectDeferMode: state.channelConnectDeferMode,
        channelConnectDeferIds: state.channelConnectDeferIds,
        channelConnectDeferSkipIds: state.channelConnectDeferSkipIds,
      },
      update: {
        channel: state.updateChannel,
      },
    }),
  });
  void revalidateGatewayConfig();
}
