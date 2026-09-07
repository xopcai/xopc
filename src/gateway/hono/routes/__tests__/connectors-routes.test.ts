import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { DEFAULT_MOBILE_SCOPES, type GatewayScope } from '../../../security/gateway-scopes.js';
import { gatewayScopes } from '../../middleware/scopes.js';

const { listConnectorApprovals, getConnectorApproval, decideConnectorApproval } = vi.hoisted(() => ({
  listConnectorApprovals: vi.fn(() => []),
  getConnectorApproval: vi.fn(),
  decideConnectorApproval: vi.fn(),
}));

vi.mock('../../../../storage/sqlite/index.js', async (original) => ({
  ...await original<typeof import('../../../../storage/sqlite/index.js')>(),
  listConnectorApprovals,
  getConnectorApproval,
  decideConnectorApproval,
}));

import { registerConnectorRoutes } from '../connectors.js';

function app(scopes: readonly GatewayScope[] = ['gateway.admin']) {
  const hono = new Hono();
  hono.use('*', async (c, next) => {
    setGatewayPrincipal(c, { kind: 'device', principalId: 'phone', scopes });
    await next();
  });
  hono.use('*', gatewayScopes());
  registerConnectorRoutes(hono, {
    service: { currentConfig: {} },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return hono;
}

describe('connector routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a normally paired phone list confirmations for its conversation', async () => {
    const response = await app(DEFAULT_MOBILE_SCOPES).request('/api/connectors/approvals?status=pending&sessionKey=agent%3Amain%3Awebchat%3Achat');
    expect(response.status).toBe(200);
    expect(listConnectorApprovals).toHaveBeenCalledWith(expect.objectContaining({ principalId: 'local-owner', sessionKey: 'agent:main:webchat:chat' }));
  });

  it.each(['?status=pending', '?sessionKey=chat&principalId=someone-else'])('rejects unscoped mobile reads %s', async query => {
    expect((await app(DEFAULT_MOBILE_SCOPES).request(`/api/connectors/approvals${query}`)).status).toBe(403);
    expect(listConnectorApprovals).not.toHaveBeenCalled();
  });

  it.each(['approved', 'denied'])('lets a paired phone submit %s for the matching session', async decision => {
    getConnectorApproval.mockReturnValue({ id: 'confirmation', principalId: 'local-owner', sessionKey: 'chat' });
    decideConnectorApproval.mockReturnValue({ id: 'confirmation', status: decision });
    const response = await app(DEFAULT_MOBILE_SCOPES).request('/api/connectors/approvals/respond', {
      method: 'POST', body: JSON.stringify({ id: 'confirmation', sessionKey: 'chat', decision }),
    });
    expect(response.status).toBe(200);
    expect(decideConnectorApproval).toHaveBeenCalledWith('confirmation', decision);
  });

  it.each([
    ['chat', undefined, 'local-owner'],
    ['other-chat', 'chat', 'local-owner'],
    ['chat', 'chat', 'someone-else'],
    [undefined, 'chat', 'local-owner'],
  ])('rejects mismatched confirmation context', async (storedSessionKey, sessionKey, principalId) => {
    getConnectorApproval.mockReturnValue({ id: 'confirmation', principalId, sessionKey: storedSessionKey });
    const response = await app(DEFAULT_MOBILE_SCOPES).request('/api/connectors/approvals/respond', {
      method: 'POST', body: JSON.stringify({ id: 'confirmation', sessionKey, decision: 'approved' }),
    });
    expect(response.status).toBe(403);
    expect(decideConnectorApproval).not.toHaveBeenCalled();
  });

  it('rejects confirmation writes from a read-only device', async () => {
    const response = await app(['sessions.read']).request('/api/connectors/approvals/respond', {
      method: 'POST', body: JSON.stringify({ id: 'confirmation', sessionKey: 'chat', decision: 'approved' }),
    });
    expect(response.status).toBe(403);
    expect(getConnectorApproval).not.toHaveBeenCalled();
  });
  it('matches the approvals collection before the connector id route', async () => {
    const response = await app().request('/api/connectors/approvals?status=pending');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, payload: { approvals: [] } });
    expect(listConnectorApprovals).toHaveBeenCalledWith({
      principalId: 'local-owner',
      sessionKey: undefined,
      status: 'pending',
      limit: 100,
    });
  });
});
