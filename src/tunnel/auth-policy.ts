import type { ResolvedGatewayAuth } from '../gateway/auth.js';

/** A public FRP ingress cannot trust local sockets or proxy identity headers. */
export function requireTunnelGatewayToken(auth: ResolvedGatewayAuth): string {
  if (auth.mode !== 'token' || !auth.token?.trim()) {
    throw new Error('Public remote access requires gateway token authentication.');
  }
  return auth.token;
}
