import type { Context } from 'hono';

import type { GatewayScope } from './gateway-scopes.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';

export type GatewayPrincipal = {
  kind: 'owner' | 'device' | 'trusted-proxy';
  principalId: string;
  deviceId?: string;
  accessSessionId?: string;
  browserSessionId?: string;
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

export function getPersonalOwnerId(c: Context): string | null {
  const principal = getGatewayPrincipal(c);
  if (principal.kind === 'owner') return 'local-owner';
  if (principal.kind !== 'device' || !principal.deviceId) return null;
  const platform = getDevice(principal.deviceId)?.platform;
  return platform === 'harmonyos' || platform === 'ios' || platform === 'android' ? 'local-owner' : null;
}
