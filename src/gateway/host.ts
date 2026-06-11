import { DEFAULT_GATEWAY_PORT } from '../daemon/constants.js';

/** True when the bind address is local-only (127.x, localhost, ::1). */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) {
    return true;
  }
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  );
}

/** True when the gateway listens on all interfaces. */
export function isAllInterfacesHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  const normalized = host.trim();
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '*';
}

/** Vite dev server origins for the gateway console (`web/` defaults to port 3000). */
export const GATEWAY_DEV_CONSOLE_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
] as const;

/** Expo / React Native web dev server (Metro defaults to port 8081). */
export const GATEWAY_EXPO_DEV_ORIGINS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
] as const;

const GATEWAY_LOOPBACK_DEV_ORIGINS = [
  ...GATEWAY_DEV_CONSOLE_ORIGINS,
  ...GATEWAY_EXPO_DEV_ORIGINS,
] as const;

/** Effective HTTP listen port: CLI `--port` override wins over config (default 18790). */
export function resolveEffectiveGatewayPort(
  config: { gateway?: { port?: number } },
  listenPortOverride?: number,
): number {
  if (typeof listenPortOverride === 'number' && Number.isFinite(listenPortOverride)) {
    return listenPortOverride;
  }
  return config.gateway?.port ?? DEFAULT_GATEWAY_PORT;
}

/** Resolve listen port from a gateway service (supports partial test mocks without `getEffectiveListenPort`). */
export function resolveGatewayServiceListenPort(service: {
  currentConfig: { gateway?: { port?: number } };
  getEffectiveListenPort?: () => number;
}): number {
  if (typeof service.getEffectiveListenPort === 'function') {
    return service.getEffectiveListenPort();
  }
  return resolveEffectiveGatewayPort(service.currentConfig);
}

export function buildDefaultCorsOrigins(params: { port: number; bindHost?: string }): string[] {
  const origins = new Set<string>([
    `http://localhost:${params.port}`,
    `http://127.0.0.1:${params.port}`,
    ...GATEWAY_LOOPBACK_DEV_ORIGINS,
  ]);
  const bindHost = params.bindHost?.trim();
  if (bindHost && !isLoopbackHost(bindHost) && !isAllInterfacesHost(bindHost)) {
    origins.add(`http://${bindHost}:${params.port}`);
  }
  return [...origins];
}

/**
 * Effective browser origins for CORS and CSRF checks.
 * Custom `gateway.corsOrigins` (e.g. after LAN pairing) still merge loopback Vite dev origins.
 */
export function resolveGatewayCorsOrigins(params: {
  configuredOrigins?: string[];
  port: number;
  bindHost?: string;
}): string[] {
  const configured = (params.configuredOrigins ?? [])
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length === 0) {
    return buildDefaultCorsOrigins({ port: params.port, bindHost: params.bindHost });
  }
  return [...new Set([...configured, ...GATEWAY_LOOPBACK_DEV_ORIGINS])];
}

/** Browser origin (`https://host`) from a gateway public/tunnel root URL. */
export function originFromGatewayPublicUrl(publicUrl: string | null | undefined): string | null {
  const trimmed = publicUrl?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** CORS + CSRF allowlist including active FRP tunnel + reverse-proxy origins. */
export function resolveAllowedBrowserOrigins(params: {
  configuredOrigins?: string[];
  port: number;
  bindHost?: string;
  tunnelPublicUrl?: string | null;
  /** User-configured reverse-proxy public URL (gateway.publicUrl). */
  reverseProxyPublicUrl?: string | null;
}): string[] {
  const origins = resolveGatewayCorsOrigins({
    configuredOrigins: params.configuredOrigins,
    port: params.port,
    bindHost: params.bindHost,
  });
  const tunnelOrigin = originFromGatewayPublicUrl(params.tunnelPublicUrl);
  if (tunnelOrigin && !origins.includes(tunnelOrigin)) {
    origins.push(tunnelOrigin);
  }
  const reverseProxyOrigin = originFromGatewayPublicUrl(params.reverseProxyPublicUrl);
  if (reverseProxyOrigin && !origins.includes(reverseProxyOrigin)) {
    origins.push(reverseProxyOrigin);
  }
  return origins;
}
