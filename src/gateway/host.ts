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

export function buildDefaultCorsOrigins(params: { port: number; bindHost?: string }): string[] {
  const origins = new Set<string>([
    `http://localhost:${params.port}`,
    `http://127.0.0.1:${params.port}`,
    ...GATEWAY_DEV_CONSOLE_ORIGINS,
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
  return [...new Set([...configured, ...GATEWAY_DEV_CONSOLE_ORIGINS])];
}
