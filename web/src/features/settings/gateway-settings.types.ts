export type GatewayAuthMode = 'none' | 'token' | 'password';

export type UpdatePackageChannel = 'stable' | 'beta' | 'dev';

export interface GatewayAuthRateLimitState {
  enabled: boolean;
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
}

export type GatewayChannelConnectDeferMode = 'auto' | 'off' | 'explicit';

export interface GatewaySettingsState {
  host: string;
  port: number;
  auth: {
    mode: GatewayAuthMode;
    token: string;
    password: string;
    rateLimit: GatewayAuthRateLimitState;
  };
  /** Browser origin allowlist (`gateway.corsOrigins`). Empty uses gateway localhost defaults. */
  corsOrigins: string[];
  maxSseConnections: number;
  channelConnectDeferMode: GatewayChannelConnectDeferMode;
  channelConnectDeferIds: string[];
  channelConnectDeferSkipIds: string[];
  /** npm / CLI update channel (config `update.channel`). */
  updateChannel: UpdatePackageChannel;
}

export const DEFAULT_GATEWAY_PORT = 18790;
export const DEFAULT_MAX_SSE_CONNECTIONS = 100;
export const MAX_CHANNEL_DEFER_LIST_SIZE = 24;

export const DEFAULT_AUTH_RATE_LIMIT: GatewayAuthRateLimitState = {
  enabled: true,
  maxAttempts: 5,
  windowMs: 900_000,
  blockDurationMs: 300_000,
};
