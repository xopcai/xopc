import type { PersistedTunnelState, TunnelRegistration } from './tunnel-types.js';

export function persistedFromRegistration(registration: TunnelRegistration): PersistedTunnelState {
  return {
    tunnelId: registration.tunnelId,
    tunnelToken: registration.tunnelToken,
    subdomain: registration.subdomain,
    publicUrl: registration.publicUrl,
    frpcAuthToken: registration.frpc.authToken,
    registeredAt: new Date().toISOString(),
    enabled: true,
    frpcServerAddr: registration.frpc.serverAddr,
    frpcServerPort: registration.frpc.serverPort,
    proxyName: registration.frpc.proxyName,
    heartbeatIntervalMs: registration.heartbeatIntervalMs,
  };
}

/** Rebuild registration from disk when Broker row is still valid (stop without deregister). */
export function registrationFromPersisted(
  persisted: PersistedTunnelState,
): TunnelRegistration | null {
  if (
    !persisted.frpcAuthToken ||
    !persisted.frpcServerAddr ||
    !persisted.frpcServerPort ||
    !persisted.proxyName
  ) {
    return null;
  }
  return {
    tunnelId: persisted.tunnelId,
    tunnelToken: persisted.tunnelToken,
    subdomain: persisted.subdomain,
    publicUrl: persisted.publicUrl,
    frpc: {
      serverAddr: persisted.frpcServerAddr,
      serverPort: persisted.frpcServerPort,
      authToken: persisted.frpcAuthToken,
      proxyName: persisted.proxyName,
    },
    expiresAt: '',
    heartbeatIntervalMs: persisted.heartbeatIntervalMs ?? 30_000,
  };
}

export function canResumePersistedTunnel(persisted: PersistedTunnelState | null): persisted is PersistedTunnelState {
  return Boolean(
    persisted?.tunnelId &&
      persisted.tunnelToken &&
      persisted.subdomain &&
      persisted.frpcAuthToken &&
      registrationFromPersisted(persisted),
  );
}
