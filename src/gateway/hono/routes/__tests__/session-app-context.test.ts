import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { submitSessionInput, replaceLatestSessionTurn } from '../session-input-handler.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { CapabilityError } from '../../../../capabilities/runtime/dispatcher.js';

function fixture() {
  const source = { kind: 'app_context', text: 'Frozen body', sourceId: 'tab:1', version: 'hash', title: 'Application context' };
  const service = {
    endpointTools: { registry: { verifyTurnClaim: () => true } },
    prepareSessionAppContext: vi.fn(async () => source),
    submitSessionInput: vi.fn(async () => ({ ok: true, state: {} })),
    replaceLatestSessionTurn: vi.fn(),
  };
  const app = new Hono();
  const principal = { kind: 'owner' as const, principalId: 'authenticated-owner', scopes: ['gateway.admin' as const] };
  app.use('*', async (c, next) => { setGatewayPrincipal(c, principal); await next(); });
  app.post('/input', c => submitSessionInput(c, { service } as never, 'conversation'));
  app.post('/replace', c => replaceLatestSessionTurn(c, { service } as never, 'conversation', 'turn'));
  const snapshot = { version: 1, resourceRefs: [] };
  const send = (path = '/input') => app.request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      content: 'Review', clientMessageId: 'intent', delivery: 'next', appContext: snapshot,
      origin: { type: 'endpoint', endpointId: 'tab', token: 'a'.repeat(32) },
    }),
  });
  return { service, principal, snapshot, source, send };
}

describe('application context input adapter', () => {
  it('uses the authenticated principal and only queues server-prepared context', async () => {
    const { service, principal, snapshot, source, send } = fixture();
    expect((await send()).status).toBe(202);
    expect(service.prepareSessionAppContext).toHaveBeenCalledWith(snapshot, principal, 'conversation', 'intent');
    expect(service.submitSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sourceContexts: [source] }));
  });

  it.each([
    [new CapabilityError('FORBIDDEN', 'Revoked'), 403],
    [new CapabilityError('REVISION_CONFLICT', 'Changed'), 409],
    [new CapabilityError('INVALID_INPUT', 'Invalid envelope'), 400],
    [new Error('Database unavailable'), 503],
  ])('never queues context when resolution fails (%s)', async (error, status) => {
    const { service, send } = fixture();
    service.prepareSessionAppContext.mockRejectedValue(error);
    expect((await send()).status).toBe(status);
    expect(service.submitSessionInput).not.toHaveBeenCalled();
  });

  it('explicitly rejects unsupported replacement context instead of silently discarding it', async () => {
    const { service, send } = fixture();
    expect((await send('/replace')).status).toBe(400);
    expect(service.replaceLatestSessionTurn).not.toHaveBeenCalled();
  });
});
