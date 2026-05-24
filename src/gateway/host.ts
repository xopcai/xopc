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

export function buildDefaultCorsOrigins(params: { port: number; bindHost?: string }): string[] {
  const origins = new Set<string>([
    `http://localhost:${params.port}`,
    `http://127.0.0.1:${params.port}`,
  ]);
  const bindHost = params.bindHost?.trim();
  if (bindHost && !isLoopbackHost(bindHost) && !isAllInterfacesHost(bindHost)) {
    origins.add(`http://${bindHost}:${params.port}`);
  }
  return [...origins];
}
