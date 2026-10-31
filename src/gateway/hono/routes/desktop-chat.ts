import { DESKTOP_CHAT_MANIFEST } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';

import { getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerDesktopChatRoutes(authenticated: Hono, { service }: AuthenticatedRouteDeps): void {
  authenticated.get('/api/desktop-chat/bootstrap', c => {
    c.header('Cache-Control', 'no-store');
    const principal = getGatewayPrincipal(c);
    if (principal.kind !== 'owner' || !principal.scopes.includes('gateway.admin')
      || service.getResolvedAuth().mode !== 'token') {
      return c.json({ ok: false, error: { code: 'OWNER_TOKEN_REQUIRED' } }, 403);
    }
    const { id, publicKey } = getOrCreateGatewayIdentity();
    return c.json({ ok: true, payload: { gatewayId: id, publicKey, manifest: DESKTOP_CHAT_MANIFEST } });
  });
}
