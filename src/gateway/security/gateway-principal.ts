import type { Context } from 'hono';

import type { GatewayScope } from './gateway-scopes.js';

export type GatewayPrincipal = {
  kind: 'owner' | 'device' | 'trusted-proxy';
  principalId: string;
  deviceId?: string;
  accessSessionId?: string;
  scopes: readonly GatewayScope[];
};

const PRINCIPAL_CONTEXT_KEY = 'gatewayPrincipal';

export function setGatewayPrincipal(c: Context, principal: GatewayPrincipal): void {
  c.set(PRINCIPAL_CONTEXT_KEY, principal);
}

export function getGatewayPrincipal(c: Context): GatewayPrincipal {
  const principal = c.get(PRINCIPAL_CONTEXT_KEY) as GatewayPrincipal | undefined;
  if (!principal) throw new Error('Gateway principal is unavailable');
  return principal;
}
