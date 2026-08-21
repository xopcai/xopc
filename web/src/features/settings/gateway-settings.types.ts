export type GatewayBindMode = 'auto' | 'loopback' | 'lan' | 'tailnet' | 'custom';

export type GatewayAuthMode = 'none' | 'token' | 'password' | 'trusted-proxy';

export type UpdatePackageChannel = 'stable' | 'beta' | 'dev';

export interface GatewayAuthRateLimitState {
  enabled: boolean;
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
  exemptLoopback: boolean;
}

export interface GatewayTrustedProxyState {
  userHeader: string;
  requiredHeaders: string[];
  allowUsers: string[];
  allowLoopback: boolean;
}

export type GatewayChannelConnectDeferMode = 'auto' | 'off' | 'explicit';

export interface GatewaySettingsState {
  bind: GatewayBindMode;
  customBindHost: string;
  port: number;
  auth: {
    mode: GatewayAuthMode;
    token: string;
    password: string;
    rateLimit: GatewayAuthRateLimitState;
    trustedProxy: GatewayTrustedProxyState;
  };
  /** Browser origin allowlist (`gateway.corsOrigins`). Empty uses gateway localhost defaults. */
  corsOrigins: string[];
  /** Reverse-proxy CIDRs allowed to terminate trusted-proxy auth. */
  trustedProxies: string[];
  /** Fall back to X-Real-IP when X-Forwarded-For parsing fails (default false). */
  allowRealIpFallback: boolean;
  /** Dangerous: allow browser Origin to match HTTP Host when not in corsOrigins. */
  dangerouslyAllowHostHeaderOriginFallback: boolean;
  /** When true, non-loopback binds require explicit gateway.auth.rateLimit. */
  securityStrict: boolean;
  channelConnectDeferMode: GatewayChannelConnectDeferMode;
  channelConnectDeferIds: string[];
  channelConnectDeferSkipIds: string[];
  /** npm / CLI update channel (config `update.channel`). */
  updateChannel: UpdatePackageChannel;
  updateCheckOnStart: boolean;
  updateAutoEnabled: boolean;
  updateAutoStableDelayHours: number;
  updateAutoStableJitterHours: number;
  updateAutoBetaCheckIntervalHours: number;
}

export const DEFAULT_GATEWAY_PORT = 18790;
export const MAX_CHANNEL_DEFER_LIST_SIZE = 24;

export const DEFAULT_AUTH_RATE_LIMIT: GatewayAuthRateLimitState = {
  enabled: true,
  maxAttempts: 5,
  windowMs: 900_000,
  blockDurationMs: 300_000,
  exemptLoopback: true,
};

export const DEFAULT_TRUSTED_PROXY: GatewayTrustedProxyState = {
  userHeader: '',
  requiredHeaders: [],
  allowUsers: [],
  allowLoopback: false,
};
